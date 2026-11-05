import type { Views } from '@/integrations/supabase/database.types'
import { roundQty, type StockItem } from '@/features/inventory/domain'

export type ListItem = Views<'shopping_list_items_view'>

export interface ListGroup {
  key: string
  label: string
  items: ListItem[]
}

/**
 * Organiza a lista para uso no mercado: pendentes agrupados por categoria
 * (ordem fixa das categorias) e, ao final, o que já está no carrinho.
 */
export function organizeList(items: ListItem[]): { pending: ListGroup[]; checked: ListItem[] } {
  const byName = (a: ListItem, b: ListItem) => a.name.localeCompare(b.name, 'pt-BR')
  const pending = items.filter((i) => !i.checked_at)
  const checked = items
    .filter((i) => i.checked_at)
    .sort((a, b) => (b.checked_at ?? '').localeCompare(a.checked_at ?? ''))

  const groups = new Map<string, ListGroup & { sort: number }>()
  for (const item of pending) {
    const key = item.category_id ?? '_outros'
    const g = groups.get(key) ?? { key, label: item.category_name, items: [], sort: item.category_sort }
    g.items.push(item)
    groups.set(key, g)
  }
  return {
    pending: [...groups.values()]
      .sort((a, b) => a.sort - b.sort || a.label.localeCompare(b.label, 'pt-BR'))
      .map(({ key, label, items }) => ({ key, label, items: items.sort(byName) })),
    checked,
  }
}

export interface ListTotals {
  itemCount: number
  checkedCount: number
  /** Soma apenas dos itens com preço estimado. */
  estimatedTotal: number
  checkedTotal: number
  withoutPrice: number
}

/** Valores em centavos para não acumular erro de ponto flutuante. */
export function listTotals(items: ListItem[]): ListTotals {
  let total = 0
  let checkedTotal = 0
  let withoutPrice = 0
  let checkedCount = 0
  for (const i of items) {
    if (i.checked_at) checkedCount++
    if (i.estimated_unit_price === null) {
      withoutPrice++
      continue
    }
    const cents = Math.round(i.estimated_unit_price * 100 * i.quantity)
    total += cents
    if (i.checked_at) checkedTotal += cents
  }
  return {
    itemCount: items.length,
    checkedCount,
    estimatedTotal: total / 100,
    checkedTotal: checkedTotal / 100,
    withoutPrice,
  }
}

/** "2,49" / "R$ 2,49" / "1.234,50" → 2.49 / 1234.5; vazio → null; inválido → undefined. */
export function parsePrice(input: string): number | null | undefined {
  const s = input.replace(/R\$|\s/gi, '')
  if (s === '') return null
  const normalized = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return undefined
  return Math.round(Number(normalized) * 100) / 100
}

/** Produtos que estão faltando no estoque e ainda não estão na lista aberta. */
export function missingFromList(stock: StockItem[], items: ListItem[], removedIds: Set<string>): StockItem[] {
  const inList = new Set(items.map((i) => i.household_product_id).filter(Boolean))
  return stock.filter((s) => s.to_buy_qty > 0 && !inList.has(s.id) && !removedIds.has(s.id))
}

/** Próxima quantidade ao tocar em −/+ (nunca abaixo de 1; remover é outra ação). */
export function stepQuantity(current: number, direction: 1 | -1): number {
  return roundQty(Math.max(1, current + direction))
}
