import { state, costBook, ingredient } from "../store.js";
import { createInventory, listWhere, statsForRange } from "../services.js";
import { money, esc, fmtQty, fmtDate, parseDecimal, isoDate, addDays, UNIT_LABEL, pct, decToInput } from "../format.js";
import { icon, pageHead, empty, on, $, $$, toast, tabs, busy, confirmDialog } from "../ui.js";
import { ESTOQUE_TABS } from "./insumos.js";

export const title = "Inventário";

export default async function (el) {
  let counting = false;
  let scope = "A";
  const counts = {};

  const end = isoDate();
  const [history, stats] = await Promise.all([
    listWhere("inventories").catch(() => []),
    statsForRange(addDays(end, -29), end).catch(() => []),
  ]);
  history.sort((a, b) => b.date.localeCompare(a.date) || (b.at ?? "").localeCompare(a.at ?? ""));

  // Curva ABC: quanto cada insumo pesou no custo das vendas dos últimos 30 dias
  const book = costBook();
  const consumption = new Map();
  for (const d of stats) for (const [pid, p] of Object.entries(d.byProduct ?? {})) {
    if (!state.products.some((x) => x.id === pid)) continue;
    for (const [ing, q] of book.usage(pid)) consumption.set(ing, (consumption.get(ing) ?? 0) + q * (p.qty || 0) * (ingredient(ing)?.unitCost ?? 0));
  }
  const totalCons = [...consumption.values()].reduce((s, v) => s + v, 0);
  const abc = new Map();
  let acc = 0;
  for (const [id, v] of [...consumption.entries()].sort((a, b) => b[1] - a[1])) {
    acc += v;
    const share = totalCons ? acc / totalCons : 1;
    abc.set(id, { klass: share <= 0.8 || acc === v ? "A" : share <= 0.95 ? "B" : "C", value: v, pct: totalCons ? (v / totalCons) * 100 : 0 });
  }
  const klassOf = (id) => abc.get(id)?.klass ?? "C";

  function renderList() {
    const aCount = state.ingredients.filter((i) => i.active !== false && klassOf(i.id) === "A").length;
    $("[data-body]", el).innerHTML = `
      <div class="grid g2" style="margin-bottom:var(--s-4)">
        <div class="card"><div class="card-b stack tight">
          <h3>Por que fazer inventário?</h3>
          <p class="small soft">A ficha técnica diz quanto <i>deveria</i> ter saído. A contagem mostra quanto <i>saiu de verdade</i>. A diferença (porção maior, desperdício, sumiço) entra no CMV real.</p>
          <p class="small soft"><b>Rotina recomendada:</b> toda semana conte só a <b>curva A</b> (${aCount} insumos que somam ~80% do seu custo). No último dia do mês, conte tudo.</p>
          <div class="row wrap" style="margin-top:var(--s-2)">
            <button class="btn brand" data-start="A">${icon("check2")}Contar curva A</button>
            <button class="btn" data-start="all">Inventário completo</button>
          </div></div></div>
        <div class="card"><div class="card-h"><h3>Curva ABC dos insumos</h3><span class="sub">peso no custo das vendas (30 dias)</span></div>
          <div class="card-b flush">${abc.size ? `<div class="table-wrap" style="max-height:260px;overflow:auto"><table class="t"><tbody>
            ${[...abc.entries()].slice(0, 12).map(([id, a]) => `<tr><td>${esc(ingredient(id)?.name ?? "?")}</td><td><span class="badge ${a.klass === "A" ? "brand" : a.klass === "B" ? "warn" : ""}">${a.klass}</span></td><td class="num">${money(Math.round(a.value * 100))}</td><td class="num muted">${pct(a.pct)}</td></tr>`).join("")}
          </tbody></table></div>` : empty("Sem vendas nos últimos 30 dias para calcular a curva.")}</div></div>
      </div>
      <div class="card"><div class="card-h"><h3>Inventários anteriores</h3></div><div class="card-b flush">
        ${history.length ? `<div class="list">${history.map((h) => `
          <details class="list-item" style="display:block"><summary class="row between" style="cursor:pointer;list-style:none">
            <span><b>${fmtDate(h.date)}</b> · ${h.items.length} insumo(s) ${h.full ? `<span class="badge info">completo</span>` : ""} <span class="muted xs">${esc(h.by ?? "")}</span></span>
            <span class="row"><span class="small soft">estoque ${money(h.value)}</span><span class="badge ${h.diffValue > 0 ? "bad" : "good"}">${h.diffValue > 0 ? "faltou" : "sobrou"} ${money(Math.abs(h.diffValue))}</span></span></summary>
            <table class="t" style="margin-top:var(--s-2)"><thead><tr><th>Insumo</th><th class="num">Sistema</th><th class="num">Contado</th><th class="num">Diferença</th><th class="num">Valor</th></tr></thead><tbody>
              ${h.items.filter((i) => Math.abs(i.counted - i.system) > 1e-9).map((i) => `<tr><td>${esc(i.name)}</td><td class="num">${fmtQty(i.system, i.unit)}</td><td class="num">${fmtQty(i.counted, i.unit)}</td><td class="num ${i.counted < i.system ? "bad" : "good"}">${fmtQty(i.counted - i.system, i.unit)}</td><td class="num">${money(-i.diffValue)}</td></tr>`).join("") || `<tr><td colspan="5" class="muted">Tudo bateu.</td></tr>`}
            </tbody></table></details>`).join("")}</div>` : empty("Nenhum inventário feito ainda.", "check2")}
      </div></div>`;
  }

  function renderCount() {
    const items = state.ingredients.filter((i) => i.active !== false && (scope === "all" || klassOf(i.id) === "A"));
    const byCat = new Map();
    for (const i of items) byCat.set(i.category, [...(byCat.get(i.category) ?? []), i]);
    $("[data-body]", el).innerHTML = `
      <div class="card"><div class="card-h"><h3>${scope === "all" ? "Inventário completo" : "Contagem da curva A"}</h3>
        <div class="row"><input class="input sm" type="date" data-date value="${isoDate()}" aria-label="Data da contagem" style="width:auto"><button class="btn sm" data-cancel>Cancelar</button></div></div>
        <div class="card-b flush"><div class="table-wrap"><table class="t"><thead><tr><th>Insumo</th><th class="num">No sistema</th><th class="num">Contado</th><th class="num">Diferença</th><th class="num">Valor</th></tr></thead><tbody>
        ${[...byCat.entries()].sort().map(([cat, list]) => `<tr class="sep"><td colspan="5">${esc(cat)}</td></tr>` + list.map((i) => `
          <tr data-row="${i.id}"><td><b>${esc(i.name)}</b></td><td class="num muted">${fmtQty(i.stock ?? 0, i.unit)}</td>
          <td class="num"><div class="affix" style="width:130px;margin-left:auto"><input class="input sm num" data-count="${i.id}" inputmode="decimal" value="${counts[i.id] != null ? decToInput(counts[i.id]) : ""}" placeholder="—" aria-label="Contagem de ${esc(i.name)}"><i>${UNIT_LABEL[i.unit]}</i></div></td>
          <td class="num" data-diff></td><td class="num" data-val></td></tr>`).join("")).join("")}
        </tbody></table></div></div>
        <div class="modal-f"><span class="small soft" data-summary style="margin-right:auto"></span><button class="btn brand" data-finish>${icon("check")}Concluir contagem</button></div>
      </div>
      <p class="xs muted" style="margin-top:var(--s-2)">Conte o que está fisicamente na loja (geladeira, freezer, estoque seco). Deixe em branco o que não contou — não será alterado. Dica: em kg, "0,35" = 350 g.</p>`;
    updateDiffs();
  }

  function updateDiffs() {
    let total = 0;
    let n = 0;
    for (const row of $$("[data-row]", el)) {
      const ing = ingredient(row.dataset.row);
      const v = counts[ing.id];
      const diffEl = $("[data-diff]", row);
      const valEl = $("[data-val]", row);
      if (v == null) { diffEl.textContent = ""; valEl.textContent = ""; continue; }
      n++;
      const diff = v - (ing.stock ?? 0);
      const val = Math.round(diff * ing.unitCost * 100);
      total += val;
      diffEl.innerHTML = Math.abs(diff) < 1e-9 ? `<span class="good">ok</span>` : `<span class="${diff < 0 ? "bad" : "good"}">${diff > 0 ? "+" : ""}${fmtQty(diff, ing.unit)}</span>`;
      valEl.innerHTML = val ? `<span class="${val < 0 ? "bad" : "good"}">${money(val)}</span>` : "";
    }
    const s = $("[data-summary]", el);
    if (s) s.innerHTML = n ? `${n} contado(s) · ${total < 0 ? `faltando <b class="bad">${money(-total)}</b>` : `sobrando <b class="good">${money(total)}</b>`}` : "Nenhum item contado ainda.";
  }

  el.innerHTML = `${pageHead("Estoque", "Contagem física: é ela que separa o CMV teórico do CMV real.")}${tabs(ESTOQUE_TABS, "#/estoque/inventario")}<div data-body></div>`;

  const offs = [
    on(el, "click", "[data-start]", (_e, b) => { scope = b.dataset.start; counting = true; renderCount(); }),
    on(el, "click", "[data-cancel]", () => { counting = false; for (const k in counts) delete counts[k]; renderList(); }),
    on(el, "input", "[data-count]", (e) => {
      const v = e.target.value.trim();
      if (v === "") delete counts[e.target.dataset.count];
      else counts[e.target.dataset.count] = parseDecimal(v);
      updateDiffs();
    }),
    on(el, "keydown", "[data-count]", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      const all = $$("[data-count]", el);
      all[all.indexOf(e.target) + 1]?.focus();
    }),
    on(el, "click", "[data-finish]", (_e, b) => busy(b, async () => {
      const items = Object.entries(counts).map(([ingredientId, counted]) => ({ ingredientId, counted }));
      if (!items.length) return toast("Conte pelo menos um item.", "bad");
      if (!(await confirmDialog("Concluir inventário?", `O estoque de ${items.length} insumo(s) será ajustado para o valor contado. A diferença entra no CMV real.`, { submit: "Concluir", danger: false }))) return;
      const date = $("[data-date]", el).value || isoDate();
      const r = await createInventory({ date, items });
      toast(r.diffValue > 0 ? `Inventário salvo. Faltaram ${money(r.diffValue)} em mercadoria.` : "Inventário salvo.", r.diffValue > 0 ? "" : "good");
      history.unshift({ date, items: [], value: r.value, diffValue: r.diffValue, at: new Date().toISOString() });
      counting = false;
      for (const k in counts) delete counts[k];
      const fresh = await listWhere("inventories").catch(() => history);
      history.splice(0, history.length, ...fresh.sort((a, b) => b.date.localeCompare(a.date) || (b.at ?? "").localeCompare(a.at ?? "")));
      renderList();
    })),
  ];
  renderList();
  return () => { offs.forEach((f) => f()); void counting; };
}
