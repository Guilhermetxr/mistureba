import { state, subscribe } from "../store.js";
import { saveSettings, savePrivate, loadPrivate, savePaymentMethod, deleteDocById, createStaffUser, updateStaff, saveCategory, feeFor } from "../services.js";
import { isEmulator } from "../firebase.js";
import { firebaseConfig } from "../firebase-config.js";
import { money, esc, parseDecimal, decToInput, KIND_LABEL, pct } from "../format.js";
import { icon, pageHead, on, $, tabs, modal, toast, formData, opt, confirmDialog, busy } from "../ui.js";

export const title = "Configurações";

const TABS = [
  ["#/config", "Empresa"],
  ["#/config/cmv", "CMV e impostos"],
  ["#/config/taxas", "Taxas da maquininha"],
  ["#/config/stone", "Stone"],
  ["#/config/ifood", "iFood"],
  ["#/config/usuarios", "Usuários"],
  ["#/config/categorias", "Categorias financeiras"],
];

const GROUPS = { insumos: "Compra de insumos (vai pro CMV, fora do DRE)", fixa: "Despesa fixa", variavel: "Despesa variável", imposto: "Imposto pago", investimento: "Investimento", receita: "Receita" };

export default async function (el, params) {
  const tab = params.tab ?? "";
  const href = tab ? `#/config/${tab}` : "#/config";
  el.innerHTML = `${pageHead("Configurações", "")}${tabs(TABS, href)}<div data-body></div>`;
  const body = $("[data-body]", el);
  const offs = [];

  const section = (titleText, sub, inner, submit = "Salvar") => `
    <form class="card" data-form novalidate style="max-width:820px"><div class="card-h"><h3>${titleText}</h3></div>
      <div class="card-b stack">${sub ? `<p class="small soft">${sub}</p>` : ""}${inner}
      <div class="row end"><span class="form-error" role="alert" style="margin-right:auto"></span><button class="btn primary" type="submit">${submit}</button></div></div></form>`;

  function bindForm(handler) {
    const form = $("[data-form]", body);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const btn = $("button[type=submit]", form);
      const err = $(".form-error", form);
      busy(btn, async () => {
        err.textContent = "";
        try { await handler(formData(form), form); toast("Configurações salvas.", "good"); } catch (ex) { err.textContent = ex.message; }
      });
    });
  }

  /* ---------------- Empresa ---------------- */
  if (tab === "") {
    const c = state.settings.company;
    body.innerHTML = section("Dados da lanchonete", "Aparecem no cupom e no topo do sistema.", `<div class="form-grid">
      <label class="field" style="grid-column:span 2"><span>Nome</span><input class="input" name="name" value="${esc(c.name)}"></label>
      <label class="field"><span>CNPJ</span><input class="input" name="cnpj" value="${esc(c.cnpj)}"></label>
      <label class="field"><span>Telefone</span><input class="input" name="phone" value="${esc(c.phone)}"></label>
      <label class="field" style="grid-column:1/-1"><span>Endereço</span><input class="input" name="address" value="${esc(c.address)}"></label></div>`);
    bindForm((v) => saveSettings("company", v));
  }

  /* ---------------- CMV ---------------- */
  if (tab === "cmv") {
    const c = state.settings.cmv;
    body.innerHTML = section("Metas de CMV e impostos", "Essas metas pintam de verde/amarelo/vermelho os produtos e o painel do CMV.", `<div class="form-grid">
      <label class="field"><span>CMV ideal (meta)</span><div class="affix"><input class="input num" name="target_percent" inputmode="decimal" value="${decToInput(c.target_percent, 1)}"><i>%</i></div><small>Lanchonete costuma mirar 28–35%.</small></label>
      <label class="field"><span>Alerta acima de</span><div class="affix"><input class="input num" name="alert_percent" inputmode="decimal" value="${decToInput(c.alert_percent, 1)}"><i>%</i></div></label>
      <label class="field"><span>Imposto sobre faturamento</span><div class="affix"><input class="input num" name="tax_percent" inputmode="decimal" value="${decToInput(c.tax_percent, 2)}"><i>%</i></div><small>Alíquota efetiva do Simples (veja com o contador).</small></label>
      <label class="field"><span>Custo do insumo na compra</span><select class="select" name="cost_method">${opt("medio", "Custo médio ponderado", c.cost_method)}${opt("ultimo", "Último preço pago", c.cost_method)}</select><small>Médio suaviza oscilações; último reage na hora.</small></label></div>`);
    bindForm(async (v) => {
      const data = { target_percent: parseDecimal(v.target_percent), alert_percent: parseDecimal(v.alert_percent), tax_percent: parseDecimal(v.tax_percent), cost_method: v.cost_method };
      if (!(data.target_percent > 0 && data.target_percent < 100)) throw new Error("Meta de CMV inválida.");
      if (data.alert_percent < data.target_percent) throw new Error("O alerta precisa ser maior ou igual à meta.");
      await saveSettings("cmv", data);
    });
  }

  /* ---------------- Taxas ---------------- */
  if (tab === "taxas") {
    const render = () => {
      const ms = state.methods;
      body.innerHTML = `
        <div class="alert" style="margin-bottom:var(--s-4);max-width:1000px">${icon("info")}<div>Pegue as taxas no contrato ou no app da Stone (Menu › Taxas). <b>Taxa</b> é o MDR de cada transação; <b>antecipação</b> é o custo extra se você recebe antes (D+1). O sistema usa isso pra calcular o líquido de cada venda, a margem real dos produtos e quando o dinheiro cai.</div></div>
        <div class="card" style="max-width:1000px"><div class="card-h"><h3>Formas de pagamento</h3><button class="btn sm primary" data-new-method>${icon("plus")}Nova forma</button></div>
          <div class="card-b flush"><div class="table-wrap"><table class="t"><thead><tr><th>Nome</th><th>Tipo</th><th class="num">Taxa</th><th class="num">Antecipação</th><th class="num">Fixo</th><th class="num">Recebe em</th><th class="num">Em R$ 100</th><th></th></tr></thead><tbody>
          ${ms.map((m) => `<tr class="${m.active === false ? "dim" : ""}"><td><b>${esc(m.name)}</b>${m.uses_terminal ? ` <span class="badge">maquininha</span>` : ""}</td><td class="soft">${KIND_LABEL[m.kind]}${m.installments > 1 ? ` ${m.installments}x` : ""}</td>
            <td class="num">${m.kind === "ifood" ? `<span class="muted">aba iFood</span>` : pct(m.fee_percent)}</td><td class="num">${m.anticipation_percent ? pct(m.anticipation_percent) : "—"}</td><td class="num">${m.fixed_fee_cents ? money(m.fixed_fee_cents) : "—"}</td>
            <td class="num">${m.settlement_days ? `D+${m.settlement_days}` : "na hora"}</td><td class="num muted">${m.kind === "ifood" ? "" : `− ${money(feeFor(m, 10000))}`}</td>
            <td class="act"><button class="btn ghost sm icon" data-edit-method="${m.id}" aria-label="Editar ${esc(m.name)}">${icon("edit")}</button></td></tr>`).join("")}
          </tbody></table></div></div></div>`;
    };
    const methodModal = (m = null) => modal({
      title: m ? `Editar ${m.name}` : "Nova forma de pagamento",
      footer: m ? `<button type="button" class="btn danger" data-remove style="margin-right:auto">Excluir</button>` : "",
      body: `<div class="form-grid">
        <label class="field" style="grid-column:span 2"><span>Nome</span><input class="input" name="name" value="${esc(m?.name ?? "")}" required autofocus placeholder="Ex.: Crédito 4x"></label>
        <label class="field"><span>Tipo</span><select class="select" name="kind">${Object.entries(KIND_LABEL).map(([k, v]) => opt(k, v, m?.kind ?? "credito")).join("")}</select></label>
        <label class="field"><span>Parcelas</span><input class="input num" name="installments" inputmode="numeric" value="${m?.installments ?? 1}"></label>
        <label class="field"><span>Taxa (MDR)</span><div class="affix"><input class="input num" name="fee_percent" inputmode="decimal" value="${decToInput(m?.fee_percent ?? 0, 2)}"><i>%</i></div></label>
        <label class="field"><span>Antecipação</span><div class="affix"><input class="input num" name="anticipation_percent" inputmode="decimal" value="${decToInput(m?.anticipation_percent ?? 0, 2)}"><i>%</i></div></label>
        <label class="field"><span>Tarifa fixa por venda</span><div class="affix"><input class="input num" name="fixed_fee" inputmode="decimal" value="${decToInput((m?.fixed_fee_cents ?? 0) / 100, 2)}"><i>R$</i></div></label>
        <label class="field"><span>Dias para receber</span><input class="input num" name="settlement_days" inputmode="numeric" value="${m?.settlement_days ?? 0}"><small>0 = na hora; débito D+1; crédito D+30.</small></label>
        <label class="field"><span>Ordem no PDV</span><input class="input num" name="sort" inputmode="numeric" value="${m?.sort ?? state.methods.length}"></label>
        <label class="check" style="grid-column:1/-1"><input type="checkbox" name="uses_terminal" ${m?.uses_terminal ? "checked" : ""}> Passa na maquininha Stone</label>
        <label class="check" style="grid-column:1/-1"><input type="checkbox" name="active" ${m?.active !== false ? "checked" : ""}> Ativa no PDV</label></div>`,
      onOpen: (d) => on(d, "click", "[data-remove]", async () => {
        if (!(await confirmDialog("Excluir forma de pagamento?", "Vendas antigas mantêm o nome e a taxa gravados. Prefira desativar se ainda pode usar."))) return;
        await deleteDocById("paymentMethods", m.id);
        d.closeModal();
        toast("Excluída.");
      }),
      onSubmit: async (form) => {
        const v = formData(form);
        await savePaymentMethod(m?.id ?? null, { ...v, fee_percent: parseDecimal(v.fee_percent), anticipation_percent: parseDecimal(v.anticipation_percent), fixed_fee_cents: Math.round(parseDecimal(v.fixed_fee) * 100) });
        toast("Taxa salva. Vale para as próximas vendas.", "good");
      },
    });
    offs.push(
      on(body, "click", "[data-new-method]", () => methodModal()),
      on(body, "click", "[data-edit-method]", (_e, b) => methodModal(state.methods.find((m) => m.id === b.dataset.editMethod))),
      subscribe((k) => k === "methods" && render()),
    );
    render();
  }

  /* ---------------- Stone ---------------- */
  if (tab === "stone") {
    const s = state.settings.stone;
    const priv = await loadPrivate("stone").catch(() => ({}));
    const webhook = `https://southamerica-east1-${firebaseConfig.projectId}.cloudfunctions.net/stoneWebhook`;
    body.innerHTML = section("Integração com a maquininha Stone", "", `
      <div class="alert">${icon("info")}<div>
        <b>Modo manual</b> (padrão): o caixa digita o valor na maquininha e confirma no PDV. Funciona com qualquer maquininha, já calcula taxas e recebíveis.<br>
        <b>Modo integrado (Stone Connect)</b>: o PDV manda o valor direto pra maquininha e a venda fecha sozinha quando o pagamento é aprovado. Precisa pedir à Stone o acesso ao <b>Stone Connect / API Pagar.me</b> (chave secreta <code>sk_…</code>) e o número de série das maquininhas. Requer as Cloud Functions publicadas (plano Blaze do Firebase).</div></div>
      <div class="form-grid">
        <label class="field"><span>Modo</span><select class="select" name="mode">${opt("manual", "Manual (digitar na maquininha)", s.mode)}${opt("connect", "Integrado (Stone Connect)", s.mode)}</select></label>
        <label class="field" style="grid-column:span 2"><span>Números de série das maquininhas</span><input class="input" name="devices" value="${esc((s.devices ?? []).join(", "))}" placeholder="Ex.: 12345678, 87654321"><small>Separe por vírgula. A primeira é a padrão do PDV.</small></label>
        <label class="field" style="grid-column:1/-1"><span>Chave secreta (API)</span><input class="input" name="secret_key" type="password" autocomplete="off" value="${esc(priv.secret_key ?? "")}" placeholder="sk_..."><small>Fica guardada numa área que só o administrador e o servidor leem.</small></label>
        <label class="field" style="grid-column:1/-1"><span>Segredo do webhook</span><input class="input" name="webhook_secret" type="password" autocomplete="off" value="${esc(priv.webhook_secret ?? "")}" placeholder="opcional"><small>Cadastre na Stone/Pagar.me o webhook <code>${esc(webhook)}?token=SEU_SEGREDO</code> com os eventos <code>order.paid</code>, <code>order.canceled</code> e <code>order.payment_failed</code>.</small></label>
      </div>`);
    bindForm(async (v) => {
      await saveSettings("stone", { mode: v.mode, devices: v.devices.split(",").map((x) => x.trim()).filter(Boolean) });
      await savePrivate("stone", { secret_key: v.secret_key, webhook_secret: v.webhook_secret });
    });
  }

  /* ---------------- iFood ---------------- */
  if (tab === "ifood") {
    const f = state.settings.ifood;
    const priv = await loadPrivate("ifood").catch(() => ({}));
    body.innerHTML = section("iFood", "", `
      <div class="alert">${icon("info")}<div>As taxas abaixo valem sempre — inclusive quando o pedido do iFood é lançado à mão no PDV (canal iFood). A <b>integração automática</b> puxa os pedidos sozinha pela API oficial (Merchant API): cadastre um app no <a href="https://developer.ifood.com.br" target="_blank" rel="noopener">Portal do Desenvolvedor iFood</a>, peça a homologação e cole as credenciais aqui. Precisa das Cloud Functions publicadas.</div></div>
      <div class="form-grid">
        <label class="field"><span>Comissão do plano</span><div class="affix"><input class="input num" name="commission_percent" inputmode="decimal" value="${decToInput(f.commission_percent, 2)}"><i>%</i></div><small>Básico ~12% · Entrega iFood ~23%.</small></label>
        <label class="field"><span>Taxa de pagamento online</span><div class="affix"><input class="input num" name="payment_fee_percent" inputmode="decimal" value="${decToInput(f.payment_fee_percent, 2)}"><i>%</i></div></label>
        <label class="field"><span>Repasse em (dias)</span><input class="input num" name="settlement_days" inputmode="numeric" value="${f.settlement_days}"></label>
      </div>
      <h3 style="font-size:var(--t-md);margin-top:var(--s-2)">Integração automática</h3>
      <div class="form-grid">
        <label class="check" style="grid-column:1/-1"><input type="checkbox" name="enabled" ${f.enabled ? "checked" : ""}> Ativar integração (buscar pedidos a cada minuto)</label>
        <label class="field"><span>Merchant ID (ID da loja)</span><input class="input" name="merchant_id" value="${esc(f.merchant_id)}"></label>
        <label class="field"><span>Client ID</span><input class="input" name="client_id" value="${esc(priv.client_id ?? "")}" autocomplete="off"></label>
        <label class="field"><span>Client Secret</span><input class="input" name="client_secret" type="password" value="${esc(priv.client_secret ?? "")}" autocomplete="off"></label>
        <label class="check" style="grid-column:1/-1"><input type="checkbox" name="auto_confirm" ${f.auto_confirm ? "checked" : ""}> Confirmar pedidos automaticamente ao chegar</label>
      </div>
      <p class="small soft">Pra cada produto, preencha o <b>Código no iFood</b> na ficha técnica (é o "código PDV" do item no cardápio do iFood). É assim que o pedido baixa estoque e calcula o CMV certinho.</p>`);
    bindForm(async (v) => {
      await saveSettings("ifood", {
        enabled: v.enabled, merchant_id: v.merchant_id, auto_confirm: v.auto_confirm,
        commission_percent: parseDecimal(v.commission_percent), payment_fee_percent: parseDecimal(v.payment_fee_percent), settlement_days: parseInt(v.settlement_days, 10) || 0,
      });
      await savePrivate("ifood", { client_id: v.client_id, client_secret: v.client_secret });
    });
  }

  /* ---------------- Usuários ---------------- */
  if (tab === "usuarios") {
    const render = () => {
      body.innerHTML = `<div class="card" style="max-width:820px"><div class="card-h"><h3>Quem acessa o sistema</h3><button class="btn sm primary" data-new-user>${icon("plus")}Novo usuário</button></div>
        <div class="card-b flush"><table class="t"><thead><tr><th>Nome</th><th>Usuário</th><th>Perfil</th><th></th></tr></thead><tbody>
        ${state.users.map((u) => `<tr class="${u.active === false ? "dim" : ""}"><td><b>${esc(u.name)}</b></td><td class="mono">${esc(u.login ?? "")}</td>
          <td><span class="badge ${u.role === "admin" ? "brand" : ""}">${u.role === "admin" ? "Administrador" : "Caixa"}</span></td>
          <td class="act">${u.id !== state.profile.uid ? `<button class="btn sm" data-toggle-user="${u.id}">${u.active === false ? "Reativar" : "Bloquear"}</button>` : `<span class="muted xs">você</span>`}</td></tr>`).join("")}
        </tbody></table></div></div>
        <p class="small muted" style="margin-top:var(--s-3);max-width:820px"><b>Caixa</b> acessa PDV, caixa, vendas do dia e registro de perdas. <b>Administrador</b> vê tudo, inclusive custos, CMV e financeiro. Pra trocar a senha de alguém, bloqueie e crie um usuário novo${isEmulator ? "" : " (ou redefina pelo Console do Firebase › Authentication)"}.</p>`;
    };
    offs.push(
      on(body, "click", "[data-new-user]", () => modal({
        title: "Novo usuário",
        body: `<div class="form-grid">
          <label class="field" style="grid-column:1/-1"><span>Nome</span><input class="input" name="name" required autofocus></label>
          <label class="field"><span>Usuário (login)</span><input class="input" name="login" autocapitalize="none" required placeholder="ex.: joao"></label>
          <label class="field"><span>Senha</span><input class="input" name="password" type="password" autocomplete="new-password" required></label>
          <label class="field"><span>Perfil</span><select class="select" name="role">${opt("caixa", "Caixa", "caixa")}${opt("admin", "Administrador", "")}</select></label></div>`,
        onSubmit: async (form) => { await createStaffUser(formData(form)); toast("Usuário criado.", "good"); },
      })),
      on(body, "click", "[data-toggle-user]", async (_e, b) => {
        const u = state.users.find((x) => x.id === b.dataset.toggleUser);
        await updateStaff(u.id, { active: u.active === false });
        toast(u.active === false ? "Usuário reativado." : "Usuário bloqueado.");
      }),
      subscribe((k) => k === "users" && render()),
    );
    render();
  }

  /* ---------------- Categorias ---------------- */
  if (tab === "categorias") {
    const render = () => {
      body.innerHTML = `<div class="card" style="max-width:820px"><div class="card-h"><h3>Categorias de contas</h3><button class="btn sm primary" data-new-cat>${icon("plus")}Nova categoria</button></div>
        <div class="card-b flush"><table class="t"><thead><tr><th>Nome</th><th>Tipo</th><th>Entra no DRE como</th><th></th></tr></thead><tbody>
        ${state.categories.map((c) => `<tr><td><b>${esc(c.name)}</b></td><td>${c.type === "pagar" ? "A pagar" : "A receber"}</td><td class="small soft">${GROUPS[c.dre_group]}</td>
          <td class="act"><button class="btn ghost sm icon" data-edit-cat="${c.id}" aria-label="Editar">${icon("edit")}</button></td></tr>`).join("")}
        </tbody></table></div></div>`;
    };
    const catModal = (c = null) => modal({
      title: c ? "Editar categoria" : "Nova categoria",
      body: `<div class="form-grid"><label class="field" style="grid-column:1/-1"><span>Nome</span><input class="input" name="name" value="${esc(c?.name ?? "")}" required autofocus></label>
        <label class="field"><span>Tipo</span><select class="select" name="type">${opt("pagar", "A pagar", c?.type ?? "pagar")}${opt("receber", "A receber", c?.type)}</select></label>
        <label class="field"><span>Grupo no DRE</span><select class="select" name="dre_group">${Object.entries(GROUPS).map(([k, v]) => opt(k, v, c?.dre_group ?? "fixa")).join("")}</select></label></div>`,
      onSubmit: async (form) => { await saveCategory(c?.id ?? null, formData(form)); toast("Categoria salva.", "good"); },
    });
    offs.push(
      on(body, "click", "[data-new-cat]", () => catModal()),
      on(body, "click", "[data-edit-cat]", (_e, b) => catModal(state.categories.find((c) => c.id === b.dataset.editCat))),
      subscribe((k) => k === "categories" && render()),
    );
    render();
  }

  return () => offs.forEach((f) => f());
}
