// Cupom não fiscal / comanda para impressora térmica (80mm) via iframe.
import { state } from "./store.js";
import { money, esc, CHANNELS } from "./format.js";

export function printReceipt(sale, { kitchen = false } = {}) {
  const co = state.settings.company;
  const when = new Date(sale.clientAt ?? Date.now()).toLocaleString("pt-BR");
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: 80mm auto; margin: 4mm; }
    body { font: 12px/1.35 ui-monospace, "Courier New", monospace; color: #000; width: 72mm; margin: 0; }
    h1 { font-size: 15px; text-align: center; margin: 0 0 2px; }
    .c { text-align: center; } .r { text-align: right; } .b { font-weight: 700; }
    hr { border: 0; border-top: 1px dashed #000; margin: 6px 0; }
    table { width: 100%; border-collapse: collapse; } td { vertical-align: top; padding: 1px 0; }
    .big { font-size: 22px; font-weight: 800; text-align: center; margin: 4px 0; }
    .obs { font-size: 11px; padding-left: 10px; }
  </style></head><body>
    ${kitchen ? `<div class="big">PEDIDO ${esc(sale.number ?? "")}</div>` : `<h1>${esc(co.name)}</h1>${co.cnpj ? `<div class="c">CNPJ ${esc(co.cnpj)}</div>` : ""}${co.address ? `<div class="c">${esc(co.address)}</div>` : ""}`}
    <div class="c">${esc(CHANNELS[sale.channel] ?? "")} · ${when}</div>
    ${sale.customer ? `<div class="c b">${esc(sale.customer)}</div>` : ""}
    ${kitchen ? "" : `<div class="c">Pedido nº ${esc(sale.number ?? "")}</div>`}
    <hr>
    <table>${sale.items.map((i) => `<tr><td>${i.qty}x ${esc(i.name)}</td>${kitchen ? "" : `<td class="r">${money(i.qty * i.price)}</td>`}</tr>${i.notes ? `<tr><td class="obs" colspan="2">» ${esc(i.notes)}</td></tr>` : ""}`).join("")}</table>
    ${sale.notes ? `<hr><div>Obs: ${esc(sale.notes)}</div>` : ""}
    ${kitchen ? "" : `<hr><table>
      <tr><td>Subtotal</td><td class="r">${money(sale.subtotal)}</td></tr>
      ${sale.discount ? `<tr><td>Desconto</td><td class="r">-${money(sale.discount)}</td></tr>` : ""}
      ${sale.deliveryFee ? `<tr><td>Entrega</td><td class="r">${money(sale.deliveryFee)}</td></tr>` : ""}
      <tr class="b"><td>TOTAL</td><td class="r">${money(sale.total)}</td></tr>
      ${sale.payments.map((p) => `<tr><td>${esc(p.name)}</td><td class="r">${money(p.received ?? p.amount)}</td></tr>`).join("")}
      ${sale.payments.some((p) => p.change) ? `<tr><td>Troco</td><td class="r">${money(sale.payments.reduce((s, p) => s + (p.change || 0), 0))}</td></tr>` : ""}
    </table><hr><div class="c">Documento sem valor fiscal</div><div class="c">Obrigado e volte sempre!</div>`}
  </body></html>`;
  const f = document.createElement("iframe");
  f.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  document.body.append(f);
  f.contentDocument.open();
  f.contentDocument.write(html);
  f.contentDocument.close();
  setTimeout(() => {
    f.contentWindow.focus();
    f.contentWindow.print();
    setTimeout(() => f.remove(), 1500);
  }, 150);
}
