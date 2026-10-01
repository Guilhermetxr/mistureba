import { state, subscribe, sellable, method, isAdmin } from "../store.js";
import { createSale, openCash } from "../services.js";
import { functions, fb, db } from "../firebase.js";
import { money, esc, parseMoney, centsToInput, CHANNELS, KIND_LABEL } from "../format.js";
import { icon, on, $, $$, modal, toast, busy } from "../ui.js";
import { printReceipt } from "../receipt.js";

export const title = "PDV";

export default async function (el) {
  const cart = { channel: "balcao", items: [], customer: "", notes: "", discount: 0, discountPct: false, deliveryFee: 0 };
  let cat = "";
  let search = "";

  el.innerHTML = `
    <div class="pdv">
      <section class="pdv-catalog">
        <div class="pdv-top">
          <label class="search grow">${icon("search")}<input class="input" data-search placeholder="Buscar produto ou código…  ( / )" aria-label="Buscar produto" autocomplete="off"></label>
          <div class="seg" data-channels>${Object.entries(CHANNELS).map(([k, v]) => `<button data-channel="${k}">${v}</button>`).join("")}</div>
        </div>
        <div class="cats" data-cats></div>
        <div class="prod-grid" data-grid></div>
      </section>
      <aside class="pdv-cart">
        <div class="cart-head">
          <div class="row between"><b>Pedido</b><span class="small soft" data-session></span></div>
          <input class="input" data-customer placeholder="Nome do cliente / mesa (opcional)" aria-label="Nome do cliente">
        </div>
        <div class="cart-items" data-items></div>
        <div class="cart-foot" data-foot></div>
      </aside>
    </div>`;

  const price = (p) => (cart.channel === "ifood" && p.ifoodPrice ? p.ifoodPrice : p.price);
  const subtotal = () => cart.items.reduce((s, i) => s + i.qty * i.price, 0);
  const discount = () => Math.min(subtotal(), cart.discountPct ? Math.round((subtotal() * cart.discount) / 100) : cart.discount);
  const total = () => subtotal() - discount() + (cart.channel === "delivery" ? cart.deliveryFee : 0);

  function products() {
    const needle = search.trim().toLowerCase();
    const order = categories();
    return sellable()
      .filter((p) => (!cat || p.category === cat) && (!needle || p.name.toLowerCase().includes(needle) || (p.code && p.code.toLowerCase() === needle)))
      .sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category) || a.name.localeCompare(b.name, "pt-BR"));
  }

  // Adicionais sempre por último
  function categories() {
    return [...new Set(sellable().map((p) => p.category))].sort((a, b) => (a === "Adicionais") - (b === "Adicionais") || a.localeCompare(b, "pt-BR"));
  }

  function renderCatalog() {
    $$("[data-channel]", el).forEach((b) => b.classList.toggle("active", b.dataset.channel === cart.channel));
    const cats = categories();
    $("[data-cats]", el).innerHTML = `<button data-cat="" class="${!cat ? "active" : ""}">Tudo</button>` + cats.map((c) => `<button data-cat="${esc(c)}" class="${c === cat ? "active" : ""}">${esc(c)}</button>`).join("");
    const list = products();
    const inCart = new Map(cart.items.map((i) => [i.productId, (i.qty || 0)]));
    $("[data-grid]", el).innerHTML = list.length
      ? list.map((p) => `<button class="prod" data-add="${p.id}"><b>${esc(p.name)}</b>
          <span class="row between"><span class="price">${money(price(p))}</span>${inCart.get(p.id) ? `<span class="badge brand qty-tag">${inCart.get(p.id)}×</span>` : ""}</span></button>`).join("")
      : `<div class="empty" style="grid-column:1/-1">${icon("search")}<div>Nenhum produto encontrado.</div></div>`;
  }

  function renderCart() {
    const s = state.session;
    $("[data-session]", el).innerHTML = cart.channel === "ifood" ? "Pedido iFood" : s ? `Caixa aberto · ${s.salesCount ?? 0} venda(s)` : `<span class="bad">Caixa fechado</span>`;
    $("[data-items]", el).innerHTML = cart.items.length
      ? cart.items.map((i, idx) => `<div class="cart-item">
          <button class="name" data-note="${idx}" style="all:unset;cursor:pointer" title="Adicionar observação"><span class="name">${esc(i.name)}</span></button>
          <span class="num strong">${money(i.qty * i.price)}</span>
          <div class="row"><div class="qty"><button data-dec="${idx}" aria-label="Diminuir">−</button><span>${i.qty}</span><button data-inc="${idx}" aria-label="Aumentar">+</button></div>
            <span class="xs muted">${money(i.price)} un.</span></div>
          <button class="btn ghost sm icon" data-rm="${idx}" aria-label="Remover ${esc(i.name)}" style="justify-self:end">${icon("trash")}</button>
          ${i.notes ? `<span class="obs">» ${esc(i.notes)}</span>` : ""}</div>`).join("")
      : `<div class="empty">${icon("pdv")}<div>Toque nos produtos para montar o pedido.</div></div>`;
    const blocked = cart.channel !== "ifood" && !s;
    $("[data-foot]", el).innerHTML = `
      <div class="cart-line"><span>Subtotal</span><span class="num">${money(subtotal())}</span></div>
      <div class="cart-line"><button class="btn ghost sm" data-discount style="padding:0">${discount() ? "Desconto" : "+ Desconto"}</button><span class="num">${discount() ? `− ${money(discount())}` : ""}</span></div>
      ${cart.channel === "delivery" ? `<div class="cart-line"><span>Taxa de entrega</span><div class="affix pre" style="width:120px"><i>R$</i><input class="input sm num" data-fee inputmode="decimal" value="${centsToInput(cart.deliveryFee)}" aria-label="Taxa de entrega"></div></div>` : ""}
      <div class="cart-total"><span>Total</span><span class="num">${money(total())}</span></div>
      ${blocked ? `<button class="btn brand lg block" data-open-cash>${icon("caixa")}Abrir caixa para vender</button>`
        : `<div class="row"><button class="btn lg" data-clear ${cart.items.length ? "" : "disabled"} aria-label="Limpar pedido">${icon("x")}</button>
           <button class="btn brand lg grow" data-pay ${cart.items.length ? "" : "disabled"}>Cobrar ${money(total())} <kbd style="background:transparent;color:#fff;border-color:rgba(255,255,255,.5)">F9</kbd></button></div>`}`;
  }

  function render() { renderCatalog(); renderCart(); }

  function add(pid) {
    const p = state.products.find((x) => x.id === pid);
    if (!p) return;
    const existing = cart.items.find((i) => i.productId === pid && !i.notes);
    if (existing) existing.qty++;
    else cart.items.push({ productId: pid, name: p.name, price: price(p), qty: 1, notes: "" });
    render();
  }

  function reset() {
    Object.assign(cart, { items: [], customer: "", notes: "", discount: 0, discountPct: false, deliveryFee: 0 });
    $("[data-customer]", el).value = "";
    search = "";
    $("[data-search]", el).value = "";
    render();
  }

  /* ---------- Pagamento ---------- */
  function payModal() {
    const due = total();
    const payments = [];
    const stoneCfg = state.settings.stone;
    const methods = state.methods.filter((m) => m.active !== false && (cart.channel === "ifood" || m.kind !== "ifood"));
    const remaining = () => due - payments.reduce((s, p) => s + p.amount, 0);
    let unsubCharge = null;

    const d = modal({
      title: `Cobrar ${money(due)}`,
      submit: "Finalizar venda",
      body: `<div class="stack">
        <div class="row between"><div><div class="lbl">Falta receber</div><div class="big-remaining num" data-rem></div></div>
          <div class="field" style="width:170px"><span>Valor desta parte</span><div class="affix pre"><i>R$</i><input class="input num" data-amount inputmode="decimal" autofocus></div></div></div>
        <div class="pay-methods">${methods.map((m) => `<button type="button" data-method="${m.id}">${esc(m.name)}<small>${m.kind === "dinheiro" ? "calcula troco" : m.uses_terminal ? (stoneCfg.mode === "connect" ? "envia p/ maquininha" : "na maquininha") : KIND_LABEL[m.kind]}</small></button>`).join("")}</div>
        <div data-cash hidden class="card" style="box-shadow:none"><div class="card-b row wrap">
          <label class="field" style="width:170px"><span>Recebido em dinheiro</span><div class="affix pre"><i>R$</i><input class="input num" data-received inputmode="decimal"></div></label>
          <div class="grow"><div class="lbl">Troco</div><div class="stat-value num" data-change>R$ 0,00</div></div>
          <button type="button" class="btn primary" data-cash-ok>Confirmar dinheiro</button></div></div>
        <div data-terminal hidden></div>
        <div class="pay-list" data-list></div>
        <label class="field"><span>Observação do pedido</span><input class="input" data-obs value="${esc(cart.notes)}" placeholder="Ex.: sem cebola, entregar na portaria"></label>
      </div>`,
      onOpen: (dlg) => {
        const amountEl = $("[data-amount]", dlg);
        const refresh = () => {
          const r = remaining();
          $("[data-rem]", dlg).textContent = money(r);
          $("[data-rem]", dlg).classList.toggle("good", r === 0);
          amountEl.value = centsToInput(r);
          $("[data-list]", dlg).innerHTML = payments.map((p, i) => `<div class="pay-row"><b class="grow">${esc(p.label)}</b>${p.change ? `<span class="small soft">troco ${money(p.change)}</span>` : ""}<span class="num strong">${money(p.amount)}</span><button type="button" class="btn ghost sm icon" data-unpay="${i}" aria-label="Remover pagamento">${icon("x")}</button></div>`).join("");
          $("[data-submit]", dlg).disabled = r !== 0;
        };
        const addPayment = (m, amount, extra = {}) => {
          payments.push({ methodId: m.id, label: m.name, amount, ...extra });
          $("[data-cash]", dlg).hidden = true;
          $("[data-terminal]", dlg).hidden = true;
          refresh();
          if (remaining() === 0) $("[data-submit]", dlg).focus();
        };
        on(dlg, "click", "[data-method]", async (_e, b) => {
          const m = method(b.dataset.method);
          const amount = Math.min(parseMoney(amountEl.value), remaining());
          if (!(amount > 0)) return toast("Nada a receber.", "bad");
          if (m.kind === "dinheiro") {
            const box = $("[data-cash]", dlg);
            box.hidden = false;
            box.dataset.amount = amount;
            const rec = $("[data-received]", dlg);
            rec.value = centsToInput(amount);
            rec.focus();
            rec.select();
            $("[data-change]", dlg).textContent = money(0);
            return;
          }
          if (m.uses_terminal && stoneCfg.mode === "connect") return chargeTerminal(m, amount);
          addPayment(m, amount);
        });
        on(dlg, "input", "[data-received]", (e) => {
          const amount = Number($("[data-cash]", dlg).dataset.amount);
          $("[data-change]", dlg).textContent = money(Math.max(0, parseMoney(e.target.value) - amount));
        });
        const confirmCash = () => {
          const amount = Number($("[data-cash]", dlg).dataset.amount);
          const received = parseMoney($("[data-received]", dlg).value);
          if (received < amount) return toast("Valor recebido menor que a parte a pagar.", "bad");
          addPayment(methods.find((m) => m.kind === "dinheiro"), amount, { received, change: received - amount });
        };
        on(dlg, "click", "[data-cash-ok]", confirmCash);
        on(dlg, "keydown", "[data-received]", (e) => { if (e.key === "Enter") { e.preventDefault(); confirmCash(); } });
        on(dlg, "keydown", "[data-amount]", (e) => { if (e.key === "Enter") e.preventDefault(); });
        on(dlg, "click", "[data-unpay]", (_e, b) => { payments.splice(Number(b.dataset.unpay), 1); refresh(); });

        // Stone Connect: envia a cobrança para a maquininha e espera a aprovação (webhook → Firestore)
        async function chargeTerminal(m, amount) {
          const box = $("[data-terminal]", dlg);
          box.hidden = false;
          const devices = stoneCfg.devices ?? [];
          box.innerHTML = `<div class="alert">${icon("card")}<div>Enviando <b>${money(amount)}</b> (${esc(m.name)}) para a maquininha…</div></div>`;
          try {
            const call = fb.httpsCallable(functions, "stoneCharge");
            const res = await call({ amount, methodId: m.id, device: devices[0] ?? null, description: `Pedido ${cart.customer || ""}`.trim() });
            const chargeId = res.data.chargeId;
            box.innerHTML = `<div class="alert warn">${icon("card")}<div><b>Aguardando pagamento na maquininha…</b><br><span class="small">Passe o cartão / pix na Stone. A tela confirma sozinha.</span>
              <div class="row" style="margin-top:8px"><button type="button" class="btn sm" data-manual-ok>Aprovado (confirmar manualmente)</button><button type="button" class="btn sm danger" data-abort>Cancelar</button></div></div></div>`;
            unsubCharge?.();
            unsubCharge = fb.onSnapshot(fb.doc(db, "stoneCharges", chargeId), (snap) => {
              const st = snap.data()?.status;
              if (st === "paid") { unsubCharge(); addPayment(m, amount, { stoneOrderId: chargeId }); toast("Pagamento aprovado na maquininha.", "good"); }
              if (st === "failed" || st === "canceled") { unsubCharge(); box.innerHTML = `<div class="alert bad">${icon("alert")}<div>Pagamento recusado/cancelado na maquininha. Tente outra forma.</div></div>`; }
            });
            on(box, "click", "[data-manual-ok]", () => { unsubCharge?.(); addPayment(m, amount, { stoneOrderId: chargeId }); });
            on(box, "click", "[data-abort]", () => { unsubCharge?.(); box.hidden = true; });
          } catch (ex) {
            box.innerHTML = `<div class="alert bad">${icon("alert")}<div><b>Não deu pra falar com a maquininha</b> (${esc(ex.message)}).<br>
              <button type="button" class="btn sm" data-fallback style="margin-top:6px">Passei na maquininha manualmente — confirmar</button></div></div>`;
            on(box, "click", "[data-fallback]", () => addPayment(m, amount));
          }
        }
        dlg.addEventListener("close", () => unsubCharge?.());
        refresh();
        amountEl.select();
      },
      onSubmit: async (form) => {
        if (remaining() !== 0) throw new Error("Ainda falta receber.");
        cart.notes = $("[data-obs]", form).value.trim();
        cart.customer = $("[data-customer]", el).value.trim();
        const res = await createSale({
          channel: cart.channel,
          items: cart.items,
          payments: payments.map((p) => ({ methodId: p.methodId, amount: p.amount, received: p.received, change: p.change, stoneOrderId: p.stoneOrderId })),
          discount: discount(),
          deliveryFee: cart.channel === "delivery" ? cart.deliveryFee : 0,
          customer: cart.customer,
          notes: cart.notes,
        });
        const snapshot = {
          ...res, number: res.number, channel: cart.channel, customer: cart.customer, notes: cart.notes, clientAt: new Date().toISOString(),
          items: cart.items.map((i) => ({ ...i })), subtotal: subtotal(), discount: discount(), deliveryFee: cart.channel === "delivery" ? cart.deliveryFee : 0, total: due,
          payments: payments.map((p) => ({ name: p.label, amount: p.amount, received: p.received, change: p.change })),
        };
        reset();
        doneModal(snapshot);
      },
    });
    return d;
  }

  function doneModal(sale) {
    const change = sale.payments.reduce((s, p) => s + (p.change || 0), 0);
    modal({
      title: `Venda nº ${sale.number} concluída`,
      submit: "Nova venda",
      cancel: "",
      body: `<div class="stack center" style="align-items:center">
        <div class="badge good" style="font-size:14px;padding:6px 12px">${icon("check")}${money(sale.total)}</div>
        ${change ? `<div><div class="lbl">Troco</div><div class="stat-value hero">${money(change)}</div></div>` : ""}
        <div class="row"><button type="button" class="btn" data-print>${icon("printer")}Cupom</button><button type="button" class="btn" data-kitchen>${icon("printer")}Comanda cozinha</button></div></div>`,
      onOpen: (d) => {
        on(d, "click", "[data-print]", () => printReceipt(sale));
        on(d, "click", "[data-kitchen]", () => printReceipt(sale, { kitchen: true }));
        $("[data-submit]", d).focus();
      },
      onSubmit: () => { $("[data-search]", el).focus(); },
    });
  }

  function discountModal() {
    modal({
      title: "Desconto",
      body: `<div class="row"><div class="seg"><button type="button" data-dt="rs" class="${cart.discountPct ? "" : "active"}">R$</button><button type="button" data-dt="pct" class="${cart.discountPct ? "active" : ""}">%</button></div>
        <input class="input num" name="v" inputmode="decimal" value="${cart.discountPct ? cart.discount : centsToInput(cart.discount)}" autofocus style="width:160px"></div>`,
      onOpen: (d) => on(d, "click", "[data-dt]", (_e, b) => { $$("[data-dt]", d).forEach((x) => x.classList.toggle("active", x === b)); }),
      onSubmit: (form) => {
        const pctMode = $("[data-dt=pct]", form).classList.contains("active");
        const v = form.elements.v.value;
        cart.discountPct = pctMode;
        cart.discount = pctMode ? Math.min(100, Number(v.replace(",", ".")) || 0) : parseMoney(v);
        if (!isAdmin() && (pctMode ? cart.discount > 15 : cart.discount > subtotal() * 0.15)) throw new Error("Desconto acima de 15% só com o administrador.");
        renderCart();
      },
    });
  }

  function openCashModal() {
    modal({
      title: "Abrir caixa",
      submit: "Abrir caixa",
      body: `<label class="field"><span>Troco inicial (fundo de caixa)</span><div class="affix pre"><i>R$</i><input class="input num" name="v" inputmode="decimal" value="0,00" autofocus></div></label>`,
      onSubmit: async (form) => { await openCash(parseMoney(form.elements.v.value)); toast("Caixa aberto. Bora vender!", "good"); },
    });
  }

  const onKey = (e) => {
    if (document.querySelector("dialog[open]")) return;
    if (e.key === "F9") { e.preventDefault(); if (cart.items.length && (cart.channel === "ifood" || state.session)) payModal(); }
    if (e.key === "/" && document.activeElement?.tagName !== "INPUT") { e.preventDefault(); $("[data-search]", el).focus(); }
  };
  document.addEventListener("keydown", onKey);

  const offs = [
    on(el, "click", "[data-add]", (_e, b) => add(b.dataset.add)),
    on(el, "click", "[data-cat]", (_e, b) => { cat = b.dataset.cat; renderCatalog(); }),
    on(el, "click", "[data-channel]", (_e, b) => {
      cart.channel = b.dataset.channel;
      for (const i of cart.items) { const p = state.products.find((x) => x.id === i.productId); if (p) i.price = price(p); }
      render();
    }),
    on(el, "input", "[data-search]", (e) => { search = e.target.value; renderCatalog(); }),
    on(el, "keydown", "[data-search]", (e) => {
      if (e.key === "Enter") { const first = products()[0]; if (first) { add(first.id); e.target.select(); } }
      if (e.key === "Escape") { search = ""; e.target.value = ""; renderCatalog(); }
    }),
    on(el, "click", "[data-inc]", (_e, b) => { cart.items[b.dataset.inc].qty++; render(); }),
    on(el, "click", "[data-dec]", (_e, b) => { const i = cart.items[b.dataset.dec]; i.qty > 1 ? i.qty-- : cart.items.splice(b.dataset.dec, 1); render(); }),
    on(el, "click", "[data-rm]", (_e, b) => { cart.items.splice(Number(b.dataset.rm), 1); render(); }),
    on(el, "click", "[data-note]", (_e, b) => {
      const it = cart.items[b.dataset.note];
      modal({
        title: it.name,
        body: `<label class="field"><span>Observação</span><input class="input" name="n" value="${esc(it.notes)}" placeholder="Ex.: sem cebola, ponto bem passado" autofocus></label>`,
        onSubmit: (f) => { it.notes = f.elements.n.value.trim(); renderCart(); },
      });
    }),
    on(el, "click", "[data-clear]", () => reset()),
    on(el, "click", "[data-pay]", (_e, b) => busy(b, async () => payModal())),
    on(el, "click", "[data-discount]", discountModal),
    on(el, "click", "[data-open-cash]", openCashModal),
    on(el, "change", "[data-fee]", (e) => { cart.deliveryFee = parseMoney(e.target.value); renderCart(); }),
    on(el, "input", "[data-customer]", (e) => (cart.customer = e.target.value)),
    subscribe((k) => { if (k === "products" || k === "settings") renderCatalog(); if (k === "session") renderCart(); }),
  ];
  render();
  $("[data-search]", el).focus();
  return () => { offs.forEach((f) => f()); document.removeEventListener("keydown", onKey); };
}
