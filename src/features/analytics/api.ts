import { supabase } from '@/integrations/supabase/client'
import { getOpenList, listItems } from '@/features/shopping-list/api'
import { listTotals } from '@/features/shopping-list/domain'
import { addMonths, currentMonthKey, type CategoryRow, type MonthlyRow, type PriceChangeRow, type PurchaseTotalRow, type StoreRow } from './domain'

function unwrap<T>(result: { data: T | null; error: unknown }): T {
  if (result.error) throw result.error
  return result.data as T
}

export interface FinanceData {
  monthly: MonthlyRow[]
  categories: CategoryRow[]
  stores: StoreRow[]
  priceChanges: PriceChangeRow[]
  purchases: Pick<PurchaseTotalRow, 'id' | 'purchased_at' | 'total'>[]
  openList: { estimatedTotal: number; withoutPrice: number; itemCount: number } | null
}

/** Carrega todos os indicadores reais dos últimos `months` meses. */
export async function loadFinance(householdId: string, months: number): Promise<FinanceData> {
  const client = supabase()
  const since = addMonths(currentMonthKey(), -(months - 1))
  const [monthly, categories, stores, priceChanges, purchases, list] = await Promise.all([
    client.from('monthly_spending').select('*').eq('household_id', householdId).gte('month', since).order('month'),
    client.from('category_spending').select('*').eq('household_id', householdId).gte('month', since),
    client.from('store_spending').select('*').eq('household_id', householdId).order('total', { ascending: false }).limit(8),
    client.from('price_changes').select('*').eq('household_id', householdId).not('variation_pct', 'is', null),
    client
      .from('purchase_totals')
      .select('id, purchased_at, total')
      .eq('household_id', householdId)
      .order('purchased_at', { ascending: false })
      .limit(20),
    getOpenList(householdId),
  ])

  let openList: FinanceData['openList'] = null
  if (list) {
    const items = (await listItems(list.id)).filter((i) => !i.checked_at)
    const t = listTotals(items)
    openList = { estimatedTotal: t.estimatedTotal, withoutPrice: t.withoutPrice, itemCount: t.itemCount }
  }

  return {
    monthly: unwrap(monthly),
    categories: unwrap(categories),
    stores: unwrap(stores),
    priceChanges: unwrap(priceChanges),
    purchases: unwrap(purchases),
    openList,
  }
}
