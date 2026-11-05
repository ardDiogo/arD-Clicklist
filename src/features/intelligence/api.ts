import { supabase } from '@/integrations/supabase/client'
import type { BuyerStat, DateRange, FilterOptions, IntelFilters, Overview, PricePoint, PriceStat, ProductsData, StoresData } from './types'

function unwrap<T>(result: { data: unknown; error: unknown }): T {
  if (result.error) throw result.error
  return result.data as T
}

function args(householdId: string, range: DateRange, f: IntelFilters) {
  return {
    p_household_id: householdId,
    p_from: range.from,
    p_to: range.to,
    p_store: f.store ?? null,
    p_category: f.category ?? null,
    p_product: f.product ?? null,
    p_brand: f.brand ?? null,
  }
}

export async function getFilterOptions(householdId: string): Promise<FilterOptions> {
  return unwrap(await supabase().rpc('intel_filter_options', { p_household_id: householdId }))
}

export async function getOverview(householdId: string, range: DateRange, f: IntelFilters): Promise<Overview> {
  return unwrap(await supabase().rpc('intel_overview', args(householdId, range, f)))
}

export async function getStores(householdId: string, range: DateRange, f: IntelFilters): Promise<StoresData> {
  return unwrap(await supabase().rpc('intel_stores', args(householdId, range, f)))
}

export async function getProducts(householdId: string, range: DateRange, f: IntelFilters): Promise<ProductsData> {
  return unwrap(await supabase().rpc('intel_products', args(householdId, range, f)))
}

export async function getPrices(householdId: string, range: DateRange, f: IntelFilters): Promise<PriceStat[]> {
  return unwrap(await supabase().rpc('intel_prices', args(householdId, range, f)))
}

export async function getBuyers(householdId: string, range: DateRange, f: IntelFilters): Promise<BuyerStat[]> {
  return unwrap(await supabase().rpc('intel_buyers', args(householdId, range, f)))
}

export async function getPriceHistory(householdId: string, productId: string, range: DateRange): Promise<PricePoint[]> {
  const rows = unwrap<PricePoint[]>(
    await supabase().rpc('intel_price_history', {
      p_household_id: householdId,
      p_household_product_id: productId,
      p_from: range.from,
      p_to: range.to,
    }),
  )
  return rows.map((r) => ({
    ...r,
    quantity: Number(r.quantity),
    unit_price: Number(r.unit_price),
    discount: Number(r.discount),
    total_price: Number(r.total_price),
  }))
}

/** Totais dos meses fechados (para a estimativa do próximo mês). */
export async function getMonthlyTotals(householdId: string, sinceMonth: string): Promise<{ month: string; total: number }[]> {
  const rows = unwrap<{ month: string; total: number | string }[]>(
    await supabase().from('monthly_spending').select('month, total').eq('household_id', householdId).gte('month', sinceMonth).order('month'),
  )
  return rows.map((r) => ({ month: r.month.slice(0, 10), total: Number(r.total) }))
}
