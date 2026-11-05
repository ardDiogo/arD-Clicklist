import { supabase } from '@/integrations/supabase/client'
import type { MeasureUnit, StockMovementType, Tables } from '@/integrations/supabase/database.types'
import type { StockItem } from './domain'

export type Location = Pick<Tables<'locations'>, 'id' | 'name' | 'sort_order'>
export type Category = Pick<Tables<'categories'>, 'id' | 'name' | 'icon' | 'sort_order' | 'household_id'>
export type Movement = Tables<'stock_movements'>

function unwrap<T>(result: { data: T | null; error: unknown }): T {
  if (result.error) throw result.error
  return result.data as T
}

export async function listStock(householdId: string): Promise<StockItem[]> {
  return unwrap(
    await supabase().from('household_stock').select('*').eq('household_id', householdId).order('product_name'),
  )
}

export async function getStockItem(id: string): Promise<StockItem | null> {
  return unwrap(await supabase().from('household_stock').select('*').eq('id', id).maybeSingle())
}

export async function listLocations(householdId: string): Promise<Location[]> {
  return unwrap(
    await supabase()
      .from('locations')
      .select('id, name, sort_order')
      .eq('household_id', householdId)
      .is('archived_at', null)
      .order('sort_order')
      .order('name'),
  )
}

export async function listCategories(): Promise<Category[]> {
  return unwrap(
    await supabase()
      .from('categories')
      .select('id, name, icon, sort_order, household_id')
      .is('archived_at', null)
      .order('sort_order')
      .order('name'),
  )
}

export async function listBrandNames(): Promise<string[]> {
  const rows = unwrap(await supabase().from('brands').select('name').order('name'))
  return rows.map((r) => r.name)
}

export async function listMovements(householdProductId: string, limit = 50): Promise<Movement[]> {
  return unwrap(
    await supabase()
      .from('stock_movements')
      .select('*')
      .eq('household_product_id', householdProductId)
      .order('created_at', { ascending: false })
      .limit(limit),
  )
}

export interface ProductInput {
  name: string
  brandName: string
  categoryId: string | null
  presentation: string
  packageSize: number | null
  unit: MeasureUnit
  barcode: string
  idealQty: number
  notes: string
}

function productArgs(input: ProductInput) {
  return {
    p_name: input.name.trim(),
    p_brand_name: input.brandName.trim() || null,
    p_category_id: input.categoryId,
    p_presentation: input.presentation.trim() || null,
    p_package_size: input.packageSize,
    p_unit: input.unit,
    p_barcode: input.barcode.trim() || null,
    p_ideal_qty: input.idealQty,
    p_notes: input.notes.trim() || null,
  }
}

export async function createTrackedProduct(
  householdId: string,
  input: ProductInput & { locationId: string | null; currentQty: number },
): Promise<string> {
  return unwrap(
    await supabase().rpc('create_tracked_product', {
      ...productArgs(input),
      p_household_id: householdId,
      p_location_id: input.locationId,
      p_current_qty: input.currentQty,
    }),
  )
}

export async function updateTrackedProduct(id: string, input: ProductInput): Promise<void> {
  unwrap(await supabase().rpc('update_tracked_product', { ...productArgs(input), p_household_product_id: id }))
}

export async function recordMovement(
  id: string,
  type: Exclude<StockMovementType, 'transfer'>,
  quantity: number,
  idempotencyKey: string,
  note?: string,
): Promise<string> {
  return unwrap(
    await supabase().rpc('record_stock_movement', {
      p_household_product_id: id,
      p_type: type,
      p_quantity: quantity,
      p_note: note?.trim() || null,
      p_idempotency_key: idempotencyKey,
    }),
  )
}

export async function transferItem(id: string, toLocationId: string): Promise<void> {
  unwrap(
    await supabase().rpc('transfer_household_product', {
      p_household_product_id: id,
      p_to_location_id: toLocationId,
    }),
  )
}

export async function setIdealQty(id: string, idealQty: number): Promise<void> {
  unwrap(await supabase().from('household_products').update({ ideal_qty: idealQty }).eq('id', id))
}

/** "Não envia à lista": o produto não entra sozinho na lista de compras. Retorna quantos itens saíram da lista aberta. */
export async function setListExclusion(id: string, exclude: boolean): Promise<number> {
  return unwrap(await supabase().rpc('set_product_list_exclusion', { p_household_product_id: id, p_exclude: exclude }))
}

export async function archiveItem(id: string): Promise<void> {
  unwrap(await supabase().rpc('archive_household_product', { p_household_product_id: id }))
}

// Ambientes -------------------------------------------------------------------
export async function createLocation(householdId: string, name: string, sortOrder: number): Promise<void> {
  unwrap(
    await supabase().from('locations').insert({ household_id: householdId, name: name.trim(), sort_order: sortOrder }),
  )
}

export async function renameLocation(id: string, name: string): Promise<void> {
  unwrap(await supabase().from('locations').update({ name: name.trim() }).eq('id', id))
}

export async function archiveLocation(id: string): Promise<void> {
  unwrap(await supabase().rpc('archive_location', { p_location_id: id }))
}
