import { state, subscribe, costBook } from "../store.js";
import { saveIngredient } from "../services.js";
import { money, reais, esc, fmtQty, parseDecimal, decToInput, UNIT_LABEL } from "../format.js";
import { icon, pageHead, empty, on, $, modal, formData, opt, toast, tabs } from "../ui.js";

export const title = "Insumos";

export const ESTOQUE_TABS = [
  ["#/estoque", "Insumos"],
  ["#/estoque/compras", "Compras"],
  ["#/estoque/inventario", "Inventário"],
  ["#/estoque/perdas", "Perdas"],
];

export function ingredientModal(ing = null) {
  const cats = [...new Set(state.ingredients.map((i) => i.category))].sort();
  modal({
    title: ing ? `Editar ${ing.name}` : "Novo insumo",
    body: `<div class="form-grid">
      <label class="field" style="grid-column:1/-1"><span>Nome</span><input class="input" name="name" value="${esc(ing?.name ?? "")}" required autofocus></label>
      <label class="field"><span>Categoria</span><input class="input" name="category" list="ing-cats" value="${esc(ing?.category ?? "")}"><datalist id="ing-cats">${cats.map((c) => `<option value="${esc(c)}">`).join("")}</datalist></label>
      <label class="field"><span>Unidade de controle</span><select class="select" name="unit">${opt("kg", "Quilo (kg)", ing?.unit ?? "kg")}${opt("l", "Litro (L)", ing?.unit)}${opt("un", "Unidade (un)", ing?.unit)}</select></label>
      <label class="field"><span>Custo por unidade</span><div class="affix pre"><i>R$</i><input class="input num" name="unitCost" inputmode="decimal" value="${decToInput(ing?.unitCost ?? 0, 4)}"></div></label>
      <label class="field"><span>Fator de correção</span><input class="input num" name="fc" inputmode="decimal" value="${decToInput(ing?.fc ?? 1, 3)}"><small>Peso bruto ÷ peso limpo. Ex.: alface 1,40.</small></label>
      ${ing ? "" : `<label class="field"><span>Estoque atual</span><input class="input num" name="stock" inputmode="decimal" value="0"></label>`}
      <label class="field"><span>Estoque mínimo</span><input class="input num" name="minStock" inputmode="decimal" value="${decToInput(ing?.minStock ?? 0)}"></label>
      <label class="field" style="grid-column:1/-1"><span>Fornecedor</span><input class="input" name="supplier" value="${esc(ing?.supplier ?? "")}"></label>
    </div>
    <details style="margin-top:var(--s-4)"><summary class="small strong" style="cursor:pointer">Calcular custo pela embalagem</summary>
      <div class="row wrap" style="margin-top:var(--s-3)"><span class="small">Paguei</span>
        <div class="affix pre" style="width:130px"><i>R$</i><input class="input sm num" data-pack-price inputmode="decimal"></div>
        <span class="small">por</span><input class="input sm num" data-pack-qty inputmode="decimal" style="width:90px"><span class="small" data-pack-unit>${UNIT_LABEL[ing?.unit ?? "kg"]}</span>
        <button type="button" class="btn sm" data-pack-apply>Aplicar</button></div>
      <p class="xs muted" style="margin-top:6px">Ex.: caixa de 2,5 kg de batata por R$ 44,75 → R$ 17,90/kg.</p>
    </details>
    ${ing ? `<label class="check" style="margin-top:var(--s-4)"><input type="checkbox" name="active" ${ing.active !== false ? "checked" : ""}> Ativo</label>` : ""}`,
    onOpen: (d) => {
      on(d, "change", "[name=unit]", (e) => ($("[data-pack-unit]", d).textContent = UNIT_LABEL[e.target.value]));
      on(d, "click", "[data-pack-apply]", () => {
        const price = parseDecimal($("[data-pack-price]", d).value);
        const qty = parseDecimal($("[data-pack-qty]", d).value);
        if (price > 0 && qty > 0) $("[name=unitCost]", d).value = decToInput(price / qty, 4);
      });
    },
    onSubmit: async (form) => {
      const v = formData(form);
      await saveIngredient(ing?.id ?? null, {
        ...v,
        unitCost: parseDecimal(v.unitCost),
        fc: parseDecimal(v.fc) || 1,
        stock: parseDecimal(v.stock),
        minStock: parseDecimal(v.minStock),
        active: ing ? v.active : true,
      });
      toast(ing ? "Insumo atualizado. Fichas recalculadas." : "Insumo cadastrado.", "good");
    },
  });
}

export default async function (el) {
  let search = "";
  let cat = "";
  let onlyLow = false;
  let showInactive = false;

  el.innerHTML = `
    ${pageHead("Estoque", "Matéria-prima e embalagens. O custo daqui alimenta todas as fichas técnicas.", `<button class="btn primary" data-new>${icon("plus")}Novo insumo</button>`)}
    ${tabs(ESTOQUE_TABS, "#/estoque")}
    <div class="grid g3" data-kpis style="margin-bottom:var(--s-4)"></div>
    <div class="row wrap" style="margin-bottom:var(--s-3)">
      <label class="search">${icon("search")}<input class="input sm" data-search placeholder="Buscar insumo…" aria-label="Buscar insumo" style="width:220px"></label>
      <select class="select sm" data-cat style="width:auto" aria-label="Categoria"></select>
      <label class="check"><input type="checkbox" data-low> Só abaixo do mínimo</label>
      <label class="check"><input type="checkbox" data-inactive> Mostrar inativos</label>
    </div>
    <div class="card"><div class="card-b flush" data-list></div></div>`;

  function render() {
    const book = costBook();
    const all = state.ingredients.filter((i) => showInactive || i.active !== false);
    const cats = [...new Set(all.map((i) => i.category))].sort();
    $("[data-cat]", el).innerHTML = `<option value="">Todas as categorias</option>` + cats.map((c) => `<option ${c === cat ? "selected" : ""}>${esc(c)}</option>`).join("");
    const low = (i) => i.minStock > 0 && (i.stock ?? 0) <= i.minStock;
    const needle = search.toLowerCase();
    const rows = all.filter((i) => (!cat || i.category === cat) && (!needle || i.name.toLowerCase().includes(needle)) && (!onlyLow || low(i)));
    const value = state.ingredients.reduce((s, i) => s + Math.max(0, i.stock ?? 0) * (i.unitCost ?? 0), 0);
    const lowCount = state.ingredients.filter((i) => i.active !== false && low(i)).length;
    const negative = state.ingredients.filter((i) => i.active !== false && (i.stock ?? 0) < 0).length;
    $("[data-kpis]", el).innerHTML = `
      <div class="card stat"><span class="stat-label">Valor em estoque</span><span class="stat-value">${money(Math.round(value * 100))}</span><span class="stat-foot">a preço de custo</span></div>
      <div class="card stat"><span class="stat-label">Abaixo do mínimo</span><span class="stat-value ${lowCount ? "warn" : ""}">${lowCount}</span><span class="stat-foot">${lowCount ? "hora de fazer pedido" : "tudo abastecido"}</span></div>
      <div class="card stat"><span class="stat-label">Estoque negativo</span><span class="stat-value ${negative ? "bad" : ""}">${negative}</span><span class="stat-foot">${negative ? "vendeu mais do que entrou: falta lançar compra ou ajustar ficha" : "sem inconsistências"}</span></div>`;
    $("[data-list]", el).innerHTML = rows.length
      ? `<div class="table-wrap"><table class="t"><thead><tr><th>Insumo</th><th>Categoria</th><th class="num">Custo</th><th class="num">FC</th><th class="num">Estoque</th><th class="num">Mínimo</th><th class="num">Valor</th><th class="num">Fichas</th><th></th></tr></thead><tbody>
        ${rows.map((i) => {
          const st = i.stock ?? 0;
          const status = st < 0 ? `<span class="badge bad">negativo</span>` : low(i) ? `<span class="badge warn">${icon("alert")}repor</span>` : "";
          return `<tr class="click ${i.active === false ? "dim" : ""}" data-href="#/estoque/insumo/${i.id}">
            <td><b>${esc(i.name)}</b> ${status}</td><td class="soft">${esc(i.category)}</td>
            <td class="num">${reais(i.unitCost)}<span class="muted xs">/${UNIT_LABEL[i.unit]}</span></td>
            <td class="num">${i.fc !== 1 ? String(i.fc).replace(".", ",") : `<span class="muted">1</span>`}</td>
            <td class="num ${st < 0 ? "bad" : ""}">${fmtQty(st, i.unit)}</td><td class="num muted">${i.minStock ? fmtQty(i.minStock, i.unit) : "—"}</td>
            <td class="num">${money(Math.round(Math.max(0, st) * i.unitCost * 100))}</td>
            <td class="num">${book.productsUsing(i.id).length}</td>
            <td class="act"><button class="btn ghost sm icon" data-edit="${i.id}" aria-label="Editar ${esc(i.name)}">${icon("edit")}</button></td></tr>`;
        }).join("")}</tbody></table></div>`
      : empty(state.ingredients.length ? "Nada encontrado com esse filtro." : "Cadastre seus insumos pra montar as fichas técnicas.", "box");
  }

  const offs = [
    on(el, "click", "[data-new]", () => ingredientModal()),
    on(el, "click", "[data-edit]", (e, b) => { e.stopPropagation(); ingredientModal(state.ingredients.find((i) => i.id === b.dataset.edit)); }),
    on(el, "click", "[data-href]", (e, t) => { if (!e.target.closest("[data-edit]")) location.hash = t.dataset.href; }),
    on(el, "input", "[data-search]", (e) => { search = e.target.value; render(); }),
    on(el, "change", "[data-cat]", (e) => { cat = e.target.value; render(); }),
    on(el, "change", "[data-low]", (e) => { onlyLow = e.target.checked; render(); }),
    on(el, "change", "[data-inactive]", (e) => { showInactive = e.target.checked; render(); }),
    subscribe((k) => (k === "ingredients" || k === "products") && render()),
  ];
  render();
  return () => offs.forEach((f) => f());
}
