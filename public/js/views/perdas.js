import { state, isAdmin, ingredient, costBook } from "../store.js";
import { registerLoss, listWhere } from "../services.js";
import { fb } from "../firebase.js";
import { money, esc, fmtQty, fmtDate, parseDecimal, isoDate, isoMonth, fmtMonth, SMALL_UNIT, fromSmall, reais } from "../format.js";
import { icon, pageHead, empty, on, $, toast, tabs, busy, formData } from "../ui.js";
import { ESTOQUE_TABS } from "./insumos.js";

export const title = "Perdas";

const REASONS = {
  queimou: "Queimou / errou no preparo",
  venceu: "Venceu / estragou",
  pedido: "Pedido errado / devolvido",
  consumo: "Consumo da equipe",
  cortesia: "Cortesia",
  outros: "Outro motivo",
};

export default async function (el) {
  const admin = isAdmin();
  let kind = "prod";

  el.innerHTML = `
    ${pageHead(admin ? "Estoque" : "Perdas", "Registrar o que foi pro lixo é o que faz o CMV bater. Lanche que queimou é custo sem venda.")}
    ${admin ? tabs(ESTOQUE_TABS, "#/estoque/perdas") : ""}
    <div class="grid" style="grid-template-columns:${admin ? "minmax(0,380px) minmax(0,1fr)" : "minmax(0,420px)"};align-items:start">
      <form class="card" data-form novalidate><div class="card-h"><h3>Registrar perda</h3></div><div class="card-b stack">
        <div class="seg"><button type="button" data-kind="prod">Lanche / item pronto</button><button type="button" data-kind="ing">Insumo</button></div>
        <label class="field"><span data-item-label>Item</span><select class="select" name="id" required></select></label>
        <label class="field"><span>Quantidade</span><div class="affix"><input class="input num" name="qty" inputmode="decimal" value="1" required><i data-unit>un</i></div></label>
        <label class="field"><span>Motivo</span><select class="select" name="category">${Object.entries(REASONS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></label>
        <label class="field"><span>Detalhe (opcional)</span><input class="input" name="reason" placeholder="Ex.: chapa muito quente"></label>
        <p class="small soft" data-preview></p>
        <p class="form-error" role="alert"></p>
        <button class="btn primary" type="submit">${icon("trash")}Registrar perda</button>
      </div></form>
      <div data-list>${admin ? `<div class="boot" style="min-height:20vh">Carregando…</div>` : ""}</div>
    </div>`;

  const form = $("[data-form]", el);

  function renderForm() {
    for (const b of el.querySelectorAll("[data-kind]")) b.classList.toggle("active", b.dataset.kind === kind);
    const list = kind === "prod" ? state.products.filter((p) => p.active !== false && p.recipe?.length) : state.ingredients.filter((i) => i.active !== false);
    $("[name=id]", form).innerHTML = list.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join("");
    $("[data-item-label]", form).textContent = kind === "prod" ? "Lanche / item pronto" : "Insumo";
    $("[name=qty]", form).value = kind === "prod" ? "1" : "";
    preview();
  }

  function preview() {
    const id = $("[name=id]", form).value;
    let qty = parseDecimal($("[name=qty]", form).value);
    let value = 0;
    let unit = "un";
    if (kind === "prod") value = costBook().unitCost(id) * qty;
    else {
      const ing = ingredient(id);
      unit = ing?.unit ?? "un";
      qty = fromSmall(unit, qty);
      value = (ing?.unitCost ?? 0) * qty;
    }
    $("[data-unit]", form).textContent = kind === "prod" ? "un" : SMALL_UNIT[unit];
    $("[data-preview]", form).innerHTML = qty > 0 ? `Custo perdido: <b>${reais(value)}</b>` : "";
  }

  async function loadList() {
    if (!admin) return;
    const month = isoMonth();
    const list = await listWhere("stockMovements", fb.where("type", "==", "perda"), fb.where("month", "==", month)).catch(() => []);
    list.sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
    const total = list.reduce((s, m) => s + Math.abs(m.value || 0), 0);
    const byReason = new Map();
    for (const m of list) byReason.set(m.category ?? "outros", (byReason.get(m.category ?? "outros") ?? 0) + Math.abs(m.value || 0));
    $("[data-list]", el).innerHTML = `
      <div class="card" style="margin-bottom:var(--s-4)"><div class="card-h"><h3>Perdas em ${fmtMonth(month)}</h3><b class="num bad">${money(total)}</b></div>
        <div class="card-b">${byReason.size ? `<div class="row wrap">${[...byReason.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `<span class="badge">${REASONS[k] ?? k}: ${money(v)}</span>`).join("")}</div>` : `<p class="small muted">Nenhuma perda registrada neste mês.</p>`}</div></div>
      <div class="card"><div class="card-b flush">${list.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Data</th><th>Insumo</th><th>Motivo</th><th class="num">Qtd.</th><th class="num">Valor</th><th>Por</th></tr></thead><tbody>
        ${list.map((m) => `<tr><td>${fmtDate(m.day)}</td><td>${esc(m.name)}</td><td class="small soft">${esc(m.reason)}</td><td class="num">${fmtQty(Math.abs(m.qty), ingredient(m.ingredientId)?.unit ?? "un")}</td><td class="num">${money(Math.abs(m.value))}</td><td class="small muted">${esc(m.by ?? "")}</td></tr>`).join("")}
      </tbody></table></div>` : empty("Sem registros.", "trash")}</div></div>`;
  }

  const offs = [
    on(el, "click", "[data-kind]", (_e, b) => { kind = b.dataset.kind; renderForm(); }),
    on(form, "input", "[name=qty]", preview),
    on(form, "change", "[name=id]", preview),
  ];
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const btn = $("button[type=submit]", form);
    const err = $(".form-error", form);
    busy(btn, async () => {
      err.textContent = "";
      try {
        const v = formData(form);
        let qty = parseDecimal(v.qty);
        if (!(qty > 0)) throw new Error("Informe a quantidade.");
        if (kind === "ing") qty = fromSmall(ingredient(v.id)?.unit ?? "un", qty);
        const value = await registerLoss({ kind, id: v.id, qty, category: v.category, reason: [REASONS[v.category], v.reason].filter(Boolean).join(" — "), date: isoDate() });
        toast(`Perda registrada: ${money(value)}.`, "good");
        $("[name=reason]", form).value = "";
        loadList();
      } catch (ex) {
        err.textContent = ex.message;
      }
    });
  });
  renderForm();
  await loadList();
  return () => offs.forEach((f) => f());
}

