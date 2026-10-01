// Primeiro acesso: cria o administrador e popula o banco com configurações,
// formas de pagamento (taxas de exemplo), categorias financeiras e um cardápio
// de exemplo com fichas técnicas — o CMV já nasce funcionando.
import { db, fb, auth } from "./firebase.js";
import { DEFAULT_SETTINGS } from "./store.js";
import { toEmail } from "./services.js";
import { isoDate } from "./format.js";

const { doc, collection, writeBatch, getDoc } = fb;

export async function needsBootstrap() {
  const s = await getDoc(doc(db, "meta", "bootstrap"));
  return !s.exists();
}

export async function bootstrapAdmin({ name, login, password, withMenu }) {
  if (!name || !login) throw new Error("Preencha nome e usuário.");
  if ((password || "").length < 6) throw new Error("A senha precisa de pelo menos 6 caracteres.");
  const cred = await fb.createUserWithEmailAndPassword(auth, toEmail(login), password);
  const uid = cred.user.uid;
  const b1 = writeBatch(db);
  b1.set(doc(db, "users", uid), { name, login: login.trim().toLowerCase(), role: "admin", active: true, createdAt: new Date().toISOString() });
  b1.set(doc(db, "meta", "bootstrap"), { adminUid: uid, at: new Date().toISOString() });
  await b1.commit();
  await seedBase(withMenu);
}

async function seedBase(withMenu) {
  const b = writeBatch(db);
  b.set(doc(db, "settings", "general"), DEFAULT_SETTINGS);
  b.set(doc(db, "private", "ifood"), { client_id: "", client_secret: "" });
  b.set(doc(db, "private", "stone"), { secret_key: "", webhook_secret: "" });

  // Taxas de exemplo — ajuste em Configurações > Taxas conforme seu contrato com a Stone
  const methods = [
    ["Dinheiro", "dinheiro", 1, 0, 0, 0, false],
    ["Pix", "pix", 1, 0.75, 0, 0, true],
    ["Débito", "debito", 1, 1.37, 0, 1, true],
    ["Crédito à vista", "credito", 1, 3.15, 0, 30, true],
    ["Crédito 2x", "credito", 2, 4.39, 0, 30, true],
    ["Crédito 3x", "credito", 3, 5.09, 0, 30, true],
    ["Voucher (VR/VA)", "voucher", 1, 6.5, 0, 30, true],
    ["iFood (pago online)", "ifood", 1, 0, 0, 30, false],
  ];
  methods.forEach(([name, kind, installments, fee_percent, anticipation_percent, settlement_days, uses_terminal], i) =>
    b.set(doc(collection(db, "paymentMethods")), { name, kind, installments, fee_percent, fixed_fee_cents: 0, anticipation_percent, settlement_days, uses_terminal, active: true, sort: kind === "ifood" ? 99 : i }),
  );

  const cats = [
    ["Compra de insumos", "pagar", "insumos"],
    ["Aluguel", "pagar", "fixa"],
    ["Energia", "pagar", "fixa"],
    ["Água", "pagar", "fixa"],
    ["Gás", "pagar", "variavel"],
    ["Internet / Telefone", "pagar", "fixa"],
    ["Salários", "pagar", "fixa"],
    ["Encargos / Pró-labore", "pagar", "fixa"],
    ["Contador", "pagar", "fixa"],
    ["Sistemas / Mensalidades", "pagar", "fixa"],
    ["Marketing", "pagar", "variavel"],
    ["Manutenção", "pagar", "variavel"],
    ["Motoboy / Entregas", "pagar", "variavel"],
    ["Impostos (DAS)", "pagar", "imposto"],
    ["Equipamentos", "pagar", "investimento"],
    ["Outras despesas", "pagar", "variavel"],
    ["Repasse iFood", "receber", "receita"],
    ["Outras receitas", "receber", "receita"],
  ];
  const catIds = {};
  for (const [name, type, dre_group] of cats) {
    const ref = doc(collection(db, "billCategories"));
    catIds[name] = ref.id;
    b.set(ref, { name, type, dre_group });
  }
  const rec = [
    ["Aluguel do ponto", "Aluguel", 250000, 5],
    ["Conta de luz", "Energia", 90000, 15],
    ["Internet", "Internet / Telefone", 12000, 20],
    ["Contador", "Contador", 45000, 10],
  ];
  for (const [description, cat, amount, day] of rec) {
    b.set(doc(collection(db, "recurringBills")), { description, categoryId: catIds[cat], amount, day, active: true });
  }
  await b.commit();
  if (withMenu) await seedMenu();
}

async function seedMenu() {
  const b = writeBatch(db);
  const I = {};
  const now = new Date().toISOString();
  const addI = (key, name, category, unit, unitCost, fc, stock, minStock, supplier = "") => {
    const ref = doc(collection(db, "ingredients"));
    I[key] = ref.id;
    b.set(ref, { name, category, unit, unitCost, fc, stock, minStock, supplier, active: true, updatedAt: now });
    b.set(doc(collection(db, "costHistory")), { ingredientId: ref.id, name, unit, unitCost, prevCost: null, source: "cadastro", at: now, day: isoDate() });
  };
  addI("pao", "Pão de hambúrguer", "Padaria", "un", 0.85, 1, 120, 40, "Padaria Central");
  addI("pao_hot", "Pão de hot dog", "Padaria", "un", 0.6, 1, 60, 20, "Padaria Central");
  addI("carne", "Blend bovino (moído)", "Carnes", "kg", 38.9, 1, 12, 5, "Açougue Boi Bom");
  addI("salsicha", "Salsicha", "Carnes", "kg", 16.5, 1, 4, 2);
  addI("frango", "Peito de frango", "Carnes", "kg", 19.9, 1.15, 6, 3);
  addI("bacon", "Bacon fatiado", "Carnes", "kg", 42, 1, 3, 1);
  addI("queijo", "Queijo muçarela fatiado", "Laticínios", "kg", 39.9, 1, 4, 2);
  addI("cheddar", "Cheddar cremoso", "Laticínios", "kg", 32, 1, 2, 1);
  addI("ovo", "Ovo", "Hortifruti", "un", 0.7, 1, 90, 30);
  addI("alface", "Alface americana", "Hortifruti", "kg", 9, 1.4, 2, 1);
  addI("tomate", "Tomate", "Hortifruti", "kg", 7.5, 1.1, 4, 2);
  addI("cebola", "Cebola", "Hortifruti", "kg", 5, 1.15, 4, 2);
  addI("batata", "Batata palito congelada", "Congelados", "kg", 17.9, 1, 15, 5);
  addI("maionese", "Maionese (balde)", "Mercearia", "kg", 14, 1, 3, 1);
  addI("alho", "Alho", "Hortifruti", "kg", 28, 1.2, 0.5, 0.2);
  addI("oleo", "Óleo de soja", "Mercearia", "l", 8.5, 1, 18, 9);
  addI("refri", "Refrigerante lata 350ml", "Bebidas", "un", 3.2, 1, 48, 24);
  addI("suco", "Polpa de fruta", "Bebidas", "kg", 18, 1, 3, 1);
  addI("acucar", "Açúcar", "Mercearia", "kg", 4.8, 1, 5, 2);
  addI("emb_lanche", "Embalagem lanche + guardanapo", "Embalagens", "un", 0.45, 1, 300, 100);
  addI("emb_batata", "Embalagem batata", "Embalagens", "un", 0.35, 1, 200, 80);
  addI("copo", "Copo 400ml + tampa", "Embalagens", "un", 0.4, 1, 200, 80);

  const P = {};
  const mk = (key, name, category, kind, price, ifood, recipe, yieldQty = 1, yieldUnit = "un") => {
    const ref = doc(collection(db, "products"));
    P[key] = ref.id;
    b.set(ref, {
      name, category, kind,
      price: Math.round(price * 100),
      ifoodPrice: ifood == null ? null : Math.round(ifood * 100),
      yieldQty, yieldUnit, code: "", ifoodCode: "", active: true, notes: "", updatedAt: now,
      recipe: recipe.map(([k, qty]) => (k.startsWith("@") ? { type: "prod", id: P[k.slice(1)], qty } : { type: "ing", id: I[k], qty })),
    });
  };
  // Preparos (sub-receitas)
  mk("maio_casa", "Maionese da casa", "Preparos", "preparo", 0, null, [["maionese", 0.9], ["alho", 0.05], ["oleo", 0.1]], 1, "kg");
  mk("hamb", "Hambúrguer 150g moldado", "Preparos", "preparo", 0, null, [["carne", 0.15]]);
  mk("batata_frita", "Porção de batata frita (base)", "Preparos", "preparo", 0, null, [["batata", 0.3], ["oleo", 0.03]]);
  // Produtos de venda
  mk("xburguer", "X-Burguer", "Lanches", "venda", 22, 27.9, [["pao", 1], ["@hamb", 1], ["queijo", 0.03], ["@maio_casa", 0.02], ["emb_lanche", 1]]);
  mk("xsalada", "X-Salada", "Lanches", "venda", 25, 30.9, [["pao", 1], ["@hamb", 1], ["queijo", 0.03], ["alface", 0.02], ["tomate", 0.04], ["@maio_casa", 0.02], ["emb_lanche", 1]]);
  mk("xbacon", "X-Bacon", "Lanches", "venda", 28, 34.9, [["pao", 1], ["@hamb", 1], ["queijo", 0.03], ["bacon", 0.04], ["@maio_casa", 0.02], ["emb_lanche", 1]]);
  mk("xtudo", "X-Tudo", "Lanches", "venda", 34, 41.9, [["pao", 1], ["@hamb", 1], ["queijo", 0.04], ["bacon", 0.04], ["ovo", 1], ["alface", 0.02], ["tomate", 0.04], ["cebola", 0.02], ["@maio_casa", 0.03], ["emb_lanche", 1]]);
  mk("xfrango", "X-Frango", "Lanches", "venda", 26, 31.9, [["pao", 1], ["frango", 0.12], ["queijo", 0.03], ["alface", 0.02], ["tomate", 0.04], ["@maio_casa", 0.02], ["emb_lanche", 1]]);
  mk("hotdog", "Cachorro-quente", "Lanches", "venda", 15, 19.9, [["pao_hot", 1], ["salsicha", 0.1], ["cheddar", 0.03], ["batata", 0.03], ["emb_lanche", 1]]);
  mk("batata_p", "Batata frita", "Porções", "venda", 18, 22.9, [["@batata_frita", 1], ["emb_batata", 1]]);
  mk("batata_cb", "Batata cheddar e bacon", "Porções", "venda", 28, 34.9, [["@batata_frita", 1], ["cheddar", 0.06], ["bacon", 0.04], ["emb_batata", 1]]);
  mk("refri", "Refrigerante lata", "Bebidas", "venda", 7, 8.9, [["refri", 1]]);
  mk("suco", "Suco natural 400ml", "Bebidas", "venda", 10, 12.9, [["suco", 0.1], ["acucar", 0.02], ["copo", 1]]);
  mk("combo", "Combo X-Bacon + batata + refri", "Combos", "venda", 45, 54.9, [["@xbacon", 1], ["@batata_p", 1], ["@refri", 1]]);
  mk("add_bacon", "Adicional bacon", "Adicionais", "venda", 5, 6, [["bacon", 0.03]]);
  mk("add_ovo", "Adicional ovo", "Adicionais", "venda", 3, 3.5, [["ovo", 1]]);
  mk("add_cheddar", "Adicional cheddar", "Adicionais", "venda", 4, 5, [["cheddar", 0.03]]);
  await b.commit();
}

