import { state, subscribe, method } from "../store.js";
import { openCash, cashMovement, closeCash, expectedCash, listWhere } from "../services.js";
import { fb } from "../firebase.js";
import { money, esc, parseMoney, fmtDate, centsToInput } from "../format.js";
import { icon, pageHead, empty, on, $, modal, toast } from "../ui.js";

export const title = "Caixa";

const NOTES = [20000, 10000, 5000, 2000, 1000, 500, 200, 100, 50, 25, 10, 5];

export default async function (el) {
  let history = [];

  async function loadHistory() {
    history = await listWhere("cashSessions", fb.where("status", "==", "fechado"), fb.orderBy("openedAtIso", "desc"), fb.limit(15)).catch(() => []);
    render();
  }

  const t = (iso) => (iso ? new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "—");

  function render() {
    const s = state.session;
    const body = s
      ? (() => {
          const exp = expectedCash(s);
          const totals = Object.entries(s.totals ?? {}).filter(([, v]) => v).map(([k, v]) => [method(k)?.name ?? k, v]);
          return `
          <div class="grid g4" style="margin-bottom:var(--s-4)">
            <div class="card stat tone-brand"><span class="stat-label">Dinheiro na gaveta (esperado)</span><span class="stat-value hero">${money(exp)}</span></div>
            <div class="card stat"><span class="stat-label">Vendas</span><span class="stat-value">${s.salesCount ?? 0}</span><span class="stat-foot">${money(s.revenue ?? 0)}</span></div>
            <div class="card stat"><span class="stat-label">Fundo de caixa</span><span class="stat-value">${money(s.opening)}</span><span class="stat-foot">aberto às ${t(s.openedAtIso)} por ${esc(s.openedByName)}</span></div>
            <div class="card stat"><span class="stat-label">Sangrias / suprimentos</span><span class="stat-value">${money((s.suprimentos || 0) - (s.sangrias || 0))}</span><span class="stat-foot">− ${money(s.sangrias || 0)} / + ${money(s.suprimentos || 0)}</span></div>
          </div>
          <div class="grid g2">
            <div class="card"><div class="card-h"><h3>Recebido por forma de pagamento</h3></div><div class="card-b flush">
              ${totals.length ? `<table class="t"><tbody>${totals.map(([n, v]) => `<tr><td>${esc(n)}</td><td class="num">${money(v)}</td></tr>`).join("")}</tbody></table>` : empty("Nenhuma venda ainda neste caixa.")}</div></div>
            <div class="card"><div class="card-h"><h3>Movimentações</h3></div><div class="card-b flush">
              ${s.movements?.length ? `<table class="t"><tbody>${[...s.movements].reverse().map((m) => `<tr><td>${t(m.at)}</td><td><span class="badge ${m.type === "sangria" ? "warn" : "info"}">${m.type}</span></td><td class="small soft">${esc(m.reason)} · ${esc(m.by)}</td><td class="num">${m.type === "sangria" ? "−" : "+"} ${money(m.amount)}</td></tr>`).join("")}</tbody></table>` : empty("Sem sangrias ou suprimentos.")}</div></div>
          </div>`;
        })()
      : `<div class="card"><div class="card-b stack" style="align-items:flex-start">
          <h3>Caixa fechado</h3><p class="soft small">Abra o caixa informando o fundo de troco pra começar a vender no PDV.</p>
          <div class="row"><div class="affix pre" style="width:180px"><i>R$</i><input class="input num" data-opening inputmode="decimal" value="0,00" aria-label="Fundo de caixa"></div>
          <button class="btn brand" data-open>${icon("caixa")}Abrir caixa</button></div></div></div>`;

    el.innerHTML = `
      ${pageHead("Caixa", s ? `Aberto desde ${fmtDate(s.day)} às ${t(s.openedAtIso)}` : "Abertura, sangria, suprimento e fechamento com conferência.",
        s ? `<button class="btn" data-mov="suprimento">${icon("plus")}Suprimento</button><button class="btn" data-mov="sangria">${icon("minus")}Sangria</button><button class="btn primary" data-close>${icon("lock")}Fechar caixa</button>` : "")}
      ${body}
      <div class="card" style="margin-top:var(--s-4)"><div class="card-h"><h3>Fechamentos anteriores</h3></div><div class="card-b flush">
        ${history.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Dia</th><th>Horário</th><th>Operador</th><th class="num">Vendas</th><th class="num">Esperado</th><th class="num">Contado</th><th class="num">Diferença</th></tr></thead><tbody>
          ${history.map((h) => `<tr><td>${fmtDate(h.day)}</td><td class="small">${t(h.openedAtIso)}–${t(h.closedAtIso)}</td><td class="small">${esc(h.openedByName)}${h.closedByName && h.closedByName !== h.openedByName ? ` / ${esc(h.closedByName)}` : ""}</td>
            <td class="num">${money(h.revenue || 0)}</td><td class="num">${money(h.expected)}</td><td class="num">${money(h.counted)}</td>
            <td class="num"><span class="badge ${h.difference === 0 ? "good" : Math.abs(h.difference) <= 200 ? "warn" : "bad"}">${h.difference > 0 ? "+" : ""}${money(h.difference)}</span></td></tr>`).join("")}
        </tbody></table></div>` : empty("Nenhum caixa fechado ainda.")}</div></div>`;
  }

  function closeModal() {
    const s = state.session;
    const exp = expectedCash(s);
    modal({
      title: "Fechar caixa",
      submit: "Fechar caixa",
      wide: true,
      body: `<div class="grid g2">
        <div><p class="small soft" style="margin-bottom:var(--s-3)">Conte o dinheiro da gaveta. Pode usar a contagem por cédula ou digitar o total direto.</p>
          <div class="grid" style="grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--s-2)">
          ${NOTES.map((n) => `<label class="field"><span>${money(n)}</span><input class="input sm num" data-note="${n}" inputmode="numeric" placeholder="0"></label>`).join("")}</div></div>
        <div class="stack">
          <label class="field"><span>Total contado</span><div class="affix pre"><i>R$</i><input class="input num" name="counted" inputmode="decimal" required></div></label>
          <div class="card" style="box-shadow:none"><div class="card-b stack tight">
            <div class="row between small"><span>Esperado</span><b class="num">${money(exp)}</b></div>
            <div class="row between"><span>Diferença</span><b class="num" data-diff>—</b></div></div></div>
          <label class="field"><span>Observações</span><textarea class="input" name="notes" rows="2"></textarea></label>
        </div></div>`,
      onOpen: (d) => {
        const counted = $("[name=counted]", d);
        const upd = () => {
          const v = parseMoney(counted.value);
          const diff = v - exp;
          $("[data-diff]", d).innerHTML = counted.value ? `<span class="${diff === 0 ? "good" : "bad"}">${diff > 0 ? "+" : ""}${money(diff)}</span>` : "—";
        };
        on(d, "input", "[data-note]", () => {
          let sum = 0;
          d.querySelectorAll("[data-note]").forEach((i) => (sum += (parseInt(i.value, 10) || 0) * Number(i.dataset.note)));
          counted.value = centsToInput(sum);
          upd();
        });
        on(d, "input", "[name=counted]", upd);
      },
      onSubmit: async (form) => {
        if (!form.elements.counted.value) throw new Error("Informe o total contado.");
        const r = await closeCash(parseMoney(form.elements.counted.value), form.elements.notes.value);
        toast(r.difference === 0 ? "Caixa fechado. Bateu certinho!" : `Caixa fechado com diferença de ${money(r.difference)}.`, r.difference === 0 ? "good" : "");
        loadHistory();
      },
    });
  }

  const offs = [
    on(el, "click", "[data-open]", async () => {
      try { await openCash(parseMoney($("[data-opening]", el).value)); toast("Caixa aberto.", "good"); } catch (e) { toast(e.message, "bad"); }
    }),
    on(el, "click", "[data-mov]", (_e, b) => {
      const type = b.dataset.mov;
      modal({
        title: type === "sangria" ? "Sangria (retirada)" : "Suprimento (entrada de troco)",
        body: `<div class="stack"><label class="field"><span>Valor</span><div class="affix pre"><i>R$</i><input class="input num" name="v" inputmode="decimal" autofocus></div></label>
          <label class="field"><span>Motivo</span><input class="input" name="r" placeholder="${type === "sangria" ? "Ex.: depósito, pagamento do gás" : "Ex.: troco extra"}"></label></div>`,
        onSubmit: async (f) => { await cashMovement(type, parseMoney(f.elements.v.value), f.elements.r.value); toast("Movimento registrado.", "good"); },
      });
    }),
    on(el, "click", "[data-close]", closeModal),
    subscribe((k) => k === "session" && render()),
  ];
  render();
  loadHistory();
  return () => offs.forEach((f) => f());
}
