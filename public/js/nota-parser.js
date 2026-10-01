/*
 * Interpreta notas de compra em itens: texto de OCR (cupom/DANFE fotografado)
 * ou XML de NF-e. Arquivo puro (sem DOM obrigatório nem Firebase) para poder
 * ser testado no Node.
 *
 * Item: { desc, code, qty, unit, unitPrice, total }  (preços em reais, float)
 */

const UNIT_RE = "(UN|UND|UNID|UNI|KG|KGS|G|GR|L|LT|LTS|ML|PC|PCS|PCT|CX|FD|DZ|SC|BD|GL|PT|BJ|LA|LATA|FR)";

/** "1.234,56" | "1234.56" | "12,5" -> número; tolera O/0 e l/1 trocados pelo OCR */
export function num(s) {
  if (s == null) return NaN;
  let t = String(s).trim().replace(/[Oo](?=[\d,.])|(?<=[\d,.])[Oo]/g, "0").replace(/[lI](?=\d)|(?<=\d)[lI]/g, "1").replace(/\s/g, "");
  if (/,\d{1,4}$/.test(t)) t = t.replace(/\./g, "").replace(",", ".");
  else if (/\.\d{3}$/.test(t) && !/\.\d{3}\./.test(t) && t.split(".").length === 2 && t.length > 5) t = t.replace(".", "");
  else t = t.replace(/,/g, "");
  return Number(t);
}

export function normalize(s) {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const NUM_TOKEN = /\d{1,3}(?:\.\d{3})*,\d{1,4}|\d+[.,/]\d{1,4}|\d+/g;

/**
 * Leituras possíveis de um número do OCR. O erro mais comum em foto de cupom é
 * sumir a vírgula: "1,99" vira "199" e "0,635" vira "0635". Como dinheiro
 * sempre tem 2 casas, testamos essas alternativas e quem decide é a conta
 * qtd × unitário = total.
 */
function candidates(raw) {
  const out = [{ value: num(raw.replace("/", ",")), money: /[.,/]\d{2}$/.test(raw), fixed: raw.includes("/") }];
  if (/^\d{3,}$/.test(raw)) out.push({ value: Number(raw) / 100, money: true, fixed: true });
  if (/^0\d{1,3}$/.test(raw)) out.push({ value: Number(`0.${raw.slice(1)}`), money: raw.length === 3, fixed: true });
  return out.filter((c) => Number.isFinite(c.value) && c.value > 0);
}

/** Uma linha de item: acha um trio qtd × unitário ≈ total no fim da linha */
export function parseItemLine(line, { allowNoDesc = false } = {}) {
  const clean = line
    .replace(/\s+/g, " ")
    .replace(/R\$\s?/gi, "")
    .replace(/(\d),\s(\d{2})\b/g, "$1,$2")
    .replace(/\b[oO](?=\d)/g, "0")
    .trim();
  if (clean.length < 6) return null;
  if (/\b\d{1,2}\s?x\b.*(juros|parcela)|\bsem juros\b|\bparcelad|\b(aut|nsu|doc|cv|ec|atc|stoneid|rrn|aid)\b\s*[:.]/i.test(clean)) return null;
  if (/\b(total|subtotal|troco|desconto|acrescimo|valor a pagar|forma de pag|cnpj|cpf|ie:|chave|protocolo|tributos|lei 12\.741)\b/i.test(normalize(clean)) && !/\d+\s*(?:un|kg|cx)\b/i.test(clean)) return null;

  const tokens = [];
  let m;
  NUM_TOKEN.lastIndex = 0;
  while ((m = NUM_TOKEN.exec(clean))) tokens.push({ raw: m[0], index: m.index, cands: candidates(m[0]) });
  if (tokens.length < 2) return null;

  // Testa trios entre os últimos números (DANFE às vezes põe colunas de imposto depois)
  const tail = tokens.slice(-6);
  let best = null;
  for (let i = 0; i < tail.length; i++)
    for (let j = i + 1; j < tail.length; j++)
      for (let k = j + 1; k < tail.length; k++)
        for (const q of tail[i].cands)
          for (const u of tail[j].cands)
            for (const t of tail[k].cands) {
              if (!t.money) continue; // total sempre com centavos
              const diff = Math.abs(q.value * u.value - t.value);
              if (diff > Math.max(0.02, t.value * 0.01)) continue;
              if (u.value < 0.1 || (Number.isInteger(q.value) && q.value > 200)) continue; // leitura absurda
              const fixes = q.fixed + u.fixed + t.fixed;
              const score = (k === tail.length - 1 ? 2 : 0) + (j === i + 1 ? 1 : 0) + (k === j + 1 ? 1 : 0) - diff - fixes * 0.6;
              if (!best || score > best.score) best = { q: { value: q.value, index: tail[i].index }, u: { value: u.value }, t: { value: t.value }, score, fixes };
            }

  // Unitário ilegível, mas qtd e total legíveis: "0,388 866,00 33,36" -> unitário = total ÷ qtd
  if (!best && tail.length >= 3) {
    const [a, , c] = tail.slice(-3);
    const t = c.cands.find((x) => x.money);
    const q = a.cands.find((x) => x.value < 1000 && (/[.,]\d{3}$/.test(a.raw) || Number.isInteger(x.value)));
    const plausible = q && t && t.value / q.value >= 0.1 && (q.value < 1 ? /[.,]\d{3}$/.test(a.raw) : q.value <= 200);
    if (plausible && /[a-z]{3}/i.test(clean.slice(0, a.index))) best = { q: { value: q.value, index: a.index }, u: { value: t.value / q.value }, t: { value: t.value }, suspect: true };
  }

  // Sem trio: "descrição ... valor" (qtd 1)
  if (!best) {
    const last = tokens[tokens.length - 1];
    if (!/[.,]\d{2}$/.test(last.raw) || last.index < 4) return null;
    const before = clean.slice(0, last.index);
    if (!/[a-z]{3}/i.test(before)) return null;
    const v = last.cands[0].value;
    best = { q: { value: 1, index: last.index }, u: { value: v }, t: { value: v }, single: true, suspect: true };
  }
  if (best.fixes) best.suspect = true;

  let descEnd = best.q.index;
  const head = clean.slice(0, descEnd);
  const unitMatch = clean.slice(best.single ? 0 : best.q.index).match(new RegExp(`\\b${UNIT_RE}\\b`, "i")) || head.match(new RegExp(`\\b${UNIT_RE}\\s*$`, "i"));
  let desc = head
    .replace(new RegExp(`\\b${UNIT_RE}\\s*$`, "i"), "")
    .replace(/\s+[xX*]\s*$/, "")
    .replace(/(?<=[A-Z0-9])(UNID|UND|UN)\s*$/i, "")
    .trim();
  // Código no começo (sequencial, EAN, código interno) e NCM/CFOP/CST soltos
  const codeMatch = desc.match(/^(?:\d{1,4}\s+)?(\d{4,14})\s+/);
  desc = desc.replace(/^(?:\d{1,4}\s+)?(?:\d{4,14}\s+)?/, "").replace(/\s\d{8}\s\d{3,4}\s\d{4}.*$/, "").replace(/(\s+\d{2,8})+$/, "").trim();
  if (!/[a-z]{2}/i.test(desc)) {
    if (!allowNoDesc || best.single) return null;
    desc = "";
  }

  return {
    desc: desc.replace(/(\d)[,.]\s(\d)/g, "$1,$2").replace(/\s{2,}/g, " "),
    code: codeMatch?.[1] ?? "",
    qty: best.q.value,
    unit: (unitMatch?.[1] ?? "UN").toUpperCase(),
    unitPrice: best.u.value,
    total: best.t.value,
    ...(best.suspect ? { suspect: true } : {}),
  };
}

/** Texto do OCR -> cabeçalho + itens */
export function parseNotaText(text) {
  const lines = String(text ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const out = { supplier: "", cnpj: "", date: "", total: null, items: [], source: "ocr" };

  const CNPJ = /\d{2}\s?\.?\s?\d{3}\s?\.?\s?\d{3}\s?\/?\s?\d{4}\s?-?\s?\d{2}/;
  const withLabel = lines.findIndex((l) => /cnpj/i.test(l) && CNPJ.test(l));
  const cnpjIdx = withLabel >= 0 ? withLabel : lines.findIndex((l) => CNPJ.test(l));
  if (cnpjIdx >= 0) out.cnpj = lines[cnpjIdx].match(CNPJ)[0].replace(/\s/g, "");
  // Fornecedor: de preferência a linha logo acima do CNPJ; senão a primeira "com cara de nome"
  const looksName = (l) =>
    /[a-z]{3}/i.test(l) &&
    !/(cnpj|documento|danfe|nota fiscal|cupom|consumidor|eletr|auxiliar|ie\b|rua|av\.|avenida|cep|tel|via (lojista|cliente|estabelecimento)|comprovante)/i.test(l) &&
    (l.match(/\d/g)?.length ?? 0) < 6;
  const cleanName = (l) => l.replace(/\s{2,}.*$/, "").replace(/\b(stone|cielo|rede|getnet|pagseguro|pagbank|sumup|mercado pago|ton)\b/gi, "").trim();
  const above = cnpjIdx > 0 ? lines[cnpjIdx - 1] : "";
  const top = lines.slice(0, Math.max(3, cnpjIdx >= 0 ? cnpjIdx + 1 : 4));
  out.supplier = cleanName((above && looksName(above) ? above : top.find(looksName)) ?? "").slice(0, 60);
  // Comprovante de maquininha (não tem itens, só o valor pago)
  out.kind = /via (lojista|cliente|estabelecimento)|stoneid|\bnsu\b|aut[\s.:]|aprovad[oa]/i.test(text) && !/\b(qtd|quant|vl\.? unit|descri)/i.test(text) ? "comprovante" : "nota";

  const dm = String(text).match(/\b(\d{2})[/.-](\d{2})[/.-](\d{4}|\d{2})\b/);
  if (dm) {
    const y = dm[3].length === 2 ? `20${dm[3]}` : dm[3];
    if (+dm[2] >= 1 && +dm[2] <= 12 && +dm[1] >= 1 && +dm[1] <= 31) out.date = `${y}-${dm[2]}-${dm[1]}`;
  }

  for (const raw of lines) {
    const l = raw.replace(/\s+/g, " ").replace(/(\d),\s(\d{2})\b/g, "$1,$2");
    const tm = l.match(/(?:valor\s+total|total\s+(?:da\s+nota|r\$|a\s+pagar)|valor\s+a\s+pagar|v\.?\s*total\s+da\s+nota)\D{0,12}(\d{1,3}(?:\.\d{3})*,\d{2}|\d+[.,]\d{2})/i);
    if (tm) out.total = num(tm[1]);
    // Comprovante: "CRÉDITO   R$ 52,00" / "DÉBITO" / "PIX" / "VALOR"
    const cm = !out.total && l.match(/\b(cr[eé]dito|d[eé]bito|pix|voucher|valor(?: aprovado)?)\b.*?R?\$?\s?(\d{1,3}(?:\.\d{3})*,\d{2})/i);
    if (cm) out.total = num(cm[2]);
  }

  if (out.kind === "comprovante") return out;
  let inItems = false;
  let ended = false;
  let pending = ""; // descrição numa linha, quantidade/valores na linha de baixo
  for (const l of lines) {
    const n = normalize(l);
    if (/(descricao|produto|cod\b|codigo).*(qtd|quant|vl|valor)/.test(n)) { inItems = true; pending = ""; continue; }
    if (/^(qtd\.? total|quantidade total|valor total|valor sub|total|subtotal|forma de pagamento|valor a pagar)/.test(n)) {
      if (out.items.length) ended = true; // daqui pra baixo é pagamento, chave e rodapé
      pending = "";
      continue;
    }
    if (ended) continue;
    const item = parseItemLine(l, { allowNoDesc: !!pending });
    if (item && !item.desc && pending) {
      const p = parseItemLine(`${pending} ${l}`);
      if (p && p.desc) { out.items.push(p); pending = ""; continue; }
    }
    if (item && item.desc) { out.items.push(item); pending = ""; continue; }
    // Linha só com texto (e talvez código): candidata a descrição do próximo item
    pending = inItems && /[a-z]{3}/i.test(l) && !/[.,]\d{2}\s*$/.test(l.trim()) ? l : "";
  }
  return out;
}

/** XML de NF-e/NFC-e (procNFe ou NFe) -> mesmo formato. Recebe um parser de DOM. */
export function parseNfeXml(xml, DOMParserImpl = globalThis.DOMParser) {
  const doc = new DOMParserImpl().parseFromString(xml, "text/xml");
  const pick = (root, tag) => root?.getElementsByTagName(tag)?.[0]?.textContent?.trim() ?? "";
  const emit = doc.getElementsByTagName("emit")[0];
  if (!emit && !doc.getElementsByTagName("det").length) throw new Error("Esse arquivo não parece um XML de NF-e.");
  const dh = pick(doc, "dhEmi") || pick(doc, "dEmi");
  const items = [...doc.getElementsByTagName("det")].map((det) => {
    const prod = det.getElementsByTagName("prod")[0];
    return {
      desc: pick(prod, "xProd"),
      code: pick(prod, "cProd"),
      ean: pick(prod, "cEAN"),
      qty: Number(pick(prod, "qCom")),
      unit: pick(prod, "uCom").toUpperCase(),
      unitPrice: Number(pick(prod, "vUnCom")),
      total: Number(pick(prod, "vProd")) - Number(pick(prod, "vDesc") || 0),
    };
  });
  return {
    supplier: pick(emit, "xFant") || pick(emit, "xNome"),
    cnpj: pick(emit, "CNPJ"),
    date: dh.slice(0, 10),
    total: Number(pick(doc, "vNF")) || null,
    number: pick(doc, "nNF"),
    items,
    source: "xml",
  };
}

/**
 * Fator para converter a quantidade da nota na unidade do insumo.
 * Ex.: nota em G e insumo em kg -> 0,001. Retorna null quando não dá pra saber
 * (ex.: CX de 2,5 kg) — aí o usuário informa e o sistema lembra.
 */
export function unitFactor(notaUnit, ingUnit) {
  const u = String(notaUnit ?? "").toUpperCase();
  const map = { KG: ["kg", 1], KGS: ["kg", 1], G: ["kg", 0.001], GR: ["kg", 0.001], L: ["l", 1], LT: ["l", 1], LTS: ["l", 1], ML: ["l", 0.001] };
  if (map[u]) return map[u][0] === ingUnit ? map[u][1] : null;
  if (["UN", "UND", "UNID", "UNI", "PC", "PCS", "LA", "LATA"].includes(u)) return ingUnit === "un" ? 1 : null;
  return null;
}

/** Peso/volume escrito na descrição: "BATATA PALITO 2,5KG", "OLEO SOJA 900ML" -> { qty, unit } */
export function packSize(desc) {
  const m = String(desc).replace(/(\d)[,.]\s(\d)/g, "$1,$2").match(/(\d+(?:[.,]\d+)?)\s?(KG|G|GR|L|LT|ML)\b/i);
  if (!m) return null;
  const v = num(m[1]);
  const u = m[2].toUpperCase();
  if (u === "KG") return { qty: v, unit: "kg" };
  if (u === "G" || u === "GR") return { qty: v / 1000, unit: "kg" };
  if (u === "L" || u === "LT") return { qty: v, unit: "l" };
  return { qty: v / 1000, unit: "l" };
}

/** Pontua o quanto a descrição da nota parece com o nome do insumo (0..1) */
export function similarity(a, b) {
  const stop = new Set(["de", "da", "do", "com", "em", "kg", "un", "pct", "cx", "tipo", "e", "c", "s"]);
  const ta = new Set(normalize(a).split(" ").filter((w) => w.length > 1 && !stop.has(w) && !/^\d/.test(w)));
  const tb = new Set(normalize(b).split(" ").filter((w) => w.length > 1 && !stop.has(w) && !/^\d/.test(w)));
  if (!ta.size || !tb.size) return 0;
  let hit = 0;
  for (const w of tb) for (const v of ta) if (v === w || (w.length >= 4 && (v.startsWith(w.slice(0, 4)) || w.startsWith(v.slice(0, 4))))) { hit++; break; }
  return hit / tb.size;
}
