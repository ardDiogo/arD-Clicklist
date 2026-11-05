import { roundQty, type StockItem } from '@/features/inventory/domain'
import type { Tables } from '@/integrations/supabase/database.types'

export type Scan = Tables<'inventory_scans'>
export type ScanItem = Tables<'inventory_scan_items'>

export type ConfidenceLevel = 'high' | 'medium' | 'low'

export function confidenceLevel(c: number | null): ConfidenceLevel {
  if (c === null) return 'low'
  if (c >= 0.8) return 'high'
  if (c >= 0.5) return 'medium'
  return 'low'
}

export const CONFIDENCE_LABEL: Record<ConfidenceLevel, string> = {
  high: 'Alta confiança',
  medium: 'Confiança média',
  low: 'Baixa confiança',
}

/** Por que um item precisa de atenção (texto curto para a revisão). */
export function attentionReason(item: ScanItem): string | null {
  if (item.origin === 'expected') return 'Não apareceu nas fotos'
  if (!item.household_product_id) return 'Produto não identificado no seu estoque'
  if (item.estimated_quantity === null) return 'A IA não conseguiu contar'
  if (item.partially_hidden) return 'Parcialmente escondido'
  if (confidenceLevel(item.confidence) !== 'high') return 'Confira a quantidade'
  return null
}

export interface ScanSections {
  ready: ScanItem[]
  review: ScanItem[]
  notSeen: ScanItem[]
  ignored: ScanItem[]
}

/** Separa a revisão em: prontos, para revisar, não vistos e ignorados. */
export function sectionItems(items: ScanItem[]): ScanSections {
  const s: ScanSections = { ready: [], review: [], notSeen: [], ignored: [] }
  for (const i of items) {
    if (i.status === 'ignored') s.ignored.push(i)
    else if (i.origin === 'expected' && i.status === 'pending') s.notSeen.push(i)
    else if (i.status === 'confirmed') s.ready.push(i)
    else s.review.push(i)
  }
  const byConfidence = (a: ScanItem, b: ScanItem) => (a.confidence ?? 0) - (b.confidence ?? 0)
  s.review.sort(byConfidence)
  return s
}

export interface Adjustment {
  householdProductId: string
  name: string
  before: number
  after: number
}

/**
 * Ajustes que a confirmação vai aplicar: soma por produto dos itens confirmados,
 * só onde a contagem difere do estoque atual (mesma regra do banco).
 */
export function buildAdjustments(items: ScanItem[], stock: StockItem[]): Adjustment[] {
  const byId = new Map(stock.map((s) => [s.id, s]))
  const totals = new Map<string, number>()
  for (const i of items) {
    if (i.status !== 'confirmed' || !i.household_product_id || i.confirmed_quantity === null) continue
    totals.set(i.household_product_id, roundQty((totals.get(i.household_product_id) ?? 0) + i.confirmed_quantity))
  }
  const result: Adjustment[] = []
  for (const [id, after] of totals) {
    const s = byId.get(id)
    if (!s) continue
    if (after !== s.current_qty) result.push({ householdProductId: id, name: s.product_name, before: s.current_qty, after })
  }
  return result.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
}

export function detectedLabel(i: Pick<ScanItem, 'detected_name' | 'detected_brand' | 'detected_details'>): string {
  return [i.detected_name, i.detected_brand, i.detected_details].filter(Boolean).join(' · ')
}
