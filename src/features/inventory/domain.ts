import type { MeasureUnit, StockMovementType, StockStatus, Views } from '@/integrations/supabase/database.types'

export type StockItem = Views<'household_stock'>

export const UNIT_LABEL: Record<MeasureUnit, string> = {
  un: 'un',
  g: 'g',
  kg: 'kg',
  ml: 'ml',
  l: 'L',
}

export const UNIT_OPTIONS: { value: MeasureUnit; label: string }[] = [
  { value: 'un', label: 'Unidades' },
  { value: 'g', label: 'Gramas (g)' },
  { value: 'kg', label: 'Quilos (kg)' },
  { value: 'ml', label: 'Mililitros (ml)' },
  { value: 'l', label: 'Litros (L)' },
]

export const STATUS_LABEL: Record<StockStatus, string> = {
  out: 'Sem estoque',
  low: 'Repor',
  ok: 'Em dia',
  untracked: 'Sem meta',
}

export const MOVEMENT_LABEL: Record<StockMovementType, string> = {
  purchase: 'Compra',
  consumption: 'Consumo',
  inventory_adjustment: 'Contagem',
  correction: 'Correção',
  transfer: 'Transferência',
}

/** Regra central: comprar = máximo(0, ideal − atual). */
export function quantityToBuy(ideal: number, current: number): number {
  return roundQty(Math.max(0, ideal - current))
}

/** Mesmo critério da view household_stock no banco. */
export function stockStatus(ideal: number, current: number): StockStatus {
  if (ideal === 0) return 'untracked'
  if (current === 0) return 'out'
  if (current < ideal) return 'low'
  return 'ok'
}

/** Quantidades no banco têm 3 casas decimais. Evita 0.30000000000000004. */
export function roundQty(n: number): number {
  return Math.round(n * 1000) / 1000
}

const qtyFormatter = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 })

export function formatQty(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return '—'
  return qtyFormatter.format(Number(n))
}

/** Aceita "1,5" ou "1.5"; retorna null se inválido ou negativo. */
export function parseQty(input: string): number | null {
  const normalized = input.trim().replace(/\s/g, '').replace(',', '.')
  if (normalized === '') return null
  if (!/^\d+(\.\d{1,3})?$/.test(normalized)) return null
  return roundQty(Number(normalized))
}

/** "380 g", "5 kg", "1,5 L" — vazio se não houver tamanho. */
export function packageLabel(size: number | null | undefined, unit: MeasureUnit): string {
  if (!size) return ''
  return `${formatQty(size)} ${UNIT_LABEL[unit]}`
}

/** Linha secundária do produto: "Bonare · Zero açúcar · 380 g". */
export function productSubtitle(item: Pick<StockItem, 'brand_name' | 'presentation' | 'package_size' | 'unit'>): string {
  return [item.brand_name, item.presentation, packageLabel(item.package_size, item.unit)]
    .filter(Boolean)
    .join(' · ')
}

export interface StockGroup {
  key: string
  label: string
  items: StockItem[]
}

/** Agrupa e ordena por ambiente ou categoria; itens sem grupo vão para o fim. */
export function groupStock(items: StockItem[], by: 'location' | 'category'): StockGroup[] {
  const groups = new Map<string, StockGroup & { sort: number }>()
  for (const item of items) {
    const id = by === 'location' ? item.location_id : item.category_id
    const label = (by === 'location' ? item.location_name : item.category_name) ?? (by === 'location' ? 'Sem ambiente' : 'Sem categoria')
    const sort = (by === 'location' ? item.location_sort : item.category_sort) ?? Number.MAX_SAFE_INTEGER
    const key = id ?? '_none'
    const group = groups.get(key) ?? { key, label, items: [], sort }
    group.items.push(item)
    groups.set(key, group)
  }
  return [...groups.values()]
    .sort((a, b) => a.sort - b.sort || a.label.localeCompare(b.label, 'pt-BR'))
    .map(({ key, label, items }) => ({
      key,
      label,
      items: [...items].sort((a, b) => a.product_name.localeCompare(b.product_name, 'pt-BR')),
    }))
}

/**
 * Situações exclusivas: ideal (tem o que precisa), repor (abaixo do ideal), sem estoque (zerado)
 * e fora da lista (quantidade ideal 0 ou marcado "Não envia à lista").
 */
export type StockFilter = 'all' | 'ideal' | 'restock' | 'out' | 'off'

/** Busca sem acento/maiúsculas em nome, marca, apresentação e código de barras. */
export function filterStock(items: StockItem[], query: string, filter: StockFilter): StockItem[] {
  const q = normalize(query)
  return items.filter((item) => {
    if (filter === 'ideal' && item.status !== 'ok') return false
    if (filter === 'restock' && item.status !== 'low') return false
    if (filter === 'out' && item.status !== 'out') return false
    if (filter === 'off' && item.status !== 'untracked') return false
    if (!q) return true
    const haystack = normalize(
      [item.product_name, item.brand_name, item.presentation, item.barcode, item.category_name, item.location_name]
        .filter(Boolean)
        .join(' '),
    )
    return q.split(/\s+/).every((term) => haystack.includes(term))
  })
}

export function normalize(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

/** Aplica localmente o efeito de uma movimentação (para atualização otimista da UI). */
export function applyLocalMovement(item: StockItem, delta: number): StockItem {
  const current = roundQty(Math.max(0, item.current_qty + delta))
  return {
    ...item,
    current_qty: current,
    to_buy_qty: quantityToBuy(item.ideal_qty, current),
    status: stockStatus(item.ideal_qty, current),
  }
}

export function newIdempotencyKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
}
