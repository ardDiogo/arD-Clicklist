/** Formatos devolvidos pelas funções intel_* do banco (já agregados). */

export type Preset = '7d' | '30d' | '90d' | '6m' | '12m' | 'ytd' | 'custom'

export interface IntelFilters {
  preset: Preset
  /** Usados quando preset = 'custom' (AAAA-MM-DD). */
  from?: string
  to?: string
  store?: string
  category?: string
  product?: string
  brand?: string
}

export interface DateRange {
  from: string
  to: string
}

export interface Kpis {
  total: number
  purchases: number
  avg_ticket: number | null
  stores: number
  products: number
  items: number
  discount: number
}

export interface SeriesPoint {
  bucket: string
  total: number
  purchases: number
  prev_total: number
}

export interface CategoryPoint {
  name: string
  total: number
  prev_total: number
  share: number
  change_pct: number | null
}

export interface Ticket {
  purchase_id: string
  date: string
  store_name: string
  total: number
  outlier: boolean
}

export interface Overview {
  granularity: 'day' | 'week' | 'month'
  period: { from: string; to: string; days: number }
  previous: { from: string; to: string }
  kpis: Kpis
  previous_kpis: Kpis
  savings: { total: number; products: number }
  series: SeriesPoint[]
  categories: CategoryPoint[]
  tickets: Ticket[]
}

export interface StoreRank {
  store_key: string
  store_name: string
  visits: number
  total: number
  avg_ticket: number
  last_visit: string
  share: number
}

export interface StoreIndex {
  store_key: string
  store_name: string
  compared: number
  wins: number
  index: number
}

export interface BasketItem {
  household_product_id: string
  product_name: string
  unit: string
  min_price: number
  max_price: number
  spread_pct: number | null
  best_store_key: string
  best_store_name: string
  prices: { store_key: string; store_name: string; price: number; date: string; discount: boolean }[]
}

export interface SavingItem {
  household_product_id: string
  product_name: string
  unit: string
  lines: number
  quantity: number
  paid: number
  saving: number
  best_store_name: string
  best_price: number
}

export interface StoresData {
  window: { from: string; to: string }
  stores_with_prices: number
  ranking: StoreRank[]
  price_index: StoreIndex[]
  basket: BasketItem[]
  savings: SavingItem[]
}

export interface ProductStat {
  key: string
  household_product_id: string | null
  product_name: string
  category_name: string
  brand_name: string | null
  unit: string
  quantity: number
  total: number
  share: number
  receipts: number
  purchase_days: number
  first_date: string
  last_date: string
  days_since_last: number
  avg_interval_days: number | null
  current_qty: number | null
  ideal_qty: number | null
  consumed: number
  counted_down: number
}

export interface ProductsData {
  total: number
  products: ProductStat[]
}

export interface PriceStat {
  household_product_id: string
  product_name: string
  brand_name: string | null
  category_name: string
  unit: string
  package_size: number | null
  measure_unit: string
  observations: number
  last_price: number
  last_date: string
  prev_price: number | null
  first_price: number
  min_price: number
  max_price: number
  avg_price: number
  last_vs_prev_pct: number | null
  period_change_pct: number | null
  range_pct: number | null
  prev_period_avg: number | null
  vs_prev_period_pct: number | null
  stores: number
  store_spread_pct: number | null
  cheapest_store: string | null
}

export interface PricePoint {
  local_date: string
  store_key: string
  store_name: string
  unit: string
  quantity: number
  unit_price: number
  discount: number
  total_price: number
}

export interface FilterOptions {
  stores: { key: string; name: string; visits: number }[]
  categories: { id: string; name: string }[]
  products: { id: string; name: string }[]
  brands: { id: string; name: string }[]
  first_date: string | null
  confirmed: number
  drafts: number
}

export type Confidence = 'alta' | 'média' | 'baixa'

export interface Insight {
  id: string
  title: string
  description: string
  metric: string
  period: string
  source: string
  confidence: Confidence | null
  tone: 'positive' | 'warning' | 'neutral'
}
