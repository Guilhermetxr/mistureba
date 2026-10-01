import { icon } from "./icons.js";
import { esc } from "./format.js";

export { icon, esc };

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Delegação de eventos: on(root, "click", "[data-x]", (e, el) => …) */
export function on(root, type, selector, fn) {
  const handler = (e) => {
    const el = e.target.closest(selector);
    if (el && root.contains(el)) fn(e, el);
  };
  root.addEventListener(type, handler);
  return () => root.removeEventListener(type, handler);
}

export function toast(msg, tone = "") {
  let box = $(".toasts");
  if (!box) {
    box = document.createElement("div");
    box.className = "toasts";
    box.setAttribute("role", "status");
    box.setAttribute("aria-live", "polite");
    document.body.append(box);
  }
  const t = document.createElement("div");
  t.className = `toast ${tone}`;
  t.innerHTML = `${tone === "bad" ? icon("alert") : tone === "good" ? icon("check") : ""}<span>${esc(msg)}</span>`;
  t.querySelector("svg")?.setAttribute("width", "16");
  box.append(t);
  setTimeout(() => t.remove(), tone === "bad" ? 6000 : 3200);
}

/**
 * Abre um diálogo. `body` é HTML; `onSubmit(form, dialog)` pode lançar Error
 * (a mensagem aparece no rodapé, perto do botão). Retorna o <dialog>.
 */
export function modal({ title, body, submit = "Salvar", cancel = "Cancelar", wide = false, danger = false, onSubmit, onOpen, footer }) {
  const d = document.createElement("dialog");
  d.className = `modal${wide === "xl" ? " xl" : wide ? " wide" : ""}`;
  d.innerHTML = `
    <form method="dialog" novalidate>
      <div class="modal-h"><h2>${esc(title)}</h2>
        <button type="button" class="btn ghost icon" data-close aria-label="Fechar">${icon("x")}</button></div>
      <div class="modal-b">${body}</div>
      <div class="modal-f">
        <span class="form-error" role="alert"></span>
        ${footer ?? ""}
        ${cancel ? `<button type="button" class="btn" data-close>${esc(cancel)}</button>` : ""}
        ${submit ? `<button type="submit" class="btn ${danger ? "danger" : "primary"}" data-submit>${esc(submit)}</button>` : ""}
      </div>
    </form>`;
  document.body.append(d);
  const form = d.querySelector("form");
  const err = d.querySelector(".form-error");
  const close = () => {
    d.close();
    d.remove();
  };
  d.addEventListener("cancel", (e) => { e.preventDefault(); close(); });
  on(d, "click", "[data-close]", close);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!onSubmit) return close();
    const btn = d.querySelector("[data-submit]");
    err.textContent = "";
    btn && (btn.disabled = true);
    try {
      const keep = await onSubmit(form, d);
      if (keep !== false) close();
    } catch (ex) {
      console.error(ex);
      err.textContent = ex.message || "Algo deu errado.";
    } finally {
      btn && (btn.disabled = false);
    }
  });
  d.showModal();
  d.closeModal = close;
  onOpen?.(d);
  const first = d.querySelector("[autofocus]") || d.querySelector(".modal-b input, .modal-b select");
  first?.focus();
  return d;
}

export function confirmDialog(title, text, { submit = "Confirmar", danger = true } = {}) {
  return new Promise((resolve) => {
    const d = modal({
      title,
      body: `<p class="soft">${text}</p>`,
      submit,
      danger,
      onSubmit: () => resolve(true),
    });
    d.addEventListener("close", () => resolve(false));
  });
}

/** Lê um form como objeto simples (checkbox -> boolean). */
export function formData(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === "checkbox") out[el.name] = el.checked;
    else if (el.type === "radio") { if (el.checked) out[el.name] = el.value; }
    else out[el.name] = el.value.trim();
  }
  return out;
}

export const opt = (value, label, selected) =>
  `<option value="${esc(value)}"${String(value) === String(selected) ? " selected" : ""}>${esc(label)}</option>`;

export function pageHead(title, sub = "", actions = "", crumb = "") {
  return `<div class="page-head"><div>${crumb ? `<div class="crumb">${esc(crumb)}</div>` : ""}<h1>${esc(title)}</h1>${sub ? `<p>${sub}</p>` : ""}</div><div class="row wrap">${actions}</div></div>`;
}

export function tabs(items, active) {
  return `<nav class="tabs">${items.map(([href, label]) => `<a href="${href}" class="${href === active ? "active" : ""}">${esc(label)}</a>`).join("")}</nav>`;
}

export function empty(text, ic = "info") {
  return `<div class="empty">${icon(ic)}<div>${text}</div></div>`;
}

export function stat(label, value, foot = "", extra = "") {
  return `<div class="card stat ${extra}"><span class="stat-label">${esc(label)}</span><span class="stat-value">${value}</span>${foot ? `<span class="stat-foot">${foot}</span>` : ""}</div>`;
}

/** Badge de CMV% vs. alvo e alerta configurados */
export function cmvBadge(pctValue, cfg) {
  const v = `${pctValue.toFixed(1).replace(".", ",")}%`;
  if (!Number.isFinite(pctValue) || pctValue === 0) return `<span class="badge">—</span>`;
  if (pctValue > cfg.alert_percent) return `<span class="badge bad">${icon("alert")}${v}</span>`;
  if (pctValue > cfg.target_percent) return `<span class="badge warn">${v}</span>`;
  return `<span class="badge good">${icon("check")}${v}</span>`;
}

export function meter(value, target, alert, max = Math.max(60, alert + 15)) {
  const tone = value > alert ? "bad" : value > target ? "warn" : "";
  return `<div class="meter ${tone}" role="img" aria-label="CMV ${value.toFixed(1)}% com alvo de ${target}%">
    <span style="width:${Math.min(100, (value / max) * 100)}%"></span>
    <i class="target" style="left:${(target / max) * 100}%"></i></div>
    <div class="meter-legend"><span>0%</span><span>alvo ${target}%</span><span>${max}%</span></div>`;
}

/** Botão desabilita enquanto a promessa roda */
export async function busy(btn, fn) {
  if (btn.disabled) return;
  btn.disabled = true;
  try {
    return await fn();
  } finally {
    btn.disabled = false;
  }
}
