import { describe, expect, it } from 'vitest'
import {
  addMonths,
  categoryBreakdown,
  currentMonthKey,
  fillMonths,
  forecastNextPurchase,
  monthLabel,
  niceTicks,
  percentChange,
  topPriceChanges,
  type CategoryRow,
  type MonthlyRow,
  type PriceChangeRow,
} from './domain'

const NOW = new Date('2026-11-10T15:00:00Z')

describe('meses', () => {
  it('mês corrente no fuso de Brasília', () => {
    expect(currentMonthKey(new Date('2026-11-01T02:00:00Z'))).toBe('2026-10-01') // 23h de 31/10 em Brasília
    expect(currentMonthKey(NOW)).toBe('2026-11-01')
  })
  it('soma meses atravessando o ano', () => {
    expect(addMonths('2026-01-01', -1)).toBe('2025-12-01')
    expect(addMonths('2026-11-01', 2)).toBe('2027-01-01')
  })
  it('rótulos', () => {
    expect(monthLabel('2026-11-01')).toBe('nov/26')
    expect(monthLabel('2026-03-01', true)).toBe('março de 2026')
  })
})

describe('fillMonths', () => {
  it('preenche meses sem compra com zero, do mais antigo ao atual', () => {
    const rows = [
      { month: '2026-10-01', total: 48.5, purchases: 2 },
      { month: '2026-11-01', total: 37.6, purchases: 2 },
    ] as MonthlyRow[]
    expect(fillMonths(rows, 3, NOW)).toEqual([
      { month: '2026-09-01', total: 0, purchases: 0 },
      { month: '2026-10-01', total: 48.5, purchases: 2 },
      { month: '2026-11-01', total: 37.6, purchases: 2 },
    ])
  })
})

describe('percentChange / niceTicks', () => {
  it('variação', () => {
    expect(percentChange(37.6, 48.5)).toBe(-22.5)
    expect(percentChange(10, 0)).toBeNull()
  })
  it('marcas do eixo', () => {
    expect(niceTicks(870)).toEqual([0, 500, 1000])
    expect(niceTicks(48.5)).toEqual([0, 20, 40, 60])
    expect(niceTicks(0)).toEqual([0])
  })
})

describe('forecastNextPurchase', () => {
  it('precisa de 3 compras', () => {
    expect(forecastNextPurchase([{ purchased_at: '2026-11-01T10:00:00Z' }], NOW).nextDate).toBeNull()
  })
  it('usa o intervalo médio', () => {
    const f = forecastNextPurchase(
      [{ purchased_at: '2026-10-20T10:00:00Z' }, { purchased_at: '2026-10-27T10:00:00Z' }, { purchased_at: '2026-11-03T10:00:00Z' }, { purchased_at: '2026-11-03T18:00:00Z' }],
      new Date('2026-11-05T12:00:00Z'),
    )
    expect(f.intervalDays).toBe(7)
    expect(f.nextDate?.toISOString().slice(0, 10)).toBe('2026-11-10')
  })
  it('se a data já passou, prevê para hoje', () => {
    const f = forecastNextPurchase(
      [{ purchased_at: '2026-09-01T10:00:00Z' }, { purchased_at: '2026-09-08T10:00:00Z' }, { purchased_at: '2026-09-15T10:00:00Z' }],
      NOW,
    )
    expect(f.nextDate?.getTime()).toBe(NOW.getTime())
  })
})

describe('categoryBreakdown', () => {
  it('ordena e calcula participação do mês', () => {
    const rows = [
      { month: '2026-11-01', category_name: 'Limpeza', total: 6 },
      { month: '2026-11-01', category_name: 'Mercearia', total: 21.6 },
      { month: '2026-10-01', category_name: 'Mercearia', total: 99 },
    ] as CategoryRow[]
    const b = categoryBreakdown(rows, '2026-11-01')
    expect(b.total).toBe(27.6)
    expect(b.items.map((i) => i.name)).toEqual(['Mercearia', 'Limpeza'])
    expect(b.items[0]?.share).toBeCloseTo(0.7826, 3)
  })
})

describe('topPriceChanges', () => {
  it('maiores variações absolutas, sem zeros/nulos', () => {
    const rows = [
      { product_name: 'A', variation_pct: 5 },
      { product_name: 'B', variation_pct: -30 },
      { product_name: 'C', variation_pct: null },
      { product_name: 'D', variation_pct: 0 },
      { product_name: 'E', variation_pct: 12 },
    ] as PriceChangeRow[]
    expect(topPriceChanges(rows, 2).map((r) => r.product_name)).toEqual(['B', 'E'])
  })
})
