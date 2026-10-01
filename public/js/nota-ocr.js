// Leitura de nota por foto com Tesseract.js (roda no navegador, sem servidor).
// O modelo de português (~2 MB) é baixado no primeiro uso e fica em cache.
const TESSERACT = "https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.esm.min.js";

let workerPromise = null;
let progressCb = null;

async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const mod = await import(TESSERACT);
      const { createWorker } = mod.default ?? mod;
      const worker = await createWorker("por", 1, {
        logger: (m) => progressCb?.(m),
      });
      // 6 = bloco de texto uniforme: funciona bem para cupom e DANFE em colunas
      await worker.setParameters({ tessedit_pageseg_mode: "6", preserve_interword_spaces: "1" });
      return worker;
    })().catch((e) => {
      workerPromise = null;
      throw e;
    });
  }
  return workerPromise;
}

/**
 * Corrige iluminação: estima o "branco do papel" em blocos (percentil 90 de cada
 * bloco, interpolado) e divide cada pixel por ele. Papel vira branco mesmo com
 * sombra do celular, fundo cinza ou cupom térmico apagado; o texto fica escuro.
 */
function normalizeLighting(d, w, h) {
  const gray = new Float32Array(w * h);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) gray[j] = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
  const B = 48;
  const bw = Math.ceil(w / B), bh = Math.ceil(h / B);
  const bg = new Float32Array(bw * bh);
  const hist = new Uint32Array(256);
  for (let by = 0; by < bh; by++)
    for (let bx = 0; bx < bw; bx++) {
      hist.fill(0);
      let n = 0;
      for (let y = by * B; y < Math.min(h, (by + 1) * B); y += 2)
        for (let x = bx * B; x < Math.min(w, (bx + 1) * B); x += 2) { hist[gray[y * w + x] | 0]++; n++; }
      let acc = 0, v = 255;
      for (; v > 0; v--) if ((acc += hist[v]) >= n * 0.1) break;
      bg[by * bw + bx] = Math.max(v, 40);
    }
  const at = (x, y) => bg[Math.min(bh - 1, Math.max(0, y)) * bw + Math.min(bw - 1, Math.max(0, x))];
  for (let y = 0; y < h; y++) {
    const fy = y / B - 0.5, y0 = Math.floor(fy), ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = x / B - 0.5, x0 = Math.floor(fx), tx = fx - x0;
      const b = (at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx) * (1 - ty) + (at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx) * ty;
      // Curva leve: puxa o texto pro preto e o papel pro branco
      let v = (gray[y * w + x] / b) * 255;
      v = v >= 235 ? 255 : Math.max(0, (v - 40) * 1.2);
      const i = (y * w + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = v > 255 ? 255 : v;
    }
  }
}

/**
 * Recorta (crop em fração 0..1), corrige iluminação e deixa no tamanho ideal.
 */
export async function prepare(file, crop = null) {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const sx = Math.round((crop?.x ?? 0) * bmp.width), sy = Math.round((crop?.y ?? 0) * bmp.height);
  const sw = Math.round((crop?.w ?? 1) * bmp.width), sh = Math.round((crop?.h ?? 1) * bmp.height);
  const target = Math.min(2400, Math.max(1400, sw));
  const scale = Math.min(target / sw, 4000 / sh, 3);
  const w = Math.round(sw * scale);
  const h = Math.round(sh * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  normalizeLighting(img.data, w, h);
  ctx.putImageData(img, 0, 0);
  bmp.close?.();
  return canvas;
}

/**
 * onProgress({ stage, pct }) — stage: "modelo" (baixando/iniciando) | "lendo"
 * Retorna { text, confidence }
 */
export async function readNotaImage(file, onProgress, crop = null) {
  progressCb = (m) => {
    if (m.status === "recognizing text") onProgress?.({ stage: "lendo", pct: Math.round((m.progress ?? 0) * 100) });
    else onProgress?.({ stage: "modelo", pct: Math.round((m.progress ?? 0) * 100), status: m.status });
  };
  onProgress?.({ stage: "modelo", pct: 0 });
  const [worker, canvas] = await Promise.all([getWorker(), prepare(file, crop)]);
  const { data } = await worker.recognize(canvas);
  progressCb = null;
  return { text: data.text, confidence: data.confidence };
}
