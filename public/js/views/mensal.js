import { state, category } from "../store.js";
import { statsForMonth, listWhere } from "../services.js";
import { fb } from "../firebase.js";
import { money, pct, ratio, esc, isoMonth, shiftMonth, fmtMonth, fmtDayShort, weekday, monthRange } from "../format.js";
import { icon, pageHead, empty, on, tabs } from "../ui.js";
import { FIN_TABS } from "./financeiro.js";

export const title = "Mensal / DRE";

export default async function (el) {
  let month = isoMonth();

  async function load() {
    el.innerHTML = `<div class="boot" style="min-height:40vh">Montando DRE…</div>`;
    const [stats, prev, bills] = await Promise.all([
      statsForMonth(month),
      statsForMonth(shiftMonth(month, -1)).catch(() => []),
      listWhere("bills", fb.where("competence", "==", month)).catch(() => []),
    ]);
    render(stats, prev, bills);
  }

  function render(stats, prev, bills) {
    const c = state.settings.cmv;
    const sum = (arr, k) => arr.reduce((s, d) => s + (d[k] || 0), 0);
    const rev = sum(stats, "revenue");
    const prevRev = sum(prev, "revenue");
    const tax = Math.round((rev * c.tax_percent) / 100);
    const fees = sum(stats, "fees");
    const comm = sum(stats, "commission");
    const netRev = rev - tax - fees - comm;
    const theo = sum(stats, "cost");
    const loss = sum(stats, "loss");
    const inv = sum(stats, "invDiff");
    const cmv = theo + loss + inv;
    const grossProfit = netRev - cmv;
    const group = (g) => bills.filter((b) => b.type === "pagar" && category(b.categoryId)?.dre_group === g);
    const byCat = (list) => {
      const m = new Map();
      for (const b of list) m.set(category(b.categoryId)?.name ?? "Sem categoria", (m.get(category(b.categoryId)?.name ?? "Sem categoria") ?? 0) + b.amount);
      return [...m.entries()].sort((a, b) => b[1] - a[1]);
    };
    const variable = group("variavel");
    const fixed = group("fixa");
    const uncategorized = bills.filter((b) => b.type === "pagar" && !category(b.categoryId));
    const varTotal = variable.reduce((s, b) => s + b.amount, 0) + uncategorized.reduce((s, b) => s + b.amount, 0);
    const fixTotal = fixed.reduce((s, b) => s + b.amount, 0);
    const mc = grossProfit - varTotal;
    const extra = bills.filter((b) => b.type === "receber" && category(b.categoryId)?.dre_group === "receita" && !/ifood/i.test(category(b.categoryId)?.name ?? "")).reduce((s, b) => s + b.amount, 0);
    const result = mc - fixTotal + extra;
    const invest = group("investimento").reduce((s, b) => s + b.amount, 0);
    const das = group("imposto").reduce((s, b) => s + b.amount, 0);
    const mcPct = ratio(mc, rev);
    const breakEven = mcPct > 0 ? Math.round(fixTotal / (mcPct / 100)) : 0;
    const orders = sum(stats, "orders");
    const { days } = monthRange(month);
    const openDays = stats.filter((d) => d.orders > 0).length;

    const line = (label, v, cls = "", note = "") => `<tr class="${cls}"><td>${label}${note ? ` <span class="muted xs">${note}</span>` : ""}</td><td class="num">${money(v)}</td><td class="num muted">${rev ? pct(ratio(v, rev)) : ""}</td></tr>`;

    el.innerHTML = `
      ${pageHead("Financeiro", "Resultado do mês no formato de DRE simplificada, pra saber se a lanchonete deu lucro de verdade.",
        `<button class="btn icon" data-m="-1" aria-label="Mês anterior">${icon("left")}</button><strong style="min-width:150px;text-align:center">${fmtMonth(month)}</strong><button class="btn icon" data-m="1" aria-label="Próximo mês">${icon("right")}</button><button class="btn" onclick="print()">${icon("printer")}Imprimir</button>`)}
      ${tabs(FIN_TABS, "#/financeiro/mensal")}
      <div class="grid g4" style="margin-bottom:var(--s-4)">
        <div class="card stat"><span class="stat-label">Faturamento</span><span class="stat-value">${money(rev)}</span><span class="stat-foot">${prevRev ? `<span class="${rev >= prevRev ? "good" : "bad"}">${rev >= prevRev ? "▲" : "▼"} ${pct(Math.abs(ratio(rev - prevRev, prevRev)))}</span> vs. mês anterior` : "—"}</span></div>
        <div class="card stat"><span class="stat-label">Resultado</span><span class="stat-value ${result < 0 ? "bad" : "good"}">${money(result)}</span><span class="stat-foot">${pct(ratio(result, rev))} de margem líquida</span></div>
        <div class="card stat"><span class="stat-label">Ponto de equilíbrio</span><span class="stat-value">${breakEven ? money(breakEven) : "—"}</span><span class="stat-foot">${breakEven ? `≈ ${money(Math.round(breakEven / days))} por dia · já vendeu ${pct(ratio(rev, breakEven))}` : "lance as despesas fixas"}</span></div>
        <div class="card stat"><span class="stat-label">Ticket médio</span><span class="stat-value">${money(orders ? Math.round(rev / orders) : 0)}</span><span class="stat-foot">${orders} pedidos em ${openDays} dia(s)</span></div>
      </div>
      <div class="grid" style="grid-template-columns:minmax(0,1.2fr) minmax(0,1fr);align-items:start">
        <div class="card"><div class="card-h"><h3>DRE — ${fmtMonth(month)}</h3><span class="sub">% sobre o faturamento</span></div><div class="card-b flush">
          <table class="t dre"><tbody>
            ${line("<b>Faturamento bruto</b>", rev, "total")}
            ${line("(−) Impostos sobre vendas", -tax, "minus", `estimado ${pct(c.tax_percent)}`)}
            ${line("(−) Taxas de cartão / Pix", -fees, "minus")}
            ${line("(−) Comissão iFood", -comm, "minus")}
            ${line("<b>= Receita líquida</b>", netRev, "total")}
            ${line("(−) CMV teórico (fichas)", -theo, "minus")}
            ${line("(−) Perdas registradas", -loss, "minus")}
            ${line("(−) Divergência de inventário", -inv, "minus")}
            ${line("<b>= Lucro bruto</b>", grossProfit, "total")}
            ${line("(−) Despesas variáveis", -varTotal, "minus")}
            ${line("<b>= Margem de contribuição</b>", mc, "total")}
            ${byCat(fixed).map(([k, v]) => line(`(−) ${esc(k)}`, -v, "minus")).join("") || line("(−) Despesas fixas", 0, "minus", "nenhuma lançada")}
            ${extra ? line("(+) Outras receitas", extra, "minus") : ""}
            <tr class="total"><td><b>= Resultado do mês</b></td><td class="num ${result < 0 ? "bad" : "good"}"><b>${money(result)}</b></td><td class="num"><b>${pct(ratio(result, rev))}</b></td></tr>
          </tbody></table>
          <div class="card-b stack tight">
            ${invest ? `<p class="small soft">Investimentos no mês (fora do resultado): <b>${money(invest)}</b>.</p>` : ""}
            ${das ? `<p class="small soft">DAS/impostos pagos lançados em contas: <b>${money(das)}</b> — no DRE usamos a alíquota estimada pra não contar duas vezes.</p>` : ""}
            ${!fixTotal ? `<div class="alert warn">${icon("alert")}<div>Nenhuma despesa fixa com competência neste mês. Cadastre aluguel, salários etc. em <a href="#/financeiro/contas">Contas</a> (tem modelo de conta fixa que se repete todo mês).</div></div>` : ""}
          </div></div></div>
        <div class="stack">
          <div class="card"><div class="card-h"><h3>Despesas variáveis</h3></div><div class="card-b flush">
            ${byCat([...variable, ...uncategorized]).length ? `<table class="t"><tbody>${byCat([...variable, ...uncategorized]).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="num">${money(v)}</td></tr>`).join("")}</tbody></table>` : empty("Nenhuma.")}</div></div>
          <div class="card"><div class="card-h"><h3>Dia a dia</h3></div><div class="card-b flush"><div class="table-wrap" style="max-height:420px;overflow:auto">
            ${stats.length ? `<table class="t"><thead><tr><th>Dia</th><th class="num">Pedidos</th><th class="num">Vendas</th><th class="num">CMV</th></tr></thead><tbody>
              ${stats.filter((d) => d.revenue || d.loss || d.invDiff).map((d) => `<tr><td>${fmtDayShort(d.day)} <span class="muted xs">${weekday(d.day)}</span></td><td class="num">${d.orders || 0}</td><td class="num">${money(d.revenue || 0)}</td><td class="num">${pct(ratio((d.cost || 0) + (d.loss || 0) + (d.invDiff || 0), d.revenue || 0))}</td></tr>`).join("")}
            </tbody></table>` : empty("Sem movimento.")}</div></div></div>
        </div>
      </div>`;
  }

  const off = on(el, "click", "[data-m]", (_e, b) => { month = shiftMonth(month, Number(b.dataset.m)); load(); });
  await load();
  return off;
}
