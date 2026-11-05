import { normalize, productSubtitle, type StockItem } from '@/features/inventory/domain'
import type { PurchaseSource, Tables } from '@/integrations/supabase/database.types'

export type Purchase = Tables<'purchases'>
export type PurchaseItem = Tables<'purchase_items'>

export const SOURCE_LABEL: Record<PurchaseSource, string> = {
  nfce_qrcode: 'QR Code da NFC-e',
  xml: 'Arquivo XML',
  photo: 'Foto (IA)',
  manual: 'Manual',
}

/** Expande abreviações comuns de cupom para melhorar a comparação. */
const ABBREVIATIONS: Record<string, string> = {
  trad: 'tradicional',
  integ: 'integral',
  bisc: 'biscoito',
  refrig: 'refrigerante',
  sab: 'sabonete',
  deterg: 'detergente',
  amac: 'amaciante',
  cha: 'cha',
  choc: 'chocolate',
  lte: 'leite',
  marg: 'margarina',
  pct: 'pacote',
  cx: 'caixa',
  lt: 'lata',
}

function tokens(s: string): string[] {
  return normalize(s)
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((t) => t.length >= 2)
    .map((t) => ABBREVIATIONS[t] ?? t)
}

/**
 * Pontua a semelhança entre a descrição do cupom e um produto do estoque.
 * Usa sobreposição de palavras com prefixo (cupons abreviam: "MELIT" ~ "melitta").
 */
export function similarity(description: string, item: Pick<StockItem, 'product_name' | 'brand_name' | 'presentation' | 'package_size' | 'unit'>): number {
  const a = tokens(description)
  const b = tokens(`${item.product_name} ${productSubtitle(item)}`)
  if (a.length === 0 || b.length === 0) return 0
  let hits = 0
  for (const t of b) {
    if (a.some((x) => x === t || (x.length >= 3 && t.startsWith(x)) || (t.length >= 3 && x.startsWith(t)))) hits++
  }
  return hits / b.length
}

/** Produtos mais parecidos primeiro (para sugerir na revisão). */
export function suggestProducts(description: string, stock: StockItem[], limit = 3): StockItem[] {
  return stock
    .map((s) => ({ s, score: similarity(description, s) }))
    .filter((x) => x.score >= 0.5)
    .sort((x, y) => y.score - x.score || x.s.product_name.localeCompare(y.s.product_name, 'pt-BR'))
    .slice(0, limit)
    .map((x) => x.s)
}

/** Nome sugerido ao criar um produto a partir do cupom: "KETCHUP BONARE ZERO 380G" → "Ketchup Bonare Zero 380g". */
export function titleCase(description: string): string {
  return description
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/(^|\s)(\p{L})/gu, (_, sp: string, ch: string) => sp + ch.toUpperCase())
}

export interface ReviewSummary {
  toStock: number
  unmatched: number
  ignored: number
  notReceived: number
}

export function reviewSummary(items: PurchaseItem[]): ReviewSummary {
  let toStock = 0
  let unmatched = 0
  let ignored = 0
  let notReceived = 0
  for (const i of items) {
    if (i.ignored) ignored++
    else if (!i.household_product_id) unmatched++
    else if (!i.received || i.stock_quantity <= 0) notReceived++
    else toStock++
  }
  return { toStock, unmatched, ignored, notReceived }
}

/** Variação percentual entre o último preço e o anterior. */
export function priceVariation(last: number | null, previous: number | null): number | null {
  if (last === null || previous === null || previous === 0) return null
  return Math.round(((last - previous) / previous) * 1000) / 10
}
