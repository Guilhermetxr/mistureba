import { state, avgFeePercent, product } from "../store.js";
import { statsForRange } from "../services.js";
import { menuEngineering, MENU_CLASS } from "../costing.js";
import { money, pct, num, esc, isoDate, addDays, fmtDate } from "../format.js";
import { pageHead, empty, on } from "../ui.js";

export const title = "Engenharia de cardápio";

const BADGE = { estrela: "good", burro: "warn", enigma: "info", cao: "bad", "sem-venda": "" };

export default async function (el) {
  let days = 30;

  async function load() {
    el.innerHTML = `<div class="boot" style="min-height:40vh">Analisando vendas…</div>`;
    const end = isoDate();
    const start = addDays(end, -(days - 1));
    const stats = await statsForRange(start, end);
    render(stats, start, end);
  }

  function render(stats, start, end) {
    const c = state.settings.cmv;
    const fee = avgFeePercent(stats);
    const agg = new Map();
    for (const d of stats)
      for (const [id, p] of Object.entries(d.byProduct ?? {})) {
        if (id === "_avulso") continue;
        const prod = product(id);
        if (prod && prod.category === "Adicionais") continue;
        const cur = agg.get(id) ?? { id, name: prod?.name ?? p.name, qty: 0, revenue: 0, cost: 0 };
        cur.qty += p.qty || 0;
        cur.revenue += p.revenue || 0;
        cur.cost += p.cost || 0;
        agg.set(id, cur);
      }
    const rows = [...agg.values()]
      .filter((r) => r.qty > 0)
      .map((r) => {
        const price = r.revenue / r.qty;
        const cost = r.cost / r.qty;
        const mc = price - cost - (price * (fee + c.tax_percent)) / 100;
        return { ...r, price, unitCost: cost, mc, mcTotal: mc * r.qty, cmvPct: price ? (cost / price) * 100 : 0 };
      });
    const res = menuEngineering(rows).sort((a, b) => b.mcTotal - a.mcTotal);
    const totalMc = res.reduce((s, r) => s + r.mcTotal, 0);
    const counts = Object.fromEntries(Object.keys(MENU_CLASS).map((k) => [k, res.filter((r) => r.klass === k).length]));

    el.innerHTML = `
      ${pageHead("Engenharia de cardápio", "Cruza o quanto cada item vende com o quanto ele deixa de sobra. Mostra o que destacar, o que reformular e o que tirar.",
        `<div class="seg">${[7, 30, 90].map((d) => `<button data-days="${d}" class="${d === days ? "active" : ""}">${d} dias</button>`).join("")}</div>`, "CMV")}
      ${!res.length ? `<div class="card">${empty("Ainda não há vendas no período para analisar.")}</div>` : `
      <div class="grid g4" style="margin-bottom:var(--s-4)">
        ${["estrela", "burro", "enigma", "cao"].map((k) => `<div class="card stat"><span class="stat-label">${MENU_CLASS[k].label}</span><span class="stat-value">${counts[k]}</span><span class="stat-foot">${MENU_CLASS[k].tip}</span></div>`).join("")}
      </div>
      <div class="card" style="margin-bottom:var(--s-4)"><div class="card-h"><h3>Matriz popularidade × margem</h3><span class="sub">${fmtDate(start)} a ${fmtDate(end)}</span></div>
        <div class="card-b">${matrix(res)}</div></div>
      <div class="card"><div class="card-h"><h3>Itens</h3><span class="sub">ordenados pela sobra total que geraram</span></div>
        <div class="card-b flush"><div class="table-wrap"><table class="t"><thead><tr>
          <th>Item</th><th>Classificação</th><th class="num">Vendidos</th><th class="num">Preço médio</th><th class="num">CMV</th><th class="num">Sobra / un.</th><th class="num">Sobra total</th><th class="num">% da sobra</th>
        </tr></thead><tbody>
        ${res.map((r) => `<tr class="click" data-href="#/cmv/fichas/${r.id}" title="${esc(MENU_CLASS[r.klass].tip)}">
          <td><b>${esc(r.name)}</b></td><td><span class="badge ${BADGE[r.klass]}">${MENU_CLASS[r.klass].label}</span></td>
          <td class="num">${num(r.qty)}</td><td class="num">${money(r.price)}</td><td class="num">${pct(r.cmvPct)}</td>
          <td class="num">${money(r.mc)}</td><td class="num"><b>${money(r.mcTotal)}</b></td><td class="num muted">${pct(totalMc ? (r.mcTotal / totalMc) * 100 : 0)}</td></tr>`).join("")}
        </tbody></table></div></div></div>
      <p class="small muted" style="margin-top:var(--s-3)">Popular = vendeu pelo menos 70% da média por item. Margem alta = sobra por unidade acima da média ponderada (${money(res[0]?.avgMc ?? 0)}). Sobra = preço − custo − taxa média (${pct(fee)}) − impostos (${pct(c.tax_percent)}). Adicionais ficam de fora.</p>`}`;
  }

  function matrix(rows) {
    const W = 720, H = 360, pad = { t: 24, r: 16, b: 36, l: 64 };
    const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    const maxQ = Math.max(...rows.map((r) => r.qty)) * 1.1;
    const mcs = rows.map((r) => r.mc);
    const minM = Math.min(0, ...mcs), maxM = Math.max(...mcs) * 1.15 || 1;
    const x = (q) => pad.l + (q / maxQ) * iw;
    const y = (m) => pad.t + ih - ((m - minM) / (maxM - minM)) * ih;
    const cx = x(rows[0].popCut), cy = y(rows[0].avgMc);
    const labeled = new Set([...rows].sort((a, b) => b.qty - a.qty).slice(0, 14).map((r) => r.id));
    let s = `<div class="chart matrix"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Matriz de engenharia de cardápio">`;
    s += `<rect class="quad" x="${cx}" y="${pad.t}" width="${W - pad.r - cx}" height="${cy - pad.t}"/>`;
    s += `<line class="gridline" x1="${cx}" x2="${cx}" y1="${pad.t}" y2="${pad.t + ih}" stroke-dasharray="4 3"/>`;
    s += `<line class="gridline" x1="${pad.l}" x2="${W - pad.r}" y1="${cy}" y2="${cy}" stroke-dasharray="4 3"/>`;
    s += `<text class="quad-label" x="${W - pad.r - 6}" y="${pad.t + 14}" text-anchor="end">Estrelas</text>`;
    s += `<text class="quad-label" x="${pad.l + 6}" y="${pad.t + 14}">Enigmas</text>`;
    s += `<text class="quad-label" x="${W - pad.r - 6}" y="${pad.t + ih - 8}" text-anchor="end">Burros de carga</text>`;
    s += `<text class="quad-label" x="${pad.l + 6}" y="${pad.t + ih - 8}">Cães</text>`;
    s += `<g class="axis"><text x="${pad.l + iw / 2}" y="${H - 6}" text-anchor="middle">Quantidade vendida →</text>
      <text x="14" y="${pad.t + ih / 2}" transform="rotate(-90 14 ${pad.t + ih / 2})" text-anchor="middle">Sobra por unidade →</text>
      <line class="gridline" x1="${pad.l}" x2="${W - pad.r}" y1="${pad.t + ih}" y2="${pad.t + ih}"/>
      <text x="${pad.l - 8}" y="${y(maxM / 1.15) + 4}" text-anchor="end">${esc(money(maxM / 1.15))}</text>
      <text x="${pad.l - 8}" y="${y(Math.max(minM, 0)) + 4}" text-anchor="end">${esc(money(Math.max(minM, 0)))}</text></g>`;
    for (const r of rows) {
      s += `<circle class="dot" cx="${x(r.qty)}" cy="${y(r.mc)}" r="6"><title>${esc(r.name)} — ${num(r.qty)} vendidos, sobra ${money(r.mc)}/un.</title></circle>`;
      if (labeled.has(r.id)) {
        const right = x(r.qty) < W - 150;
        s += `<text class="dot-label" x="${x(r.qty) + (right ? 10 : -10)}" y="${y(r.mc) + 4}" text-anchor="${right ? "start" : "end"}">${esc(r.name)}</text>`;
      }
    }
    return s + `</svg></div>`;
  }

  const offs = [
    on(el, "click", "[data-days]", (_e, b) => { days = Number(b.dataset.days); load(); }),
    on(el, "click", "[data-href]", (_e, t) => (location.hash = t.dataset.href)),
  ];
  await load();
  return () => offs.forEach((f) => f());
}

