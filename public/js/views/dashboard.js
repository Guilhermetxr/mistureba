import { state, costBook, sellable, subscribe } from "../store.js";
import { statsForMonth, listWhere, expectedCash } from "../services.js";
import { fb } from "../firebase.js";
import { money, pct, ratio, esc, isoDate, isoMonth, monthRange, fmtDayShort, fmtDate, addDays, num } from "../format.js";
import { icon, pageHead, empty, meter } from "../ui.js";
import { barChart, wireCharts } from "../charts.js";

export const title = "Início";

export default async function (el) {
  const today = isoDate();
  const month = isoMonth();
  const [stats, bills] = await Promise.all([
    statsForMonth(month).catch(() => []),
    listWhere("bills", fb.where("paidAt", "==", null), fb.where("dueDate", "<=", addDays(today, 7))).catch(() => []),
  ]);

  function render() {
    const c = state.settings.cmv;
    const t = stats.find((d) => d.day === today) ?? {};
    const sum = (k) => stats.reduce((s, d) => s + (d[k] || 0), 0);
    const rev = sum("revenue");
    const real = sum("cost") + sum("loss") + sum("invDiff");
    const realPct = ratio(real, rev);
    const s = state.session;
    const book = costBook();
    const above = sellable().filter((p) => p.recipe?.length && ratio(book.unitCostCents(p.id), p.price) > c.alert_percent);
    const low = state.ingredients.filter((i) => i.active !== false && i.minStock > 0 && (i.stock ?? 0) <= i.minStock);
    const overdue = bills.filter((b) => b.type === "pagar" && b.dueDate < today);
    const soon = bills.filter((b) => b.type === "pagar" && b.dueDate >= today).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    const top = Object.entries(t.byProduct ?? {}).map(([, p]) => p).filter((p) => p.qty > 0).sort((a, b) => b.qty - a.qty).slice(0, 6);

    const { days } = monthRange(month);
    const daily = [];
    for (let i = 1; i <= days; i++) {
      const day = `${month}-${String(i).padStart(2, "0")}`;
      if (day > today) break;
      const d = stats.find((x) => x.day === day);
      daily.push({ label: String(i), value: (d?.revenue || 0) / 100, tip: `<b>${fmtDayShort(day)} · ${money(d?.revenue || 0)}</b>${d?.orders || 0} pedidos` });
    }
    const hour = new Date().getHours();
    const greet = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";

    el.innerHTML = `
      ${pageHead(`${greet}, ${esc(state.profile.name.split(" ")[0])}`, `${fmtDate(today)} · ${s ? `caixa aberto com ${money(expectedCash(s))} na gaveta` : "caixa fechado"}`,
        `<a class="btn brand" href="#/pdv">${icon("pdv")}Abrir PDV</a>`)}
      <div class="grid g4" style="margin-bottom:var(--s-4)">
        <div class="card stat"><span class="stat-label">Vendas hoje</span><span class="stat-value">${money(t.revenue || 0)}</span><span class="stat-foot">${t.orders || 0} pedidos · ticket ${money(t.orders ? Math.round(t.revenue / t.orders) : 0)}</span></div>
        <div class="card stat"><span class="stat-label">CMV hoje</span><span class="stat-value">${pct(ratio(t.cost || 0, t.revenue || 0))}</span><span class="stat-foot">teórico, pelas fichas</span></div>
        <div class="card stat"><span class="stat-label">Vendas no mês</span><span class="stat-value">${money(rev)}</span><span class="stat-foot">${num(sum("orders"))} pedidos</span></div>
        <a class="card stat" href="#/cmv" style="text-decoration:none"><span class="stat-label">CMV real do mês</span><span class="stat-value ${realPct > c.alert_percent ? "bad" : realPct > c.target_percent ? "warn" : "good"}">${pct(realPct)}</span>${meter(realPct, c.target_percent, c.alert_percent)}</a>
      </div>

      ${overdue.length || above.length || low.length ? `<div class="stack tight" style="margin-bottom:var(--s-4)">
        ${overdue.length ? `<div class="alert bad">${icon("alert")}<div><b>${overdue.length} conta(s) vencida(s)</b> somando ${money(overdue.reduce((s, b) => s + b.amount, 0))}. <a href="#/financeiro/contas">Ver contas</a></div></div>` : ""}
        ${above.length ? `<div class="alert warn">${icon("alert")}<div><b>${above.length} produto(s) com CMV acima de ${c.alert_percent}%</b>: ${above.slice(0, 5).map((p) => `<a href="#/cmv/fichas/${p.id}">${esc(p.name)}</a>`).join(", ")}${above.length > 5 ? "…" : ""}</div></div>` : ""}
        ${low.length ? `<div class="alert">${icon("box")}<div><b>${low.length} insumo(s) abaixo do mínimo</b>: ${low.slice(0, 6).map((i) => esc(i.name)).join(", ")}${low.length > 6 ? "…" : ""}. <a href="#/estoque">Ver estoque</a></div></div>` : ""}
      </div>` : ""}

      <div class="card" style="margin-bottom:var(--s-4)"><div class="card-h"><h3>Faturamento por dia</h3><span class="sub">mês atual</span></div>
        <div class="card-b">${daily.some((d) => d.value) ? barChart(daily, { fmtAxis: (v) => `R$ ${num(Math.round(v))}`, label: "Faturamento diário" }) : empty("Sem vendas neste mês ainda.")}</div></div>

      <div class="grid g2">
        <div class="card"><div class="card-h"><h3>Mais vendidos hoje</h3></div><div class="card-b flush">
          ${top.length ? `<table class="t"><tbody>${top.map((p) => `<tr><td>${esc(p.name)}</td><td class="num">${num(p.qty)}×</td><td class="num">${money(p.revenue)}</td><td class="num muted">${pct(ratio(p.cost, p.revenue))}</td></tr>`).join("")}</tbody></table>` : empty("Nenhuma venda hoje ainda.")}</div></div>
        <div class="card"><div class="card-h"><h3>Contas dos próximos 7 dias</h3><a class="btn sm" href="#/financeiro/contas">Ver todas</a></div><div class="card-b flush">
          ${soon.length ? `<table class="t"><tbody>${soon.slice(0, 8).map((b) => `<tr><td>${fmtDate(b.dueDate)}</td><td>${esc(b.description)}</td><td class="num">${money(b.amount)}</td></tr>`).join("")}</tbody></table>` : empty("Nada vencendo nos próximos dias.", "check")}</div></div>
      </div>`;
    wireCharts(el, [daily]);
  }

  const offs = [subscribe((k) => ["session", "products", "ingredients"].includes(k) && render())];
  render();
  return () => offs.forEach((f) => f());
}

