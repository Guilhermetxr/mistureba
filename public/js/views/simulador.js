import { state, costBook, sellable } from "../store.js";
import { statsForRange, updatePrices } from "../services.js";
import { priceForTargetCmv } from "../costing.js";
import { money, pct, reais, esc, isoDate, addDays, parseDecimal, parseMoney, centsToInput, num } from "../format.js";
import { icon, pageHead, empty, on, $, $$, toast, busy, cmvBadge, confirmDialog } from "../ui.js";

export const title = "Simulador de preços";

export default async function (el) {
  let mode = "insumo";
  const changes = []; // [{ id, pct }]
  let reprice = { how: "meta", target: state.settings.cmv.target_percent, raise: 10, round: "090", cat: "" };
  let overrides = {};

  const end = isoDate();
  const stats = await statsForRange(addDays(end, -29), end).catch(() => []);
  const sold30 = {};
  for (const d of stats) for (const [id, p] of Object.entries(d.byProduct ?? {})) sold30[id] = (sold30[id] ?? 0) + (p.qty || 0);

  el.innerHTML = `
    ${pageHead("Simulador", "Teste cenários antes de mexer no cardápio: aumento de fornecedor, reajuste de preço, nova meta de CMV.", "", "CMV")}
    <div class="seg" style="margin-bottom:var(--s-4)"><button data-mode="insumo">E se o insumo subir?</button><button data-mode="preco">Reajustar preços</button></div>
    <div data-body></div>`;

  function render() {
    $$("[data-mode]", el).forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
    $("[data-body]", el).innerHTML = mode === "insumo" ? renderInsumo() : renderPreco();
  }

  /* ---------- 1) Variação de insumo ---------- */
  function renderInsumo() {
    const c = state.settings.cmv;
    const book = costBook();
    const factor = new Map(changes.map((x) => [x.id, 1 + x.pct / 100]));
    const affected = sellable()
      .map((p) => {
        const usage = book.usage(p.id);
        let delta = 0;
        for (const [ing, q] of usage) if (factor.has(ing)) delta += q * (state.ingredients.find((i) => i.id === ing)?.unitCost ?? 0) * (factor.get(ing) - 1);
        const cost = book.unitCost(p.id) * 100;
        const newCost = cost + delta * 100;
        return { p, cost, newCost, delta: delta * 100, monthly: delta * 100 * (sold30[p.id] ?? 0) };
      })
      .filter((x) => Math.abs(x.delta) > 0.001)
      .sort((a, b) => b.monthly - a.monthly || b.delta - a.delta);
    const monthly = affected.reduce((s, x) => s + x.monthly, 0);
    const options = state.ingredients.filter((i) => i.active !== false && !changes.some((x) => x.id === i.id));
    return `
      <div class="grid" style="grid-template-columns:minmax(0,340px) minmax(0,1fr);align-items:start">
        <div class="card"><div class="card-h"><h3>Cenário</h3></div><div class="card-b stack">
          ${changes.map((x, i) => {
            const ing = state.ingredients.find((j) => j.id === x.id);
            return `<div class="stack tight"><div class="row between"><b class="small">${esc(ing?.name)}</b><button class="btn ghost sm icon" data-rm="${i}" aria-label="Remover">${icon("x")}</button></div>
              <div class="row"><div class="affix" style="width:120px"><input class="input sm num" data-pct="${i}" inputmode="decimal" value="${String(x.pct).replace(".", ",")}"><i>%</i></div>
              <span class="small soft">${reais(ing?.unitCost ?? 0)} → <b>${reais((ing?.unitCost ?? 0) * (1 + x.pct / 100))}</b>/${ing?.unit}</span></div></div>`;
          }).join("")}
          <select class="select" data-pick><option value="">+ Escolher insumo…</option>${options.map((i) => `<option value="${i.id}">${esc(i.name)}</option>`).join("")}</select>
          ${changes.length ? `<div class="alert ${monthly > 0 ? "warn" : "good"}">${icon(monthly > 0 ? "alert" : "check")}<div>Impacto estimado: <b>${money(Math.round(monthly))}/mês</b> a mais de custo, pelo volume vendido nos últimos 30 dias.</div></div>` : `<p class="small muted">Ex.: o açougue avisou que a carne sobe 12% semana que vem. Coloque aqui e veja quanto isso come da sua margem.</p>`}
        </div></div>
        <div class="card"><div class="card-h"><h3>Produtos afetados</h3><span class="sub">${affected.length} item(ns)</span></div>
          <div class="card-b flush">${!changes.length ? empty("Escolha um insumo e a variação ao lado.", "sliders") : !affected.length ? empty("Nenhum produto usa esse insumo.") : `<div class="table-wrap"><table class="t"><thead><tr>
            <th>Produto</th><th class="num">Custo hoje</th><th class="num">Custo novo</th><th class="num">CMV hoje</th><th class="num">CMV novo</th><th class="num">Preço p/ meta</th><th class="num">Vendidos 30d</th><th class="num">Impacto/mês</th></tr></thead><tbody>
            ${affected.map((x) => `<tr class="click" data-href="#/cmv/fichas/${x.p.id}"><td><b>${esc(x.p.name)}</b></td><td class="num">${money(Math.round(x.cost))}</td><td class="num">${money(Math.round(x.newCost))}</td>
              <td class="num">${cmvBadge((x.cost / x.p.price) * 100, c)}</td><td class="num">${cmvBadge((x.newCost / x.p.price) * 100, c)}</td>
              <td class="num">${money(priceForTargetCmv(Math.round(x.newCost), c.target_percent))}</td><td class="num">${num(sold30[x.p.id] ?? 0)}</td><td class="num">${money(Math.round(x.monthly))}</td></tr>`).join("")}
            </tbody></table></div>`}</div></div>
      </div>`;
  }

  /* ---------- 2) Reajuste de preços ---------- */
  function roundPrice(cents) {
    if (reprice.round === "none") return Math.round(cents);
    if (reprice.round === "050") return Math.ceil(cents / 50) * 50;
    // termina em ,90
    const up = Math.ceil((cents - 90) / 100) * 100 + 90;
    return up < cents ? up + 100 : up;
  }

  function proposals() {
    const c = state.settings.cmv;
    const book = costBook();
    return sellable()
      .filter((p) => !reprice.cat || p.category === reprice.cat)
      .map((p) => {
        const cost = book.unitCostCents(p.id);
        let proposal = reprice.how === "meta" ? priceForTargetCmv(cost, reprice.target) : p.price * (1 + reprice.raise / 100);
        if (reprice.how === "meta" && proposal < p.price) proposal = p.price; // não baixa preço sozinho
        proposal = overrides[p.id] ?? roundPrice(proposal);
        return { p, cost, now: p.price, proposal, oldPct: p.price ? (cost / p.price) * 100 : 0, newPct: proposal ? (cost / proposal) * 100 : 0, sold: sold30[p.id] ?? 0, c };
      })
      .sort((a, b) => b.oldPct - a.oldPct);
  }

  function renderPreco() {
    const rows = proposals();
    const c = state.settings.cmv;
    const cats = [...new Set(sellable().map((p) => p.category))].sort();
    const extra = rows.reduce((s, r) => s + (r.proposal - r.now) * r.sold, 0);
    const changed = rows.filter((r) => r.proposal !== r.now);
    return `
      <div class="card" style="margin-bottom:var(--s-4)"><div class="card-b"><div class="form-grid" style="align-items:end">
        <label class="field"><span>Como calcular</span><select class="select" data-rp="how"><option value="meta" ${reprice.how === "meta" ? "selected" : ""}>Bater a meta de CMV</option><option value="raise" ${reprice.how === "raise" ? "selected" : ""}>Aumento percentual</option></select></label>
        ${reprice.how === "meta" ? `<label class="field"><span>CMV desejado</span><div class="affix"><input class="input num" data-rp="target" inputmode="decimal" value="${reprice.target}"><i>%</i></div></label>`
          : `<label class="field"><span>Aumento</span><div class="affix"><input class="input num" data-rp="raise" inputmode="decimal" value="${reprice.raise}"><i>%</i></div></label>`}
        <label class="field"><span>Arredondar</span><select class="select" data-rp="round"><option value="090" ${reprice.round === "090" ? "selected" : ""}>Terminar em ,90</option><option value="050" ${reprice.round === "050" ? "selected" : ""}>Múltiplo de 0,50</option><option value="none" ${reprice.round === "none" ? "selected" : ""}>Sem arredondar</option></select></label>
        <label class="field"><span>Categoria</span><select class="select" data-rp="cat"><option value="">Todas</option>${cats.map((x) => `<option ${x === reprice.cat ? "selected" : ""}>${esc(x)}</option>`).join("")}</select></label>
      </div></div></div>
      <div class="card"><div class="card-h"><h3>Proposta</h3><span class="sub">${changed.length} preço(s) mudam · receita extra estimada ${money(Math.round(extra))}/mês (mesmo volume)</span></div>
        <div class="card-b flush"><div class="table-wrap"><table class="t"><thead><tr><th>Produto</th><th class="num">Custo</th><th class="num">Preço hoje</th><th class="num">CMV hoje</th><th class="num">Novo preço</th><th class="num">CMV novo</th><th class="num">Vendidos 30d</th></tr></thead><tbody>
        ${rows.map((r) => `<tr class="${r.proposal === r.now ? "dim" : ""}"><td><b>${esc(r.p.name)}</b> <span class="muted xs">${esc(r.p.category)}</span></td><td class="num">${money(r.cost)}</td><td class="num">${money(r.now)}</td>
          <td class="num">${cmvBadge(r.oldPct, c)}</td>
          <td class="num"><div class="affix pre" style="width:120px;margin-left:auto"><i>R$</i><input class="input sm num" data-ov="${r.p.id}" inputmode="decimal" value="${centsToInput(r.proposal)}"></div></td>
          <td class="num">${cmvBadge(r.newPct, c)}</td><td class="num">${num(r.sold)}</td></tr>`).join("")}
        </tbody></table></div></div>
        <div class="modal-f" style="border-radius:0 0 var(--r-lg) var(--r-lg)"><button class="btn" data-reset>Limpar ajustes manuais</button><button class="btn brand" data-apply ${changed.length ? "" : "disabled"}>${icon("check")}Aplicar ${changed.length} novo(s) preço(s)</button></div>
      </div>`;
  }

  const offs = [
    on(el, "click", "[data-mode]", (_e, b) => { mode = b.dataset.mode; render(); }),
    on(el, "click", "[data-href]", (_e, t) => (location.hash = t.dataset.href)),
    on(el, "change", "[data-pick]", (e) => { if (e.target.value) { changes.push({ id: e.target.value, pct: 10 }); render(); } }),
    on(el, "click", "[data-rm]", (_e, b) => { changes.splice(Number(b.dataset.rm), 1); render(); }),
    on(el, "change", "[data-pct]", (e) => { changes[Number(e.target.dataset.pct)].pct = parseDecimal(e.target.value); render(); }),
    on(el, "change", "[data-rp]", (e) => {
      const k = e.target.dataset.rp;
      reprice[k] = ["target", "raise"].includes(k) ? parseDecimal(e.target.value) : e.target.value;
      overrides = {};
      render();
    }),
    on(el, "change", "[data-ov]", (e) => { overrides[e.target.dataset.ov] = parseMoney(e.target.value); render(); }),
    on(el, "click", "[data-reset]", () => { overrides = {}; render(); }),
    on(el, "click", "[data-apply]", (_e, b) => busy(b, async () => {
      const list = proposals().filter((r) => r.proposal !== r.now);
      if (!(await confirmDialog("Aplicar novos preços?", `${list.length} produto(s) terão o preço de balcão alterado. O PDV passa a usar os novos valores na hora.`, { submit: "Aplicar", danger: false }))) return;
      await updatePrices(list.map((r) => ({ id: r.p.id, price: r.proposal })));
      overrides = {};
      toast("Preços atualizados.", "good");
      render();
    })),
  ];
  render();
  return () => offs.forEach((f) => f());
}
