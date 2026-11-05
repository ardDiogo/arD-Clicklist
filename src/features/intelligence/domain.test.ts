import { describe, expect, it } from 'vitest'
import {
  addMonthsDate,
  bucketLabel,
  buildInsights,
  fmtPct,
  forecastNextMonth,
  normalizedPrice,
  overdueProducts,
  pctChange,
  resolveRange,
  topBy,
} from './domain'
import type { Kpis, Overview, PriceStat, ProductStat, StoresData } from './types'

const kpis = (total: number, purchases: number): Kpis => ({
  total,
  purchases,
  avg_ticket: purchases ? total / purchases : null,
  stores: 1,
  products: 1,
  items: 1,
  discount: 0,
})

const overview = (over: Partial<Overview> = {}): Overview => ({
  granularity: 'day',
  period: { from: '2026-10-01', to: '2026-10-31', days: 31 },
  previous: { from: '2026-08-31', to: '2026-09-30' },
  kpis: kpis(500, 4),
  previous_kpis: kpis(400, 4),
  savings: { total: 0, products: 0 },
  series: [],
  categories: [],
  tickets: [],
  ...over,
})

const product = (over: Partial<ProductStat>): ProductStat => ({
  key: 'k',
  household_product_id: 'p',
  product_name: 'Café',
  category_name: 'Bebidas',
  brand_name: null,
  unit: 'UN',
  quantity: 1,
  total: 10,
  share: 0.1,
  receipts: 1,
  purchase_days: 1,
  first_date: '2026-01-01',
  last_date: '2026-10-01',
  days_since_last: 10,
  avg_interval_days: null,
  current_qty: 0,
  ideal_qty: 1,
  consumed: 0,
  counted_down: 0,
  ...over,
})

const price = (over: Partial<PriceStat>): PriceStat => ({
  household_product_id: 'p',
  product_name: 'Café',
  brand_name: null,
  category_name: 'Bebidas',
  unit: 'UN',
  package_size: null,
  measure_unit: 'un',
  observations: 2,
  last_price: 10,
  last_date: '2026-10-01',
  prev_price: 10,
  first_price: 10,
  min_price: 10,
  max_price: 10,
  avg_price: 10,
  last_vs_prev_pct: 0,
  period_change_pct: null,
  range_pct: null,
  prev_period_avg: null,
  vs_prev_period_pct: null,
  stores: 1,
  store_spread_pct: null,
  cheapest_store: null,
  ...over,
})

describe('períodos', () => {
  it('resolve presets a partir de hoje (inclusivo)', () => {
    const t = '2026-11-05'
    expect(resolveRange({ preset: '7d' }, t)).toEqual({ from: '2026-10-30', to: t })
    expect(resolveRange({ preset: '30d' }, t)).toEqual({ from: '2026-10-07', to: t })
    expect(resolveRange({ preset: '6m' }, t)).toEqual({ from: '2026-05-06', to: t })
    expect(resolveRange({ preset: '12m' }, t)).toEqual({ from: '2025-11-06', to: t })
    expect(resolveRange({ preset: 'ytd' }, t)).toEqual({ from: '2026-01-01', to: t })
  })
  it('personalizado: inverte datas trocadas e ignora valores inválidos', () => {
    expect(resolveRange({ preset: 'custom', from: '2026-10-10', to: '2026-10-01' }, '2026-11-05')).toEqual({ from: '2026-10-01', to: '2026-10-10' })
    expect(resolveRange({ preset: 'custom', from: 'x' }, '2026-11-05')).toEqual({ from: '2026-10-07', to: '2026-11-05' })
  })
  it('soma meses respeitando o fim do mês', () => {
    expect(addMonthsDate('2026-03-31', -1)).toBe('2026-02-28')
  })
  it('rótulos da série', () => {
    expect(bucketLabel('2026-10-01', 'month')).toBe('out/26')
    expect(bucketLabel('2026-10-05', 'week')).toBe('05/10')
    expect(bucketLabel('2026-10-05', 'day')).toBe('05')
  })
})

describe('números', () => {
  it('variação percentual trata divisão por zero e ausência', () => {
    expect(pctChange(110, 100)).toBe(10)
    expect(pctChange(90, 100)).toBe(-10)
    expect(pctChange(10, 0)).toBeNull()
    expect(pctChange(10, null)).toBeNull()
    expect(fmtPct(12.5)).toBe('+12,5%')
    expect(fmtPct(-3)).toBe('−3%')
  })
  it('preço por kg/L só com tamanho de embalagem e compra por unidade', () => {
    expect(normalizedPrice({ last_price: 18, unit: 'UN', package_size: 500, measure_unit: 'g' })).toBe('R$ 36,00/kg')
    expect(normalizedPrice({ last_price: 18, unit: 'KG', package_size: 500, measure_unit: 'g' })).toBeNull()
    expect(normalizedPrice({ last_price: 18, unit: 'UN', package_size: null, measure_unit: 'g' })).toBeNull()
  })
  it('previsão exige 2 meses fechados e ignora o mês corrente', () => {
    expect(forecastNextMonth([{ month: '2026-10-01', total: 500 }, { month: '2026-11-01', total: 50 }], '2026-11-05')).toBeNull()
    expect(
      forecastNextMonth(
        [
          { month: '2026-09-01', total: 400 },
          { month: '2026-10-01', total: 600 },
          { month: '2026-11-01', total: 50 },
        ],
        '2026-11-05',
      ),
    ).toEqual({ value: 500, min: 400, max: 600, months: 2 })
  })
  it('rankings ignoram valores nulos', () => {
    expect(topBy([{ v: 1 }, { v: null }, { v: 3 }], (r) => r.v, 5).map((r) => r.v)).toEqual([3, 1])
  })
  it('produtos atrasados: 1,5× o intervalo habitual com 3+ compras', () => {
    const rows = [
      product({ key: 'a', avg_interval_days: 10, purchase_days: 3, days_since_last: 20 }),
      product({ key: 'b', avg_interval_days: 10, purchase_days: 2, days_since_last: 40 }),
      product({ key: 'c', avg_interval_days: 10, purchase_days: 5, days_since_last: 12 }),
    ]
    expect(overdueProducts(rows).map((r) => r.key)).toEqual(['a'])
  })
})

describe('insights do arD', () => {
  const range = { from: '2026-10-01', to: '2026-10-31' }

  it('sem dados não inventa nada', () => {
    expect(buildInsights({ range })).toEqual([])
    expect(buildInsights({ range, overview: overview({ kpis: kpis(0, 0), previous_kpis: kpis(0, 0) }) })).toEqual([])
  })

  it('variação de gasto só a partir de 10% e com base anterior', () => {
    const ins = buildInsights({ range, overview: overview() })
    expect(ins[0]).toMatchObject({ id: 'spend-change', title: 'Gasto 25% maior que no período anterior', confidence: 'alta', tone: 'warning' })
    expect(buildInsights({ range, overview: overview({ previous_kpis: kpis(480, 4) }) })).toEqual([])
    expect(buildInsights({ range, overview: overview({ previous_kpis: kpis(0, 0) }) })).toEqual([])
  })

  it('categoria que mais cresceu e concentração', () => {
    const ins = buildInsights({
      range,
      overview: overview({
        previous_kpis: kpis(480, 4),
        categories: [
          { name: 'Mercearia', total: 300, prev_total: 300, share: 0.6, change_pct: 0 },
          { name: 'Limpeza', total: 130, prev_total: 100, share: 0.26, change_pct: 30 },
        ],
      }),
    })
    expect(ins.map((i) => i.id)).toEqual(['category-up-Limpeza', 'category-share'])
    expect(ins[0]?.title).toBe('Vocês gastaram 30% a mais com Limpeza')
  })

  it('mercado mais barato exige 2 mercados e 3 produtos comparáveis', () => {
    const stores: StoresData = {
      window: range,
      stores_with_prices: 2,
      ranking: [],
      price_index: [
        { store_key: 'b', store_name: 'Mercado B', compared: 10, wins: 7, index: 1.02 },
        { store_key: 'a', store_name: 'Mercado A', compared: 10, wins: 3, index: 1.08 },
      ],
      basket: [],
      savings: [],
    }
    expect(buildInsights({ range, stores })[0]?.title).toBe('Mercado B teve o menor preço em 7 de 10 produtos comparáveis')
    expect(buildInsights({ range, stores: { ...stores, price_index: stores.price_index.slice(0, 1) } })).toEqual([])
  })

  it('preço que subiu e que caiu', () => {
    const ins = buildInsights({
      range,
      prices: [
        price({ household_product_id: 'c', product_name: 'café', last_price: 11.2, prev_price: 10, last_vs_prev_pct: 12 }),
        price({ household_product_id: 'a', product_name: 'Arroz', last_price: 9, prev_price: 10, last_vs_prev_pct: -10 }),
        price({ household_product_id: 'x', product_name: 'Sal', last_vs_prev_pct: 2 }),
      ],
    })
    expect(ins.map((i) => i.title)).toEqual(['O preço de café aumentou 12%', 'Arroz ficou 10% mais barato'])
  })

  it('reposição frequente e produto atrasado com estoque zerado', () => {
    const ins = buildInsights({
      range,
      products: {
        total: 100,
        products: [
          product({ key: 's', product_name: 'Sabonete', purchase_days: 5, avg_interval_days: 8, days_since_last: 3, current_qty: 2 }),
          product({ key: 'c', product_name: 'Café', purchase_days: 3, avg_interval_days: 16, days_since_last: 40, current_qty: 0 }),
        ],
      },
    })
    expect(ins.map((i) => i.id)).toEqual(['frequent-s', 'overdue-c'])
  })
})
