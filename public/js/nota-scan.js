// Escanear nota: foto (OCR com Tesseract.js) ou XML da NF-e -> conferência -> compra.
// O vínculo "item da nota -> insumo" (e o fator de conversão) fica salvo por
// fornecedor em /itemAliases, então a próxima nota do mesmo fornecedor já vem casada.
import { state, ingredient } from "./store.js";
import { db, fb } from "./firebase.js";
import { readNotaImage } from "./nota-ocr.js";
import { parseNotaText, parseNfeXml, normalize, similarity, unitFactor, packSize } from "./nota-parser.js";
import { money, reais, esc, parseDecimal, decToInput, isoDate, UNIT_LABEL, pct } from "./format.js";
import { icon, modal, on, $, $$, toast } from "./ui.js";

const aliasId = (supplier, desc) => `${normalize(supplier).replace(/ /g, "_").slice(0, 40) || "geral"}__${normalize(desc).replace(/ /g, "_").slice(0, 80)}`;

async function loadAliases() {
  const snap = await fb.getDocs(fb.collection(db, "itemAliases")).catch(() => null);
  return new Map((snap?.docs ?? []).map((d) => [d.id, d.data()]));
}

/** Sugere insumo e fator para cada item lido */
function match(item, supplier, aliases) {
  const exact = aliases.get(aliasId(supplier, item.desc)) ?? [...aliases.values()].find((a) => normalize(a.desc) === normalize(item.desc));
  if (exact && ingredient(exact.ingredientId)) return { ingredientId: exact.ingredientId, factor: exact.factor, how: "memória" };
  let best = null;
  for (const ing of state.ingredients) {
    if (ing.active === false) continue;
    const sc = Math.max(similarity(item.desc, ing.name), similarity(ing.name, item.desc) * 0.9);
    if (!best || sc > best.sc) best = { ing, sc };
  }
  if (!best || best.sc < 0.5) return { ingredientId: "", factor: null, how: "" };
  return { ingredientId: best.ing.id, factor: guessFactor(item, best.ing), how: "parecido" };
}

function guessFactor(item, ing) {
  const f = unitFactor(item.unit, ing.unit);
  if (f != null) return f;
  // "BATATA 2,5KG" vendida por unidade/caixa -> 1 UN = 2,5 kg
  const pack = packSize(item.desc);
  if (pack && pack.unit === ing.unit) return pack.qty;
  return null;
}

export function scanNotaModal(onConfirm) {
  let parsed = null;
  let rows = [];
  let rawText = "";
  let aliases = new Map();
  let imageUrl = "";
  let photo = null;
  let crop = { x: 0.05, y: 0.05, w: 0.9, h: 0.9 };

  const d = modal({
    title: "Escanear nota de compra",
    wide: "xl",
    submit: "",
    cancel: "Fechar",
    body: `<div data-step></div>`,
  });
  const step = $("[data-step]", d);

  function renderPick(msg = "") {
    step.innerHTML = `
      <div class="grid g2">
        <label class="card" style="box-shadow:none;cursor:pointer"><div class="card-b stack tight" style="align-items:flex-start">
          ${icon("camera")}<b>Foto da nota ou cupom</b>
          <span class="small soft">Tire a foto de cima, com a nota esticada e bem iluminada. Funciona com cupom de mercado e DANFE.</span>
          <span class="btn primary" style="margin-top:6px">Escolher foto</span>
          <input type="file" accept="image/*" capture="environment" data-photo hidden></div></label>
        <label class="card" style="box-shadow:none;cursor:pointer"><div class="card-b stack tight" style="align-items:flex-start">
          ${icon("file")}<b>XML da NF-e</b>
          <span class="small soft">Se o fornecedor mandou o XML por e-mail, use ele: vem tudo certinho, sem erro de leitura.</span>
          <span class="btn" style="margin-top:6px">Escolher XML</span>
          <input type="file" accept=".xml,text/xml,application/xml" data-xml hidden></div></label>
      </div>
      ${msg ? `<div class="alert bad" style="margin-top:var(--s-4)">${icon("alert")}<div>${msg}</div></div>` : ""}`;
  }

  function renderProgress(label, pctValue) {
    step.innerHTML = `<div class="stack" style="align-items:center;padding:var(--s-6) 0">
      ${imageUrl ? `<img src="${imageUrl}" alt="Nota enviada" style="max-height:220px;max-width:100%;border-radius:var(--r-md);border:1px solid var(--line)">` : ""}
      <b>${esc(label)}</b>
      <div class="meter" style="width:min(360px,100%)"><span style="width:${pctValue}%;background:var(--series-1)"></span></div>
      <span class="small muted">${pctValue}%</span></div>`;
  }

  function fromPhoto(file) {
    photo = file;
    imageUrl = URL.createObjectURL(file);
    crop = { x: 0.05, y: 0.05, w: 0.9, h: 0.9 };
    renderCrop();
  }

  // Recorte: o usuário marca só a nota (fundo estampado, mesa e mão atrapalham o OCR)
  function renderCrop() {
    step.innerHTML = `
      <div class="stack" style="align-items:center">
        <p class="small soft center">Arraste os cantos pra deixar <b>só a nota</b> dentro do quadro. Mesa, toalha e dedos atrapalham a leitura.</p>
        <div class="crop-wrap" data-crop-wrap><img src="${imageUrl}" alt="Foto da nota" draggable="false">
          <div class="crop-box" data-crop-box>${["nw", "ne", "sw", "se"].map((h) => `<i data-handle="${h}" aria-hidden="true"></i>`).join("")}</div></div>
        <div class="row wrap" style="justify-content:center">
          <button type="button" class="btn" data-again>Outra foto</button>
          <button type="button" class="btn" data-full>Usar foto inteira</button>
          <button type="button" class="btn brand" data-read>${icon("check")}Ler área marcada</button></div>
      </div>`;
    const wrap = $("[data-crop-wrap]", step);
    const box = $("[data-crop-box]", step);
    const paint = () => Object.assign(box.style, { left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.w * 100}%`, height: `${crop.h * 100}%` });
    paint();
    let drag = null;
    wrap.addEventListener("pointerdown", (e) => {
      const r = wrap.getBoundingClientRect();
      const handle = e.target.closest("[data-handle]")?.dataset.handle;
      if (!handle && !e.target.closest("[data-crop-box]")) return;
      e.preventDefault();
      wrap.setPointerCapture(e.pointerId);
      drag = { handle, sx: e.clientX, sy: e.clientY, start: { ...crop }, r };
    });
    wrap.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const dx = (e.clientX - drag.sx) / drag.r.width;
      const dy = (e.clientY - drag.sy) / drag.r.height;
      const s0 = drag.start;
      const min = 0.08;
      let { x, y, w, h } = s0;
      if (!drag.handle) {
        x = Math.min(1 - w, Math.max(0, s0.x + dx));
        y = Math.min(1 - h, Math.max(0, s0.y + dy));
      } else {
        if (drag.handle.includes("w")) { x = Math.min(s0.x + s0.w - min, Math.max(0, s0.x + dx)); w = s0.x + s0.w - x; }
        if (drag.handle.includes("e")) w = Math.min(1 - s0.x, Math.max(min, s0.w + dx));
        if (drag.handle.includes("n")) { y = Math.min(s0.y + s0.h - min, Math.max(0, s0.y + dy)); h = s0.y + s0.h - y; }
        if (drag.handle.includes("s")) h = Math.min(1 - s0.y, Math.max(min, s0.h + dy));
      }
      crop = { x, y, w, h };
      paint();
    });
    const end = () => (drag = null);
    wrap.addEventListener("pointerup", end);
    wrap.addEventListener("pointercancel", end);
  }

  async function runOcr(area) {
    renderProgress("Preparando o leitor…", 0);
    const file = photo;
    try {
      const [{ text, confidence }, al] = await Promise.all([
        readNotaImage(file, (p) => renderProgress(p.stage === "lendo" ? "Lendo a nota…" : "Carregando o leitor (só demora na primeira vez)…", p.pct), area),
        loadAliases(),
      ]);
      aliases = al;
      rawText = text;
      parsed = parseNotaText(text);
      parsed.confidence = confidence;
      buildRows();
      if (!rows.length && (parsed.total || parsed.kind === "comprovante")) {
        // Comprovante de cartão ou nota sem itens legíveis: aproveita fornecedor/data/valor
        rows = [{ desc: parsed.supplier ? `Compra ${parsed.supplier}` : "Compra", code: "", qty: 1, unit: "UN", unitPrice: parsed.total ?? 0, total: parsed.total ?? 0, include: false, ingredientId: "", factor: null, how: "" }];
      }
      if (!rows.length) return renderPick(`Não consegui achar itens nessa foto (confiança da leitura ${Math.round(confidence)}%). Tente outra foto mais reta e iluminada, ou use o XML.<details style="margin-top:8px"><summary>Ver o texto lido</summary><pre class="xs" style="white-space:pre-wrap">${esc(text)}</pre></details>`);
      renderReview();
    } catch (e) {
      console.error(e);
      renderPick(`Falha ao ler a imagem: ${esc(e.message)}. Na primeira vez o leitor precisa de internet pra baixar o modelo de português.`);
    }
  }

  async function fromXml(file) {
    try {
      const [text, al] = await Promise.all([file.text(), loadAliases()]);
      aliases = al;
      parsed = parseNfeXml(text);
      rawText = "";
      buildRows();
      renderReview();
    } catch (e) {
      renderPick(esc(e.message));
    }
  }

  function buildRows() {
    rows = parsed.items.map((it) => {
      const m = match(it, parsed.supplier, aliases);
      return { ...it, include: !!m.ingredientId, ingredientId: m.ingredientId, factor: m.factor, how: m.how };
    });
  }

  function stockQty(r) {
    return r.qty * (r.factor ?? 1);
  }

  function renderReview() {
    const sel = rows.filter((r) => r.include);
    const sum = sel.reduce((s, r) => s + r.total, 0);
    const all = rows.reduce((s, r) => s + r.total, 0);
    const mismatch = parsed.total && Math.abs(all - parsed.total) > Math.max(0.05, parsed.total * 0.01);
    const ingOpts = (id) => `<option value="">— não é insumo / ignorar —</option>` + state.ingredients.filter((i) => i.active !== false).map((i) => `<option value="${i.id}" ${i.id === id ? "selected" : ""}>${esc(i.name)} (${UNIT_LABEL[i.unit]})</option>`).join("");
    step.innerHTML = `
      <div class="stack">
        <div class="form-grid">
          <label class="field"><span>Fornecedor</span><input class="input" data-h="supplier" value="${esc(parsed.supplier)}"></label>
          <label class="field"><span>Data da nota</span><input class="input" type="date" data-h="date" value="${parsed.date || isoDate()}"></label>
          <div class="field"><span>Total da nota</span><div class="stat-value" style="font-size:var(--t-lg)">${parsed.total ? money(Math.round(parsed.total * 100)) : "—"}</div></div>
          <div class="field"><span>Lido</span><div class="small soft">${rows.length} item(ns) · ${parsed.source === "xml" ? "XML (exato)" : `foto · confiança ${Math.round(parsed.confidence ?? 0)}%`}</div></div>
        </div>
        ${parsed.kind === "comprovante" ? `<div class="alert">${icon("info")}<div>Isso é um <b>comprovante da maquininha</b>: ele traz o valor pago, mas não os itens. Escolha o insumo e ajuste a quantidade — ou fotografe a nota fiscal/cupom da compra pra vir item por item.</div></div>` : ""}
        ${mismatch ? `<div class="alert warn">${icon("alert")}<div>A soma dos itens lidos (<b>${money(Math.round(all * 100))}</b>) não bate com o total da nota (<b>${money(Math.round(parsed.total * 100))}</b>). Algum item pode ter sido lido errado ou ficado de fora — confira com a nota na mão.</div></div>` : ""}
        <div class="table-wrap"><table class="t"><thead><tr>
          <th></th><th>Na nota</th><th>Insumo</th><th class="num">Conversão</th><th class="num">Entra no estoque</th><th class="num">Custo / un.</th></tr></thead><tbody>
          ${rows.map((r, i) => {
            const ing = ingredient(r.ingredientId);
            const q = stockQty(r);
            const unitCost = q > 0 ? r.total / q : 0;
            const diff = ing?.unitCost ? ((unitCost - ing.unitCost) / ing.unitCost) * 100 : 0;
            const needsFactor = ing && r.factor == null;
            return `<tr class="${r.include ? "" : "dim"}">
              <td><input type="checkbox" data-inc="${i}" ${r.include ? "checked" : ""} aria-label="Incluir ${esc(r.desc)}" style="width:18px;height:18px;accent-color:var(--brand)"></td>
              <td style="min-width:220px"><div class="row" style="gap:6px"><input class="input sm" data-desc="${i}" value="${esc(r.desc)}" aria-label="Descrição">${r.suspect ? `<span class="badge warn" title="A leitura desta linha precisou de correção automática. Confira quantidade e valor com a nota.">${icon("alert")}conferir</span>` : ""}</div>
                <div class="row" style="margin-top:4px;gap:4px"><input class="input sm num" data-qty="${i}" inputmode="decimal" value="${decToInput(r.qty)}" aria-label="Quantidade na nota" style="width:72px">
                  <span class="xs muted">${esc(r.unit)} · total</span><div class="affix pre" style="width:110px"><i>R$</i><input class="input sm num" data-tot="${i}" inputmode="decimal" value="${r.total.toFixed(2).replace(".", ",")}" aria-label="Valor total da linha"></div></div></td>
              <td style="min-width:200px"><select class="select sm" data-ing="${i}">${ingOpts(r.ingredientId)}</select>
                ${r.how ? `<div class="xs ${r.how === "memória" ? "good" : "muted"}" style="margin-top:3px">${r.how === "memória" ? "✓ lembrado deste fornecedor" : "sugestão por nome — confira"}</div>` : ""}</td>
              <td class="num">${ing ? `<div class="row" style="justify-content:flex-end;gap:4px"><span class="xs muted nowrap">1 ${esc(r.unit)} =</span>
                <input class="input sm num" data-factor="${i}" inputmode="decimal" value="${r.factor != null ? decToInput(r.factor, 4) : ""}" placeholder="?" style="width:80px${needsFactor ? ";border-color:var(--warn)" : ""}"><span class="xs muted">${UNIT_LABEL[ing.unit]}</span></div>` : ""}</td>
              <td class="num">${ing ? `${decToInput(q)} ${UNIT_LABEL[ing.unit]}` : ""}</td>
              <td class="num">${ing && q > 0 ? `${reais(unitCost)}${Math.abs(diff) >= 1 ? ` <span class="badge ${diff > 0 ? "bad" : "good"}">${diff > 0 ? "+" : "−"}${pct(Math.abs(diff))}</span>` : ""}` : ""}</td></tr>`;
          }).join("")}
        </tbody></table></div>
        <div class="row between wrap">
          <span class="small soft">${sel.length} item(ns) vão pra compra · ${money(Math.round(sum * 100))}</span>
          ${rawText ? `<details><summary class="small" style="cursor:pointer">Ver texto lido pela câmera</summary><pre class="xs" style="white-space:pre-wrap;max-height:200px;overflow:auto;background:var(--surface-2);padding:8px;border-radius:6px">${esc(rawText)}</pre></details>` : ""}
        </div>
        <p class="xs muted">Linhas com <b>?</b> na conversão: diga quanto 1 unidade da nota vale no estoque (ex.: 1 CX = 2,5 kg). O sistema lembra pra próxima nota desse fornecedor.</p>
      </div>`;
    const f = d.querySelector(".modal-f");
    if (!$("[data-use]", f)) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn brand";
      b.dataset.use = "";
      f.append(b);
      const back = document.createElement("button");
      back.type = "button";
      back.className = "btn";
      back.dataset.back = "";
      back.textContent = "Outra nota";
      f.insertBefore(back, f.querySelector("[data-close]"));
    }
    const useBtn = $("[data-use]", f);
    useBtn.innerHTML = `${icon("check")}Lançar ${sel.length} item(ns)`;
    useBtn.disabled = !sel.length;
  }

  async function confirm() {
    const sel = rows.filter((r) => r.include);
    const missing = sel.filter((r) => !r.ingredientId);
    if (missing.length) return toast(`Escolha o insumo de "${missing[0].desc}" ou desmarque a linha.`, "bad");
    const noFactor = sel.filter((r) => r.factor == null || !(r.factor > 0));
    if (noFactor.length) return toast(`Informe a conversão de "${noFactor[0].desc}" (1 ${noFactor[0].unit} = quanto?).`, "bad");
    const supplier = $("[data-h=supplier]", d).value.trim();
    const date = $("[data-h=date]", d).value || isoDate();

    // Guarda o vínculo para as próximas notas
    const b = fb.writeBatch(db);
    for (const r of sel) b.set(fb.doc(db, "itemAliases", aliasId(supplier, r.desc)), { desc: r.desc, supplier, ingredientId: r.ingredientId, factor: r.factor, at: new Date().toISOString() });
    b.commit().catch((e) => console.warn("aliases", e));

    // Junta linhas do mesmo insumo
    const byIng = new Map();
    for (const r of sel) {
      const cur = byIng.get(r.ingredientId) ?? { ingredientId: r.ingredientId, qty: 0, total: 0 };
      cur.qty += stockQty(r);
      cur.total += Math.round(r.total * 100);
      byIng.set(r.ingredientId, cur);
    }
    d.closeModal();
    onConfirm({
      supplier,
      date,
      notes: [parsed.number ? `NF ${parsed.number}` : "", parsed.source === "xml" ? "importada do XML" : "lida por foto"].filter(Boolean).join(" · "),
      lines: [...byIng.values()].map((l) => ({ ...l, qty: Math.round(l.qty * 1000) / 1000 })),
    });
  }

  on(d, "change", "[data-photo]", (e) => e.target.files[0] && fromPhoto(e.target.files[0]));
  on(d, "change", "[data-xml]", (e) => e.target.files[0] && fromXml(e.target.files[0]));
  on(d, "change", "[data-inc]", (e) => { rows[e.target.dataset.inc].include = e.target.checked; renderReview(); });
  on(d, "change", "[data-desc]", (e) => { rows[e.target.dataset.desc].desc = e.target.value.trim(); });
  on(d, "change", "[data-qty]", (e) => {
    const r = rows[e.target.dataset.qty];
    r.qty = parseDecimal(e.target.value) || 0;
    r.unitPrice = r.qty ? r.total / r.qty : 0;
    r.suspect = false;
    renderReview();
  });
  on(d, "change", "[data-tot]", (e) => {
    const r = rows[e.target.dataset.tot];
    r.total = parseDecimal(e.target.value) || 0;
    r.unitPrice = r.qty ? r.total / r.qty : 0;
    r.suspect = false;
    renderReview();
  });
  on(d, "click", "[data-read]", () => runOcr(crop));
  on(d, "click", "[data-full]", () => runOcr(null));
  on(d, "click", "[data-again]", () => { if (imageUrl) URL.revokeObjectURL(imageUrl); imageUrl = ""; renderPick(); });
  on(d, "change", "[data-ing]", (e) => {
    const r = rows[e.target.dataset.ing];
    r.ingredientId = e.target.value;
    r.include = !!r.ingredientId;
    r.how = "";
    const ing = ingredient(r.ingredientId);
    r.factor = ing ? guessFactor(r, ing) : null;
    renderReview();
  });
  on(d, "change", "[data-factor]", (e) => {
    const v = parseDecimal(e.target.value);
    rows[e.target.dataset.factor].factor = v > 0 ? v : null;
    renderReview();
  });
  // Enter num campo não fecha o diálogo: só aplica o valor
  on(d, "keydown", "input", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    e.target.dispatchEvent(new Event("change", { bubbles: true }));
  });
  on(d, "click", "[data-use]", confirm);
  on(d, "click", "[data-back]", () => {
    rows = [];
    parsed = null;
    imageUrl = "";
    $$("[data-use],[data-back]", d).forEach((x) => x.remove());
    renderPick();
  });
  d.addEventListener("close", () => imageUrl && URL.revokeObjectURL(imageUrl));
  renderPick();
}
