import type { Views } from '@/integrations/supabase/database.types'

export type MonthlyRow = Views<'monthly_spending'>
export type CategoryRow = Views<'category_spending'>
export type StoreRow = Views<'store_spending'>
export type PriceChangeRow = Views<'price_changes'>
export type PurchaseTotalRow = Views<'purchase_totals'>

/** "2026-11-01" para o mês corrente no fuso de Brasília. */
export function currentMonthKey(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' }).formatToParts(now)
  const y = parts.find((p) => p.type === 'year')?.value
  const m = parts.find((p) => p.type === 'month')?.value
  return `${y}-${m}-01`
}

export function addMonths(key: string, delta: number): string {
  const [y, m] = key.split('-').map(Number) as [number, number]
  const d = new Date(Date.UTC(y, m - 1 + delta, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`
}

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const MONTHS_LONG = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

export function monthLabel(key: string, long = false): string {
  const [y, m] = key.split('-').map(Number) as [number, number]
  return long ? `${MONTHS_LONG[m - 1]} de ${y}` : `${MONTHS[m - 1]}/${String(y).slice(2)}`
}

export interface MonthPoint {
  month: string
  total: number
  purchases: number
}

/** Série contínua dos últimos N meses (meses sem compra entram com zero). */
export function fillMonths(rows: MonthlyRow[], months: number, now = new Date()): MonthPoint[] {
  const byMonth = new Map(rows.map((r) => [r.month.slice(0, 10), r]))
  const last = currentMonthKey(now)
  return Array.from({ length: months }, (_, i) => {
    const key = addMonths(last, i - (months - 1))
    const r = byMonth.get(key)
    return { month: key, total: r ? Number(r.total) : 0, purchases: r?.purchases ?? 0 }
  })
}

/** Variação percentual com uma casa; null quando a base é zero. */
export function percentChange(current: number, previous: number): number | null {
  if (!previous) return null
  return Math.round(((current - previous) / previous) * 1000) / 10
}

/** Escala "bonita" para o eixo: 3 marcas arredondadas cobrindo o máximo. */
export function niceTicks(max: number, count = 3): number[] {
  if (max <= 0) return [0]
  const rough = max / count
  const pow = 10 ** Math.floor(Math.log10(rough))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= rough) ?? 10 * pow
  return Array.from({ length: count + 1 }, (_, i) => Math.round(i * step * 100) / 100).filter((v, i) => i === 0 || v - step < max)
}

export interface Forecast {
  nextDate: Date | null
  intervalDays: number | null
}

/**
 * Previsão da próxima compra pelo intervalo médio entre compras recentes
 * (mínimo de 3 compras para não chutar). Datas iguais (mesmo dia) contam como uma.
 */
export function forecastNextPurchase(purchases: Pick<PurchaseTotalRow, 'purchased_at'>[], now = new Date()): Forecast {
  const days = [...new Set(purchases.map((p) => p.purchased_at.slice(0, 10)))]
    .sort()
    .slice(-8)
    .map((d) => new Date(`${d}T12:00:00Z`).getTime())
  if (days.length < 3) return { nextDate: null, intervalDays: null }
  const gaps = days.slice(1).map((d, i) => (d - days[i]!) / 86_400_000)
  const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length
  const intervalDays = Math.max(1, Math.round(avg))
  let next = days[days.length - 1]! + intervalDays * 86_400_000
  // Se a data prevista já passou, a próxima compra é "a qualquer momento" (hoje).
  if (next < now.getTime()) next = now.getTime()
  return { nextDate: new Date(next), intervalDays }
}

/** Categorias de um mês, ordenadas por valor, com participação no total. */
export function categoryBreakdown(rows: CategoryRow[], month: string) {
  const items = rows.filter((r) => r.month.slice(0, 10) === month)
  const total = items.reduce((s, r) => s + Math.round(Number(r.total) * 100), 0) / 100
  return {
    total,
    items: items
      .map((r) => ({ name: r.category_name, total: Number(r.total), share: total ? Number(r.total) / total : 0 }))
      .sort((a, b) => b.total - a.total),
  }
}

/** Maiores variações (alta ou baixa) entre produtos com ao menos 2 compras. */
export function topPriceChanges(rows: PriceChangeRow[], limit = 5): PriceChangeRow[] {
  return rows
    .filter((r) => r.variation_pct !== null && r.variation_pct !== 0)
    .sort((a, b) => Math.abs(b.variation_pct ?? 0) - Math.abs(a.variation_pct ?? 0))
    .slice(0, limit)
}
