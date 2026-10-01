import { auth, db, fb, isEmulator } from "./firebase.js";
import { state, start, stop, subscribe, isAdmin } from "./store.js";
import { icon, esc, $, on, toast, formData } from "./ui.js";
import { needsBootstrap, bootstrapAdmin } from "./seed.js";
import { toEmail } from "./services.js";

const root = document.getElementById("root");

/* ---------------- Rotas ---------------- */
// [padrão, módulo, só admin?]
const ROUTES = [
  [/^\/$/, "dashboard", true],
  [/^\/pdv$/, "pdv", false],
  [/^\/caixa$/, "caixa", false],
  [/^\/vendas$/, "vendas", false],
  [/^\/ifood$/, "ifood", true],
  [/^\/cmv$/, "cmv", true],
  [/^\/cmv\/fichas$/, "fichas", true],
  [/^\/cmv\/fichas\/(?<id>[\w-]+)$/, "ficha", true],
  [/^\/cmv\/cardapio$/, "cardapio", true],
  [/^\/cmv\/simulador$/, "simulador", true],
  [/^\/estoque$/, "insumos", true],
  [/^\/estoque\/insumo\/(?<id>[\w-]+)$/, "insumo", true],
  [/^\/estoque\/compras$/, "compras", true],
  [/^\/estoque\/inventario$/, "inventario", true],
  [/^\/estoque\/perdas$/, "perdas", false],
  [/^\/financeiro$/, "financeiro", true],
  [/^\/financeiro\/mensal$/, "mensal", true],
  [/^\/financeiro\/contas$/, "contas", true],
  [/^\/financeiro\/recebiveis$/, "recebiveis", true],
  [/^\/config(?:\/(?<tab>\w+))?$/, "config", true],
];

const NAV = [
  ["Operação", [
    ["#/", "home", "Início", true],
    ["#/pdv", "pdv", "PDV", false],
    ["#/caixa", "caixa", "Caixa", false],
    ["#/vendas", "receipt", "Vendas", false],
    ["#/ifood", "bike", "iFood", true],
  ]],
  ["CMV", [
    ["#/cmv", "pie", "Painel do CMV", true],
    ["#/cmv/fichas", "clipboard", "Fichas técnicas", true],
    ["#/cmv/cardapio", "matrix", "Engenharia de cardápio", true],
    ["#/cmv/simulador", "sliders", "Simulador de preços", true],
  ]],
  ["Estoque", [
    ["#/estoque", "box", "Insumos", true],
    ["#/estoque/compras", "truck", "Compras", true],
    ["#/estoque/inventario", "check2", "Inventário", true],
    ["#/estoque/perdas", "trash", "Perdas", false],
  ]],
  ["Financeiro", [
    ["#/financeiro", "bank", "Diário", true],
    ["#/financeiro/mensal", "trendUp", "Mensal / DRE", true],
    ["#/financeiro/contas", "bills", "Contas", true],
    ["#/financeiro/recebiveis", "card", "Recebíveis", true],
  ]],
  ["Sistema", [["#/config", "gear", "Configurações", true]]],
];

let cleanup = null;
let current = "";

function path() {
  return (location.hash.replace(/^#/, "") || "/").split("?")[0];
}
export function queryParams() {
  return new URLSearchParams(location.hash.split("?")[1] || "");
}

async function route() {
  if (!state.profile) return;
  const p = path();
  let match = null;
  for (const [re, mod, admin] of ROUTES) {
    const m = p.match(re);
    if (m) { match = { mod, admin, params: m.groups ?? {} }; break; }
  }
  if (!match) { location.hash = isAdmin() ? "#/" : "#/pdv"; return; }
  if (match.admin && !isAdmin()) { location.hash = "#/pdv"; return; }

  cleanup?.();
  cleanup = null;
  current = p;
  renderNav();
  document.querySelector(".shell")?.classList.remove("nav-open");
  const page = $("#page");
  page.className = match.mod === "pdv" ? "page full" : "page";
  page.innerHTML = `<div class="boot" style="min-height:40vh">Carregando…</div>`;
  try {
    const view = await import(`./views/${match.mod}.js`);
    if (current !== p) return;
    // Cada tela ganha um container novo: se uma tela antiga terminar de
    // carregar depois da troca, ela escreve num elemento já desconectado.
    page.innerHTML = "";
    const host = document.createElement("div");
    page.append(host);
    const result = await view.default(host, match.params, queryParams());
    if (current !== p || !host.isConnected) { result?.(); return; }
    cleanup = result || null;
    document.title = `${view.title ?? "Mistureba"} · Mistureba`;
    window.scrollTo(0, 0);
  } catch (e) {
    console.error(e);
    page.innerHTML = `<div class="alert bad">${icon("alert")}<div><b>Erro ao abrir a tela.</b> ${esc(e.message)}</div></div>`;
  }
}

function renderNav() {
  const nav = $(".nav");
  if (!nav) return;
  const p = path();
  const admin = isAdmin();
  const lowStock = state.ingredients.filter((i) => i.active !== false && (i.stock ?? 0) <= (i.minStock ?? 0) && i.minStock > 0).length;
  nav.innerHTML = NAV.map(([label, items]) => {
    const visible = items.filter((it) => admin || !it[3]);
    if (!visible.length) return "";
    return `<div class="nav-label">${label}</div>` + visible.map(([href, ic, text]) => {
      const h = href.slice(1);
      const active = h === p || (h !== "/" && h !== "/cmv" && h !== "/estoque" && h !== "/financeiro" && h !== "/config" && p.startsWith(h + "/")) || (h === "/config" && p.startsWith("/config"));
      const extra = href === "#/estoque" && lowStock ? `<span class="pill" title="Insumos abaixo do mínimo">${lowStock}</span>` : "";
      return `<a href="${href}" class="${active ? "active" : ""}">${icon(ic)}<span>${text}</span>${extra}</a>`;
    }).join("");
  }).join("");
  const net = $(".net");
  if (net) {
    net.classList.toggle("off", !state.online);
    net.textContent = state.online ? "Online" : "Offline — salvando local";
  }
}

function renderShell() {
  const p = state.profile;
  root.innerHTML = `
  <div class="shell">
    <aside class="side">
      <div class="logo"><span class="logo-mark">M</span><span>${esc(state.settings.company.name || "Mistureba")}</span></div>
      <nav class="nav" aria-label="Menu principal"></nav>
      <div class="side-foot">
        <div class="who"><b>${esc(p.name)}</b><span class="net">Online</span></div>
        <button type="button" data-logout aria-label="Sair" title="Sair">${icon("logout")}</button>
      </div>
    </aside>
    <div class="main">
      <header class="topbar"><button type="button" data-menu aria-label="Abrir menu">${icon("menu")}</button><div class="logo"><span class="logo-mark">M</span>Mistureba</div></header>
      <main id="page" class="page"></main>
    </div>
  </div>`;
  on(root, "click", "[data-logout]", async () => { stop(); await fb.signOut(auth); });
  on(root, "click", "[data-menu]", () => $(".shell").classList.toggle("nav-open"));
  on(root, "click", ".main", (e) => { if (!e.target.closest("[data-menu]")) $(".shell")?.classList.remove("nav-open"); });
  renderNav();
}

/* ---------------- Login / primeiro acesso ---------------- */
function loginArt() {
  return `<div class="login-art">
    <div class="logo" style="color:#fff"><span class="logo-mark">M</span>Mistureba</div>
    <div><h1>Cada lanche com o custo na ponta do lápis.</h1>
    <p>PDV, caixa, estoque, contas e o CMV de cada item do cardápio — num lugar só, funcionando até sem internet.</p></div>
    <p class="xs" style="color:#8f877d">${isEmulator ? "Modo local (emuladores do Firebase)" : ""}</p>
  </div>`;
}

function renderLogin(msg = "") {
  root.innerHTML = `<div class="login">${loginArt()}
    <form class="login-form" novalidate>
      <div><h2>Entrar</h2><p class="soft small">Use o usuário e a senha que o administrador criou pra você.</p></div>
      <label class="field"><span>Usuário</span><input class="input" name="login" autocomplete="username" autocapitalize="none" required autofocus></label>
      <label class="field"><span>Senha</span><input class="input" name="password" type="password" autocomplete="current-password" required></label>
      <p class="form-error" role="alert">${esc(msg)}</p>
      <button class="btn primary lg" type="submit">Entrar</button>
    </form></div>`;
  const form = $("form", root);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("button[type=submit]", form);
    const err = $(".form-error", form);
    const { login, password } = formData(form);
    if (!login || !password) { err.textContent = "Preencha usuário e senha."; return; }
    btn.disabled = true;
    err.textContent = "";
    try {
      await fb.signInWithEmailAndPassword(auth, toEmail(login), password);
    } catch (ex) {
      err.textContent = ["auth/invalid-credential", "auth/wrong-password", "auth/user-not-found", "auth/invalid-email"].includes(ex.code)
        ? "Usuário ou senha incorretos."
        : ex.code === "auth/network-request-failed" ? "Sem conexão. O primeiro login do dia precisa de internet." : ex.message;
      btn.disabled = false;
    }
  });
}

function renderSetup() {
  root.innerHTML = `<div class="login">${loginArt()}
    <form class="login-form" novalidate>
      <div><div class="crumb">Primeiro acesso</div><h2>Criar o administrador</h2><p class="soft small">Essa conta vê tudo: CMV, financeiro e configurações. Os funcionários do caixa você cadastra depois.</p></div>
      <label class="field"><span>Seu nome</span><input class="input" name="name" required autofocus></label>
      <label class="field"><span>Usuário</span><input class="input" name="login" autocapitalize="none" placeholder="ex.: dono" required></label>
      <label class="field"><span>Senha</span><input class="input" name="password" type="password" autocomplete="new-password" minlength="6" required><small>Mínimo de 6 caracteres.</small></label>
      <label class="check"><input type="checkbox" name="withMenu" checked> Começar com um cardápio de exemplo (lanches com ficha técnica)</label>
      <p class="form-error" role="alert"></p>
      <button class="btn brand lg" type="submit">Criar e entrar</button>
    </form></div>`;
  const form = $("form", root);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("button[type=submit]", form);
    const err = $(".form-error", form);
    btn.disabled = true;
    err.textContent = "";
    try {
      settingUp = true;
      await bootstrapAdmin(formData(form));
      settingUp = false;
      await enter(auth.currentUser);
    } catch (ex) {
      settingUp = false;
      console.error(ex);
      err.textContent = ex.code === "auth/email-already-in-use" ? "Esse usuário já existe." : ex.message;
      btn.disabled = false;
    }
  });
}

/* ---------------- Sessão ---------------- */
let settingUp = false;
let unsubStore = null;

async function enter(user) {
  const snap = await fb.getDoc(fb.doc(db, "users", user.uid));
  const profile = snap.data();
  if (!profile || profile.active === false) {
    await fb.signOut(auth);
    renderLogin("Usuário sem acesso. Fale com o administrador.");
    return;
  }
  state.user = user;
  state.profile = { uid: user.uid, ...profile };
  start();
  await waitFor(["settings", "methods", "ingredients", "products", "session"]);
  renderShell();
  unsubStore?.();
  unsubStore = subscribe(() => renderNav());
  if (!location.hash || location.hash === "#") location.hash = isAdmin() ? "#/" : "#/pdv";
  route();
}

function waitFor(keys) {
  return new Promise((resolve) => {
    const check = () => keys.every((k) => state.loaded.has(k));
    if (check()) return resolve();
    const un = subscribe(() => { if (check()) { un(); resolve(); } });
    setTimeout(resolve, 8000);
  });
}

fb.onAuthStateChanged(auth, async (user) => {
  if (settingUp) return;
  if (user) return enter(user).catch((e) => { console.error(e); renderLogin(e.message); });
  state.profile = null;
  state.loaded.clear();
  stop();
  try {
    if (await needsBootstrap()) return renderSetup();
  } catch (e) {
    console.warn("bootstrap check", e);
  }
  renderLogin();
});

addEventListener("hashchange", route);
addEventListener("unhandledrejection", (e) => {
  const msg = e.reason?.message;
  if (msg) toast(msg, "bad");
});
