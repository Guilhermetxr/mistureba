// Todas as gravações no Firestore passam por aqui.
// Vendas usam batch + increment (sem transação) para funcionar offline:
// o PDV grava no cache local na hora e sincroniza quando a internet volta.
import { db, fb, auth, firebaseConfig, isEmulator } from "./firebase.js";
import { state, costBook, ingredient, method, isAdmin } from "./store.js";
import { isoDate, isoMonth, addDays } from "./format.js";
import { buildStatsPatch } from "./stats.js";

const { doc, collection, writeBatch, increment, serverTimestamp, setDoc, updateDoc, addDoc, getDoc, getDocs, deleteDoc, query, where, arrayUnion } = fb;

const col = (name) => collection(db, name);
const newId = (name) => doc(col(name)).id;
const nowIso = () => new Date().toISOString();
const user = () => ({ uid: auth.currentUser?.uid ?? null, name: state.profile?.name ?? "" });

/** Commit que não trava a tela quando está offline (grava no cache e segue). */
async function commit(batch, label = "Gravação") {
  const p = batch.commit();
  p.catch((e) => {
    console.error(label, e);
    import("./ui.js").then(({ toast }) => toast(`${label} não sincronizou: ${e.message}`, "bad"));
  });
  await Promise.race([p, new Promise((r) => setTimeout(r, state.online ? 4000 : 150))]);
}

/* ------------------------------------------------------------------ */
/* Taxas                                                                */
/* ------------------------------------------------------------------ */
export function feeFor(m, amountCents) {
  if (!m || amountCents <= 0) return 0;
  const p = (Number(m.fee_percent) || 0) + (Number(m.anticipation_percent) || 0);
  return Math.round((amountCents * p) / 100) + (Number(m.fixed_fee_cents) || 0);
}

/* ------------------------------------------------------------------ */
/* Estatísticas diárias (agregados para relatórios baratos)            */
/* ------------------------------------------------------------------ */
const statsPatch = (sale, sign) => buildStatsPatch(sale, sign, increment);
const statsRef = (day) => doc(db, "dailyStats", day);

/* ------------------------------------------------------------------ */
/* Vendas                                                               */
/* ------------------------------------------------------------------ */
/**
 * cart = { channel, items:[{productId,name,qty,price,notes}], payments:[{methodId,amount,received,stoneOrderId}],
 *          discount, deliveryFee, customer, notes }
 */
export async function createSale(cart) {
  const book = costBook();
  const now = new Date();
  const day = isoDate(now);
  const channel = cart.channel || "balcao";
  if (!cart.items.length) throw new Error("Carrinho vazio.");
  if (channel !== "ifood" && !state.session) throw new Error("Abra o caixa antes de vender.");

  const items = cart.items.map((it) => {
    const p = state.products.find((x) => x.id === it.productId);
    return {
      productId: it.productId ?? null,
      name: it.name,
      category: p?.category ?? "",
      qty: it.qty,
      price: it.price,
      cost: it.productId ? book.unitCostCents(it.productId) : 0,
      notes: it.notes || "",
    };
  });
  const subtotal = items.reduce((s, i) => s + i.qty * i.price, 0);
  const discount = Math.max(0, cart.discount || 0);
  const deliveryFee = Math.max(0, cart.deliveryFee || 0);
  const total = subtotal - discount + deliveryFee;
  if (total < 0) throw new Error("Desconto maior que o total.");

  const ifoodCfg = state.settings.ifood;
  const payments = cart.payments.map((p) => {
    const m = method(p.methodId);
    let fee = feeFor(m, p.amount);
    if (m?.kind === "ifood") fee = Math.round((p.amount * (Number(ifoodCfg.payment_fee_percent) || 0)) / 100);
    const settleDays = m?.kind === "ifood" ? Number(ifoodCfg.settlement_days) || 30 : Number(m?.settlement_days) || 0;
    return {
      methodId: p.methodId,
      name: m?.name ?? "Outro",
      kind: m?.kind ?? "outro",
      installments: m?.installments ?? 1,
      amount: p.amount,
      fee,
      received: p.received ?? null,
      change: p.change ?? 0,
      settleDate: addDays(day, settleDays),
      stoneOrderId: p.stoneOrderId ?? null,
    };
  });
  const paid = payments.reduce((s, p) => s + p.amount, 0);
  if (paid !== total) throw new Error("A soma dos pagamentos precisa bater com o total.");

  const cost = items.reduce((s, i) => s + i.qty * i.cost, 0);
  const fees = payments.reduce((s, p) => s + p.fee, 0);
  const commission = channel === "ifood" ? Math.round((subtotal * (Number(ifoodCfg.commission_percent) || 0)) / 100) : 0;

  // Baixa de estoque pela ficha técnica
  const usage = {};
  for (const it of items) {
    if (!it.productId) continue;
    for (const [ingId, q] of book.usage(it.productId)) usage[ingId] = (usage[ingId] ?? 0) + q * it.qty;
  }

  const id = newId("sales");
  const session = channel !== "ifood" || state.session ? state.session : null;
  const number = (session?.salesCount ?? 0) + 1;
  const sale = {
    number,
    channel,
    status: "concluida",
    items,
    payments,
    subtotal,
    discount,
    deliveryFee,
    total,
    cost,
    fees,
    commission,
    usage,
    customer: cart.customer || "",
    notes: cart.notes || "",
    day,
    month: isoMonth(now),
    hour: String(now.getHours()).padStart(2, "0"),
    clientAt: nowIso(),
    createdAt: serverTimestamp(),
    cashSessionId: session?.id ?? null,
    userId: user().uid,
    userName: user().name,
  };

  const b = writeBatch(db);
  b.set(doc(db, "sales", id), sale);
  for (const [ingId, q] of Object.entries(usage)) b.update(doc(db, "ingredients", ingId), { stock: increment(-q) });
  b.set(statsRef(day), statsPatch(sale, 1), { merge: true });
  if (session) {
    const cashIn = payments.filter((p) => p.kind === "dinheiro").reduce((s, p) => s + p.amount, 0);
    const totals = {};
    for (const p of payments) totals[p.methodId || p.kind] = increment(p.amount);
    b.update(doc(db, "cashSessions", session.id), {
      salesCount: increment(1),
      revenue: increment(total),
      cashSales: increment(cashIn),
      ...Object.fromEntries(Object.entries(totals).map(([k, v]) => [`totals.${k}`, v])),
    });
  }
  await commit(b, "Venda");
  return { id, number, total, change: payments.reduce((s, p) => s + (p.change || 0), 0) };
}

export async function cancelSale(sale, reason) {
  if (sale.status === "cancelada") throw new Error("Venda já cancelada.");
  const b = writeBatch(db);
  b.update(doc(db, "sales", sale.id), { status: "cancelada", cancelReason: reason || "", canceledAt: nowIso(), canceledBy: user().name });
  for (const [ingId, q] of Object.entries(sale.usage ?? {})) {
    if (ingredient(ingId)) b.update(doc(db, "ingredients", ingId), { stock: increment(q) });
  }
  b.set(statsRef(sale.day), statsPatch(sale, -1), { merge: true });
  if (sale.cashSessionId && state.session?.id === sale.cashSessionId) {
    const cashIn = sale.payments.filter((p) => p.kind === "dinheiro").reduce((s, p) => s + p.amount, 0);
    const upd = { revenue: increment(-sale.total), cashSales: increment(-cashIn) };
    for (const p of sale.payments) upd[`totals.${p.methodId || p.kind}`] = increment(-p.amount);
    b.update(doc(db, "cashSessions", sale.cashSessionId), upd);
  }
  await commit(b, "Cancelamento");
}

/* ------------------------------------------------------------------ */
/* Caixa                                                                */
/* ------------------------------------------------------------------ */
export async function openCash(opening) {
  if (state.session) throw new Error("Já existe um caixa aberto.");
  const b = writeBatch(db);
  b.set(doc(col("cashSessions")), {
    status: "aberto",
    day: isoDate(),
    openedAt: serverTimestamp(),
    openedAtIso: nowIso(),
    openedBy: user().uid,
    openedByName: user().name,
    opening,
    salesCount: 0,
    revenue: 0,
    cashSales: 0,
    sangrias: 0,
    suprimentos: 0,
    totals: {},
    movements: [],
  });
  await commit(b, "Abertura de caixa");
}

export async function cashMovement(type, amount, reason) {
  if (!state.session) throw new Error("Nenhum caixa aberto.");
  if (amount <= 0) throw new Error("Informe um valor.");
  const b = writeBatch(db);
  b.update(doc(db, "cashSessions", state.session.id), {
    [type === "sangria" ? "sangrias" : "suprimentos"]: increment(amount),
    movements: arrayUnion({ type, amount, reason: reason || "", at: nowIso(), by: user().name }),
  });
  await commit(b, "Movimento de caixa");
}

export function expectedCash(s) {
  return (s.opening || 0) + (s.cashSales || 0) + (s.suprimentos || 0) - (s.sangrias || 0);
}

export async function closeCash(counted, notes) {
  const s = state.session;
  if (!s) throw new Error("Nenhum caixa aberto.");
  const expected = expectedCash(s);
  const b = writeBatch(db);
  b.update(doc(db, "cashSessions", s.id), {
    status: "fechado",
    closedAt: serverTimestamp(),
    closedAtIso: nowIso(),
    closedBy: user().uid,
    closedByName: user().name,
    expected,
    counted,
    difference: counted - expected,
    notes: notes || "",
  });
  await commit(b, "Fechamento de caixa");
  return { expected, difference: counted - expected };
}

/* ------------------------------------------------------------------ */
/* Insumos, fichas técnicas e custos                                    */
/* ------------------------------------------------------------------ */
export async function saveIngredient(id, data) {
  if (!data.name) throw new Error("Informe o nome do insumo.");
  if (!["kg", "l", "un"].includes(data.unit)) throw new Error("Unidade inválida.");
  const prev = id ? ingredient(id) : null;
  const ref = id ? doc(db, "ingredients", id) : doc(col("ingredients"));
  const b = writeBatch(db);
  const payload = {
    name: data.name,
    category: data.category || "Geral",
    unit: data.unit,
    unitCost: Number(data.unitCost) || 0,
    fc: Math.max(1, Number(data.fc) || 1),
    minStock: Number(data.minStock) || 0,
    supplier: data.supplier || "",
    active: data.active !== false,
    updatedAt: nowIso(),
  };
  if (!id) payload.stock = Number(data.stock) || 0;
  b.set(ref, payload, { merge: true });
  if (!prev || Math.abs(prev.unitCost - payload.unitCost) > 1e-9) {
    b.set(doc(col("costHistory")), {
      ingredientId: ref.id,
      name: payload.name,
      unit: payload.unit,
      unitCost: payload.unitCost,
      prevCost: prev?.unitCost ?? null,
      source: prev ? "ajuste manual" : "cadastro",
      at: nowIso(),
      day: isoDate(),
    });
  }
  await commit(b, "Insumo");
  return ref.id;
}

export async function saveProduct(id, data) {
  if (!data.name) throw new Error("Informe o nome.");
  const ref = id ? doc(db, "products", id) : doc(col("products"));
  const b = writeBatch(db);
  b.set(
    ref,
    {
      name: data.name,
      category: data.category || (data.kind === "preparo" ? "Preparos" : "Lanches"),
      kind: data.kind === "preparo" ? "preparo" : "venda",
      price: Math.max(0, Math.round(data.price || 0)),
      ifoodPrice: data.ifoodPrice ? Math.round(data.ifoodPrice) : null,
      yieldQty: Math.max(0.0001, Number(data.yieldQty) || 1),
      yieldUnit: data.yieldUnit || "un",
      code: data.code || "",
      ifoodCode: data.ifoodCode || "",
      active: data.active !== false,
      notes: data.notes || "",
      recipe: (data.recipe || []).filter((r) => r.id && r.qty > 0).map((r) => ({ type: r.type, id: r.id, qty: Number(r.qty) })),
      updatedAt: nowIso(),
    },
    { merge: true },
  );
  await commit(b, "Produto");
  return ref.id;
}

/** Atualiza vários preços de uma vez (ex.: aplicar preço sugerido) */
export async function updatePrices(list) {
  const b = writeBatch(db);
  for (const { id, price, ifoodPrice } of list) {
    const patch = { updatedAt: nowIso() };
    if (price != null) patch.price = price;
    if (ifoodPrice != null) patch.ifoodPrice = ifoodPrice;
    b.update(doc(db, "products", id), patch);
  }
  await commit(b, "Preços");
}

export async function deleteDocById(colName, id) {
  await deleteDoc(doc(db, colName, id));
}

export async function setActive(colName, id, active) {
  const b = writeBatch(db);
  b.update(doc(db, colName, id), { active });
  await commit(b);
}

/* ------------------------------------------------------------------ */
/* Compras (entrada de nota) — atualiza estoque e custo                 */
/* ------------------------------------------------------------------ */
export async function createPurchase({ date, supplier, notes, items, billMode, dueDate }) {
  if (!items.length) throw new Error("Adicione ao menos um item.");
  const method = state.settings.cmv.cost_method;
  const b = writeBatch(db);
  const purchaseRef = doc(col("purchases"));
  let total = 0;
  const lines = [];
  for (const it of items) {
    const ing = ingredient(it.ingredientId);
    if (!ing) throw new Error("Insumo não encontrado.");
    if (!(it.qty > 0) || !(it.total > 0)) throw new Error(`Informe quantidade e valor de ${ing.name}.`);
    const unitPrice = it.total / 100 / it.qty;
    const stockBefore = Math.max(0, ing.stock || 0);
    const newCost =
      method === "ultimo" || stockBefore === 0 ? unitPrice : (stockBefore * (ing.unitCost || 0) + it.total / 100) / (stockBefore + it.qty);
    total += it.total;
    lines.push({ ingredientId: ing.id, name: ing.name, unit: ing.unit, qty: it.qty, total: it.total, unitPrice });
    b.update(doc(db, "ingredients", ing.id), {
      stock: increment(it.qty),
      unitCost: newCost,
      lastPurchase: { date, unitPrice, supplier: supplier || "" },
      supplier: supplier || ing.supplier || "",
      updatedAt: nowIso(),
    });
    b.set(doc(col("stockMovements")), {
      ingredientId: ing.id,
      name: ing.name,
      type: "compra",
      qty: it.qty,
      unitCost: unitPrice,
      value: it.total,
      ref: purchaseRef.id,
      reason: supplier || "",
      day: date,
      month: date.slice(0, 7),
      at: nowIso(),
      by: user().name,
    });
    if (Math.abs(newCost - (ing.unitCost || 0)) > 1e-6) {
      b.set(doc(col("costHistory")), {
        ingredientId: ing.id,
        name: ing.name,
        unit: ing.unit,
        unitCost: newCost,
        prevCost: ing.unitCost || 0,
        purchasePrice: unitPrice,
        source: `compra${supplier ? ` · ${supplier}` : ""}`,
        at: nowIso(),
        day: date,
      });
    }
  }
  let billId = null;
  if (billMode && billMode !== "nenhum") {
    const cat = state.categories.find((c) => c.dre_group === "insumos");
    const billRef = doc(col("bills"));
    billId = billRef.id;
    const due = billMode === "pago" ? date : dueDate || date;
    b.set(billRef, {
      type: "pagar",
      description: `Compra${supplier ? ` — ${supplier}` : ""}`,
      categoryId: cat?.id ?? null,
      amount: total,
      dueDate: due,
      month: due.slice(0, 7),
      competence: date.slice(0, 7),
      paidAt: billMode === "pago" ? date : null,
      paidAmount: billMode === "pago" ? total : null,
      supplier: supplier || "",
      purchaseId: purchaseRef.id,
      createdAt: nowIso(),
    });
  }
  b.set(purchaseRef, { date, month: date.slice(0, 7), supplier: supplier || "", notes: notes || "", items: lines, total, billId, by: user().name, at: nowIso() });
  b.set(statsRef(date), { day: date, month: date.slice(0, 7), purchases: increment(total) }, { merge: true });
  await commit(b, "Compra");
}

/* ------------------------------------------------------------------ */
/* Perdas e inventário (a diferença entre CMV teórico e real)           */
/* ------------------------------------------------------------------ */
/** entry = { kind: "ing"|"prod", id, qty, reason, date } */
export async function registerLoss(entry) {
  const book = costBook();
  const date = entry.date || isoDate();
  const usage = entry.kind === "prod" ? [...book.usage(entry.id)].map(([id, q]) => [id, q * entry.qty]) : [[entry.id, entry.qty]];
  if (!usage.length) throw new Error("Esse produto não tem ficha técnica.");
  const label = entry.kind === "prod" ? state.products.find((p) => p.id === entry.id)?.name : ingredient(entry.id)?.name;
  const b = writeBatch(db);
  let value = 0;
  for (const [ingId, q] of usage) {
    const ing = ingredient(ingId);
    if (!ing) continue;
    const v = Math.round(q * (ing.unitCost || 0) * 100);
    value += v;
    b.update(doc(db, "ingredients", ingId), { stock: increment(-q) });
    b.set(doc(col("stockMovements")), {
      ingredientId: ingId,
      name: ing.name,
      type: "perda",
      qty: -q,
      unitCost: ing.unitCost || 0,
      value: -v,
      reason: `${entry.reason || "Perda"}${entry.kind === "prod" ? ` (${entry.qty}× ${label})` : ""}`,
      category: entry.category || "outros",
      day: date,
      month: date.slice(0, 7),
      at: nowIso(),
      by: user().name,
    });
  }
  b.set(statsRef(date), { day: date, month: date.slice(0, 7), loss: increment(value) }, { merge: true });
  await commit(b, "Perda");
  return value;
}

/** items = [{ ingredientId, counted }] */
export async function createInventory({ date, notes, items }) {
  const b = writeBatch(db);
  const ref = doc(col("inventories"));
  let value = 0;
  let diffValue = 0;
  const lines = [];
  for (const it of items) {
    const ing = ingredient(it.ingredientId);
    if (!ing || it.counted == null || Number.isNaN(it.counted)) continue;
    const system = ing.stock || 0;
    const diff = it.counted - system;
    const cost = ing.unitCost || 0;
    value += Math.round(it.counted * cost * 100);
    const dv = Math.round(-diff * cost * 100); // positivo = faltou produto
    diffValue += dv;
    lines.push({ ingredientId: ing.id, name: ing.name, unit: ing.unit, system, counted: it.counted, unitCost: cost, diffValue: dv });
    if (Math.abs(diff) > 1e-9) {
      b.update(doc(db, "ingredients", ing.id), { stock: increment(diff) });
      b.set(doc(col("stockMovements")), {
        ingredientId: ing.id,
        name: ing.name,
        type: "inventario",
        qty: diff,
        unitCost: cost,
        value: -dv,
        ref: ref.id,
        reason: "Contagem de inventário",
        day: date,
        month: date.slice(0, 7),
        at: nowIso(),
        by: user().name,
      });
    }
  }
  if (!lines.length) throw new Error("Preencha a contagem de pelo menos um insumo.");
  b.set(ref, { date, month: date.slice(0, 7), notes: notes || "", items: lines, value, diffValue, full: lines.length >= state.ingredients.filter((i) => i.active !== false).length, by: user().name, at: nowIso() });
  b.set(statsRef(date), { day: date, month: date.slice(0, 7), invDiff: increment(diffValue) }, { merge: true });
  await commit(b, "Inventário");
  return { value, diffValue };
}

/* ------------------------------------------------------------------ */
/* Contas a pagar / receber                                             */
/* ------------------------------------------------------------------ */
export async function saveBill(id, data) {
  if (!data.description) throw new Error("Descreva a conta.");
  if (!(data.amount > 0)) throw new Error("Informe o valor.");
  if (!data.dueDate) throw new Error("Informe o vencimento.");
  const ref = id ? doc(db, "bills", id) : doc(col("bills"));
  const payload = {
    type: data.type,
    description: data.description,
    categoryId: data.categoryId || null,
    amount: data.amount,
    dueDate: data.dueDate,
    month: data.dueDate.slice(0, 7),
    competence: data.competence || data.dueDate.slice(0, 7),
    supplier: data.supplier || "",
    notes: data.notes || "",
  };
  if (data.paid) {
    payload.paidAt = data.paidAt || isoDate();
    payload.paidAmount = data.paidAmount || data.amount;
  } else {
    payload.paidAt = null;
    payload.paidAmount = null;
  }
  if (!id) payload.createdAt = nowIso();
  await setDoc(ref, payload, { merge: true });
}

export async function payBill(id, paidAt, paidAmount) {
  await updateDoc(doc(db, "bills", id), { paidAt, paidAmount });
}

export async function saveRecurring(id, data) {
  if (!data.description || !(data.amount > 0)) throw new Error("Preencha descrição e valor.");
  const ref = id ? doc(db, "recurringBills", id) : doc(col("recurringBills"));
  await setDoc(ref, { description: data.description, categoryId: data.categoryId || null, amount: data.amount, day: Math.min(28, Math.max(1, Number(data.day) || 10)), active: data.active !== false }, { merge: true });
}

/** Gera as contas fixas do mês (idempotente: id determinístico). */
export async function generateRecurring(month, existingBills) {
  const b = writeBatch(db);
  let n = 0;
  for (const r of state.recurring.filter((x) => x.active !== false)) {
    const id = `rec_${r.id}_${month}`;
    if (existingBills.some((x) => x.id === id)) continue;
    const due = `${month}-${String(r.day).padStart(2, "0")}`;
    b.set(doc(db, "bills", id), {
      type: "pagar",
      description: r.description,
      categoryId: r.categoryId,
      amount: r.amount,
      dueDate: due,
      month,
      competence: month,
      recurringId: r.id,
      paidAt: null,
      paidAmount: null,
      supplier: "",
      notes: "",
      createdAt: nowIso(),
    });
    n++;
  }
  if (n) await commit(b, "Contas fixas");
  return n;
}

export async function saveCategory(id, data) {
  if (!data.name) throw new Error("Informe o nome.");
  const ref = id ? doc(db, "billCategories", id) : doc(col("billCategories"));
  await setDoc(ref, { name: data.name, type: data.type, dre_group: data.dre_group }, { merge: true });
}

/* ------------------------------------------------------------------ */
/* Configurações                                                        */
/* ------------------------------------------------------------------ */
export async function saveSettings(section, data) {
  await setDoc(doc(db, "settings", "general"), { [section]: data }, { merge: true });
}

export async function savePrivate(name, data) {
  await setDoc(doc(db, "private", name), data, { merge: true });
}

export async function loadPrivate(name) {
  const s = await getDoc(doc(db, "private", name));
  return s.data() ?? {};
}

export async function savePaymentMethod(id, data) {
  if (!data.name) throw new Error("Informe o nome.");
  const ref = id ? doc(db, "paymentMethods", id) : doc(col("paymentMethods"));
  await setDoc(
    ref,
    {
      name: data.name,
      kind: data.kind,
      installments: Math.max(1, Number(data.installments) || 1),
      fee_percent: Number(data.fee_percent) || 0,
      fixed_fee_cents: Math.round(Number(data.fixed_fee_cents) || 0),
      anticipation_percent: Number(data.anticipation_percent) || 0,
      settlement_days: Math.max(0, Number(data.settlement_days) || 0),
      uses_terminal: !!data.uses_terminal,
      active: data.active !== false,
      sort: Number(data.sort) || 0,
    },
    { merge: true },
  );
}

/* ------------------------------------------------------------------ */
/* Usuários (Firebase Auth). Login por "usuário" vira e-mail interno.  */
/* ------------------------------------------------------------------ */
export const EMAIL_DOMAIN = "mistureba.app";
export const toEmail = (login) => (login.includes("@") ? login.trim().toLowerCase() : `${login.trim().toLowerCase()}@${EMAIL_DOMAIN}`);

export async function createStaffUser({ name, login, password, role }) {
  if (!isAdmin()) throw new Error("Só o administrador cria usuários.");
  if (!name || !login) throw new Error("Preencha nome e usuário.");
  if ((password || "").length < 6) throw new Error("A senha precisa de pelo menos 6 caracteres.");
  // App secundário: criar a conta sem derrubar a sessão do administrador
  const second = fb.initializeApp(firebaseConfig, `staff-${Date.now()}`);
  const a2 = fb.getAuth(second);
  if (isEmulator) fb.connectAuthEmulator(a2, `http://${location.hostname || "127.0.0.1"}:9099`, { disableWarnings: true });
  try {
    const cred = await fb.createUserWithEmailAndPassword(a2, toEmail(login), password);
    await setDoc(doc(db, "users", cred.user.uid), { name, login: login.trim().toLowerCase(), role, active: true, createdAt: nowIso() });
    await fb.signOut(a2);
  } catch (e) {
    if (e.code === "auth/email-already-in-use") throw new Error("Esse usuário já existe.");
    throw e;
  } finally {
    await fb.deleteApp(second);
  }
}

export async function updateStaff(uid, data) {
  await updateDoc(doc(db, "users", uid), data);
}

/* ------------------------------------------------------------------ */
/* Leituras de relatório                                                */
/* ------------------------------------------------------------------ */
export async function statsForMonth(month) {
  const s = await getDocs(query(col("dailyStats"), where("month", "==", month)));
  return s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => a.day.localeCompare(b.day));
}

export async function statsForRange(start, end) {
  const s = await getDocs(query(col("dailyStats"), where("day", ">=", start), where("day", "<=", end)));
  return s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => a.day.localeCompare(b.day));
}

export async function listWhere(colName, ...conds) {
  const s = await getDocs(query(col(colName), ...conds));
  return s.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export { addDoc };
