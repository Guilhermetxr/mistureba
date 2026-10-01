import { state, costBook, sellable } from "../store.js";
import { statsForMonth, listWhere } from "../services.js";
import { fb } from "../firebase.js";
import { money, pct, ratio, isoMonth, shiftMonth, fmtMonth, monthRange, fmtDayShort, fmtDate, reais, addDays, isoDate, esc } from "../format.js";
import { icon, pageHead, empty, cmvBadge, meter, on } from "../ui.js";
import { barChart, wireCharts } from "../charts.js";
import { priceForTargetCmv } from "../costing.js";

export const title = "Painel do CMV";

export default async function (el, _params, q) {
  let month = q.get("m") || isoMonth();
  const cfg = () => state.settings.cmv;

  async function load() {
    el.innerHTML = `<div class="boot" style="min-height:40vh">Calculando CMV…</div>`;
    const { start, end } = monthRange(month);
    const since = addDays(isoDate(), -45);
    const [stats, inventories, history] = await Promise.all([
      statsForMonth(month),
      listWhere("inventories"),
      listWhere("costHistory", fb.where("day", ">=", since)),
    ]);
    render(stats, inventories, history, start, end);
  }

  function render(stats, inventories, history, start, end) {
    const c = cfg();
    const book = costBook();
    const sum = (k) => stats.reduce((s, d) => s + (d[k] || 0), 0);
    const revenue = sum("revenue");
    const theo = sum("cost");
    const loss = sum("loss");
    const invDiff = sum("invDiff");
    const purchases = sum("purchases");
    const real = theo + loss + invDiff;
    const realPct = ratio(real, revenue);
    const theoPct = ratio(theo, revenue);

    // Método contábil: EI + Compras − EF (se houver inventários que cercam o período)
    const invs = [...inventories].sort((a, b) => a.date.localeCompare(b.date));
    const ei = [...invs].reverse().find((i) => i.date < start);
    const ef = [...invs].reverse().find((i) => i.date <= end && i.date >= start);
    let classic = null;
    if (ei && ef) {
      const purchBetween = stats.filter((d) => d.day > ei.date && d.day <= ef.date).reduce((s, d) => s + (d.purchases || 0), 0);
      const revBetween = stats.filter((d) => d.day > ei.date && d.day <= ef.date).reduce((s, d) => s + (d.revenue || 0), 0);
      const cmv = ei.value + purchBetween - ef.value;
      classic = { ei, ef, purch: purchBetween, cmv, pct: ratio(cmv, revBetween), rev: revBetween };
    }

    // Por categoria (vendas do mês)
    const byCat = new Map();
    for (const d of stats) for (const [, p] of Object.entries(d.byProduct ?? {})) {
      const k = p.category || "Sem categoria";
      const cur = byCat.get(k) ?? { revenue: 0, cost: 0, qty: 0 };
      cur.revenue += p.revenue || 0;
      cur.cost += p.cost || 0;
      cur.qty += p.qty || 0;
      byCat.set(k, cur);
    }
    const cats = [...byCat.entries()].filter(([, v]) => v.qty > 0).sort((a, b) => b[1].revenue - a[1].revenue);

    // Produtos (ficha atual) acima do alvo
    const prods = sellable().map((p) => {
      const cost = book.unitCostCents(p.id);
      return { p, cost, pct: ratio(cost, p.price), noRecipe: !(p.recipe?.length) };
    });
    const above = prods.filter((x) => !x.noRecipe && x.pct > c.target_percent).sort((a, b) => b.pct - a.pct);
    const noRecipe = prods.filter((x) => x.noRecipe);

    // Insumos que subiram
    const rises = new Map();
    for (const h of [...history].sort((a, b) => a.at.localeCompare(b.at))) {
      if (h.prevCost == null) continue;
      const cur = rises.get(h.ingredientId) ?? { first: h.prevCost, last: h.unitCost, name: h.name, unit: h.unit };
      cur.last = h.unitCost;
      rises.set(h.ingredientId, cur);
    }
    const riseList = [...rises.entries()]
      .map(([id, r]) => ({ id, ...r, change: r.first ? ((r.last - r.first) / r.first) * 100 : 0 }))
      .filter((r) => Math.abs(r.change) >= 3)
      .sort((a, b) => b.change - a.change);

    const daily = [];
    const { days } = monthRange(month);
    for (let i = 1; i <= days; i++) {
      const day = `${month}-${String(i).padStart(2, "0")}`;
      const d = stats.find((s) => s.day === day);
      const r = (d?.cost || 0) + (d?.loss || 0) + (d?.invDiff || 0);
      const v = d?.revenue ? ratio(r, d.revenue) : 0;
      daily.push({ label: String(i), value: v, tip: `<b>${fmtDayShort(day)} · CMV ${pct(v)}</b>Vendas ${money(d?.revenue || 0)} · Custo ${money(r)}` });
    }

    const tone = realPct > c.alert_percent ? "bad" : realPct > c.target_percent ? "warn" : "good";
    const verdict = !revenue
      ? "Sem vendas no período."
      : tone === "good"
        ? `Dentro da meta de ${c.target_percent}%.`
        : tone === "warn"
          ? `Acima da meta de ${c.target_percent}% — atenção.`
          : `Bem acima da meta (alerta em ${c.alert_percent}%).`;

    el.innerHTML = `
      ${pageHead("Painel do CMV", "Custo da Mercadoria Vendida: quanto do que entra no caixa vai embora em ingrediente e embalagem.",
        `<div class="row"><button class="btn icon" data-m="-1" aria-label="Mês anterior">${icon("left")}</button>
         <strong class="nowrap" style="min-width:150px;text-align:center">${fmtMonth(month)}</strong>
         <button class="btn icon" data-m="1" aria-label="Próximo mês">${icon("right")}</button></div>`, "CMV")}

      <div class="grid" style="grid-template-columns:minmax(0,1.3fr) minmax(0,2fr);margin-bottom:var(--s-4)">
        <div class="card tone-brand"><div class="stat" style="padding:var(--s-5)">
          <span class="stat-label">CMV real do mês</span>
          <span class="stat-value hero">${pct(realPct)}</span>
          <span class="stat-foot" style="color:var(--side-ink)">${money(real)} de ${money(revenue)} vendidos · ${verdict}</span>
          <div style="margin-top:var(--s-3)">${meter(realPct, c.target_percent, c.alert_percent)}</div>
        </div></div>
        <div class="card"><div class="card-h"><h3>De onde vem o CMV real</h3><span class="sub">teórico + perdas + divergência de inventário</span></div>
          <div class="card-b">
            <table class="t"><tbody>
              <tr><td>CMV teórico <span class="muted xs">(o que as fichas técnicas dizem que saiu)</span></td><td class="num">${money(theo)}</td><td class="num">${pct(theoPct)}</td></tr>
              <tr><td>Perdas registradas <span class="muted xs">(queimou, venceu, caiu)</span></td><td class="num">${money(loss)}</td><td class="num">${pct(ratio(loss, revenue))}</td></tr>
              <tr><td>Divergência de inventário <span class="muted xs">(sumiu sem registro / porção maior)</span></td><td class="num ${invDiff > 0 ? "bad" : ""}">${money(invDiff)}</td><td class="num">${pct(ratio(invDiff, revenue))}</td></tr>
              <tr class="total"><td><b>CMV real</b></td><td class="num"><b>${money(real)}</b></td><td class="num"><b>${pct(realPct)}</b></td></tr>
            </tbody></table>
            ${revenue && realPct - theoPct > 2 ? `<div class="alert warn" style="margin-top:var(--s-3)">${icon("alert")}<div>O real está <b>${pct(realPct - theoPct)}</b> acima do teórico. Isso é dinheiro saindo por porção fora da ficha, desperdício ou furto — confira as perdas e faça inventário semanal dos itens caros.</div></div>` : ""}
          </div></div>
      </div>

      <div class="grid g4" style="margin-bottom:var(--s-4)">
        <div class="card stat"><span class="stat-label">Faturamento</span><span class="stat-value">${money(revenue)}</span><span class="stat-foot">${stats.reduce((s, d) => s + (d.orders || 0), 0)} pedidos</span></div>
        <div class="card stat"><span class="stat-label">CMV teórico</span><span class="stat-value">${pct(theoPct)}</span><span class="stat-foot">${money(theo)}</span></div>
        <div class="card stat"><span class="stat-label">Compras de insumo</span><span class="stat-value">${money(purchases)}</span><span class="stat-foot">${pct(ratio(purchases, revenue))} do faturamento</span></div>
        <div class="card stat"><span class="stat-label">Meta de CMV</span><span class="stat-value">${c.target_percent}%</span><span class="stat-foot">alerta acima de ${c.alert_percent}% · <a href="#/config/cmv">ajustar</a></span></div>
      </div>

      <div class="card" style="margin-bottom:var(--s-4)"><div class="card-h"><h3>CMV real por dia</h3><span class="sub">linha tracejada = meta</span></div>
        <div class="card-b">${revenue ? barChart(daily, { ref: { value: c.target_percent, label: `meta ${c.target_percent}%` }, fmtAxis: (v) => `${Math.round(v)}%`, label: "CMV percentual por dia" }) : empty("Sem vendas neste mês.")}</div></div>

      <div class="grid g2" style="margin-bottom:var(--s-4)">
        <div class="card"><div class="card-h"><h3>Produtos acima da meta</h3><span class="sub">pela ficha técnica atual</span></div>
          <div class="card-b flush">${above.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Produto</th><th class="num">Custo</th><th class="num">Preço</th><th class="num">CMV</th><th class="num">Preço p/ meta</th></tr></thead><tbody>
            ${above.map((x) => `<tr class="click" data-href="#/cmv/fichas/${x.p.id}"><td>${esc(x.p.name)}</td><td class="num">${money(x.cost)}</td><td class="num">${money(x.p.price)}</td><td class="num">${cmvBadge(x.pct, c)}</td><td class="num">${money(priceForTargetCmv(x.cost, c.target_percent))}</td></tr>`).join("")}
            </tbody></table></div>` : empty("Todos os produtos estão dentro da meta. 👌", "check")}</div></div>

        <div class="card"><div class="card-h"><h3>Insumos que mudaram de preço</h3><span class="sub">últimos 45 dias</span></div>
          <div class="card-b flush">${riseList.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Insumo</th><th class="num">Antes</th><th class="num">Agora</th><th class="num">Variação</th><th>Afeta</th></tr></thead><tbody>
            ${riseList.map((r) => {
              const affected = book.productsUsing(r.id);
              return `<tr class="click" data-href="#/estoque/insumo/${r.id}"><td>${esc(r.name)}</td><td class="num">${reais(r.first)}</td><td class="num">${reais(r.last)}</td>
              <td class="num"><span class="badge ${r.change > 0 ? "bad" : "good"}">${icon(r.change > 0 ? "up" : "down")}${pct(Math.abs(r.change))}</span></td>
              <td class="small soft">${affected.length} produto${affected.length === 1 ? "" : "s"}</td></tr>`;
            }).join("")}</tbody></table></div>` : empty("Nenhuma variação relevante (≥ 3%) nos custos.")}</div></div>
      </div>

      <div class="grid g2">
        <div class="card"><div class="card-h"><h3>CMV por categoria</h3><span class="sub">${fmtMonth(month)}</span></div>
          <div class="card-b flush">${cats.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Categoria</th><th class="num">Vendido</th><th class="num">Custo</th><th class="num">CMV</th></tr></thead><tbody>
            ${cats.map(([k, v]) => `<tr><td>${esc(k)}</td><td class="num">${money(v.revenue)}</td><td class="num">${money(v.cost)}</td><td class="num">${cmvBadge(ratio(v.cost, v.revenue), c)}</td></tr>`).join("")}
          </tbody></table></div>` : empty("Sem vendas neste mês.")}</div></div>

        <div class="card"><div class="card-h"><h3>Conferência pelo inventário</h3><span class="sub">Estoque inicial + Compras − Estoque final</span></div>
          <div class="card-b">${classic ? `
            <table class="t dre"><tbody>
              <tr><td>Estoque inicial <span class="muted xs">(${fmtDate(classic.ei.date)})</span></td><td class="num">${money(classic.ei.value)}</td></tr>
              <tr><td>+ Compras no intervalo</td><td class="num">${money(classic.purch)}</td></tr>
              <tr><td>− Estoque final <span class="muted xs">(${fmtDate(classic.ef.date)})</span></td><td class="num">${money(classic.ef.value)}</td></tr>
              <tr class="total"><td>CMV contábil</td><td class="num">${money(classic.cmv)} · ${pct(classic.pct)}</td></tr>
            </tbody></table>
            <p class="small soft" style="margin-top:var(--s-3)">Vendas no intervalo: ${money(classic.rev)}. Esse é o número que o contador usa — se ficar muito diferente do CMV real acima, tem compra sem lançamento ou inventário incompleto.</p>`
            : `<div class="stack tight"><p class="small soft">Para essa conferência, faça um inventário completo no último dia do mês anterior e outro no fim deste mês.</p>
               <p><a class="btn sm" href="#/estoque/inventario">${icon("check2")}Fazer inventário</a></p></div>`}
          </div></div>
      </div>

      ${noRecipe.length ? `<div class="alert warn" style="margin-top:var(--s-4)">${icon("alert")}<div><b>${noRecipe.length} produto(s) sem ficha técnica</b> — entram na venda com custo zero e deixam o CMV mais bonito do que é: ${noRecipe.slice(0, 6).map((x) => `<a href="#/cmv/fichas/${x.p.id}">${esc(x.p.name)}</a>`).join(", ")}${noRecipe.length > 6 ? "…" : ""}</div></div>` : ""}
    `;
    wireCharts(el, [daily]);
  }

  const off = on(el, "click", "[data-m], [data-href]", (e, t) => {
    if (t.dataset.href) { location.hash = t.dataset.href; return; }
    month = shiftMonth(month, Number(t.dataset.m));
    history.replaceState(null, "", `#/cmv?m=${month}`);
    load();
  });
  await load();
  return off;
}
