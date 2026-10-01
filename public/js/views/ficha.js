import { state, product, avgFeePercent, ifoodFeePercent } from "../store.js";
import { saveProduct, setActive } from "../services.js";
import { CostBook, contribution, priceForTargetCmv } from "../costing.js";
import { money, pct, reais, esc, parseMoney, parseDecimal, centsToInput, decToInput, toSmall, fromSmall, SMALL_UNIT, fmtQty } from "../format.js";
import { icon, on, $, toast, busy, meter, cmvBadge, opt, confirmDialog } from "../ui.js";
import { hbars } from "../charts.js";

export const title = "Ficha técnica";

export default async function (el, params, q) {
  const isNew = params.id === "novo";
  const src = isNew ? null : product(params.id);
  if (!isNew && !src) {
    el.innerHTML = `<div class="alert bad">${icon("alert")}Ficha não encontrada. <a href="#/cmv/fichas">Voltar</a></div>`;
    return;
  }
  const dupFrom = q.get("de") ? product(q.get("de")) : null;
  const base = src ?? dupFrom;
  const draft = {
    name: base ? (dupFrom ? `${base.name} (cópia)` : base.name) : "",
    category: base?.category ?? (q.get("tipo") === "preparo" ? "Preparos" : "Lanches"),
    kind: base?.kind ?? (q.get("tipo") === "preparo" ? "preparo" : "venda"),
    price: base?.price ?? 0,
    ifoodPrice: base?.ifoodPrice ?? null,
    yieldQty: base?.yieldQty ?? 1,
    yieldUnit: base?.yieldUnit ?? "un",
    code: base?.code ?? "",
    ifoodCode: base?.ifoodCode ?? "",
    notes: base?.notes ?? "",
    active: base?.active !== false,
    recipe: (base?.recipe ?? []).map((r) => ({ ...r })),
  };
  const selfId = src?.id ?? "__draft__";
  let dirty = false;

  // Um produto não pode conter a si mesmo, nem quem já o contém (evita ciclo)
  function containsSelf(pid, seen = new Set()) {
    if (pid === selfId) return true;
    if (seen.has(pid)) return false;
    seen.add(pid);
    return (product(pid)?.recipe ?? []).some((r) => r.type === "prod" && containsSelf(r.id, seen));
  }

  function book() {
    const others = state.products.filter((p) => p.id !== selfId);
    return new CostBook(state.ingredients, [...others, { id: selfId, ...draft }]);
  }

  const categories = [...new Set(state.products.map((p) => p.category))].sort();

  el.innerHTML = `
    <div class="page-head">
      <div><div class="crumb"><a href="#/cmv/fichas${draft.kind === "preparo" ? "?tipo=preparo" : ""}" style="text-decoration:none">← Fichas técnicas</a></div>
        <h1 data-title>${esc(draft.name || (draft.kind === "preparo" ? "Novo preparo" : "Novo produto"))}</h1>
        <p data-sub></p></div>
      <div class="row wrap">
        ${src ? `<a class="btn" href="#/cmv/fichas/novo?de=${src.id}">${icon("copy")}Duplicar</a>
          <button class="btn ${draft.active ? "danger" : ""}" data-toggle>${draft.active ? "Desativar" : "Reativar"}</button>` : ""}
        <button class="btn primary" data-save>${icon("check")}Salvar ficha</button>
      </div>
    </div>

    <div class="grid" style="grid-template-columns:minmax(0,1fr) 340px;align-items:start" data-cols>
      <div class="stack">
        <div class="card"><div class="card-h"><h3>Dados</h3></div><div class="card-b">
          <div class="form-grid">
            <label class="field" style="grid-column:span 2"><span>Nome</span><input class="input" name="name" value="${esc(draft.name)}" required></label>
            <label class="field"><span>Tipo</span><select class="select" name="kind">${opt("venda", "Produto de venda", draft.kind)}${opt("preparo", "Preparo (sub-receita)", draft.kind)}</select></label>
            <label class="field"><span>Categoria</span><input class="input" name="category" list="cat-list" value="${esc(draft.category)}"><datalist id="cat-list">${categories.map((c) => `<option value="${esc(c)}">`).join("")}</datalist></label>
            <label class="field" data-for="venda"><span>Preço balcão</span><div class="affix pre"><i>R$</i><input class="input num" name="price" inputmode="decimal" value="${centsToInput(draft.price)}"></div></label>
            <label class="field" data-for="venda"><span>Preço iFood</span><div class="affix pre"><i>R$</i><input class="input num" name="ifoodPrice" inputmode="decimal" value="${centsToInput(draft.ifoodPrice)}" placeholder="opcional"></div></label>
            <label class="field" data-for="preparo"><span>Rendimento da receita</span><input class="input num" name="yieldQty" inputmode="decimal" value="${decToInput(draft.yieldQty)}"></label>
            <label class="field" data-for="preparo"><span>Unidade do rendimento</span><select class="select" name="yieldUnit">${opt("kg", "kg", draft.yieldUnit)}${opt("l", "litro", draft.yieldUnit)}${opt("un", "unidade/porção", draft.yieldUnit)}</select></label>
            <label class="field" data-for="venda"><span>Código interno</span><input class="input" name="code" value="${esc(draft.code)}" placeholder="opcional"></label>
            <label class="field" data-for="venda"><span>Código no iFood</span><input class="input" name="ifoodCode" value="${esc(draft.ifoodCode)}" placeholder="código PDV do item"><small>Liga o pedido do iFood a esta ficha.</small></label>
          </div></div></div>

        <div class="card"><div class="card-h"><h3>Ficha técnica</h3><span class="sub">quantidade líquida por ${draft.kind === "preparo" ? "receita" : "unidade vendida"}</span></div>
          <div class="card-b flush"><div class="table-wrap"><table class="t"><thead><tr>
            <th>Item</th><th class="num">Qtd. líquida</th><th class="num">FC</th><th class="num">Qtd. bruta</th><th class="num">Custo unit.</th><th class="num">Custo</th><th class="num">%</th><th></th>
          </tr></thead><tbody data-lines></tbody><tfoot data-total></tfoot></table></div>
          <div class="row wrap" style="padding:var(--s-3) var(--s-5) var(--s-5)">
            <select class="select" data-add style="max-width:360px"></select>
            <span class="xs muted">FC = fator de correção (perda no pré-preparo: casca, talo, gordura). Ajuste no cadastro do insumo.</span>
          </div></div></div>

        <div class="card"><div class="card-h"><h3>Modo de preparo / observações</h3></div><div class="card-b">
          <textarea class="input" name="notes" rows="4" placeholder="Ex.: prensar o blend a 150g, 2 min cada lado, queijo por cima no último minuto…">${esc(draft.notes)}</textarea>
        </div></div>
      </div>

      <aside class="stack" style="position:sticky;top:var(--s-4)" data-summary></aside>
    </div>`;

  const mq = matchMedia("(max-width: 1100px)");
  const layout = () => ($("[data-cols]", el).style.gridTemplateColumns = mq.matches ? "minmax(0,1fr)" : "minmax(0,1fr) 340px");
  layout();
  mq.addEventListener("change", layout);

  function renderAddOptions() {
    const used = new Set(draft.recipe.map((r) => `${r.type}:${r.id}`));
    const ings = state.ingredients.filter((i) => i.active !== false && !used.has(`ing:${i.id}`));
    const preps = state.products.filter((p) => p.kind === "preparo" && p.id !== selfId && !used.has(`prod:${p.id}`) && !containsSelf(p.id));
    const prods = state.products.filter((p) => p.kind === "venda" && p.id !== selfId && !used.has(`prod:${p.id}`) && !containsSelf(p.id));
    const group = (label, list, type) => (list.length ? `<optgroup label="${label}">${list.map((x) => `<option value="${type}:${x.id}">${esc(x.name)}</option>`).join("")}</optgroup>` : "");
    $("[data-add]", el).innerHTML = `<option value="">+ Adicionar item à ficha…</option>` + group("Insumos", ings, "ing") + group("Preparos", preps, "prod") + group("Produtos (para combos)", prods, "prod");
  }

  function renderLines() {
    const b = book();
    const lines = b.lines(selfId);
    const total = lines.reduce((s, l) => s + l.cost, 0);
    $("[data-lines]", el).innerHTML = lines.length
      ? lines.map((l) => {
          const small = SMALL_UNIT[l.unit];
          const shown = toSmall(l.unit, l.item.qty);
          return `<tr${l.missing ? ` class="dim"` : ""}>
            <td>${l.isSub ? `<a href="#/cmv/fichas/${l.item.id}">${esc(l.name)}</a> <span class="badge info">preparo</span>` : `<a href="#/estoque/insumo/${l.item.id}" style="text-decoration:none">${esc(l.name)}</a>`}</td>
            <td class="num"><div class="affix" style="width:120px;margin-left:auto"><input class="input sm num" data-qty="${l.index}" inputmode="decimal" value="${decToInput(shown, 2)}" aria-label="Quantidade de ${esc(l.name)} em ${small}"><i>${small}</i></div></td>
            <td class="num">${l.fc !== 1 ? l.fc.toFixed(2).replace(".", ",") : `<span class="muted">1</span>`}</td>
            <td class="num">${fmtQty(l.grossQty, l.unit)}</td>
            <td class="num">${reais(l.unitCost)}<span class="muted xs">/${l.unit}</span></td>
            <td class="num"><b>${reais(l.cost)}</b></td>
            <td class="num muted">${total ? pct((l.cost / total) * 100) : "—"}</td>
            <td class="act"><button class="btn ghost sm icon" data-del="${l.index}" aria-label="Remover ${esc(l.name)}">${icon("x")}</button></td></tr>`;
        }).join("")
      : `<tr><td colspan="8">${`<div class="empty">${icon("clipboard")}<div>Adicione os insumos que vão neste ${draft.kind === "preparo" ? "preparo" : "produto"}, com a quantidade de uma unidade.</div></div>`}</td></tr>`;
    $("[data-total]", el).innerHTML = lines.length
      ? `<tr><td colspan="5">Custo total ${draft.kind === "preparo" ? `da receita (rende ${fmtQty(draft.yieldQty, draft.yieldUnit)})` : ""}</td><td class="num">${reais(total)}</td><td></td><td></td></tr>`
      : "";
    renderSummary(b, total);
  }

  function renderSummary(b, totalRecipe) {
    const c = state.settings.cmv;
    const cost = Math.round(b.unitCost(selfId) * 100);
    const box = $("[data-summary]", el);
    $("[data-title]", el).textContent = draft.name || (draft.kind === "preparo" ? "Novo preparo" : "Novo produto");
    if (draft.kind === "preparo") {
      const usedBy = state.products.filter((p) => p.recipe?.some((r) => r.type === "prod" && r.id === selfId));
      $("[data-sub]", el).textContent = `Custo por ${draft.yieldUnit}: ${reais(b.unitCost(selfId))}`;
      box.innerHTML = `
        <div class="card tone-brand"><div class="stat"><span class="stat-label">Custo por ${draft.yieldUnit === "un" ? "unidade" : draft.yieldUnit}</span>
          <span class="stat-value hero">${reais(b.unitCost(selfId))}</span>
          <span class="stat-foot" style="color:var(--side-ink)">Receita inteira: ${reais(totalRecipe)} · rende ${fmtQty(draft.yieldQty, draft.yieldUnit)}</span></div></div>
        <div class="card"><div class="card-h"><h3>Usado em</h3></div><div class="card-b">${usedBy.length ? `<div class="stack tight">${usedBy.map((p) => `<a href="#/cmv/fichas/${p.id}">${esc(p.name)}</a>`).join("")}</div>` : `<p class="small muted">Ainda não entra em nenhuma ficha.</p>`}</div></div>`;
      return;
    }
    const fee = avgFeePercent();
    const bal = contribution(draft.price, cost, fee, c.tax_percent);
    const ifo = draft.ifoodPrice ? contribution(draft.ifoodPrice, cost, ifoodFeePercent(), c.tax_percent) : null;
    const suggested = priceForTargetCmv(cost, c.target_percent);
    // Preço iFood que deixa a mesma sobra por unidade que o balcão
    const sameMarginIfood = cost ? Math.ceil((bal.mc + cost) / (1 - (ifoodFeePercent() + c.tax_percent) / 100) / 10) * 10 : 0;
    $("[data-sub]", el).innerHTML = `Custo ${money(cost)} · CMV ${draft.price ? pct(bal.cmvPct) : "—"}`;
    const breakdown = b.breakdown(selfId).slice(0, 6);
    box.innerHTML = `
      <div class="card"><div class="stat">
        <span class="stat-label">CMV no balcão</span>
        <div class="row between"><span class="stat-value hero">${draft.price ? pct(bal.cmvPct) : "—"}</span>${draft.price ? cmvBadge(bal.cmvPct, c) : ""}</div>
        ${draft.price ? meter(bal.cmvPct, c.target_percent, c.alert_percent) : `<span class="stat-foot">Informe o preço de venda.</span>`}
      </div>
      <div class="card-b" style="padding-top:0">
        <table class="t dre" style="font-size:var(--t-sm)"><tbody>
          <tr><td style="padding-left:0">Preço</td><td class="num">${money(draft.price)}</td></tr>
          <tr><td style="padding-left:0">− Custo (ficha)</td><td class="num">${money(cost)}</td></tr>
          <tr><td style="padding-left:0">− Taxa média cartão (${pct(fee)})</td><td class="num">${money(bal.fees)}</td></tr>
          <tr><td style="padding-left:0">− Impostos (${pct(c.tax_percent)})</td><td class="num">${money(bal.tax)}</td></tr>
          <tr class="total"><td style="padding-left:0">Sobra por unidade</td><td class="num ${bal.mc < 0 ? "bad" : "good"}">${money(bal.mc)}</td></tr>
        </tbody></table>
        ${cost ? `<div class="alert" style="margin-top:var(--s-3)">${icon("info")}<div>Pra CMV de <b>${c.target_percent}%</b>, o preço seria <b>${money(suggested)}</b>.
          ${suggested !== draft.price ? `<button class="btn sm" data-use-price="${suggested}" style="margin-top:6px">Usar ${money(suggested)}</button>` : ""}</div></div>` : ""}
      </div></div>

      <div class="card"><div class="card-h"><h3>No iFood</h3><span class="sub">comissão + taxa ${pct(ifoodFeePercent())}</span></div><div class="card-b">
        ${ifo ? `<div class="row between"><span>CMV</span>${cmvBadge(ifo.cmvPct, c)}</div>
          <div class="row between small" style="margin-top:6px"><span class="soft">Sobra por unidade</span><b class="${ifo.mc < 0 ? "bad" : ""}">${money(ifo.mc)}</b></div>
          <p class="xs muted" style="margin-top:6px">Preço iFood que deixa a mesma sobra do balcão: <b>${money(sameMarginIfood)}</b></p>`
          : `<p class="small muted">Sem preço iFood. Pra sobrar o mesmo que no balcão depois da comissão: <b>${money(sameMarginIfood)}</b>.</p>`}
      </div></div>

      ${breakdown.length ? `<div class="card"><div class="card-h"><h3>De onde vem o custo</h3></div><div class="card-b">
        ${hbars(breakdown.map((x) => ({ label: x.name, value: x.cost })), { fmt: (v) => reais(v) })}</div></div>` : ""}`;
  }

  function markDirty() { dirty = true; }

  const offs = [
    on(el, "input", "input[name], textarea[name]", (e) => {
      const t = e.target;
      markDirty();
      if (t.name === "price" || t.name === "ifoodPrice") draft[t.name] = t.value.trim() ? parseMoney(t.value) : t.name === "price" ? 0 : null;
      else if (t.name === "yieldQty") draft.yieldQty = parseDecimal(t.value) || 1;
      else draft[t.name] = t.value;
      if (["price", "ifoodPrice", "yieldQty", "name"].includes(t.name)) renderLines();
    }),
    on(el, "change", "select[name]", (e) => {
      markDirty();
      draft[e.target.name] = e.target.value;
      if (e.target.name === "kind") toggleKind();
      renderLines();
    }),
    on(el, "change", "[data-qty]", (e) => {
      const i = Number(e.target.dataset.qty);
      const r = draft.recipe[i];
      const unit = r.type === "ing" ? state.ingredients.find((x) => x.id === r.id)?.unit : product(r.id)?.yieldUnit;
      r.qty = fromSmall(unit ?? "un", parseDecimal(e.target.value));
      markDirty();
      renderLines();
    }),
    on(el, "change", "[data-add]", (e) => {
      const [type, id] = e.target.value.split(":");
      if (!id) return;
      const unit = type === "ing" ? state.ingredients.find((x) => x.id === id)?.unit : product(id)?.yieldUnit;
      draft.recipe.push({ type, id, qty: unit === "un" ? 1 : 0.05 });
      markDirty();
      renderAddOptions();
      renderLines();
      const inputs = el.querySelectorAll("[data-qty]");
      inputs[inputs.length - 1]?.select();
    }),
    on(el, "click", "[data-del]", (_e, b) => {
      draft.recipe.splice(Number(b.dataset.del), 1);
      markDirty();
      renderAddOptions();
      renderLines();
    }),
    on(el, "click", "[data-use-price]", (_e, b) => {
      draft.price = Number(b.dataset.usePrice);
      $("input[name=price]", el).value = centsToInput(draft.price);
      markDirty();
      renderLines();
    }),
    on(el, "click", "[data-save]", (_e, b) =>
      busy(b, async () => {
        try {
          const id = await saveProduct(src?.id ?? null, draft);
          dirty = false;
          toast("Ficha salva.", "good");
          if (!src) location.hash = `#/cmv/fichas/${id}`;
        } catch (ex) {
          toast(ex.message, "bad");
        }
      }),
    ),
    on(el, "click", "[data-toggle]", async () => {
      if (draft.active && !(await confirmDialog("Desativar produto?", "Ele some do PDV, mas o histórico de vendas continua."))) return;
      await setActive("products", src.id, !draft.active);
      toast(draft.active ? "Produto desativado." : "Produto reativado.");
      location.hash = "#/cmv/fichas";
    }),
  ];

  function toggleKind() {
    for (const f of el.querySelectorAll("[data-for]")) f.hidden = f.dataset.for !== draft.kind;
  }

  const beforeUnload = (e) => { if (dirty) { e.preventDefault(); } };
  addEventListener("beforeunload", beforeUnload);

  toggleKind();
  renderAddOptions();
  renderLines();

  return () => {
    offs.forEach((f) => f());
    removeEventListener("beforeunload", beforeUnload);
    mq.removeEventListener("change", layout);
    if (dirty) toast("Alterações da ficha não salvas foram descartadas.");
  };
}
