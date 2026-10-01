// Estado vivo do app: coleções pequenas ficam sincronizadas em tempo real
// (onSnapshot) e servem todas as telas sem novas leituras.
import { db, fb } from "./firebase.js";
import { CostBook } from "./costing.js";

const { collection, doc, onSnapshot, query, where, limit } = fb;

export const DEFAULT_SETTINGS = {
  company: { name: "Mistureba Lanches", cnpj: "", phone: "", address: "" },
  cmv: { target_percent: 30, alert_percent: 35, cost_method: "medio", tax_percent: 6 },
  ifood: { enabled: false, merchant_id: "", commission_percent: 12, payment_fee_percent: 3.2, auto_confirm: true, settlement_days: 30 },
  stone: { mode: "manual", devices: [] },
};

export const state = {
  user: null, // Firebase user
  profile: null, // users/{uid}
  settings: structuredClone(DEFAULT_SETTINGS),
  methods: [],
  ingredients: [],
  products: [],
  categories: [],
  recurring: [],
  users: [],
  session: null, // caixa aberto
  online: navigator.onLine,
  loaded: new Set(),
};

const listeners = new Set();
let unsubs = [];
let version = 0;
let book = null;
let bookVersion = -1;
let raf = 0;

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit(key) {
  version++;
  if (key) state.loaded.add(key);
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(() => listeners.forEach((fn) => fn(key)));
}

export const isAdmin = () => state.profile?.role === "admin";

const sortByName = (a, b) => a.name.localeCompare(b.name, "pt-BR");
const mapDocs = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));

export function start() {
  stop();
  const admin = isAdmin();
  unsubs.push(
    onSnapshot(doc(db, "settings", "general"), (s) => {
      const data = s.data() ?? {};
      for (const k of Object.keys(DEFAULT_SETTINGS)) state.settings[k] = { ...DEFAULT_SETTINGS[k], ...(data[k] ?? {}) };
      emit("settings");
    }),
    onSnapshot(collection(db, "paymentMethods"), (s) => {
      state.methods = mapDocs(s).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
      emit("methods");
    }),
    onSnapshot(collection(db, "ingredients"), (s) => {
      state.ingredients = mapDocs(s).sort(sortByName);
      emit("ingredients");
    }),
    onSnapshot(collection(db, "products"), (s) => {
      state.products = mapDocs(s).sort(sortByName);
      emit("products");
    }),
    onSnapshot(query(collection(db, "cashSessions"), where("status", "==", "aberto"), limit(1)), (s) => {
      state.session = s.empty ? null : { id: s.docs[0].id, ...s.docs[0].data() };
      emit("session");
    }),
  );
  if (admin) {
    unsubs.push(
      onSnapshot(collection(db, "billCategories"), (s) => {
        state.categories = mapDocs(s).sort(sortByName);
        emit("categories");
      }),
      onSnapshot(collection(db, "recurringBills"), (s) => {
        state.recurring = mapDocs(s).sort((a, b) => a.description.localeCompare(b.description, "pt-BR"));
        emit("recurring");
      }),
      onSnapshot(collection(db, "users"), (s) => {
        state.users = mapDocs(s).sort(sortByName);
        emit("users");
      }),
    );
  }
}

export function stop() {
  unsubs.forEach((u) => u());
  unsubs = [];
}

addEventListener("online", () => { state.online = true; emit("net"); });
addEventListener("offline", () => { state.online = false; emit("net"); });

/** Livro de custos (memoizado até algo mudar) */
export function costBook() {
  if (!book || bookVersion !== version) {
    book = new CostBook(state.ingredients, state.products);
    bookVersion = version;
  }
  return book;
}

export const ingredient = (id) => state.ingredients.find((i) => i.id === id);
export const product = (id) => state.products.find((p) => p.id === id);
export const method = (id) => state.methods.find((m) => m.id === id);
export const category = (id) => state.categories.find((c) => c.id === id);

export function sellable() {
  return state.products.filter((p) => p.kind === "venda" && p.active !== false);
}

/** Taxa média real das vendas (fallback: taxa do crédito à vista) — usada na margem por produto */
export function avgFeePercent(statsDocs = []) {
  const rev = statsDocs.reduce((s, d) => s + (d.revenue || 0) - (d.byChannel?.ifood?.revenue || 0), 0);
  const fees = statsDocs.reduce((s, d) => s + (d.fees || 0) - (d.byChannel?.ifood?.fees || 0), 0);
  if (rev > 0) return (fees / rev) * 100;
  const credit = state.methods.find((m) => m.kind === "credito" && m.installments === 1);
  return credit ? credit.fee_percent + (credit.anticipation_percent || 0) : 2;
}

export function ifoodFeePercent() {
  const f = state.settings.ifood;
  return (Number(f.commission_percent) || 0) + (Number(f.payment_fee_percent) || 0);
}
