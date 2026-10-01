import { state, costBook, subscribe, avgFeePercent, ifoodFeePercent } from "../store.js";
import { money, pct, esc, fmtQty } from "../format.js";
import { icon, pageHead, empty, cmvBadge, on, $ } from "../ui.js";
import { contribution } from "../costing.js";

export const title = "Fichas técnicas";

export default async function (el, _p, q) {
  let kind = q.get("tipo") === "preparo" ? "preparo" : "venda";
  let cat = "";
  let search = "";
  let sort = "cmv";

  el.innerHTML = `
    ${pageHead("Fichas técnicas", "Receita de cada item com o custo calculado na hora. Mudou o preço do insumo, muda aqui.",
      `<a class="btn primary" href="#/cmv/fichas/novo?tipo=${kind}">${icon("plus")}Nova ficha</a>`, "CMV")}
    <div class="row wrap between" style="margin-bottom:var(--s-4)">
      <div class="seg" role="tablist">
        <button data-kind="venda">Produtos de venda</button><button data-kind="preparo">Preparos / sub-receitas</button>
      </div>
      <div class="row wrap">
        <label class="search">${icon("search")}<input class="input sm" data-search placeholder="Buscar…" style="width:200px"></label>
        <select class="select sm" data-cat style="width:auto"></select>
        <select class="select sm" data-sort style="width:auto">
          <option value="cmv">Maior CMV primeiro</option><option value="mc">Menor margem primeiro</option><option value="name">Nome</option>
        </select>
      </div>
    </div>
    <div class="card"><div class="card-b flush" data-list></div></div>
    <p class="small muted" style="margin-top:var(--s-3)" data-foot></p>`;

  function render() {
    const c = state.settings.cmv;
    const book = costBook();
    const fee = avgFeePercent();
    const ifee = ifoodFeePercent();
    for (const b of el.querySelectorAll("[data-kind]")) b.classList.toggle("active", b.dataset.kind === kind);
    const all = state.products.filter((p) => p.kind === kind);
    const cats = [...new Set(all.map((p) => p.category))].sort();
    $("[data-cat]", el).innerHTML = `<option value="">Todas as categorias</option>` + cats.map((x) => `<option ${x === cat ? "selected" : ""}>${esc(x)}</option>`).join("");
    const needle = search.toLowerCase();
    let rows = all
      .filter((p) => (!cat || p.category === cat) && (!needle || p.name.toLowerCase().includes(needle)))
      .map((p) => {
        const cost = book.unitCostCents(p.id);
        const b = contribution(p.price, cost, fee, c.tax_percent);
        const i = p.ifoodPrice ? contribution(p.ifoodPrice, cost, ifee, c.tax_percent) : null;
        return { p, cost, b, i, lines: p.recipe?.length ?? 0 };
      });
    rows.sort((a, b) =>
      sort === "name" ? a.p.name.localeCompare(b.p.name, "pt-BR") : sort === "mc" ? a.b.mcPct - b.b.mcPct : b.b.cmvPct - a.b.cmvPct,
    );

    const list = $("[data-list]", el);
    if (!rows.length) {
      list.innerHTML = empty(all.length ? "Nada encontrado com esse filtro." : "Nenhuma ficha cadastrada ainda.");
      return;
    }
    if (kind === "preparo") {
      list.innerHTML = `<div class="table-wrap"><table class="t"><thead><tr><th>Preparo</th><th>Rendimento</th><th class="num">Custo da receita</th><th class="num">Custo por unidade</th><th class="num">Usado em</th></tr></thead><tbody>
        ${rows.map(({ p, lines }) => {
          const usedBy = state.products.filter((x) => x.recipe?.some((r) => r.type === "prod" && r.id === p.id)).length;
          const unit = book.unitCost(p.id);
          return `<tr class="click ${p.active === false ? "dim" : ""}" data-href="#/cmv/fichas/${p.id}"><td><b>${esc(p.name)}</b>${lines ? "" : ` <span class="badge warn">sem receita</span>`}</td>
          <td>${fmtQty(p.yieldQty, p.yieldUnit)}</td><td class="num">${money(Math.round(unit * p.yieldQty * 100))}</td>
          <td class="num">${money(Math.round(unit * 100))} / ${p.yieldUnit === "un" ? "un" : p.yieldUnit}</td><td class="num">${usedBy} ficha${usedBy === 1 ? "" : "s"}</td></tr>`;
        }).join("")}</tbody></table></div>`;
    } else {
      list.innerHTML = `<div class="table-wrap"><table class="t"><thead><tr>
        <th>Produto</th><th class="num">Custo</th><th class="num">Preço balcão</th><th class="num">CMV</th><th class="num">Margem de contribuição</th>
        <th class="num">Preço iFood</th><th class="num">CMV iFood</th><th class="num">Margem iFood</th></tr></thead><tbody>
        ${rows.map(({ p, cost, b, i, lines }) => `<tr class="click ${p.active === false ? "dim" : ""}" data-href="#/cmv/fichas/${p.id}">
          <td><b>${esc(p.name)}</b> <span class="muted xs">${esc(p.category)}</span>${lines ? "" : ` <span class="badge warn">${icon("alert")}sem ficha</span>`}${p.active === false ? ` <span class="badge">inativo</span>` : ""}</td>
          <td class="num">${money(cost)}</td><td class="num">${money(p.price)}</td><td class="num">${cmvBadge(b.cmvPct, c)}</td>
          <td class="num ${b.mc < 0 ? "bad" : ""}">${money(b.mc)} <span class="muted xs">${pct(b.mcPct)}</span></td>
          <td class="num">${p.ifoodPrice ? money(p.ifoodPrice) : `<span class="muted">—</span>`}</td>
          <td class="num">${i ? cmvBadge(i.cmvPct, c) : ""}</td>
          <td class="num ${i && i.mc < 0 ? "bad" : ""}">${i ? `${money(i.mc)} <span class="muted xs">${pct(i.mcPct)}</span>` : ""}</td></tr>`).join("")}
        </tbody></table></div>`;
    }
    $("[data-foot]", el).textContent =
      kind === "venda"
        ? `Margem de contribuição = preço − custo − taxa média de cartão (${pct(fee)}) − impostos (${pct(c.tax_percent)}). No iFood: comissão + taxa de pagamento (${pct(ifee)}).`
        : "Preparos são receitas intermediárias (molhos, blends, massas). Entram nas fichas dos produtos pelo custo por unidade.";
  }

  const offs = [
    on(el, "click", "[data-kind]", (_e, b) => {
      kind = b.dataset.kind;
      cat = "";
      el.querySelector(".page-head a").href = `#/cmv/fichas/novo?tipo=${kind}`;
      render();
    }),
    on(el, "click", "[data-href]", (_e, t) => (location.hash = t.dataset.href)),
    on(el, "input", "[data-search]", (e) => { search = e.target.value; render(); }),
    on(el, "change", "[data-cat]", (e) => { cat = e.target.value; render(); }),
    on(el, "change", "[data-sort]", (e) => { sort = e.target.value; render(); }),
    subscribe((k) => ["products", "ingredients", "settings", "methods"].includes(k) && render()),
  ];
  render();
  return () => offs.forEach((f) => f());
}

