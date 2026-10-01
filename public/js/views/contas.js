import { state, category, subscribe } from "../store.js";
import { saveBill, payBill, saveRecurring, generateRecurring, listWhere, deleteDocById } from "../services.js";
import { fb } from "../firebase.js";
import { money, esc, isoDate, isoMonth, shiftMonth, fmtMonth, fmtDate, parseMoney, centsToInput } from "../format.js";
import { icon, pageHead, empty, on, $, tabs, modal, toast, formData, opt, confirmDialog } from "../ui.js";
import { FIN_TABS } from "./financeiro.js";

export const title = "Contas";

const GROUP_LABEL = { insumos: "Insumos (CMV)", fixa: "Fixa", variavel: "Variável", imposto: "Imposto", investimento: "Investimento", receita: "Receita" };

function catOptions(type, selected) {
  return `<option value="">Sem categoria</option>` + state.categories.filter((c) => c.type === type).map((c) => opt(c.id, `${c.name} · ${GROUP_LABEL[c.dre_group]}`, selected)).join("");
}

export default async function (el) {
  let month = isoMonth();
  let type = "pagar";
  let status = "";
  let bills = [];

  el.innerHTML = `
    ${pageHead("Financeiro", "Contas a pagar e a receber. As fixas (aluguel, luz, salário) se repetem sozinhas todo mês.",
      `<button class="btn" data-recurring>${icon("refresh")}Contas fixas</button><button class="btn primary" data-new>${icon("plus")}Nova conta</button>`)}
    ${tabs(FIN_TABS, "#/financeiro/contas")}
    <div class="row wrap between" style="margin-bottom:var(--s-4)">
      <div class="row"><button class="btn icon sm" data-m="-1" aria-label="Mês anterior">${icon("left")}</button><strong data-month style="min-width:150px;text-align:center"></strong><button class="btn icon sm" data-m="1" aria-label="Próximo mês">${icon("right")}</button></div>
      <div class="row wrap"><div class="seg"><button data-type="pagar">A pagar</button><button data-type="receber">A receber</button></div>
        <select class="select sm" data-status style="width:auto" aria-label="Situação"><option value="">Todas</option><option value="aberto">Em aberto</option><option value="vencido">Vencidas</option><option value="pago">Pagas</option></select></div>
    </div>
    <div class="grid g4" data-kpis style="margin-bottom:var(--s-4)"></div>
    <div class="card"><div class="card-b flush" data-list></div></div>`;

  async function load() {
    $("[data-month]", el).textContent = fmtMonth(month);
    bills = await listWhere("bills", fb.where("month", "==", month)).catch(() => []);
    if (month >= isoMonth() && state.recurring.length) {
      const n = await generateRecurring(month, bills);
      if (n) { toast(`${n} conta(s) fixa(s) de ${fmtMonth(month)} lançada(s).`); bills = await listWhere("bills", fb.where("month", "==", month)); }
    }
    render();
  }

  const today = isoDate();
  const stateOf = (b) => (b.paidAt ? "pago" : b.dueDate < today ? "vencido" : "aberto");

  function render() {
    for (const b of el.querySelectorAll("[data-type]")) b.classList.toggle("active", b.dataset.type === type);
    const list = bills.filter((b) => b.type === type && (!status || stateOf(b) === status)).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    const ofType = bills.filter((b) => b.type === type);
    const tot = (arr) => arr.reduce((s, b) => s + b.amount, 0);
    const verb = type === "pagar" ? "pagar" : "receber";
    $("[data-kpis]", el).innerHTML = `
      <div class="card stat"><span class="stat-label">Total a ${verb} no mês</span><span class="stat-value">${money(tot(ofType))}</span><span class="stat-foot">${ofType.length} conta(s)</span></div>
      <div class="card stat"><span class="stat-label">${type === "pagar" ? "Pago" : "Recebido"}</span><span class="stat-value good">${money(ofType.filter((b) => b.paidAt).reduce((s, b) => s + (b.paidAmount ?? b.amount), 0))}</span></div>
      <div class="card stat"><span class="stat-label">Em aberto</span><span class="stat-value">${money(tot(ofType.filter((b) => stateOf(b) === "aberto")))}</span></div>
      <div class="card stat"><span class="stat-label">Vencido</span><span class="stat-value ${ofType.some((b) => stateOf(b) === "vencido") ? "bad" : ""}">${money(tot(ofType.filter((b) => stateOf(b) === "vencido")))}</span></div>`;
    $("[data-list]", el).innerHTML = list.length
      ? `<div class="table-wrap"><table class="t"><thead><tr><th>Vencimento</th><th>Descrição</th><th>Categoria</th><th class="num">Valor</th><th>Situação</th><th></th></tr></thead><tbody>
        ${list.map((b) => {
          const st = stateOf(b);
          return `<tr><td class="nowrap">${fmtDate(b.dueDate)}</td><td><b>${esc(b.description)}</b>${b.supplier ? ` <span class="muted xs">${esc(b.supplier)}</span>` : ""}${b.recurringId ? ` <span class="badge">fixa</span>` : ""}</td>
            <td class="small soft">${esc(category(b.categoryId)?.name ?? "—")}</td><td class="num strong">${money(b.amount)}</td>
            <td>${st === "pago" ? `<span class="badge good">${icon("check")}${type === "pagar" ? "paga" : "recebida"} ${fmtDate(b.paidAt).slice(0, 5)}</span>` : st === "vencido" ? `<span class="badge bad">${icon("alert")}vencida</span>` : `<span class="badge">em aberto</span>`}</td>
            <td class="act">${!b.paidAt ? `<button class="btn sm" data-pay="${b.id}">${type === "pagar" ? "Pagar" : "Receber"}</button>` : ""}
              <button class="btn ghost sm icon" data-edit="${b.id}" aria-label="Editar">${icon("edit")}</button>
              <button class="btn ghost sm icon" data-del="${b.id}" aria-label="Excluir">${icon("trash")}</button></td></tr>`;
        }).join("")}</tbody></table></div>`
      : empty(`Nenhuma conta ${status ? "nessa situação" : `a ${verb}`} em ${fmtMonth(month)}.`, "bills");
  }

  function billModal(b = null) {
    const t = b?.type ?? type;
    modal({
      title: b ? "Editar conta" : t === "pagar" ? "Nova conta a pagar" : "Nova conta a receber",
      body: `<div class="form-grid">
        <label class="field" style="grid-column:1/-1"><span>Descrição</span><input class="input" name="description" value="${esc(b?.description ?? "")}" required autofocus></label>
        <label class="field"><span>Valor</span><div class="affix pre"><i>R$</i><input class="input num" name="amount" inputmode="decimal" value="${centsToInput(b?.amount)}" required></div></label>
        <label class="field"><span>Vencimento</span><input class="input" type="date" name="dueDate" value="${b?.dueDate ?? isoDate()}" required></label>
        <label class="field"><span>Competência</span><input class="input" type="month" name="competence" value="${b?.competence ?? month}"><small>Mês em que a despesa entra no DRE.</small></label>
        <label class="field"><span>Categoria</span><select class="select" name="categoryId">${catOptions(t, b?.categoryId)}</select></label>
        <label class="field" style="grid-column:1/-1"><span>${t === "pagar" ? "Fornecedor / favorecido" : "Pagador"}</span><input class="input" name="supplier" value="${esc(b?.supplier ?? "")}"></label>
        <label class="field" style="grid-column:1/-1"><span>Observações</span><input class="input" name="notes" value="${esc(b?.notes ?? "")}"></label>
        <label class="check"><input type="checkbox" name="paid" ${b?.paidAt ? "checked" : ""}> Já ${t === "pagar" ? "paga" : "recebida"}</label>
        <label class="field" data-paid-at ${b?.paidAt ? "" : "hidden"}><span>Data do pagamento</span><input class="input" type="date" name="paidAt" value="${b?.paidAt ?? isoDate()}"></label>
      </div>`,
      onOpen: (d) => on(d, "change", "[name=paid]", (e) => ($("[data-paid-at]", d).hidden = !e.target.checked)),
      onSubmit: async (form) => {
        const v = formData(form);
        await saveBill(b?.id ?? null, { ...v, type: t, amount: parseMoney(v.amount) });
        toast("Conta salva.", "good");
        load();
      },
    });
  }

  function recurringModal() {
    const renderRows = () => state.recurring.length
      ? `<table class="t"><thead><tr><th>Descrição</th><th>Categoria</th><th class="num">Dia</th><th class="num">Valor</th><th></th></tr></thead><tbody>
        ${state.recurring.map((r) => `<tr class="${r.active === false ? "dim" : ""}"><td>${esc(r.description)}</td><td class="small soft">${esc(category(r.categoryId)?.name ?? "—")}</td><td class="num">${r.day}</td><td class="num">${money(r.amount)}</td>
          <td class="act"><button type="button" class="btn ghost sm" data-rtoggle="${r.id}">${r.active === false ? "Ativar" : "Pausar"}</button></td></tr>`).join("")}</tbody></table>`
      : `<p class="small muted">Nenhuma conta fixa cadastrada.</p>`;
    modal({
      title: "Contas fixas (todo mês)",
      wide: true,
      submit: "Adicionar conta fixa",
      cancel: "Fechar",
      body: `<div data-rows>${renderRows()}</div>
        <h3 style="margin:var(--s-5) 0 var(--s-3);font-size:var(--t-md)">Nova conta fixa</h3>
        <div class="form-grid">
          <label class="field" style="grid-column:span 2"><span>Descrição</span><input class="input" name="description" placeholder="Ex.: Aluguel"></label>
          <label class="field"><span>Valor</span><div class="affix pre"><i>R$</i><input class="input num" name="amount" inputmode="decimal"></div></label>
          <label class="field"><span>Dia do vencimento</span><input class="input num" name="day" inputmode="numeric" value="10"></label>
          <label class="field" style="grid-column:span 2"><span>Categoria</span><select class="select" name="categoryId">${catOptions("pagar")}</select></label>
        </div>
        <p class="xs muted" style="margin-top:var(--s-3)">As contas fixas são lançadas automaticamente quando você abre o mês aqui em Contas. Valor variável (luz, água)? Lance o valor médio e ajuste quando a conta chegar.</p>`,
      onOpen: (d) => on(d, "click", "[data-rtoggle]", async (_e, b) => {
        const r = state.recurring.find((x) => x.id === b.dataset.rtoggle);
        await saveRecurring(r.id, { ...r, active: r.active === false });
        setTimeout(() => ($("[data-rows]", d).innerHTML = renderRows()), 300);
      }),
      onSubmit: async (form, d) => {
        const v = formData(form);
        await saveRecurring(null, { ...v, amount: parseMoney(v.amount) });
        toast("Conta fixa cadastrada.", "good");
        form.reset();
        setTimeout(() => ($("[data-rows]", d).innerHTML = renderRows()), 300);
        load();
        return false;
      },
    });
  }

  const offs = [
    on(el, "click", "[data-new]", () => billModal()),
    on(el, "click", "[data-recurring]", recurringModal),
    on(el, "click", "[data-edit]", (_e, b) => billModal(bills.find((x) => x.id === b.dataset.edit))),
    on(el, "click", "[data-del]", async (_e, b) => {
      const bill = bills.find((x) => x.id === b.dataset.del);
      if (!(await confirmDialog("Excluir conta?", `"${esc(bill.description)}" — ${money(bill.amount)}`, { submit: "Excluir" }))) return;
      await deleteDocById("bills", bill.id);
      toast("Conta excluída.");
      load();
    }),
    on(el, "click", "[data-pay]", (_e, b) => {
      const bill = bills.find((x) => x.id === b.dataset.pay);
      modal({
        title: `${bill.type === "pagar" ? "Pagar" : "Receber"}: ${bill.description}`,
        submit: "Confirmar",
        body: `<div class="form-grid"><label class="field"><span>Data</span><input class="input" type="date" name="d" value="${isoDate()}"></label>
          <label class="field"><span>Valor ${bill.type === "pagar" ? "pago" : "recebido"}</span><div class="affix pre"><i>R$</i><input class="input num" name="v" inputmode="decimal" value="${centsToInput(bill.amount)}"></div><small>Com juros/desconto, se houver.</small></label></div>`,
        onSubmit: async (f) => { await payBill(bill.id, f.elements.d.value || isoDate(), parseMoney(f.elements.v.value)); toast("Baixa registrada.", "good"); load(); },
      });
    }),
    on(el, "click", "[data-m]", (_e, b) => { month = shiftMonth(month, Number(b.dataset.m)); load(); }),
    on(el, "click", "[data-type]", (_e, b) => { type = b.dataset.type; render(); }),
    on(el, "change", "[data-status]", (e) => { status = e.target.value; render(); }),
    subscribe((k) => k === "categories" && render()),
  ];
  await load();
  return () => offs.forEach((f) => f());
}
