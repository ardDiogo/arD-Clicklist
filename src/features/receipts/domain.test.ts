import { describe, expect, it } from 'vitest'
import type { StockItem } from '@/features/inventory/domain'
import { priceVariation, reviewSummary, similarity, suggestProducts, titleCase, type PurchaseItem } from './domain'

const stock = [
  { id: '1', product_name: 'Café', brand_name: 'Melitta', presentation: 'Tradicional', package_size: 500, unit: 'g' },
  { id: '2', product_name: 'Ketchup Zero', brand_name: 'Bonare', presentation: null, package_size: 380, unit: 'g' },
  { id: '3', product_name: 'Leite integral', brand_name: 'Italac', presentation: null, package_size: 1, unit: 'l' },
] as StockItem[]

describe('similarity / suggestProducts', () => {
  it('reconhece descrições abreviadas de cupom', () => {
    expect(suggestProducts('CAFE MELIT TRAD 500G', stock)[0]?.id).toBe('1')
    expect(suggestProducts('KETCHUP BONARE ZERO 380G', stock)[0]?.id).toBe('2')
    expect(suggestProducts('LTE INTEG ITALAC 1L', stock)[0]?.id).toBe('3')
  })
  it('não sugere produtos sem relação', () => {
    expect(suggestProducts('SACOLA PLASTICA', stock)).toHaveLength(0)
    expect(similarity('', stock[0]!)).toBe(0)
  })
})

describe('titleCase', () => {
  it('formata o nome vindo do cupom', () => {
    expect(titleCase('KETCHUP  BONARE ZERO 380G')).toBe('Ketchup Bonare Zero 380g')
    expect(titleCase('PÃO FRANCÊS')).toBe('Pão Francês')
  })
})

describe('reviewSummary', () => {
  it('conta o que será lançado, o que falta associar e o que foi ignorado', () => {
    const base = { household_product_id: 'x', received: true, ignored: false, stock_quantity: 1 }
    const items = [
      base,
      { ...base, household_product_id: null },
      { ...base, ignored: true },
      { ...base, received: false },
      { ...base, stock_quantity: 0 },
    ] as PurchaseItem[]
    expect(reviewSummary(items)).toEqual({ toStock: 1, unmatched: 1, ignored: 1, notReceived: 2 })
  })
})

describe('priceVariation', () => {
  it('calcula a variação percentual com uma casa', () => {
    expect(priceVariation(21.5, 18.9)).toBe(13.8)
    expect(priceVariation(10, null)).toBeNull()
    expect(priceVariation(10, 0)).toBeNull()
  })
})
