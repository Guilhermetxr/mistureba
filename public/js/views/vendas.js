import { state, isAdmin } from "../store.js";
import { cancelSale } from "../services.js";
import { db, fb } from "../firebase.js";
import { money, pct, ratio, esc, isoDate, fmtTs, CHANNELS } from "../format.js";
import { icon, pageHead, empty, on, $, modal, toast } from "../ui.js";
import { printReceipt } from "../receipt.js";

export const title = "Vendas";

export default async function (el) {
  const admin = isAdmin();
  let day = isoDate();
  let channel = "";
  let sales = [];
  let unsub = null;

  el.innerHTML = `
    ${pageHead("Vendas", "Todas as vendas do dia, com cancelamento e reimpressão.",
      `${admin ? `<input class="input" type="date" data-day value="${day}" aria-label="Dia" style="width:auto">` : ""}
       <select class="select" data-ch style="width:auto" aria-label="Canal"><option value="">Todos os canais</option>${Object.entries(CHANNELS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select>`)}
    <div class="grid g4" data-kpis style="margin-bottom:var(--s-4)"></div>
    <div class="card"><div class="card-b flush" data-list></div></div>`;

  function listen() {
    unsub?.();
    unsub = fb.onSnapshot(fb.query(fb.collection(db, "sales"), fb.where("day", "==", day), fb.orderBy("clientAt", "desc")), (snap) => {
      sales = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      render();
    }, (e) => { $("[data-list]", el).innerHTML = `<div class="alert bad" style="margin:var(--s-4)">${icon("alert")}${esc(e.message)}</div>`; });
  }

  function render() {
    const list = sales.filter((s) => !channel || s.channel === channel);
    const ok = list.filter((s) => s.status !== "cancelada");
    const rev = ok.reduce((s, x) => s + x.total, 0);
    const cost = ok.reduce((s, x) => s + x.cost, 0);
    const canceled = list.filter((s) => s.status === "cancelada");
    $("[data-kpis]", el).innerHTML = `
      <div class="card stat"><span class="stat-label">Faturamento</span><span class="stat-value">${money(rev)}</span></div>
      <div class="card stat"><span class="stat-label">Pedidos</span><span class="stat-value">${ok.length}</span><span class="stat-foot">ticket médio ${money(ok.length ? Math.round(rev / ok.length) : 0)}</span></div>
      ${admin ? `<div class="card stat"><span class="stat-label">CMV teórico</span><span class="stat-value">${pct(ratio(cost, rev))}</span><span class="stat-foot">${money(cost)}</span></div>` : ""}
      <div class="card stat"><span class="stat-label">Cancelados</span><span class="stat-value ${canceled.length ? "bad" : ""}">${canceled.length}</span><span class="stat-foot">${money(canceled.reduce((s, x) => s + x.total, 0))}</span></div>`;
    $("[data-list]", el).innerHTML = list.length
      ? `<div class="table-wrap"><table class="t"><thead><tr><th>Nº</th><th>Hora</th><th>Canal</th><th>Itens</th><th>Pagamento</th><th class="num">Total</th>${admin ? `<th class="num">CMV</th>` : ""}<th>Status</th></tr></thead><tbody>
        ${list.map((s) => `<tr class="click ${s.status === "cancelada" ? "dim" : ""}" data-sale="${s.id}">
          <td class="strong">${s.ifoodDisplayId ? `#${esc(s.ifoodDisplayId)}` : s.number ?? "—"}</td><td>${fmtTs(s.createdAt ?? s.clientAt, false)}</td>
          <td><span class="badge ${s.channel === "ifood" ? "bad" : s.channel === "delivery" ? "info" : ""}">${CHANNELS[s.channel]}</span></td>
          <td class="small">${esc(s.items.map((i) => `${i.qty}× ${i.name}`).join(", ")).slice(0, 80)}${s.customer ? ` <span class="muted">· ${esc(s.customer)}</span>` : ""}</td>
          <td class="small soft">${esc(s.payments.map((p) => p.name).join(" + "))}</td><td class="num strong">${money(s.total)}</td>
          ${admin ? `<td class="num">${pct(ratio(s.cost, s.total))}</td>` : ""}
          <td>${s.status === "cancelada" ? `<span class="badge bad">cancelada</span>` : `<span class="badge good">ok</span>`}</td></tr>`).join("")}
        </tbody></table></div>`
      : empty("Nenhuma venda neste dia.", "receipt");
  }

  function detail(s) {
    const net = s.total - s.fees - s.commission - s.cost;
    modal({
      title: `Venda ${s.ifoodDisplayId ? `iFood #${s.ifoodDisplayId}` : `nº ${s.number ?? ""}`}`,
      submit: "",
      cancel: "Fechar",
      wide: true,
      footer: `<button type="button" class="btn" data-print>${icon("printer")}Reimprimir</button>${s.status !== "cancelada" && (admin || s.cashSessionId === state.session?.id) ? `<button type="button" class="btn danger" data-cancel>${icon("x")}Cancelar venda</button>` : ""}`,
      body: `<div class="stack">
        <div class="row wrap small soft"><span>${fmtTs(s.createdAt ?? s.clientAt)}</span>·<span>${CHANNELS[s.channel]}</span>·<span>${esc(s.userName || "")}</span>${s.customer ? `·<b>${esc(s.customer)}</b>` : ""}</div>
        ${s.status === "cancelada" ? `<div class="alert bad">${icon("alert")}<div>Cancelada por ${esc(s.canceledBy ?? "")}${s.cancelReason ? `: ${esc(s.cancelReason)}` : ""}</div></div>` : ""}
        <table class="t"><thead><tr><th>Item</th><th class="num">Qtd.</th><th class="num">Preço</th>${admin ? `<th class="num">Custo</th>` : ""}<th class="num">Total</th></tr></thead><tbody>
          ${s.items.map((i) => `<tr><td>${esc(i.name)}${i.notes ? `<div class="xs muted">» ${esc(i.notes)}</div>` : ""}${admin && !i.productId ? ` <span class="badge warn">sem ficha</span>` : ""}</td><td class="num">${i.qty}</td><td class="num">${money(i.price)}</td>${admin ? `<td class="num muted">${money(i.cost * i.qty)}</td>` : ""}<td class="num">${money(i.qty * i.price)}</td></tr>`).join("")}
        </tbody></table>
        <div class="grid g2">
          <table class="t"><tbody>
            <tr><td>Subtotal</td><td class="num">${money(s.subtotal)}</td></tr>
            ${s.discount ? `<tr><td>Desconto</td><td class="num">− ${money(s.discount)}</td></tr>` : ""}
            ${s.deliveryFee ? `<tr><td>Entrega</td><td class="num">${money(s.deliveryFee)}</td></tr>` : ""}
            <tr><td><b>Total</b></td><td class="num"><b>${money(s.total)}</b></td></tr>
            ${s.payments.map((p) => `<tr><td class="soft">${esc(p.name)}${p.change ? ` (troco ${money(p.change)})` : ""}</td><td class="num">${money(p.amount)}</td></tr>`).join("")}
          </tbody></table>
          ${admin ? `<table class="t"><tbody>
            <tr><td>− CMV</td><td class="num">${money(s.cost)} <span class="muted xs">${pct(ratio(s.cost, s.total))}</span></td></tr>
            <tr><td>− Taxas de pagamento</td><td class="num">${money(s.fees)}</td></tr>
            ${s.commission ? `<tr><td>− Comissão iFood</td><td class="num">${money(s.commission)}</td></tr>` : ""}
            <tr><td><b>Sobra (antes de impostos e fixos)</b></td><td class="num ${net < 0 ? "bad" : "good"}"><b>${money(net)}</b></td></tr>
          </tbody></table>` : ""}
        </div>
        ${s.notes ? `<p class="small"><b>Obs:</b> ${esc(s.notes)}</p>` : ""}</div>`,
      onOpen: (d) => {
        on(d, "click", "[data-print]", () => printReceipt(s));
        on(d, "click", "[data-cancel]", () => {
          d.closeModal();
          modal({
            title: "Cancelar venda",
            submit: "Cancelar venda",
            danger: true,
            cancel: "Voltar",
            body: `<p class="small soft" style="margin-bottom:var(--s-3)">Os insumos voltam pro estoque e o valor sai do caixa e dos relatórios. Se foi no cartão, estorne também na maquininha.</p>
              <label class="field"><span>Motivo</span><input class="input" name="r" required autofocus placeholder="Ex.: cliente desistiu, lançado errado"></label>`,
            onSubmit: async (f) => {
              if (!f.elements.r.value.trim()) throw new Error("Informe o motivo.");
              await cancelSale(s, f.elements.r.value.trim());
              toast("Venda cancelada.", "good");
            },
          });
        });
      },
    });
  }

  const offs = [
    on(el, "change", "[data-day]", (e) => { day = e.target.value || isoDate(); listen(); }),
    on(el, "change", "[data-ch]", (e) => { channel = e.target.value; render(); }),
    on(el, "click", "[data-sale]", (_e, t) => detail(sales.find((s) => s.id === t.dataset.sale))),
  ];
  listen();
  return () => { offs.forEach((f) => f()); unsub?.(); };
}
