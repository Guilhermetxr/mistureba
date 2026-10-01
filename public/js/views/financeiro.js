import { state, category } from "../store.js";
import { listWhere } from "../services.js";
import { fb, db } from "../firebase.js";
import { money, pct, ratio, esc, isoDate, addDays, fmtDate, weekday, CHANNELS } from "../format.js";
import { icon, pageHead, empty, on, $, tabs } from "../ui.js";

export const title = "Financeiro diário";

export const FIN_TABS = [
  ["#/financeiro", "Diário"],
  ["#/financeiro/mensal", "Mensal / DRE"],
  ["#/financeiro/contas", "Contas a pagar e receber"],
  ["#/financeiro/recebiveis", "Recebíveis"],
];

export default async function (el) {
  let day = isoDate();

  el.innerHTML = `
    ${pageHead("Financeiro", "O fechamento do dia: quanto entrou, por onde, quanto ficou com a maquininha e o que foi pago.",
      `<button class="btn icon" data-d="-1" aria-label="Dia anterior">${icon("left")}</button><input class="input" type="date" data-day style="width:auto" aria-label="Dia"><button class="btn icon" data-d="1" aria-label="Próximo dia">${icon("right")}</button>`)}
    ${tabs(FIN_TABS, "#/financeiro")}
    <div data-body></div>`;

  async function load() {
    $("[data-day]", el).value = day;
    $("[data-body]", el).innerHTML = `<div class="boot" style="min-height:30vh">Carregando…</div>`;
    const [statSnap, paid, sessions] = await Promise.all([
      fb.getDoc(fb.doc(db, "dailyStats", day)),
      listWhere("bills", fb.where("paidAt", "==", day)).catch(() => []),
      listWhere("cashSessions", fb.where("day", "==", day)).catch(() => []),
    ]);
    render(statSnap.data() ?? {}, paid, sessions);
  }

  function render(d, paid, sessions) {
    const c = state.settings.cmv;
    const rev = d.revenue || 0;
    const tax = Math.round((rev * c.tax_percent) / 100);
    const loss = (d.loss || 0) + (d.invDiff || 0);
    const gross = rev - (d.fees || 0) - (d.commission || 0) - tax - (d.cost || 0) - loss;
    const methods = Object.entries(d.byMethod ?? {}).map(([k, v]) => ({ k, ...v })).filter((m) => m.amount).sort((a, b) => b.amount - a.amount);
    const channels = Object.entries(d.byChannel ?? {}).filter(([, v]) => v.orders > 0);
    const outs = paid.filter((b) => b.type === "pagar");
    const ins = paid.filter((b) => b.type === "receber");
    const outTotal = outs.reduce((s, b) => s + (b.paidAmount ?? b.amount), 0);
    const inTotal = ins.reduce((s, b) => s + (b.paidAmount ?? b.amount), 0);
    const sangrias = sessions.reduce((s, x) => s + (x.sangrias || 0), 0);
    const hours = Object.entries(d.byHour ?? {}).filter(([, v]) => v.orders > 0).sort();
    const peak = hours.reduce((m, h) => (h[1].revenue > (m?.[1].revenue ?? 0) ? h : m), null);

    $("[data-body]", el).innerHTML = `
      <p class="small soft" style="margin:-8px 0 var(--s-4)">${weekday(day)}, ${fmtDate(day)}${peak ? ` · pico às ${peak[0]}h (${money(peak[1].revenue)})` : ""}</p>
      <div class="grid g4" style="margin-bottom:var(--s-4)">
        <div class="card stat"><span class="stat-label">Faturamento</span><span class="stat-value">${money(rev)}</span><span class="stat-foot">${d.orders || 0} pedidos${d.canceled ? ` · ${d.canceled} cancelado(s)` : ""}</span></div>
        <div class="card stat"><span class="stat-label">Taxas + comissão</span><span class="stat-value">${money((d.fees || 0) + (d.commission || 0))}</span><span class="stat-foot">${pct(ratio((d.fees || 0) + (d.commission || 0), rev))} do faturamento</span></div>
        <div class="card stat"><span class="stat-label">CMV do dia</span><span class="stat-value">${pct(ratio((d.cost || 0) + loss, rev))}</span><span class="stat-foot">${money((d.cost || 0) + loss)}${loss ? ` (perdas ${money(loss)})` : ""}</span></div>
        <div class="card stat"><span class="stat-label">Contas pagas no dia</span><span class="stat-value">${money(outTotal)}</span><span class="stat-foot">${outs.length} lançamento(s)</span></div>
      </div>
      <div class="grid g2" style="margin-bottom:var(--s-4)">
        <div class="card"><div class="card-h"><h3>Por forma de pagamento</h3></div><div class="card-b flush">
          ${methods.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Forma</th><th class="num">Qtd.</th><th class="num">Bruto</th><th class="num">Taxa</th><th class="num">Líquido</th></tr></thead><tbody>
            ${methods.map((m) => `<tr><td>${esc(m.name)}</td><td class="num">${m.count}</td><td class="num">${money(m.amount)}</td><td class="num muted">${money(m.fee)}</td><td class="num"><b>${money(m.amount - m.fee)}</b></td></tr>`).join("")}
          </tbody><tfoot><tr><td>Total</td><td></td><td class="num">${money(methods.reduce((s, m) => s + m.amount, 0))}</td><td class="num">${money(methods.reduce((s, m) => s + m.fee, 0))}</td><td class="num">${money(methods.reduce((s, m) => s + m.amount - m.fee, 0))}</td></tr></tfoot></table></div>` : empty("Sem vendas.")}</div></div>
        <div class="card"><div class="card-h"><h3>Resultado do dia</h3><span class="sub">antes das despesas fixas</span></div><div class="card-b flush">
          <table class="t dre"><tbody>
            <tr><td>Faturamento</td><td class="num">${money(rev)}</td></tr>
            <tr class="minus"><td>Taxas de pagamento</td><td class="num">− ${money(d.fees || 0)}</td></tr>
            <tr class="minus"><td>Comissão iFood</td><td class="num">− ${money(d.commission || 0)}</td></tr>
            <tr class="minus"><td>Impostos estimados (${pct(c.tax_percent)})</td><td class="num">− ${money(tax)}</td></tr>
            <tr class="minus"><td>CMV (fichas)</td><td class="num">− ${money(d.cost || 0)}</td></tr>
            ${loss ? `<tr class="minus"><td>Perdas e divergências</td><td class="num">− ${money(loss)}</td></tr>` : ""}
            <tr class="total"><td>Margem de contribuição</td><td class="num ${gross < 0 ? "bad" : "good"}">${money(gross)} <span class="xs muted">${pct(ratio(gross, rev))}</span></td></tr>
          </tbody></table></div></div>
      </div>
      <div class="grid g3">
        <div class="card"><div class="card-h"><h3>Por canal</h3></div><div class="card-b flush">
          ${channels.length ? `<table class="t"><tbody>${channels.map(([k, v]) => `<tr><td>${CHANNELS[k] ?? k}</td><td class="num">${v.orders}</td><td class="num">${money(v.revenue)}</td></tr>`).join("")}</tbody></table>` : empty("—")}</div></div>
        <div class="card"><div class="card-h"><h3>Caixa</h3></div><div class="card-b flush">
          ${sessions.length ? `<table class="t"><tbody>${sessions.map((s) => `<tr><td>${esc(s.openedByName)}</td><td><span class="badge ${s.status === "aberto" ? "info" : "good"}">${s.status}</span></td><td class="num">${s.status === "fechado" ? `<span class="${s.difference ? "bad" : "good"}">${s.difference > 0 ? "+" : ""}${money(s.difference)}</span>` : ""}</td></tr>`).join("")}
            <tr><td colspan="2" class="soft">Sangrias</td><td class="num">${money(sangrias)}</td></tr></tbody></table>` : empty("Caixa não foi aberto.")}</div></div>
        <div class="card"><div class="card-h"><h3>Pago / recebido no dia</h3></div><div class="card-b flush">
          ${paid.length ? `<table class="t"><tbody>${paid.map((b) => `<tr><td>${esc(b.description)}<div class="xs muted">${esc(category(b.categoryId)?.name ?? "")}</div></td><td class="num ${b.type === "pagar" ? "bad" : "good"}">${b.type === "pagar" ? "−" : "+"} ${money(b.paidAmount ?? b.amount)}</td></tr>`).join("")}
            ${inTotal ? `<tr><td class="soft">Recebido</td><td class="num">${money(inTotal)}</td></tr>` : ""}</tbody></table>` : empty("Nenhuma conta paga nesse dia.")}</div></div>
      </div>`;
  }

  const offs = [
    on(el, "change", "[data-day]", (e) => { day = e.target.value || isoDate(); load(); }),
    on(el, "click", "[data-d]", (_e, b) => { day = addDays(day, Number(b.dataset.d)); load(); }),
  ];
  await load();
  return () => offs.forEach((f) => f());
}
