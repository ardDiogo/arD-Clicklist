import { describe, expect, it } from 'vitest'
import {
  applyLocalMovement,
  filterStock,
  formatQty,
  groupStock,
  parseQty,
  productSubtitle,
  quantityToBuy,
  stockStatus,
  type StockItem,
} from './domain'

function item(partial: Partial<StockItem>): StockItem {
  return {
    id: crypto.randomUUID(),
    household_id: 'h',
    product_id: 'p',
    product_name: 'Produto',
    presentation: null,
    package_size: null,
    unit: 'un',
    barcode: null,
    brand_id: null,
    brand_name: null,
    category_id: null,
    category_name: null,
    category_sort: null,
    location_id: null,
    location_name: null,
    location_sort: null,
    ideal_qty: 0,
    current_qty: 0,
    to_buy_qty: 0,
    status: 'untracked',
    notes: null,
    last_movement_at: null,
    created_at: '',
    updated_at: '',
    exclude_from_list: false,
    ...partial,
  }
}

describe('quantityToBuy', () => {
  it.each([
    [3, 1, 2], // Ketchup
    [5, 2, 3], // Sabonete
    [6, 4, 2], // Sardinha
    [1, 1, 0], // Arroz
    [1, 0, 1], // Café
    [2, 5, 0], // acima do ideal nunca vira negativo
    [1, 0.7, 0.3], // sem erro de ponto flutuante
  ])('ideal %d, atual %d → comprar %d', (ideal, current, expected) => {
    expect(quantityToBuy(ideal, current)).toBe(expected)
  })
})

describe('stockStatus', () => {
  it('classifica como a view do banco', () => {
    expect(stockStatus(0, 3)).toBe('untracked')
    expect(stockStatus(3, 0)).toBe('out')
    expect(stockStatus(3, 1)).toBe('low')
    expect(stockStatus(3, 3)).toBe('ok')
    expect(stockStatus(3, 4)).toBe('ok')
  })
})

describe('parseQty / formatQty', () => {
  it('aceita vírgula ou ponto', () => {
    expect(parseQty('1,5')).toBe(1.5)
    expect(parseQty('2.25')).toBe(2.25)
    expect(parseQty(' 3 ')).toBe(3)
  })
  it('rejeita negativos, texto e mais de 3 casas', () => {
    expect(parseQty('-1')).toBeNull()
    expect(parseQty('abc')).toBeNull()
    expect(parseQty('1,2345')).toBeNull()
    expect(parseQty('')).toBeNull()
  })
  it('formata em pt-BR', () => {
    expect(formatQty(1.5)).toBe('1,5')
    expect(formatQty(1000)).toBe('1.000')
    expect(formatQty(null)).toBe('—')
  })
})

describe('productSubtitle', () => {
  it('junta marca, apresentação e embalagem', () => {
    expect(productSubtitle({ brand_name: 'Bonare', presentation: 'Zero', package_size: 380, unit: 'g' })).toBe(
      'Bonare · Zero · 380 g',
    )
    expect(productSubtitle({ brand_name: null, presentation: null, package_size: 1.5, unit: 'l' })).toBe('1,5 L')
  })
})

describe('groupStock', () => {
  const items = [
    item({ product_name: 'Sabonete', location_id: 'b', location_name: 'Banheiro', location_sort: 50 }),
    item({ product_name: 'Arroz', location_id: 'd', location_name: 'Despensa', location_sort: 10 }),
    item({ product_name: 'Açúcar', location_id: 'd', location_name: 'Despensa', location_sort: 10 }),
    item({ product_name: 'Avulso' }),
  ]
  it('ordena grupos pela ordem do ambiente e itens alfabeticamente', () => {
    const groups = groupStock(items, 'location')
    expect(groups.map((g) => g.label)).toEqual(['Despensa', 'Banheiro', 'Sem ambiente'])
    expect(groups[0]?.items.map((i) => i.product_name)).toEqual(['Açúcar', 'Arroz'])
  })
})

describe('filterStock', () => {
  const items = [
    item({ product_name: 'Café Melitta', to_buy_qty: 1, status: 'out' }),
    item({ product_name: 'Ketchup', brand_name: 'Bonare', to_buy_qty: 2, status: 'low' }),
    item({ product_name: 'Arroz', to_buy_qty: 0, status: 'ok' }),
  ]
  it('busca sem acento e por marca', () => {
    expect(filterStock(items, 'cafe', 'all')).toHaveLength(1)
    expect(filterStock(items, 'bonare', 'all')[0]?.product_name).toBe('Ketchup')
  })
  it('filtra por reposição e sem estoque', () => {
    expect(filterStock(items, '', 'restock')).toHaveLength(2)
    expect(filterStock(items, '', 'out')).toHaveLength(1)
  })
})

describe('applyLocalMovement', () => {
  it('recalcula compra e status sem ficar negativo', () => {
    const it1 = applyLocalMovement(item({ ideal_qty: 3, current_qty: 1 }), -5)
    expect(it1.current_qty).toBe(0)
    expect(it1.status).toBe('out')
    expect(it1.to_buy_qty).toBe(3)
  })
})
