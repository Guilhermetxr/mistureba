import { state, costBook, ingredient, subscribe } from "../store.js";
import { listWhere } from "../services.js";
import { fb } from "../firebase.js";
import { money, reais, pct, esc, fmtQty, fmtDate, UNIT_LABEL } from "../format.js";
import { icon, empty, on, cmvBadge } from "../ui.js";
import { ingredientModal } from "./insumos.js";

export const title = "Insumo";

const MOV = { compra: ["Compra", "good"], perda: ["Perda", "bad"], inventario: ["Inventário", "info"], ajuste: ["Ajuste", ""] };

export default async function (el, params) {
  const id = params.id;
  if (!ingredient(id)) {
    el.innerHTML = `<div class="alert bad">${icon("alert")}Insumo não encontrado. <a href="#/estoque">Voltar</a></div>`;
    return;
  }
  const [history, moves] = await Promise.all([
    listWhere("costHistory", fb.where("ingredientId", "==", id), fb.orderBy("at", "desc"), fb.limit(30)).catch(() => []),
    listWhere("stockMovements", fb.where("ingredientId", "==", id), fb.orderBy("at", "desc"), fb.limit(60)).catch(() => []),
  ]);

  function render() {
    const ing = ingredient(id);
    const c = state.settings.cmv;
    const book = costBook();
    const using = book.productsUsing(id).map((p) => {
      const q = book.usage(p.id).get(id) ?? 0;
      const part = q * ing.unitCost * 100;
      const cost = book.unitCostCents(p.id);
      return { p, q, part, share: cost ? (part / cost) * 100 : 0, cmv: p.price ? (cost / p.price) * 100 : 0 };
    }).sort((a, b) => b.share - a.share);
    const oldest = history[history.length - 1];
    const first = oldest?.prevCost ?? oldest?.unitCost;
    const change = first ? ((ing.unitCost - first) / first) * 100 : 0;

    el.innerHTML = `
      <div class="page-head"><div><div class="crumb"><a href="#/estoque" style="text-decoration:none">← Estoque</a></div>
        <h1>${esc(ing.name)}</h1><p>${esc(ing.category)}${ing.supplier ? ` · ${esc(ing.supplier)}` : ""}${ing.active === false ? " · inativo" : ""}</p></div>
        <button class="btn" data-edit>${icon("edit")}Editar</button></div>
      <div class="grid g4" style="margin-bottom:var(--s-4)">
        <div class="card stat"><span class="stat-label">Custo atual</span><span class="stat-value">${reais(ing.unitCost)}<span class="muted small">/${UNIT_LABEL[ing.unit]}</span></span>
          <span class="stat-foot">${history.length > 1 ? `<span class="${change > 0 ? "bad" : "good"}">${change > 0 ? "▲" : "▼"} ${pct(Math.abs(change))}</span> no histórico` : "sem variação registrada"}</span></div>
        <div class="card stat"><span class="stat-label">Estoque</span><span class="stat-value ${ing.stock < 0 ? "bad" : ""}">${fmtQty(ing.stock ?? 0, ing.unit)}</span><span class="stat-foot">mínimo ${fmtQty(ing.minStock ?? 0, ing.unit)}</span></div>
        <div class="card stat"><span class="stat-label">Valor parado</span><span class="stat-value">${money(Math.round(Math.max(0, ing.stock ?? 0) * ing.unitCost * 100))}</span></div>
        <div class="card stat"><span class="stat-label">Fator de correção</span><span class="stat-value">${String(ing.fc ?? 1).replace(".", ",")}</span><span class="stat-foot">${ing.fc > 1 ? `perde ${pct((1 - 1 / ing.fc) * 100)} no pré-preparo` : "sem perda no preparo"}</span></div>
      </div>
      <div class="grid g2" style="margin-bottom:var(--s-4)">
        <div class="card"><div class="card-h"><h3>Onde é usado</h3><span class="sub">peso no custo de cada produto</span></div>
          <div class="card-b flush">${using.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Produto</th><th class="num">Qtd. bruta</th><th class="num">Custo</th><th class="num">% do custo</th><th class="num">CMV</th></tr></thead><tbody>
            ${using.map((u) => `<tr class="click" data-href="#/cmv/fichas/${u.p.id}"><td>${esc(u.p.name)}</td><td class="num">${fmtQty(u.q, ing.unit)}</td><td class="num">${money(Math.round(u.part))}</td><td class="num">${pct(u.share)}</td><td class="num">${cmvBadge(u.cmv, c)}</td></tr>`).join("")}
            </tbody></table></div>` : empty("Não entra em nenhuma ficha técnica ainda.")}</div></div>
        <div class="card"><div class="card-h"><h3>Histórico de custo</h3></div>
          <div class="card-b flush">${history.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Data</th><th>Origem</th><th class="num">Antes</th><th class="num">Depois</th></tr></thead><tbody>
            ${history.map((h) => `<tr><td>${fmtDate(h.day)}</td><td class="soft small">${esc(h.source)}${h.purchasePrice ? ` · pago ${reais(h.purchasePrice)}` : ""}</td><td class="num muted">${h.prevCost != null ? reais(h.prevCost) : "—"}</td><td class="num"><b>${reais(h.unitCost)}</b></td></tr>`).join("")}
            </tbody></table></div>` : empty("Sem histórico.")}</div></div>
      </div>
      <div class="card"><div class="card-h"><h3>Movimentações</h3><span class="sub">compras, perdas e inventários (as vendas baixam direto pela ficha)</span></div>
        <div class="card-b flush">${moves.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Data</th><th>Tipo</th><th>Detalhe</th><th class="num">Quantidade</th><th class="num">Valor</th><th>Por</th></tr></thead><tbody>
          ${moves.map((m) => `<tr><td>${fmtDate(m.day)}</td><td><span class="badge ${MOV[m.type]?.[1] ?? ""}">${MOV[m.type]?.[0] ?? m.type}</span></td><td class="small soft">${esc(m.reason ?? "")}</td>
            <td class="num ${m.qty < 0 ? "bad" : "good"}">${m.qty > 0 ? "+" : ""}${fmtQty(m.qty, ing.unit)}</td><td class="num">${money(Math.abs(m.value || 0))}</td><td class="small muted">${esc(m.by ?? "")}</td></tr>`).join("")}
          </tbody></table></div>` : empty("Nenhuma movimentação.")}</div></div>`;
  }

  const offs = [
    on(el, "click", "[data-edit]", () => ingredientModal(ingredient(id))),
    on(el, "click", "[data-href]", (_e, t) => (location.hash = t.dataset.href)),
    subscribe((k) => (k === "ingredients" || k === "products") && ingredient(id) && render()),
  ];
  render();
  return () => offs.forEach((f) => f());
}

