// Gráficos em SVG puro. Uma série = uma cor (--series-1), sem legenda;
// eixos/grade recessivos, rótulos em tinta de texto, tooltip por barra.
import { esc } from "./format.js";

/**
 * data: [{ label, value, tip }]  (value numérico; tip = HTML do tooltip)
 * opts: { height, ref: { value, label }, fmtAxis, labelEvery }
 */
export function barChart(data, opts = {}) {
  const W = 720;
  const H = opts.height ?? 220;
  const pad = { t: 16, r: 8, b: 26, l: 52 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const maxV = Math.max(1, opts.ref?.value ?? 0, ...data.map((d) => d.value));
  const nice = niceMax(maxV);
  const y = (v) => pad.t + ih - (v / nice) * ih;
  const bw = iw / Math.max(1, data.length);
  const gap = Math.min(2, bw * 0.2) + (bw > 14 ? bw * 0.18 : 0);
  const every = opts.labelEvery ?? Math.ceil(data.length / 12);
  const fmt = opts.fmtAxis ?? ((v) => String(Math.round(v)));

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * nice);
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.label ?? "Gráfico de barras")}">`;
  s += `<g class="axis">`;
  for (const t of ticks) {
    s += `<line class="gridline" x1="${pad.l}" x2="${W - pad.r}" y1="${y(t)}" y2="${y(t)}"/>`;
    s += `<text x="${pad.l - 8}" y="${y(t) + 4}" text-anchor="end">${esc(fmt(t))}</text>`;
  }
  data.forEach((d, i) => {
    if (i % every === 0) s += `<text x="${pad.l + i * bw + bw / 2}" y="${H - 8}" text-anchor="middle">${esc(d.label)}</text>`;
  });
  s += `</g>`;
  data.forEach((d, i) => {
    const x = pad.l + i * bw + gap / 2;
    const w = Math.max(1, bw - gap);
    const h = Math.max(0, pad.t + ih - y(d.value));
    const r = Math.min(4, w / 2, h);
    const top = pad.t + ih - h;
    // Canto arredondado só no topo, base reta no eixo
    if (h > 0)
      s += `<path class="bar" data-i="${i}" d="M${x},${pad.t + ih} V${top + r} Q${x},${top} ${x + r},${top} H${x + w - r} Q${x + w},${top} ${x + w},${top + r} V${pad.t + ih} Z"/>`;
    s += `<rect class="hit" data-i="${i}" x="${pad.l + i * bw}" y="${pad.t}" width="${bw}" height="${ih}"/>`;
  });
  if (opts.ref) {
    s += `<line class="ref" x1="${pad.l}" x2="${W - pad.r}" y1="${y(opts.ref.value)}" y2="${y(opts.ref.value)}"/>`;
    s += `<text class="ref-label" x="${W - pad.r}" y="${y(opts.ref.value) - 6}" text-anchor="end">${esc(opts.ref.label)}</text>`;
  }
  s += `</svg>`;
  return `<div class="chart" data-chart>${s}<div class="tip" hidden></div></div>`;
}

/** Liga os tooltips de todos os gráficos dentro de `root`. */
export function wireCharts(root, datasets) {
  root.querySelectorAll("[data-chart]").forEach((box, idx) => {
    const data = datasets[idx];
    if (!data) return;
    const tip = box.querySelector(".tip");
    const svg = box.querySelector("svg");
    const bars = [...box.querySelectorAll(".bar")];
    const show = (e) => {
      const hit = e.target.closest(".hit");
      if (!hit) return;
      const i = Number(hit.dataset.i);
      const d = data[i];
      const r = hit.getBoundingClientRect();
      const br = box.getBoundingClientRect();
      tip.innerHTML = d.tip ?? `<b>${esc(d.label)}</b>${esc(String(d.value))}`;
      tip.hidden = false;
      const barEl = bars.find((b) => b.dataset.i === String(i));
      const top = barEl ? barEl.getBoundingClientRect().top : r.bottom - 10;
      tip.style.left = `${Math.min(br.width - 70, Math.max(70, r.left - br.left + r.width / 2))}px`;
      tip.style.top = `${top - br.top}px`;
      bars.forEach((b) => b.classList.toggle("dim", b.dataset.i !== String(i)));
    };
    svg.addEventListener("pointermove", show);
    svg.addEventListener("pointerleave", () => {
      tip.hidden = true;
      bars.forEach((b) => b.classList.remove("dim"));
    });
  });
}

function niceMax(v) {
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

/** Barras horizontais em HTML (participação no custo, ranking) */
export function hbars(rows, { fmt = (v) => v, max } = {}) {
  const m = max ?? Math.max(1e-9, ...rows.map((r) => r.value));
  return `<div class="hbars">${rows
    .map(
      (r) => `<div class="hbar"><span>${esc(r.label)}</span><span class="num right">${fmt(r.value)}${r.extra ? ` <span class="muted xs">${r.extra}</span>` : ""}</span>
      <div class="track"><span style="width:${Math.max(1, (r.value / m) * 100)}%"></span></div></div>`,
    )
    .join("")}</div>`;
}
