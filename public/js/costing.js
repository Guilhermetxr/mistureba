/*
 * Motor de custo — o coração do CMV.
 *
 * Custo de cada linha da ficha técnica:
 *   insumo  -> qtd líquida × fator de correção × custo unitário
 *   produto -> qtd × custo unitário do produto/preparo (custo total ÷ rendimento)
 *
 * Produtos podem conter preparos (molho da casa, blend moldado) e outros
 * produtos (combos) em qualquer profundidade. Ciclos são ignorados.
 *
 * Arquivo puro (sem Firebase): uma cópia idêntica vive em functions/costing.js
 * para as integrações (iFood) calcularem o CMV no servidor.
 *
 * ingredient: { id, name, unit, unitCost, fc }
 * product:    { id, name, kind, yieldQty, yieldUnit, recipe: [{ type: "ing"|"prod", id, qty }] }
 */
export class CostBook {
  constructor(ingredients = [], products = []) {
    this.ingredients = new Map(ingredients.map((i) => [i.id, i]));
    this.products = new Map(products.map((p) => [p.id, p]));
    this.memo = new Map();
    this.usageMemo = new Map();
  }

  /** Custo (R$) de 1 unidade de rendimento do produto */
  unitCost(productId, stack = []) {
    if (this.memo.has(productId)) return this.memo.get(productId);
    if (stack.includes(productId)) return 0;
    const p = this.products.get(productId);
    if (!p) return 0;
    const total = this.lines(productId, [...stack, productId]).reduce((s, l) => s + l.cost, 0);
    const cost = total / (p.yieldQty || 1);
    this.memo.set(productId, cost);
    return cost;
  }

  unitCostCents(productId) {
    return Math.round(this.unitCost(productId) * 100);
  }

  /** Linhas da ficha com custo calculado */
  lines(productId, stack = [productId]) {
    const p = this.products.get(productId);
    return (p?.recipe ?? []).map((item, index) => {
      if (item.type === "ing") {
        const ing = this.ingredients.get(item.id);
        const fc = ing?.fc || 1;
        const grossQty = item.qty * fc;
        const unitCost = ing?.unitCost ?? 0;
        return { index, item, name: ing?.name ?? "(insumo removido)", unit: ing?.unit ?? "un", fc, isSub: false, grossQty, unitCost, cost: grossQty * unitCost, missing: !ing };
      }
      const sub = this.products.get(item.id);
      const unitCost = stack.includes(item.id) ? 0 : this.unitCost(item.id, stack);
      return { index, item, name: sub?.name ?? "(produto removido)", unit: sub?.yieldUnit ?? "un", fc: 1, isSub: true, grossQty: item.qty, unitCost, cost: item.qty * unitCost, missing: !sub };
    });
  }

  /** Quanto de cada insumo (bruto, já com FC) sai do estoque ao vender 1 unidade */
  usage(productId, stack = []) {
    if (this.usageMemo.has(productId)) return this.usageMemo.get(productId);
    const out = new Map();
    if (stack.includes(productId)) return out;
    const p = this.products.get(productId);
    const y = p?.yieldQty || 1;
    for (const item of p?.recipe ?? []) {
      if (item.type === "ing") {
        const fc = this.ingredients.get(item.id)?.fc || 1;
        out.set(item.id, (out.get(item.id) ?? 0) + (item.qty * fc) / y);
      } else {
        for (const [ing, q] of this.usage(item.id, [...stack, productId])) {
          out.set(ing, (out.get(ing) ?? 0) + (q * item.qty) / y);
        }
      }
    }
    this.usageMemo.set(productId, out);
    return out;
  }

  /** Produtos de venda que usam o insumo (direto ou via preparo/combo) */
  productsUsing(ingredientId) {
    return [...this.products.values()].filter((p) => p.kind === "venda" && this.usage(p.id).has(ingredientId));
  }

  /** Participação de cada insumo no custo do produto (para o gráfico "de onde vem o custo") */
  breakdown(productId) {
    const u = this.usage(productId);
    return [...u.entries()]
      .map(([id, q]) => {
        const ing = this.ingredients.get(id);
        return { id, name: ing?.name ?? "?", qty: q, unit: ing?.unit, cost: q * (ing?.unitCost ?? 0) };
      })
      .sort((a, b) => b.cost - a.cost);
  }
}

/** Preço sugerido para bater o CMV alvo */
export const priceForTargetCmv = (costCents, targetPct) => (targetPct > 0 ? Math.ceil(costCents / (targetPct / 100) / 10) * 10 : 0);

/**
 * Margem de contribuição unitária:
 * preço − custo − taxas (maquininha/iFood) − impostos sobre venda
 */
export function contribution(priceCents, costCents, feePct, taxPct) {
  const fees = Math.round((priceCents * feePct) / 100);
  const tax = Math.round((priceCents * taxPct) / 100);
  const mc = priceCents - costCents - fees - tax;
  return { fees, tax, mc, mcPct: priceCents ? (mc / priceCents) * 100 : 0, cmvPct: priceCents ? (costCents / priceCents) * 100 : 0 };
}

/**
 * Engenharia de cardápio (Kasavana & Smith).
 * rows: [{ id, qty, mc }] — mc = margem de contribuição unitária
 */
export function menuEngineering(rows) {
  const totalQty = rows.reduce((s, r) => s + r.qty, 0);
  if (!rows.length || !totalQty) return rows.map((r) => ({ ...r, klass: "sem-venda" }));
  const popCut = (1 / rows.length) * 0.7 * totalQty;
  const avgMc = rows.reduce((s, r) => s + r.mc * r.qty, 0) / totalQty;
  return rows.map((r) => {
    const pop = r.qty >= popCut;
    const high = r.mc >= avgMc;
    const klass = r.qty === 0 ? "sem-venda" : pop && high ? "estrela" : pop ? "burro" : high ? "enigma" : "cao";
    return { ...r, klass, popCut, avgMc };
  });
}

export const MENU_CLASS = {
  estrela: { label: "Estrela", tip: "Vende muito e dá boa margem. Mantenha, destaque no cardápio e não mexa na receita." },
  burro: { label: "Burro de carga", tip: "Vende muito, mas margem baixa. Revise a ficha (porção, insumo mais barato) ou suba o preço aos poucos." },
  enigma: { label: "Enigma", tip: "Margem boa, mas vende pouco. Dê destaque, foto melhor, ofereça no balcão ou em combo." },
  cao: { label: "Cão", tip: "Vende pouco e margem baixa. Candidato a sair do cardápio ou ser reformulado." },
  "sem-venda": { label: "Sem venda", tip: "Nenhuma venda no período." },
};
