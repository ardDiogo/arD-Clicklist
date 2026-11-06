import { formatCurrency } from '@/lib/format'
import type {
  BuyerStat,
  Confidence,
  DateRange,
  Insight,
  IntelFilters,
  Overview,
  Preset,
  PriceStat,
  ProductStat,
  ProductsData,
  StoresData,
} from './types'

// -----------------------------------------------------------------------------
// Datas (sempre AAAA-MM-DD no fuso de Brasília)
// -----------------------------------------------------------------------------
export function todayBR(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

function toUTC(d: string): Date {
  const [y, m, day] = d.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(y, m - 1, day))
}

function fromUTC(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export function addDays(d: string, n: number): string {
  const x = toUTC(d)
  x.setUTCDate(x.getUTCDate() + n)
  return fromUTC(x)
}

export function addMonthsDate(d: string, n: number): string {
  const [y, m, day] = d.split('-').map(Number) as [number, number, number]
  const last = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate()
  return fromUTC(new Date(Date.UTC(y, m - 1 + n, Math.min(day, last))))
}

export function daysBetween(from: string, to: string): number {
  return Math.round((toUTC(to).getTime() - toUTC(from).getTime()) / 86_400_000)
}

const isDate = (s: string | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s)

export const PRESETS: { value: Preset; label: string; short: string }[] = [
  { value: '7d', label: 'Últimos 7 dias', short: '7 dias' },
  { value: '30d', label: 'Últimos 30 dias', short: '30 dias' },
  { value: '90d', label: 'Últimos 90 dias', short: '90 dias' },
  { value: '6m', label: 'Últimos 6 meses', short: '6 meses' },
  { value: '12m', label: 'Últimos 12 meses', short: '12 meses' },
  { value: 'ytd', label: 'Este ano', short: 'Este ano' },
  { value: 'custom', label: 'Personalizado', short: 'Personalizado' },
]

/** Intervalo de datas do filtro (inclusivo). */
export function resolveRange(f: IntelFilters, today = todayBR()): DateRange {
  switch (f.preset) {
    case '7d':
      return { from: addDays(today, -6), to: today }
    case '30d':
      return { from: addDays(today, -29), to: today }
    case '90d':
      return { from: addDays(today, -89), to: today }
    case '6m':
      return { from: addDays(addMonthsDate(today, -6), 1), to: today }
    case '12m':
      return { from: addDays(addMonthsDate(today, -12), 1), to: today }
    case 'ytd':
      return { from: `${today.slice(0, 4)}-01-01`, to: today }
    case 'custom': {
      const from = isDate(f.from) ? f.from : addDays(today, -29)
      const to = isDate(f.to) ? f.to : today
      return from <= to ? { from, to } : { from: to, to: from }
    }
  }
}

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

/** "05/10/2026" a partir de "2026-10-05" (sem conversão de fuso). */
export function fmtDay(d: string | null | undefined, withYear = true): string {
  if (!d) return '—'
  const [y, m, day] = d.slice(0, 10).split('-')
  return withYear ? `${day}/${m}/${y}` : `${day}/${m}`
}

export function rangeLabel(r: DateRange): string {
  return `${fmtDay(r.from)} a ${fmtDay(r.to)}`
}

/** Rótulo curto do ponto da série conforme o agrupamento. */
export function bucketLabel(bucket: string, granularity: Overview['granularity'], long = false): string {
  const [y, m] = bucket.split('-').map(Number) as [number, number]
  if (granularity === 'month') return long ? `${MONTHS[m - 1]} de ${y}` : `${MONTHS[m - 1]}/${String(y).slice(2)}`
  if (granularity === 'week') return long ? `semana de ${fmtDay(bucket)}` : fmtDay(bucket, false)
  return long ? fmtDay(bucket) : bucket.slice(8, 10)
}

// -----------------------------------------------------------------------------
// Números
// -----------------------------------------------------------------------------
/** ((atual − anterior) / anterior) × 100, com 1 casa. Null sem base de comparação. */
export function pctChange(current: number | null | undefined, previous: number | null | undefined): number | null {
  if (current === null || current === undefined || previous === null || previous === undefined || previous === 0) return null
  return Math.round(((current - previous) / previous) * 1000) / 10
}

export function fmtPct(p: number | null | undefined, signed = true): string {
  if (p === null || p === undefined) return '—'
  const s = Math.abs(p).toLocaleString('pt-BR', { maximumFractionDigits: 1 })
  if (!signed) return `${s}%`
  return p > 0 ? `+${s}%` : p < 0 ? `−${s}%` : '0%'
}

export function fmtShare(share: number): string {
  return `${(share * 100).toLocaleString('pt-BR', { maximumFractionDigits: share < 0.1 ? 1 : 0 })}%`
}

export function fmtQty(q: number, unit: string): string {
  const n = q.toLocaleString('pt-BR', { maximumFractionDigits: 3 })
  return `${n} ${unit.toLowerCase()}`
}

/** "PAO FORMA SEVEN BOYS 450G LEITE" → "Pao Forma Seven Boys 450g Leite" (rótulo da marca/apresentação). */
export function prettyVariant(label: string | null | undefined, max = 48): string {
  if (!label) return ''
  const t = label
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/(^|\s)([a-zà-ú])/g, (_, s: string, c: string) => s + c.toUpperCase())
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

/** Preço por kg/L calculado pelo tamanho escrito na nota ("450G", "CX12"…). */
export function perBase(p: { price_per_base: number | null; base_unit: 'kg' | 'L' | null }): string | null {
  if (p.price_per_base === null || p.price_per_base === undefined || !p.base_unit) return null
  return `${formatCurrency(p.price_per_base)}/${p.base_unit}`
}

/** Preço por kg/L quando o produto tem tamanho de embalagem e foi comprado por unidade. */
export function normalizedPrice(p: Pick<PriceStat, 'last_price' | 'unit' | 'package_size' | 'measure_unit'>): string | null {
  if (!p.package_size || p.unit !== 'UN') return null
  const conv: Record<string, [number, string]> = { kg: [1, 'kg'], g: [1000, 'kg'], l: [1, 'L'], ml: [1000, 'L'] }
  const c = conv[p.measure_unit]
  if (!c) return null
  const base = p.package_size / c[0]
  if (base <= 0) return null
  return `${formatCurrency(p.last_price / base)}/${c[1]}`
}

/** Estimativa do próximo mês: média dos meses fechados com compras (mínimo 2). */
export function forecastNextMonth(
  months: { month: string; total: number }[],
  today = todayBR(),
): { value: number; min: number; max: number; months: number } | null {
  const current = `${today.slice(0, 7)}-01`
  const closed = months.filter((m) => m.month < current && m.total > 0).slice(-6)
  if (closed.length < 2) return null
  const totals = closed.map((m) => m.total)
  const value = Math.round((totals.reduce((s, t) => s + t, 0) / totals.length) * 100) / 100
  return { value, min: Math.min(...totals), max: Math.max(...totals), months: closed.length }
}

// -----------------------------------------------------------------------------
// Rankings de produtos e preços
// -----------------------------------------------------------------------------
export function topBy<T>(rows: T[], score: (r: T) => number | null | undefined, n: number, dir: 'desc' | 'asc' = 'desc'): T[] {
  return rows
    .filter((r) => {
      const v = score(r)
      return v !== null && v !== undefined && Number.isFinite(v)
    })
    .sort((a, b) => (dir === 'desc' ? (score(b) as number) - (score(a) as number) : (score(a) as number) - (score(b) as number)))
    .slice(0, n)
}

/** Produtos que costumam ser repostos e já passaram bastante do intervalo habitual. */
export function overdueProducts(rows: ProductStat[]): ProductStat[] {
  return rows
    .filter((p) => p.avg_interval_days && p.purchase_days >= 3 && p.days_since_last > p.avg_interval_days * 1.5)
    .sort((a, b) => b.days_since_last / (b.avg_interval_days ?? 1) - a.days_since_last / (a.avg_interval_days ?? 1))
}

// -----------------------------------------------------------------------------
// Insights do arD — regras sobre números calculados (sem IA generativa)
// -----------------------------------------------------------------------------
function confidenceFrom(n: number, high: number, medium: number): Confidence {
  return n >= high ? 'alta' : n >= medium ? 'média' : 'baixa'
}

export interface InsightInput {
  range: DateRange
  overview?: Overview | null
  stores?: StoresData | null
  products?: ProductsData | null
  prices?: PriceStat[] | null
  buyers?: BuyerStat[] | null
}

export function buildInsights({ range, overview, stores, products, prices, buyers }: InsightInput): Insight[] {
  const out: Insight[] = []
  const period = rangeLabel(range)

  if (overview) {
    const cur = overview.kpis
    const prev = overview.previous_kpis
    const delta = pctChange(cur.total, prev.total)
    if (delta !== null && Math.abs(delta) >= 10 && cur.purchases > 0) {
      out.push({
        id: 'spend-change',
        title: delta > 0 ? `Gasto ${fmtPct(delta, false)} maior que no período anterior` : `Gasto ${fmtPct(delta, false)} menor que no período anterior`,
        description: `${formatCurrency(cur.total)} em ${cur.purchases} ${cur.purchases === 1 ? 'compra' : 'compras'}, contra ${formatCurrency(prev.total)} de ${fmtDay(overview.previous.from)} a ${fmtDay(overview.previous.to)}.`,
        metric: `Total gasto ${fmtPct(delta)}`,
        period,
        source: 'Comprovantes confirmados',
        confidence: confidenceFrom(Math.min(cur.purchases, prev.purchases), 4, 2),
        tone: delta > 0 ? 'warning' : 'positive',
      })
    }

    const rising = overview.categories
      .filter((c) => c.prev_total > 0 && c.change_pct !== null && c.change_pct >= 15 && c.total - c.prev_total >= 20 && c.name !== 'Não associados')
      .sort((a, b) => b.total - b.prev_total - (a.total - a.prev_total))[0]
    if (rising) {
      out.push({
        id: `category-up-${rising.name}`,
        title: `Vocês gastaram ${fmtPct(rising.change_pct, false)} a mais com ${rising.name}`,
        description: `${formatCurrency(rising.total)} no período, contra ${formatCurrency(rising.prev_total)} no período anterior equivalente.`,
        metric: `${rising.name}: ${fmtPct(rising.change_pct)}`,
        period,
        source: 'Itens dos comprovantes, por categoria do produto',
        confidence: confidenceFrom(Math.min(cur.purchases, prev.purchases), 4, 2),
        tone: 'warning',
      })
    }

    const top = overview.categories.filter((c) => c.name !== 'Não associados')[0]
    if (top && top.share >= 0.35 && cur.purchases >= 2) {
      out.push({
        id: 'category-share',
        title: `${top.name} concentra ${fmtShare(top.share)} dos gastos`,
        description: `É a categoria que mais pesa no orçamento: ${formatCurrency(top.total)} no período.`,
        metric: `Participação ${fmtShare(top.share)}`,
        period,
        source: 'Itens dos comprovantes, por categoria do produto',
        confidence: null,
        tone: 'neutral',
      })
    }

    const unlinked = overview.categories.find((c) => c.name === 'Não associados')
    if (unlinked && unlinked.share >= 0.1) {
      out.push({
        id: 'unlinked',
        title: `${fmtShare(unlinked.share)} dos itens não estão ligados a um produto`,
        description: 'Esses itens ficam fora das comparações de preço e de categoria. Associe-os na revisão da compra para análises mais completas.',
        metric: `${formatCurrency(unlinked.total)} sem produto`,
        period,
        source: 'Itens dos comprovantes',
        confidence: null,
        tone: 'neutral',
      })
    }

    const outlier = overview.tickets.filter((t) => t.outlier).sort((a, b) => b.total - a.total)[0]
    if (outlier) {
      out.push({
        id: `outlier-${outlier.purchase_id}`,
        title: 'Uma compra ficou bem acima do padrão',
        description: `${fmtDay(outlier.date)} em ${outlier.store_name}: ${formatCurrency(outlier.total)}, acima do limite estatístico das demais compras do período.`,
        metric: `Ticket ${formatCurrency(outlier.total)} · média ${formatCurrency(cur.avg_ticket)}`,
        period,
        source: 'Comprovantes confirmados (critério do intervalo interquartil)',
        confidence: confidenceFrom(overview.tickets.length, 10, 6),
        tone: 'neutral',
      })
    }
  }

  if (stores) {
    const ranked = stores.price_index
    const best = ranked[0]
    if (ranked.length >= 2 && best && best.compared >= 3) {
      const totalCompared = stores.basket.length
      out.push({
        id: 'store-cheapest',
        title: `${best.store_name} teve o menor preço em ${best.wins} de ${best.compared} produtos comparáveis`,
        description:
          best.index <= 1
            ? `Na cesta de produtos iguais (mesma marca e apresentação), ${best.store_name} teve o menor preço em todos os produtos comparados.`
            : `Na cesta de produtos iguais (mesma marca e apresentação), os preços de ${best.store_name} ficaram em média ${fmtPct((best.index - 1) * 100, false)} acima do menor preço encontrado.`,
        metric: `Índice de preço ${best.index.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} · ${totalCompared} produtos na cesta`,
        period: `${rangeLabel(stores.window)} (preços recentes)`,
        source: 'Último preço pago de cada produto em cada mercado',
        confidence: confidenceFrom(best.compared, 10, 5),
        tone: 'positive',
      })
    }
    const saving = stores.savings[0]
    if (saving && saving.saving >= 1) {
      const sum = stores.savings.reduce((s, x) => s + x.saving, 0)
      out.push({
        id: 'saving-top',
        title: `A maior oportunidade de economia está em ${saving.product_name}`,
        description: `${saving.variant_label ? `${prettyVariant(saving.variant_label)} — c` : 'C'}omprando no ${saving.best_store_name} (${formatCurrency(saving.best_price)}), teriam pago ${formatCurrency(saving.saving)} a menos. No total, ${formatCurrency(sum)} em ${stores.savings.length} ${stores.savings.length === 1 ? 'produto' : 'produtos'} — valor hipotético, não economia realizada.`,
        metric: `Economia potencial ${formatCurrency(saving.saving)}`,
        period,
        source: 'Preços do mesmo produto em outros mercados (até 90 dias de diferença)',
        confidence: confidenceFrom(saving.lines, 4, 2),
        tone: 'positive',
      })
    }
  }

  if (prices) {
    const up = topBy(prices.filter((p) => (p.last_vs_prev_pct ?? 0) >= 5), (p) => p.last_vs_prev_pct, 1)[0]
    if (up) {
      out.push({
        id: `price-up-${up.variant_key ?? up.household_product_id}`,
        title: `O preço de ${up.product_name} aumentou ${fmtPct(up.last_vs_prev_pct, false)}`,
        description: `${up.variant_label ? `${prettyVariant(up.variant_label)}: ` : ''}último preço ${formatCurrency(up.last_price)}, contra ${formatCurrency(up.prev_price)} na compra anterior da mesma marca.`,
        metric: `Variação ${fmtPct(up.last_vs_prev_pct)}`,
        period,
        source: 'Preço líquido pago (com descontos) nas duas últimas compras',
        confidence: confidenceFrom(up.observations, 4, 2),
        tone: 'warning',
      })
    }
    const down = topBy(prices.filter((p) => (p.last_vs_prev_pct ?? 0) <= -5), (p) => p.last_vs_prev_pct, 1, 'asc')[0]
    if (down) {
      out.push({
        id: `price-down-${down.variant_key ?? down.household_product_id}`,
        title: `${down.product_name} ficou ${fmtPct(down.last_vs_prev_pct, false)} mais barato`,
        description: `${down.variant_label ? `${prettyVariant(down.variant_label)}: ` : ''}último preço ${formatCurrency(down.last_price)}, contra ${formatCurrency(down.prev_price)} na compra anterior da mesma marca.`,
        metric: `Variação ${fmtPct(down.last_vs_prev_pct)}`,
        period,
        source: 'Preço líquido pago (com descontos) nas duas últimas compras',
        confidence: confidenceFrom(down.observations, 4, 2),
        tone: 'positive',
      })
    }
  }

  if (products) {
    const frequent = topBy(
      products.products.filter((p) => p.purchase_days >= 3),
      (p) => p.avg_interval_days,
      1,
      'asc',
    )[0]
    if (frequent && frequent.avg_interval_days) {
      out.push({
        id: `frequent-${frequent.key}`,
        title: `${frequent.product_name} é um dos produtos de reposição mais frequente`,
        description: `Comprado em ${frequent.purchase_days} datas diferentes, em média a cada ${Math.round(frequent.avg_interval_days)} dias. Intervalo entre compras, não necessariamente o consumo real.`,
        metric: `Intervalo médio ${Math.round(frequent.avg_interval_days)} dias`,
        period: 'Histórico completo até o fim do período',
        source: 'Datas das compras confirmadas',
        confidence: confidenceFrom(frequent.purchase_days, 6, 4),
        tone: 'neutral',
      })
    }
    const overdue = overdueProducts(products.products).find((p) => (p.current_qty ?? 0) === 0)
    if (overdue && overdue.avg_interval_days) {
      out.push({
        id: `overdue-${overdue.key}`,
        title: `${overdue.product_name} está há ${overdue.days_since_last} dias sem compra`,
        description: `Costuma ser comprado a cada ${Math.round(overdue.avg_interval_days)} dias e o estoque registrado está zerado. Vale conferir se precisa ir para a lista.`,
        metric: `${overdue.days_since_last} dias · habitual ${Math.round(overdue.avg_interval_days)}`,
        period: 'Histórico completo',
        source: 'Datas das compras confirmadas e estoque atual',
        confidence: confidenceFrom(overdue.purchase_days, 6, 4),
        tone: 'warning',
      })
    }
  }

  if (buyers) {
    const named = buyers.filter((b) => b.user_id)
    const top = named[0]
    if (named.length >= 2 && top && top.share >= 0.6) {
      out.push({
        id: `buyer-share-${top.user_id}`,
        title: `${top.name} fez ${fmtShare(top.share)} dos gastos do período`,
        description: `${top.purchases} ${top.purchases === 1 ? 'compra' : 'compras'}, ${formatCurrency(top.total)} no total, ticket médio de ${formatCurrency(top.avg_ticket)}${top.top_store ? `, principalmente no ${top.top_store}` : ''}.`,
        metric: `Participação ${fmtShare(top.share)}`,
        period,
        source: 'Campo “Comprado por” das compras confirmadas',
        confidence: null,
        tone: 'neutral',
      })
    }
  }

  return out
}
