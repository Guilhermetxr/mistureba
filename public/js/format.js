// Formatação e datas. Dinheiro é SEMPRE guardado em centavos (inteiro).

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const NUM = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 });
const PCT = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1, minimumFractionDigits: 1 });

export const money = (cents) => BRL.format((cents || 0) / 100);
/** Valor em reais (float) — custo unitário de insumo, pode ter mais casas */
export const reais = (v) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: Math.abs(v) < 1 && v !== 0 ? 4 : 2 }).format(v || 0);
export const num = (v) => NUM.format(v || 0);
export const pct = (v) => `${PCT.format(Number.isFinite(v) ? v : 0)}%`;
export const ratio = (part, whole) => (whole ? (part / whole) * 100 : 0);

/** "12,50" | "12.50" | "1.234,56" -> número */
export function parseDecimal(input) {
  if (input == null) return 0;
  let s = String(input).trim().replace(/[R$\s%]/g, "");
  if (!s) return 0;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}
export const parseMoney = (input) => Math.round(parseDecimal(input) * 100);
export const centsToInput = (c) => (c == null ? "" : (c / 100).toFixed(2).replace(".", ","));
export const decToInput = (v, digits = 3) => (v == null ? "" : String(Number(Number(v).toFixed(digits))).replace(".", ","));

const pad = (n) => String(n).padStart(2, "0");
export const isoDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const isoMonth = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
export const nowTime = (d = new Date()) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
export function addDays(date, days) {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + days);
  return isoDate(d);
}
export function monthRange(month) {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  return { start: `${month}-01`, end: `${month}-${pad(last)}`, days: last };
}
export function shiftMonth(month, delta) {
  const [y, m] = month.split("-").map(Number);
  return isoMonth(new Date(y, m - 1 + delta, 1));
}
export function daysBetween(a, b) {
  return Math.round((new Date(`${b}T12:00:00`) - new Date(`${a}T12:00:00`)) / 86400000);
}
export const fmtDate = (s) => {
  if (!s) return "—";
  const [y, m, d] = String(s).slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
};
export const fmtDayShort = (s) => {
  const [, m, d] = s.split("-");
  return `${d}/${m}`;
};
export function fmtMonth(month) {
  const [y, m] = month.split("-").map(Number);
  const name = new Date(y, m - 1, 1).toLocaleDateString("pt-BR", { month: "long" });
  return `${name[0].toUpperCase()}${name.slice(1)} de ${y}`;
}
export function weekday(date) {
  return new Date(`${date}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "");
}
/** Timestamp do Firestore | Date | ms -> "dd/mm hh:mm" */
export function fmtTs(ts, withDate = true) {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return withDate ? `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${nowTime(d)}` : nowTime(d);
}

export const UNIT_LABEL = { kg: "kg", l: "L", un: "un" };
/** Unidade menor para digitar ficha técnica (g, ml) */
export const SMALL_UNIT = { kg: "g", l: "ml", un: "un" };
export const toSmall = (unit, q) => (unit === "un" ? q : q * 1000);
export const fromSmall = (unit, q) => (unit === "un" ? q : q / 1000);
export function fmtQty(q, unit) {
  if (unit !== "un" && Math.abs(q) < 1 && q !== 0) return `${num(q * 1000)} ${SMALL_UNIT[unit]}`;
  return `${num(q)} ${UNIT_LABEL[unit] ?? unit}`;
}

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export const CHANNELS = { balcao: "Balcão", delivery: "Delivery próprio", ifood: "iFood" };
export const KIND_LABEL = { dinheiro: "Dinheiro", pix: "Pix", debito: "Débito", credito: "Crédito", voucher: "Voucher", ifood: "iFood", outro: "Outro" };
