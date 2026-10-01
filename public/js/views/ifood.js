import { state, sellable } from "../store.js";
import { db, fb, functions } from "../firebase.js";
import { money, pct, ratio, esc, isoDate, fmtTs } from "../format.js";
import { icon, pageHead, empty, on, $, toast, busy } from "../ui.js";

export const title = "iFood";

const STATUS = { PLACED: ["Novo", "warn"], CONFIRMED: ["Confirmado", "info"], DISPATCHED: ["Saiu p/ entrega", "info"], READY_TO_PICKUP: ["Pronto p/ retirada", "info"], CONCLUDED: ["Concluído", "good"], CANCELLED: ["Cancelado", "bad"] };

export default async function (el) {
  const cfg = state.settings.ifood;
  let orders = [];
  let logs = [];

  el.innerHTML = `
    ${pageHead("iFood", cfg.enabled ? "Pedidos entram sozinhos, baixam estoque pela ficha técnica e já calculam comissão e CMV." : "Integração desligada — lance pedidos do iFood pelo PDV no canal iFood, ou ative a integração.",
      `${cfg.enabled ? `<button class="btn" data-poll>${icon("refresh")}Buscar pedidos agora</button>` : ""}<a class="btn" href="#/config/ifood">${icon("gear")}Configurar</a>`)}
    <div class="grid g4" data-kpis style="margin-bottom:var(--s-4)"></div>
    <div class="grid" style="grid-template-columns:minmax(0,2fr) minmax(0,1fr);align-items:start">
      <div class="card"><div class="card-h"><h3>Pedidos de hoje</h3></div><div class="card-b flush" data-orders></div></div>
      <div class="stack">
        <div class="card"><div class="card-h"><h3>Produtos sem código iFood</h3></div><div class="card-b flush" data-map></div></div>
        <div class="card"><div class="card-h"><h3>Log da integração</h3></div><div class="card-b flush" data-log></div></div>
      </div>
    </div>`;

  function render() {
    const ok = orders.filter((o) => o.status !== "cancelada");
    const rev = ok.reduce((s, o) => s + o.total, 0);
    const comm = ok.reduce((s, o) => s + o.commission + o.fees, 0);
    const cost = ok.reduce((s, o) => s + o.cost, 0);
    $("[data-kpis]", el).innerHTML = `
      <div class="card stat"><span class="stat-label">Integração</span><span class="stat-value">${cfg.enabled ? `<span class="good">Ligada</span>` : `<span class="muted">Desligada</span>`}</span><span class="stat-foot">comissão ${pct(cfg.commission_percent)} + ${pct(cfg.payment_fee_percent)}</span></div>
      <div class="card stat"><span class="stat-label">Pedidos hoje</span><span class="stat-value">${ok.length}</span><span class="stat-foot">${money(rev)}</span></div>
      <div class="card stat"><span class="stat-label">Fica com o iFood</span><span class="stat-value bad">${money(comm)}</span><span class="stat-foot">${pct(ratio(comm, rev))} do faturamento iFood</span></div>
      <div class="card stat"><span class="stat-label">CMV iFood</span><span class="stat-value">${pct(ratio(cost, rev))}</span><span class="stat-foot">sobra ${money(rev - comm - cost)}</span></div>`;
    $("[data-orders]", el).innerHTML = orders.length
      ? `<div class="table-wrap"><table class="t"><thead><tr><th>Pedido</th><th>Hora</th><th>Cliente / itens</th><th class="num">Total</th><th>Status</th><th></th></tr></thead><tbody>
        ${orders.map((o) => {
          const st = STATUS[o.ifoodStatus] ?? [o.ifoodStatus ?? (o.status === "cancelada" ? "Cancelado" : "Manual"), o.status === "cancelada" ? "bad" : ""];
          const unmapped = o.items.filter((i) => !i.productId).length;
          return `<tr class="${o.status === "cancelada" ? "dim" : ""}"><td class="strong">#${esc(o.ifoodDisplayId ?? o.number ?? "")}</td><td>${fmtTs(o.createdAt ?? o.clientAt, false)}</td>
            <td class="small"><b>${esc(o.customer || "")}</b> ${esc(o.items.map((i) => `${i.qty}× ${i.name}`).join(", ")).slice(0, 90)}${unmapped ? ` <span class="badge warn">${unmapped} sem ficha</span>` : ""}</td>
            <td class="num">${money(o.total)}</td><td><span class="badge ${st[1]}">${st[0]}</span></td>
            <td class="act">${o.ifoodOrderId && o.status !== "cancelada" ? actions(o) : ""}</td></tr>`;
        }).join("")}</tbody></table></div>`
      : empty(cfg.enabled ? "Nenhum pedido do iFood hoje ainda." : "Nenhum pedido iFood lançado hoje.", "bike");
    const unm = sellable().filter((p) => !p.ifoodCode && p.category !== "Adicionais");
    $("[data-map]", el).innerHTML = unm.length
      ? `<div class="list">${unm.slice(0, 12).map((p) => `<a class="list-item" href="#/cmv/fichas/${p.id}" style="text-decoration:none">${esc(p.name)}<span class="muted xs" style="margin-left:auto">definir →</span></a>`).join("")}${unm.length > 12 ? `<div class="list-item muted xs">+ ${unm.length - 12} outros</div>` : ""}</div>`
      : `<p class="small good" style="padding:var(--s-4) var(--s-5)">${icon("check")} Todos os produtos estão ligados ao iFood.</p>`;
    $("[data-log]", el).innerHTML = logs.length
      ? `<div class="list">${logs.map((l) => `<div class="list-item small"><span class="${l.level === "error" ? "bad" : "muted"}">${fmtTs(l.at)}</span><span class="grow">${esc(l.message)}</span></div>`).join("")}</div>`
      : `<p class="small muted" style="padding:var(--s-4) var(--s-5)">Sem registros.</p>`;
  }

  function actions(o) {
    const s = o.ifoodStatus;
    const btn = (action, label, cls = "") => `<button class="btn sm ${cls}" data-act="${action}" data-order="${esc(o.ifoodOrderId)}">${label}</button>`;
    if (s === "PLACED") return btn("confirm", "Confirmar", "brand");
    if (s === "CONFIRMED") return btn("dispatch", "Despachar") + " " + btn("readyToPickup", "Pronto");
    return "";
  }

  const unsubs = [
    fb.onSnapshot(fb.query(fb.collection(db, "sales"), fb.where("day", "==", isoDate()), fb.where("channel", "==", "ifood")), (snap) => {
      orders = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (b.clientAt ?? "").localeCompare(a.clientAt ?? ""));
      render();
    }),
    fb.onSnapshot(fb.query(fb.collection(db, "integrationLog"), fb.where("source", "==", "ifood"), fb.orderBy("at", "desc"), fb.limit(15)), (snap) => {
      logs = snap.docs.map((d) => d.data());
      render();
    }, () => {}),
  ];

  const offs = [
    on(el, "click", "[data-poll]", (_e, b) => busy(b, async () => {
      try { const r = await fb.httpsCallable(functions, "ifoodPollNow")(); toast(`${r.data.imported ?? 0} pedido(s) novo(s).`, "good"); } catch (e) { toast(e.message, "bad"); }
    })),
    on(el, "click", "[data-act]", (_e, b) => busy(b, async () => {
      try { await fb.httpsCallable(functions, "ifoodAction")({ orderId: b.dataset.order, action: b.dataset.act }); toast("Enviado ao iFood.", "good"); } catch (e) { toast(e.message, "bad"); }
    })),
  ];
  render();
  return () => { offs.forEach((f) => f()); unsubs.forEach((u) => u()); };
}
