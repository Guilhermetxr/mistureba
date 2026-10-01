import { statsForRange, listWhere } from "../services.js";
import { fb } from "../firebase.js";
import { money, isoDate, addDays, fmtDate, weekday, KIND_LABEL } from "../format.js";
import { pageHead, empty, tabs } from "../ui.js";
import { FIN_TABS } from "./financeiro.js";

export const title = "Recebíveis";

export default async function (el) {
  const today = isoDate();
  const horizon = addDays(today, 45);
  el.innerHTML = `<div class="boot" style="min-height:40vh">Carregando…</div>`;
  // Vendas até ~65 dias atrás ainda podem ter parcelas a cair (crédito D+30, iFood)
  const [stats, bills] = await Promise.all([
    statsForRange(addDays(today, -65), today).catch(() => []),
    listWhere("bills", fb.where("paidAt", "==", null), fb.where("dueDate", "<=", horizon)).catch(() => []),
  ]);

  const byDate = new Map();
  for (const d of stats)
    for (const [date, kinds] of Object.entries(d.receivables ?? {})) {
      if (date < today) continue;
      const cur = byDate.get(date) ?? { in: 0, kinds: {}, out: 0 };
      for (const [k, v] of Object.entries(kinds)) { cur.in += v; cur.kinds[k] = (cur.kinds[k] ?? 0) + v; }
      byDate.set(date, cur);
    }
  for (const b of bills) {
    const date = b.dueDate < today ? today : b.dueDate;
    const cur = byDate.get(date) ?? { in: 0, kinds: {}, out: 0 };
    if (b.type === "pagar") cur.out += b.amount;
    else { cur.in += b.amount; cur.kinds.contas = (cur.kinds.contas ?? 0) + b.amount; }
    byDate.set(date, cur);
  }
  const rows = [...byDate.entries()].filter(([d]) => d <= horizon).sort((a, b) => a[0].localeCompare(b[0]));
  const totIn = rows.reduce((s, [, r]) => s + r.in, 0);
  const totOut = rows.reduce((s, [, r]) => s + r.out, 0);
  const next7 = rows.filter(([d]) => d <= addDays(today, 7)).reduce((s, [, r]) => s + r.in, 0);
  let running = 0;

  el.innerHTML = `
    ${pageHead("Financeiro", "Fluxo de caixa previsto: o que a maquininha e o iFood ainda vão depositar, contra as contas a pagar.")}
    ${tabs(FIN_TABS, "#/financeiro/recebiveis")}
    <div class="grid g3" style="margin-bottom:var(--s-4)">
      <div class="card stat"><span class="stat-label">A receber (7 dias)</span><span class="stat-value good">${money(next7)}</span></div>
      <div class="card stat"><span class="stat-label">A receber (45 dias)</span><span class="stat-value">${money(totIn)}</span><span class="stat-foot">já descontadas taxas e comissão</span></div>
      <div class="card stat"><span class="stat-label">A pagar (45 dias)</span><span class="stat-value bad">${money(totOut)}</span><span class="stat-foot">inclui vencidas</span></div>
    </div>
    <div class="card"><div class="card-h"><h3>Dia a dia</h3><span class="sub">saldo acumulado não inclui o que já está no banco</span></div><div class="card-b flush">
      ${rows.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Data</th><th>Origem</th><th class="num">Entra</th><th class="num">Sai</th><th class="num">Acumulado</th></tr></thead><tbody>
        ${rows.map(([d, r]) => { running += r.in - r.out; return `<tr><td class="nowrap">${fmtDate(d)} <span class="muted xs">${weekday(d)}</span></td>
          <td class="small soft">${Object.entries(r.kinds).map(([k, v]) => `${k === "contas" ? "Contas a receber" : KIND_LABEL[k] ?? k} ${money(v)}`).join(" · ")}</td>
          <td class="num good">${r.in ? money(r.in) : ""}</td><td class="num bad">${r.out ? money(r.out) : ""}</td><td class="num strong ${running < 0 ? "bad" : ""}">${money(running)}</td></tr>`; }).join("")}
      </tbody></table></div>` : empty("Nada previsto para os próximos 45 dias.")}
    </div></div>
    <p class="small muted" style="margin-top:var(--s-3)">Prazos de recebimento de cada forma de pagamento vêm de Configurações › Taxas. Com antecipação automática na Stone, coloque 1 dia e a taxa de antecipação.</p>`;
}
