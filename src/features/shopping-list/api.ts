import { supabase } from '@/integrations/supabase/client'
import type { Tables } from '@/integrations/supabase/database.types'
import type { ListItem } from './domain'

export type ShoppingList = Tables<'shopping_lists'>

function unwrap<T>(result: { data: T | null; error: unknown }): T {
  if (result.error) throw result.error
  return result.data as T
}

export async function getOpenList(householdId: string): Promise<ShoppingList | null> {
  return unwrap(
    await supabase().from('shopping_lists').select('*').eq('household_id', householdId).eq('status', 'open').maybeSingle(),
  )
}

export async function getList(id: string): Promise<ShoppingList | null> {
  return unwrap(await supabase().from('shopping_lists').select('*').eq('id', id).maybeSingle())
}

export async function listItems(listId: string): Promise<ListItem[]> {
  return unwrap(await supabase().from('shopping_list_items_view').select('*').eq('list_id', listId))
}

/** IDs de produtos removidos pelo usuário nesta lista (não sugerir de novo). */
export async function removedProductIds(listId: string): Promise<Set<string>> {
  const rows = unwrap(
    await supabase()
      .from('shopping_list_items')
      .select('household_product_id')
      .eq('list_id', listId)
      .not('removed_at', 'is', null),
  )
  return new Set(rows.map((r) => r.household_product_id).filter((x): x is string => Boolean(x)))
}

export async function generateList(householdId: string) {
  const rows = unwrap(await supabase().rpc('generate_shopping_list', { p_household_id: householdId }))
  return rows[0] ?? null
}

/**
 * Lista pela média mensal do que a família compra (últimos meses, sem o mês atual).
 * `subtractStock`: desconta o que já há em casa (padrão: não desconta).
 */
export async function suggestFromHistory(householdId: string, months = 3, subtractStock = false) {
  const rows = unwrap(
    await supabase().rpc('suggest_shopping_from_history', { p_household_id: householdId, p_months: months, p_subtract_stock: subtractStock }),
  )
  return rows[0] ?? null
}

/** Limpa a lista aberta e monta de novo pelo estoque + consumo dos últimos meses. */
export async function resetList(householdId: string, months = 3) {
  const rows = unwrap(await supabase().rpc('reset_shopping_list', { p_household_id: householdId, p_months: months }))
  return rows[0] ?? null
}

/** Limpa a lista aberta e monta de novo por um critério só (estoque ou média das compras). */
export async function rebuildList(householdId: string, mode: 'stock' | 'average', months = 3, subtractStock = false) {
  const rows = unwrap(
    await supabase().rpc('rebuild_shopping_list', {
      p_household_id: householdId,
      p_mode: mode,
      p_months: months,
      p_subtract_stock: subtractStock,
    }),
  )
  return rows[0] ?? null
}

export async function addProduct(listId: string, householdProductId: string, quantity = 1): Promise<string> {
  return unwrap(
    await supabase().rpc('add_product_to_list', {
      p_list_id: listId,
      p_household_product_id: householdProductId,
      p_quantity: quantity,
    }),
  )
}

export async function addCustomItem(listId: string, name: string, quantity = 1): Promise<string> {
  return unwrap(await supabase().rpc('add_custom_item_to_list', { p_list_id: listId, p_name: name.trim(), p_quantity: quantity }))
}

export async function updateItem(
  itemId: string,
  quantity: number,
  estimatedUnitPrice: number | null,
  notes: string | null,
): Promise<void> {
  unwrap(
    await supabase().rpc('update_list_item', {
      p_item_id: itemId,
      p_quantity: quantity,
      p_estimated_unit_price: estimatedUnitPrice,
      p_notes: notes,
    }),
  )
}

export async function setChecked(itemId: string, checked: boolean): Promise<void> {
  unwrap(await supabase().rpc('set_list_item_checked', { p_item_id: itemId, p_checked: checked }))
}

export async function removeItem(itemId: string): Promise<void> {
  unwrap(await supabase().rpc('remove_list_item', { p_item_id: itemId }))
}

export async function completeList(listId: string, applyToStock: boolean): Promise<number> {
  const rows = unwrap(await supabase().rpc('complete_shopping_list', { p_list_id: listId, p_apply_to_stock: applyToStock }))
  return rows[0]?.applied_items ?? 0
}

/** Remove uma lista finalizada do histórico; se ela lançou no estoque, pode estornar. Retorna quantos produtos foram estornados. */
export async function removeList(listId: string, revertStock: boolean): Promise<number> {
  return unwrap(await supabase().rpc('remove_shopping_list', { p_list_id: listId, p_revert_stock: revertStock }))
}

export interface ListSummary extends ShoppingList {
  itemCount: number
  estimatedTotal: number | null
}

export async function listHistory(householdId: string, limit = 30): Promise<ListSummary[]> {
  const client = supabase()
  const lists = unwrap(
    await client
      .from('shopping_lists')
      .select('*')
      .eq('household_id', householdId)
      .eq('status', 'completed')
      .order('completed_at', { ascending: false })
      .limit(limit),
  )
  if (lists.length === 0) return []
  const items = unwrap(
    await client
      .from('shopping_list_items_view')
      .select('list_id, estimated_total, checked_at')
      .in(
        'list_id',
        lists.map((l) => l.id),
      ),
  )
  return lists.map((l) => {
    const mine = items.filter((i) => i.list_id === l.id && i.checked_at)
    const priced = mine.filter((i) => i.estimated_total !== null)
    return {
      ...l,
      itemCount: mine.length,
      estimatedTotal: priced.length ? priced.reduce((s, i) => s + Math.round((i.estimated_total ?? 0) * 100), 0) / 100 : null,
    }
  })
}
