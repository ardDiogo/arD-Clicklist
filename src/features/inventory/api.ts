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

/** Uma marca/descrição de nota ligada ao produto (agrupada por código de barras ou descrição). */
export interface LinkedItem {
  key: string
  description: string
  ean: string | null
  purchases: number
  quantity: number
  lastPrice: number | null
  lastDate: string | null
  lastStore: string | null
}

/** Itens das notas confirmadas ligados a este produto, agrupados por marca/descrição. */
export async function listLinkedItems(householdProductId: string): Promise<LinkedItem[]> {
  const client = supabase()
  const items = unwrap(
    await client
      .from('purchase_items')
      .select('purchase_id, description, ean, quantity, total_price, ignored')
      .eq('household_product_id', householdProductId),
  ).filter((i) => !i.ignored)
  if (items.length === 0) return []
  const ids = [...new Set(items.map((i) => i.purchase_id))]
  const purchases = unwrap(
    await client.from('purchases').select('id, status, purchased_at, created_at, store_name').in('id', ids).eq('status', 'confirmed'),
  )
  const byId = new Map(purchases.map((p) => [p.id, p]))
  const norm = (s: string) =>
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
  const groups = new Map<string, LinkedItem & { lastAt: string }>()
  for (const i of items) {
    const p = byId.get(i.purchase_id)
    if (!p) continue
    const key = i.ean ? `e:${i.ean}` : `d:${norm(i.description)}`
    const at = p.purchased_at ?? p.created_at
    const qty = Number(i.quantity)
    const price = qty > 0 ? Number(i.total_price) / qty : null
    const g = groups.get(key)
    if (!g) {
      groups.set(key, {
        key,
        description: i.description,
        ean: i.ean,
        purchases: 1,
        quantity: qty,
        lastPrice: price,
        lastDate: at,
        lastStore: p.store_name,
        lastAt: at,
      })
    } else {
      g.purchases += 1
      g.quantity += qty
      if (at > g.lastAt) Object.assign(g, { lastAt: at, lastDate: at, lastPrice: price, lastStore: p.store_name, description: i.description })
    }
  }
  return [...groups.values()].sort((a, b) => b.purchases - a.purchases || (b.lastAt > a.lastAt ? 1 : -1))
}

export interface MergeSuggestion {
  from_id: string
  from_name: string
  from_qty: number
  into_id: string
  into_name: string
  into_qty: number
  /** alta = nome genérico contido no outro; media = mesma 1ª palavra (confirmar). */
  confidence: 'alta' | 'media'
}

/** Pares de produtos parecidos (o específico/duplicado → o genérico que fica). */
export async function suggestMerges(householdId: string): Promise<MergeSuggestion[]> {
  const rows = unwrap(await supabase().rpc('suggest_product_merges', { p_household_id: householdId }))
  return rows.map((r) => ({ ...r, from_qty: Number(r.from_qty), into_qty: Number(r.into_qty) }))
}

/** "Não são o mesmo": a sugestão deste par não aparece mais. */
export async function dismissMerge(a: string, b: string): Promise<void> {
  unwrap(await supabase().rpc('dismiss_product_merge', { p_a: a, p_b: b }))
}

/** Junta "from" em "into": estoque, compras, preços, apelidos e listas passam para "into". */
export async function mergeProducts(from: string, into: string): Promise<void> {
  unwrap(await supabase().rpc('merge_household_products', { p_from: from, p_into: into }))
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
