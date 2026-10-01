/*
 * Cloud Functions — integrações que precisam de servidor (segredos e webhooks).
 *
 *  iFood (Merchant API)  : ifoodPoll (agendada, 1 min), ifoodPollNow, ifoodAction
 *  Stone (Stone Connect) : stoneCharge (envia cobrança p/ maquininha), stoneWebhook
 *
 * Os segredos ficam em Firestore /private/{ifood|stone}, legíveis só por admin.
 * Exigem o plano Blaze (chamadas de rede externas).
 */
import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { setGlobalOptions } from "firebase-functions/v2";
import { onCall, onRequest, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";
import { CostBook } from "./shared/costing.js";
import { buildStatsPatch } from "./shared/stats.js";

initializeApp();
const db = getFirestore();
setGlobalOptions({ region: "southamerica-east1", maxInstances: 3 });

const TZ = "America/Sao_Paulo";
const IFOOD = "https://merchant-api.ifood.com.br";
const PAGARME = "https://api.pagar.me/core/v5";

/* ------------------------------------------------------------------ */
/* Utilitários                                                          */
/* ------------------------------------------------------------------ */
function localParts(date = new Date()) {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, month: `${p.year}-${p.month}`, hour: p.hour };
}
const addDays = (day, n) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const cents = (v) => Math.round(Number(v || 0) * 100);

async function log(source, message, level = "info", payload = null) {
  logger[level === "error" ? "error" : "info"](`[${source}] ${message}`);
  await db.collection("integrationLog").add({ source, level, message, payload: payload ? JSON.stringify(payload).slice(0, 4000) : null, at: new Date().toISOString() });
}

async function requireUser(auth, role) {
  if (!auth) throw new HttpsError("unauthenticated", "Faça login.");
  const u = (await db.doc(`users/${auth.uid}`).get()).data();
  if (!u || u.active === false) throw new HttpsError("permission-denied", "Usuário sem acesso.");
  if (role === "admin" && u.role !== "admin") throw new HttpsError("permission-denied", "Só o administrador.");
  return u;
}

async function settings() {
  return (await db.doc("settings/general").get()).data() ?? {};
}

/* ------------------------------------------------------------------ */
/* iFood                                                                */
/* ------------------------------------------------------------------ */
let tokenCache = { token: null, exp: 0, clientId: null };

async function ifoodToken() {
  const priv = (await db.doc("private/ifood").get()).data() ?? {};
  if (!priv.client_id || !priv.client_secret) throw new Error("Credenciais do iFood não configuradas.");
  if (tokenCache.token && tokenCache.clientId === priv.client_id && Date.now() < tokenCache.exp - 60_000) return tokenCache.token;
  const res = await fetch(`${IFOOD}/authentication/v1.0/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grantType: "client_credentials", clientId: priv.client_id, clientSecret: priv.client_secret }),
  });
  if (!res.ok) throw new Error(`iFood auth ${res.status}: ${await res.text()}`);
  const data = await res.json();
  tokenCache = { token: data.accessToken, exp: Date.now() + (data.expiresIn ?? 3600) * 1000, clientId: priv.client_id };
  return tokenCache.token;
}

async function ifoodFetch(path, init = {}) {
  const token = await ifoodToken();
  const res = await fetch(`${IFOOD}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) } });
  if (res.status === 204) return null;
  const text = await res.text();
  if (!res.ok) throw new Error(`iFood ${path} ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

const STATUS_BY_CODE = { PLC: "PLACED", CFM: "CONFIRMED", DSP: "DISPATCHED", RTP: "READY_TO_PICKUP", CON: "CONCLUDED", CAN: "CANCELLED" };
const KIND_BY_IFOOD = { CREDIT: "credito", DEBIT: "debito", CASH: "dinheiro", PIX: "pix", MEAL_VOUCHER: "voucher", FOOD_VOUCHER: "voucher" };

async function pollIfood() {
  const cfg = (await settings()).ifood ?? {};
  if (!cfg.enabled) return { imported: 0, skipped: "desligado" };
  const headers = cfg.merchant_id ? { "x-polling-merchants": cfg.merchant_id } : {};
  const events = (await ifoodFetch("/events/v1.0/events:polling", { headers })) ?? [];
  if (!events.length) return { imported: 0 };

  let imported = 0;
  for (const ev of events) {
    try {
      const code = ev.code ?? ev.fullCode?.slice(0, 3);
      const saleRef = db.doc(`sales/ifood_${ev.orderId}`);
      if (code === "PLC") {
        const created = await importOrder(ev.orderId, cfg);
        if (created) {
          imported++;
          if (cfg.auto_confirm) await ifoodFetch(`/order/v1.0/orders/${ev.orderId}/confirm`, { method: "POST" }).catch((e) => log("ifood", `Falha ao confirmar ${ev.orderId}: ${e.message}`, "error"));
        }
      } else if (code === "CAN") {
        await cancelIfoodSale(saleRef);
      } else if (STATUS_BY_CODE[code]) {
        await saleRef.update({ ifoodStatus: STATUS_BY_CODE[code] }).catch(() => {});
      }
    } catch (e) {
      await log("ifood", `Erro no evento ${ev.code} do pedido ${ev.orderId}: ${e.message}`, "error");
    }
  }
  await ifoodFetch("/events/v1.0/events/acknowledgment", { method: "POST", body: JSON.stringify(events.map((e) => ({ id: e.id }))) });
  if (imported) await log("ifood", `${imported} pedido(s) importado(s).`);
  return { imported };
}

async function loadCatalog() {
  const [ings, prods, methods] = await Promise.all([db.collection("ingredients").get(), db.collection("products").get(), db.collection("paymentMethods").get()]);
  const ingredients = ings.docs.map((d) => ({ id: d.id, ...d.data() }));
  const products = prods.docs.map((d) => ({ id: d.id, ...d.data() }));
  return { book: new CostBook(ingredients, products), products, methods: methods.docs.map((d) => ({ id: d.id, ...d.data() })) };
}

function matchProduct(products, item) {
  const code = (item.externalCode ?? "").trim();
  const name = (item.name ?? "").trim().toLowerCase();
  return (
    (code && products.find((p) => p.ifoodCode && p.ifoodCode === code)) ||
    (code && products.find((p) => p.code && p.code === code)) ||
    products.find((p) => p.kind === "venda" && p.name.trim().toLowerCase() === name) ||
    null
  );
}

async function importOrder(orderId, cfg) {
  const ref = db.doc(`sales/ifood_${orderId}`);
  if ((await ref.get()).exists) return false;
  const order = await ifoodFetch(`/order/v1.0/orders/${orderId}`);
  const { book, products, methods } = await loadCatalog();

  const items = [];
  const pushItem = (it, qtyMult = 1) => {
    const p = matchProduct(products, it);
    const qty = Number(it.quantity || 1) * qtyMult;
    items.push({ productId: p?.id ?? null, name: it.name, category: p?.category ?? "", qty, price: cents(it.unitPrice), cost: p ? book.unitCostCents(p.id) : 0, notes: it.observations ?? "" });
  };
  for (const it of order.items ?? []) {
    pushItem(it);
    for (const opt of it.options ?? []) if (Number(opt.unitPrice) > 0 || matchProduct(products, opt)) pushItem(opt, Number(it.quantity || 1));
  }

  const subtotal = items.reduce((s, i) => s + i.qty * i.price, 0);
  const total = cents(order.total?.orderAmount ?? subtotal / 100);
  const deliveryFee = cents(order.total?.deliveryFee);
  const discount = Math.max(0, subtotal + deliveryFee + cents(order.total?.additionalFees) - total);

  const { day, month, hour } = localParts(order.createdAt ? new Date(order.createdAt) : new Date());
  const ifoodMethod = methods.find((m) => m.kind === "ifood");
  const payments = [];
  for (const pm of order.payments?.methods ?? [{ type: "ONLINE", value: total / 100 }]) {
    const amount = cents(pm.value);
    if (pm.type === "OFFLINE") {
      const kind = KIND_BY_IFOOD[pm.method] ?? "outro";
      const m = methods.find((x) => x.kind === kind && (x.installments ?? 1) === 1);
      const fee = m ? Math.round((amount * ((m.fee_percent || 0) + (m.anticipation_percent || 0))) / 100) + (m.fixed_fee_cents || 0) : 0;
      payments.push({ methodId: m?.id ?? null, name: `${m?.name ?? pm.method} (na entrega)`, kind, installments: 1, amount, fee, received: null, change: 0, settleDate: addDays(day, m?.settlement_days ?? 0), stoneOrderId: null });
    } else {
      payments.push({ methodId: ifoodMethod?.id ?? null, name: "iFood (pago online)", kind: "ifood", installments: 1, amount, fee: Math.round((amount * (Number(cfg.payment_fee_percent) || 0)) / 100), received: null, change: 0, settleDate: addDays(day, Number(cfg.settlement_days) || 30), stoneOrderId: null });
    }
  }
  // Ajuste de centavos para a soma bater com o total
  const diff = total - payments.reduce((s, p) => s + p.amount, 0);
  if (diff && payments.length) payments[0].amount += diff;

  const usage = {};
  for (const it of items) if (it.productId) for (const [ing, q] of book.usage(it.productId)) usage[ing] = (usage[ing] ?? 0) + q * it.qty;

  const sale = {
    number: null,
    channel: "ifood",
    status: "concluida",
    items,
    payments,
    subtotal,
    discount,
    deliveryFee,
    total,
    cost: items.reduce((s, i) => s + i.qty * i.cost, 0),
    fees: payments.reduce((s, p) => s + p.fee, 0),
    commission: Math.round((subtotal * (Number(cfg.commission_percent) || 0)) / 100),
    usage,
    customer: order.customer?.name ?? "",
    notes: [order.delivery?.observations, order.orderType === "TAKEOUT" ? "Retirada no balcão" : ""].filter(Boolean).join(" · "),
    day,
    month,
    hour,
    clientAt: new Date().toISOString(),
    createdAt: FieldValue.serverTimestamp(),
    cashSessionId: null,
    userId: null,
    userName: "iFood",
    ifoodOrderId: orderId,
    ifoodDisplayId: order.displayId ?? orderId.slice(0, 6),
    ifoodStatus: "PLACED",
  };

  const batch = db.batch();
  batch.create(ref, sale);
  for (const [ing, q] of Object.entries(usage)) batch.update(db.doc(`ingredients/${ing}`), { stock: FieldValue.increment(-q) });
  batch.set(db.doc(`dailyStats/${day}`), buildStatsPatch(sale, 1, FieldValue.increment), { merge: true });
  await batch.commit();
  const unmapped = items.filter((i) => !i.productId).map((i) => i.name);
  if (unmapped.length) await log("ifood", `Pedido #${sale.ifoodDisplayId}: itens sem ficha técnica (${unmapped.join(", ")}). Preencha o "Código no iFood" nas fichas.`, "warn");
  return true;
}

async function cancelIfoodSale(ref) {
  await db.runTransaction(async (t) => {
    const snap = await t.get(ref);
    const sale = snap.data();
    if (!sale || sale.status === "cancelada") return;
    t.update(ref, { status: "cancelada", ifoodStatus: "CANCELLED", canceledAt: new Date().toISOString(), canceledBy: "iFood", cancelReason: "Cancelado no iFood" });
    for (const [ing, q] of Object.entries(sale.usage ?? {})) t.update(db.doc(`ingredients/${ing}`), { stock: FieldValue.increment(q) });
    t.set(db.doc(`dailyStats/${sale.day}`), buildStatsPatch(sale, -1, FieldValue.increment), { merge: true });
  });
}

export const ifoodPoll = onSchedule({ schedule: "every 1 minutes", timeZone: TZ }, async () => {
  try {
    await pollIfood();
  } catch (e) {
    await log("ifood", `Polling falhou: ${e.message}`, "error");
  }
});

export const ifoodPollNow = onCall(async (req) => {
  await requireUser(req.auth, "admin");
  try {
    return await pollIfood();
  } catch (e) {
    await log("ifood", `Polling manual falhou: ${e.message}`, "error");
    throw new HttpsError("internal", e.message);
  }
});

export const ifoodAction = onCall(async (req) => {
  await requireUser(req.auth, "admin");
  const { orderId, action } = req.data ?? {};
  if (!orderId || !["confirm", "dispatch", "readyToPickup", "startPreparation"].includes(action)) throw new HttpsError("invalid-argument", "Ação inválida.");
  try {
    await ifoodFetch(`/order/v1.0/orders/${orderId}/${action}`, { method: "POST" });
  } catch (e) {
    throw new HttpsError("internal", e.message);
  }
  const status = { confirm: "CONFIRMED", dispatch: "DISPATCHED", readyToPickup: "READY_TO_PICKUP" }[action];
  if (status) await db.doc(`sales/ifood_${orderId}`).update({ ifoodStatus: status }).catch(() => {});
  return { ok: true };
});

/* ------------------------------------------------------------------ */
/* Stone Connect (API Pagar.me v5 com POS)                              */
/* ------------------------------------------------------------------ */
const PAYMENT_TYPE = { credito: "credit", debito: "debit", pix: "pix", voucher: "voucher" };

export const stoneCharge = onCall(async (req) => {
  const user = await requireUser(req.auth);
  const { amount, methodId, device } = req.data ?? {};
  if (!(Number.isInteger(amount) && amount > 0)) throw new HttpsError("invalid-argument", "Valor inválido.");
  const [priv, method, cfg] = await Promise.all([db.doc("private/stone").get(), db.doc(`paymentMethods/${methodId}`).get(), settings()]);
  const key = priv.data()?.secret_key;
  if (!key) throw new HttpsError("failed-precondition", "Chave da Stone não configurada.");
  const m = method.data();
  const serial = device || cfg.stone?.devices?.[0];
  if (!serial) throw new HttpsError("failed-precondition", "Nenhuma maquininha cadastrada.");

  const body = {
    closed: false,
    items: [{ amount, description: "Pedido lanchonete", quantity: 1, code: "PDV" }],
    customer: { name: "Cliente balcão", email: "balcao@mistureba.app" },
    poi_payment_settings: {
      visible: true,
      devices_serial_number: [serial],
      print_order_receipt: false,
      payment_setup: { type: PAYMENT_TYPE[m?.kind] ?? "credit", installments: m?.installments ?? 1, installment_type: "merchant" },
      display_name: `${user.name ?? "PDV"}`.slice(0, 20),
    },
  };
  const res = await fetch(`${PAGARME}/orders`, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    await log("stone", `Falha ao criar cobrança: ${res.status}`, "error", data);
    throw new HttpsError("internal", data?.message ?? `Stone respondeu ${res.status}`);
  }
  await db.doc(`stoneCharges/${data.id}`).set({ status: "pending", amount, methodId, device: serial, createdAt: new Date().toISOString(), by: req.auth.uid });
  return { chargeId: data.id };
});

export const stoneWebhook = onRequest(async (req, res) => {
  if (req.method !== "POST") return res.status(405).send("Method not allowed");
  const secret = (await db.doc("private/stone").get()).data()?.webhook_secret;
  if (secret && req.query.token !== secret) return res.status(401).send("Unauthorized");
  const ev = req.body ?? {};
  const orderId = ev.data?.order?.id ?? (String(ev.type ?? "").startsWith("order.") ? ev.data?.id : null);
  const status = { "order.paid": "paid", "charge.paid": "paid", "order.canceled": "canceled", "order.payment_failed": "failed", "charge.payment_failed": "failed" }[ev.type];
  if (orderId && status) {
    await db.doc(`stoneCharges/${orderId}`).set({ status, updatedAt: new Date().toISOString(), event: ev.type }, { merge: true });
  }
  await log("stone", `Webhook ${ev.type ?? "?"} ${orderId ?? ""}`);
  res.status(200).send("ok");
});
