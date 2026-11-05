import { describe, expect, it } from 'vitest'
import type { StockItem } from '@/features/inventory/domain'
import { listTotals, missingFromList, organizeList, parsePrice, stepQuantity, type ListItem } from './domain'

function li(p: Partial<ListItem>): ListItem {
  return {
    id: crypto.randomUUID(),
    list_id: 'l',
    household_id: 'h',
    household_product_id: null,
    name: 'Item',
    presentation: null,
    package_size: null,
    unit: null,
    brand_name: null,
    category_id: null,
    category_name: 'Outros',
    category_sort: 1000,
    location_name: null,
    ideal_qty: null,
    current_qty: null,
    quantity: 1,
    origin: 'stock',
    manually_edited: false,
    estimated_unit_price: null,
    estimated_total: null,
    notes: null,
    checked_at: null,
    checked_by: null,
    created_at: '',
    updated_at: '',
    ...p,
  }
}

describe('organizeList', () => {
  it('agrupa pendentes por categoria na ordem do mercado e separa o carrinho', () => {
    const { pending, checked } = organizeList([
      li({ name: 'Sabonete', category_id: 'hig', category_name: 'Higiene pessoal', category_sort: 50 }),
      li({ name: 'Café', category_id: 'mer', category_name: 'Mercearia', category_sort: 10 }),
      li({ name: 'Arroz', category_id: 'mer', category_name: 'Mercearia', category_sort: 10 }),
      li({ name: 'Ketchup', category_id: 'mer', category_name: 'Mercearia', category_sort: 10, checked_at: '2026-11-07T10:00:00Z' }),
      li({ name: 'Vela' }),
    ])
    expect(pending.map((g) => g.label)).toEqual(['Mercearia', 'Higiene pessoal', 'Outros'])
    expect(pending[0]?.items.map((i) => i.name)).toEqual(['Arroz', 'Café'])
    expect(checked.map((i) => i.name)).toEqual(['Ketchup'])
  })
})

describe('listTotals', () => {
  it('soma apenas itens com preço, em centavos', () => {
    const t = listTotals([
      li({ quantity: 3, estimated_unit_price: 0.1 }),
      li({ quantity: 10, estimated_unit_price: 2.49, checked_at: 'x' }),
      li({ quantity: 1 }),
    ])
    expect(t.estimatedTotal).toBe(25.2)
    expect(t.checkedTotal).toBe(24.9)
    expect(t.withoutPrice).toBe(1)
    expect(t.checkedCount).toBe(1)
    expect(t.itemCount).toBe(3)
  })
})

describe('parsePrice', () => {
  it('entende formatos brasileiros', () => {
    expect(parsePrice('2,49')).toBe(2.49)
    expect(parsePrice('R$ 1.234,50')).toBe(1234.5)
    expect(parsePrice('7.9')).toBe(7.9)
    expect(parsePrice('')).toBeNull()
    expect(parsePrice('abc')).toBeUndefined()
    expect(parsePrice('1,999')).toBeUndefined()
  })
})

describe('missingFromList', () => {
  it('sugere só o que falta, não está na lista e não foi removido', () => {
    const stock = [
      { id: 'a', to_buy_qty: 2 },
      { id: 'b', to_buy_qty: 1 },
      { id: 'c', to_buy_qty: 0 },
      { id: 'd', to_buy_qty: 3 },
    ] as StockItem[]
    const missing = missingFromList(stock, [li({ household_product_id: 'a' })], new Set(['d']))
    expect(missing.map((s) => s.id)).toEqual(['b'])
  })
})

describe('stepQuantity', () => {
  it('nunca fica abaixo de 1', () => {
    expect(stepQuantity(1, -1)).toBe(1)
    expect(stepQuantity(2.5, -1)).toBe(1.5)
    expect(stepQuantity(2, 1)).toBe(3)
  })
})
