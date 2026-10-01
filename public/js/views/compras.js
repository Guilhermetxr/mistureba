import { state, ingredient } from "../store.js";
import { createPurchase, listWhere } from "../services.js";
import { fb } from "../firebase.js";
import { money, reais, esc, fmtQty, fmtDate, parseDecimal, parseMoney, isoDate, isoMonth, shiftMonth, fmtMonth, UNIT_LABEL, pct, decToInput, centsToInput } from "../format.js";
import { scanNotaModal } from "../nota-scan.js";
import { icon, pageHead, empty, on, $, modal, toast, tabs, opt } from "../ui.js";
import { ESTOQUE_TABS } from "./insumos.js";

export const title = "Compras";

export function purchaseModal(onDone, initial = {}) {
  const lines = (initial.lines ?? []).map((l) => ({ ...l, qtyRaw: decToInput(l.qty), totalRaw: centsToInput(l.total) }));
  const suppliers = [...new Set(state.ingredients.map((i) => i.supplier).filter(Boolean))].sort();
  const d = modal({
    title: "Lançar compra",
    wide: true,
    submit: "Lançar compra",
    body: `
      <div class="form-grid">
        <label class="field"><span>Data</span><input class="input" type="date" name="date" value="${initial.date || isoDate()}" required></label>
        <label class="field" style="grid-column:span 2"><span>Fornecedor</span><input class="input" name="supplier" list="sup-list" placeholder="Ex.: Atacadão" value="${esc(initial.supplier ?? "")}"><datalist id="sup-list">${suppliers.map((s) => `<option value="${esc(s)}">`).join("")}</datalist></label>
        <label class="field"><span>Pagamento</span><select class="select" name="billMode">
          ${opt("pago", "Pago na hora", "pago")}${opt("aberto", "A prazo (boleto)", "")}${opt("nenhum", "Não lançar no financeiro", "")}</select></label>
        <label class="field" data-due hidden><span>Vencimento</span><input class="input" type="date" name="dueDate"></label>
      </div>
      <div class="card" style="margin-top:var(--s-4);box-shadow:none"><div class="table-wrap"><table class="t"><thead><tr><th>Insumo</th><th class="num">Quantidade</th><th class="num">Valor total</th><th class="num">Preço unit.</th><th class="num">Custo atual</th><th></th></tr></thead>
        <tbody data-lines></tbody><tfoot data-foot></tfoot></table></div>
        <div style="padding:var(--s-3) var(--s-5)"><select class="select" data-add style="max-width:360px"></select></div></div>
      <label class="field" style="margin-top:var(--s-4)"><span>Observações</span><input class="input" name="notes" placeholder="Nº da nota, etc." value="${esc(initial.notes ?? "")}"></label>
      <p class="xs muted" style="margin-top:var(--s-2)">Método de custo: <b>${state.settings.cmv.cost_method === "medio" ? "custo médio ponderado" : "último preço de compra"}</b> (muda em Configurações › CMV). A compra soma no estoque e recalcula todas as fichas.</p>`,
    onOpen: (dlg) => {
      const renderLines = () => {
        const used = new Set(lines.map((l) => l.ingredientId));
        $("[data-add]", dlg).innerHTML = `<option value="">+ Adicionar insumo…</option>` + state.ingredients.filter((i) => i.active !== false && !used.has(i.id)).map((i) => `<option value="${i.id}">${esc(i.name)} (${UNIT_LABEL[i.unit]})</option>`).join("");
        $("[data-lines]", dlg).innerHTML = lines.length ? lines.map((l, idx) => {
          const ing = ingredient(l.ingredientId);
          const unit = l.qty > 0 && l.total > 0 ? l.total / 100 / l.qty : 0;
          const diff = unit && ing.unitCost ? ((unit - ing.unitCost) / ing.unitCost) * 100 : 0;
          return `<tr><td><b>${esc(ing.name)}</b></td>
            <td class="num"><div class="affix" style="width:120px;margin-left:auto"><input class="input sm num" data-q="${idx}" inputmode="decimal" value="${l.qtyRaw ?? ""}"><i>${UNIT_LABEL[ing.unit]}</i></div></td>
            <td class="num"><div class="affix pre" style="width:130px;margin-left:auto"><i>R$</i><input class="input sm num" data-v="${idx}" inputmode="decimal" value="${l.totalRaw ?? ""}"></div></td>
            <td class="num">${unit ? reais(unit) : "—"}${unit && Math.abs(diff) >= 1 ? ` <span class="badge ${diff > 0 ? "bad" : "good"}">${diff > 0 ? "+" : "−"}${pct(Math.abs(diff))}</span>` : ""}</td>
            <td class="num muted">${reais(ing.unitCost)}</td>
            <td class="act"><button type="button" class="btn ghost sm icon" data-rm="${idx}" aria-label="Remover">${icon("x")}</button></td></tr>`;
        }).join("") : `<tr><td colspan="6" class="muted small" style="padding:var(--s-4) var(--s-5)">Adicione os itens da nota.</td></tr>`;
        const total = lines.reduce((s, l) => s + (l.total || 0), 0);
        $("[data-foot]", dlg).innerHTML = lines.length ? `<tr><td colspan="2">Total</td><td class="num">${money(total)}</td><td colspan="3"></td></tr>` : "";
      };
      on(dlg, "change", "[data-add]", (e) => {
        if (!e.target.value) return;
        lines.push({ ingredientId: e.target.value, qty: 0, total: 0 });
        renderLines();
        dlg.querySelectorAll("[data-q]")[lines.length - 1]?.focus();
      });
      on(dlg, "change", "[data-q]", (e) => { const l = lines[e.target.dataset.q]; l.qtyRaw = e.target.value; l.qty = parseDecimal(e.target.value); renderLines(); });
      on(dlg, "change", "[data-v]", (e) => { const l = lines[e.target.dataset.v]; l.totalRaw = e.target.value; l.total = parseMoney(e.target.value); renderLines(); });
      on(dlg, "click", "[data-rm]", (_e, b) => { lines.splice(Number(b.dataset.rm), 1); renderLines(); });
      on(dlg, "change", "[name=billMode]", (e) => ($("[data-due]", dlg).hidden = e.target.value !== "aberto"));
      renderLines();
    },
    onSubmit: async (form) => {
      const f = Object.fromEntries(new FormData(form));
      if (f.billMode === "aberto" && !f.dueDate) throw new Error("Informe o vencimento do boleto.");
      await createPurchase({ ...f, items: lines });
      toast("Compra lançada. Estoque e custos atualizados.", "good");
      onDone?.();
    },
  });
  return d;
}

export default async function (el) {
  let month = isoMonth();

  async function load() {
    const list = await listWhere("purchases", fb.where("month", "==", month)).catch(() => []);
    list.sort((a, b) => b.date.localeCompare(a.date) || (b.at ?? "").localeCompare(a.at ?? ""));
    const total = list.reduce((s, p) => s + p.total, 0);
    const bySupplier = new Map();
    for (const p of list) bySupplier.set(p.supplier || "Sem fornecedor", (bySupplier.get(p.supplier || "Sem fornecedor") ?? 0) + p.total);
    $("[data-body]", el).innerHTML = `
      <div class="grid" style="grid-template-columns:minmax(0,2fr) minmax(0,1fr);align-items:start">
        <div class="card"><div class="card-h"><h3>${fmtMonth(month)}</h3><span class="sub">${list.length} compra(s) · ${money(total)}</span></div>
          <div class="card-b flush">${list.length ? `<div class="list">${list.map((p) => `
            <details class="list-item" style="display:block"><summary class="row between" style="cursor:pointer;list-style:none">
              <span><b>${fmtDate(p.date)}</b> · ${esc(p.supplier || "Sem fornecedor")} <span class="muted xs">${p.items.length} item(ns)${p.notes ? ` · ${esc(p.notes)}` : ""}</span></span>
              <b class="num">${money(p.total)}</b></summary>
              <table class="t" style="margin-top:var(--s-2)"><tbody>${p.items.map((i) => `<tr><td>${esc(i.name)}</td><td class="num">${fmtQty(i.qty, i.unit)}</td><td class="num">${reais(i.unitPrice)}/${UNIT_LABEL[i.unit]}</td><td class="num">${money(i.total)}</td></tr>`).join("")}</tbody></table>
            </details>`).join("")}</div>` : empty("Nenhuma compra lançada neste mês.", "truck")}</div></div>
        <div class="card"><div class="card-h"><h3>Por fornecedor</h3></div><div class="card-b flush">
          ${bySupplier.size ? `<table class="t"><tbody>${[...bySupplier.entries()].sort((a, b) => b[1] - a[1]).map(([s, v]) => `<tr><td>${esc(s)}</td><td class="num">${money(v)}</td></tr>`).join("")}</tbody></table>` : empty("—")}
        </div></div>
      </div>`;
  }

  el.innerHTML = `
    ${pageHead("Estoque", "Toda nota de compra lançada aqui atualiza o estoque e o custo dos insumos — e, por tabela, o CMV de cada lanche.", `<button class="btn" data-scan>${icon("camera")}Escanear nota</button><button class="btn primary" data-new>${icon("plus")}Lançar compra</button>`)}
    ${tabs(ESTOQUE_TABS, "#/estoque/compras")}
    <div class="row" style="margin-bottom:var(--s-3)"><button class="btn icon sm" data-m="-1" aria-label="Mês anterior">${icon("left")}</button><button class="btn icon sm" data-m="1" aria-label="Próximo mês">${icon("right")}</button></div>
    <div data-body><div class="boot" style="min-height:20vh">Carregando…</div></div>`;

  const offs = [
    on(el, "click", "[data-new]", () => purchaseModal(load)),
    on(el, "click", "[data-scan]", () => scanNotaModal((data) => purchaseModal(load, data))),
    on(el, "click", "[data-m]", (_e, b) => { month = shiftMonth(month, Number(b.dataset.m)); load(); }),
  ];
  await load();
  return () => offs.forEach((f) => f());
}
