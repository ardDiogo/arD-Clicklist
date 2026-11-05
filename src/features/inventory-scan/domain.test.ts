import { describe, expect, it } from 'vitest'
import type { StockItem } from '@/features/inventory/domain'
import { attentionReason, buildAdjustments, confidenceLevel, detectedLabel, sectionItems, type ScanItem } from './domain'

function item(p: Partial<ScanItem>): ScanItem {
  return {
    id: crypto.randomUUID(),
    scan_id: 's',
    household_id: 'h',
    origin: 'detected',
    household_product_id: 'k',
    detected_name: 'Ketchup',
    detected_brand: 'Bonare',
    detected_details: null,
    estimated_quantity: 2,
    confidence: 0.9,
    partially_hidden: false,
    photo_positions: [1],
    system_quantity: 1,
    confirmed_quantity: 2,
    status: 'confirmed',
    created_at: '',
    updated_at: '',
    ...p,
  }
}

const stock = [
  { id: 'k', product_name: 'Ketchup', current_qty: 1 },
  { id: 's', product_name: 'Sardinha', current_qty: 4 },
  { id: 'a', product_name: 'Arroz', current_qty: 1 },
] as StockItem[]

describe('confidenceLevel', () => {
  it('classifica por faixas', () => {
    expect(confidenceLevel(0.95)).toBe('high')
    expect(confidenceLevel(0.8)).toBe('high')
    expect(confidenceLevel(0.6)).toBe('medium')
    expect(confidenceLevel(0.2)).toBe('low')
    expect(confidenceLevel(null)).toBe('low')
  })
})

describe('attentionReason', () => {
  it('explica por que o item precisa de revisão', () => {
    expect(attentionReason(item({}))).toBeNull()
    expect(attentionReason(item({ origin: 'expected' }))).toBe('Não apareceu nas fotos')
    expect(attentionReason(item({ household_product_id: null }))).toMatch(/não identificado/)
    expect(attentionReason(item({ estimated_quantity: null }))).toMatch(/contar/)
    expect(attentionReason(item({ partially_hidden: true }))).toMatch(/escondido/)
    expect(attentionReason(item({ confidence: 0.6 }))).toMatch(/Confira/)
  })
})

describe('sectionItems', () => {
  it('separa prontos, revisar (menor confiança primeiro), não vistos e ignorados', () => {
    const s = sectionItems([
      item({ id: '1' }),
      item({ id: '2', status: 'pending', confidence: 0.7 }),
      item({ id: '3', status: 'pending', confidence: 0.3 }),
      item({ id: '4', origin: 'expected', status: 'pending', confidence: null }),
      item({ id: '5', status: 'ignored' }),
      item({ id: '6', origin: 'expected', status: 'confirmed' }),
    ])
    expect(s.ready.map((i) => i.id)).toEqual(['1', '6'])
    expect(s.review.map((i) => i.id)).toEqual(['3', '2'])
    expect(s.notSeen.map((i) => i.id)).toEqual(['4'])
    expect(s.ignored.map((i) => i.id)).toEqual(['5'])
  })
})

describe('buildAdjustments', () => {
  it('soma por produto e só lista o que muda', () => {
    const adj = buildAdjustments(
      [
        item({ household_product_id: 'k', confirmed_quantity: 1 }),
        item({ household_product_id: 'k', confirmed_quantity: 2 }), // ketchup em duas prateleiras
        item({ household_product_id: 's', confirmed_quantity: 4 }), // igual ao estoque: sem ajuste
        item({ household_product_id: 'a', confirmed_quantity: 0, origin: 'expected' }), // acabou
        item({ household_product_id: 'a', confirmed_quantity: 5, status: 'pending' }), // pendente: ignorado
      ],
      stock,
    )
    expect(adj).toEqual([
      { householdProductId: 'a', name: 'Arroz', before: 1, after: 0 },
      { householdProductId: 'k', name: 'Ketchup', before: 1, after: 3 },
    ])
  })
})

describe('detectedLabel', () => {
  it('junta nome, marca e detalhes', () => {
    expect(detectedLabel({ detected_name: 'Ketchup', detected_brand: 'Bonare', detected_details: '380 g' })).toBe('Ketchup · Bonare · 380 g')
  })
})
