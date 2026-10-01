/*
 * Agregado diário de vendas (dailyStats/{YYYY-MM-DD}).
 * Cada venda soma (sign = 1) ou subtrai (sign = -1, cancelamento) com increment(),
 * então relatórios do mês leem ~30 documentos em vez de milhares de vendas.
 *
 * Arquivo puro: uma cópia vive em functions/shared/stats.js (npm run sync).
 */
export function buildStatsPatch(sale, sign, increment) {
  const inc = (v) => increment(sign * (v || 0));
  const hour = sale.hour ?? "00";
  const byProduct = {};
  for (const it of sale.items) {
    const key = it.productId || "_avulso";
    const cur = byProduct[key] ?? { name: it.name, category: it.category ?? "", qty: 0, revenue: 0, cost: 0 };
    cur.qty += it.qty;
    cur.revenue += it.qty * it.price;
    cur.cost += it.qty * it.cost;
    byProduct[key] = cur;
  }
  const byMethod = {};
  for (const p of sale.payments) {
    const key = p.methodId || p.kind;
    const cur = byMethod[key] ?? { name: p.name, kind: p.kind, amount: 0, fee: 0, count: 0 };
    cur.amount += p.amount;
    cur.fee += p.fee;
    cur.count += 1;
    byMethod[key] = cur;
  }
  // Recebíveis: quanto cai na conta, e quando (cartão/pix/iFood; dinheiro já está na gaveta)
  const receivables = {};
  for (const p of sale.payments) {
    if (p.kind === "dinheiro" || !p.settleDate) continue;
    let net = p.amount - p.fee;
    if (p.kind === "ifood") net -= sale.commission;
    receivables[p.settleDate] ??= {};
    receivables[p.settleDate][p.kind] = (receivables[p.settleDate][p.kind] ?? 0) + net;
  }
  // Só manda "receivables" quando há algo: um mapa vazio com merge apaga os recebíveis do dia inteiro
  const receivablesPatch = Object.keys(receivables).length
    ? {
        receivables: Object.fromEntries(
          Object.entries(receivables).map(([d, kinds]) => [d, Object.fromEntries(Object.entries(kinds).map(([k, v]) => [k, inc(v)]))]),
        ),
      }
    : {};
  return {
    ...receivablesPatch,
    day: sale.day,
    month: sale.month,
    revenue: inc(sale.total),
    orders: inc(1),
    cost: inc(sale.cost),
    fees: inc(sale.fees),
    commission: inc(sale.commission),
    discount: inc(sale.discount),
    deliveryFee: inc(sale.deliveryFee),
    ...(sign < 0 ? { canceled: increment(1), canceledValue: increment(sale.total) } : {}),
    byChannel: {
      [sale.channel]: { revenue: inc(sale.total), orders: inc(1), cost: inc(sale.cost), fees: inc(sale.fees), commission: inc(sale.commission) },
    },
    byHour: { [hour]: { revenue: inc(sale.total), orders: inc(1) } },
    byProduct: Object.fromEntries(
      Object.entries(byProduct).map(([k, v]) => [k, { name: v.name, category: v.category, qty: inc(v.qty), revenue: inc(v.revenue), cost: inc(v.cost) }]),
    ),
    byMethod: Object.fromEntries(
      Object.entries(byMethod).map(([k, v]) => [k, { name: v.name, kind: v.kind, amount: inc(v.amount), fee: inc(v.fee), count: inc(v.count) }]),
    ),
  };
}
