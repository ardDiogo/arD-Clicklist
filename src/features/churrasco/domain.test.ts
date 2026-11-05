import { describe, expect, it } from 'vitest'
import { computeChurrasco, normalizeInput } from './domain'

const get = (r: ReturnType<typeof computeChurrasco>, key: string) => r.items.find((i) => i.key === key)

describe('churrascômetro', () => {
  it('sem convidados não calcula nada', () => {
    expect(computeChurrasco({ men: 0, women: 0, kids: 0, drinkers: 0, duration: 'normal' }).items).toEqual([])
  })

  it('quem bebe nunca passa do número de adultos e entradas inválidas viram zero', () => {
    expect(normalizeInput({ men: 1, women: 1, kids: 5, drinkers: 9, duration: 'normal' }).drinkers).toBe(2)
    expect(normalizeInput({ men: -3, women: Number.NaN, kids: 2.7, drinkers: 0, duration: 'normal' })).toMatchObject({ men: 0, women: 0, kids: 2 })
  })

  it('10 homens, 8 mulheres, 4 crianças, 12 bebem cerveja', () => {
    const r = computeChurrasco({ men: 10, women: 8, kids: 4, drinkers: 12, duration: 'normal' })
    expect(r.people).toBe(22)
    expect(r.meatKg).toBe(7.2) // 4 + 2,4 + 0,8
    expect(get(r, 'bovina')?.amount).toBe(4) // 55% de 7,2 = 3,96 → 4,0
    expect(get(r, 'frango')?.amount).toBe(1.8)
    expect(get(r, 'linguica')?.amount).toBe(1.5) // 1,44 → 1,5
    expect(get(r, 'cerveja')?.amount).toBe(36) // 12 × 1,8 L = 21,6 L ÷ 0,6
    expect(get(r, 'refri')?.amount).toBe(10) // 6×0,75 + 12×0,25 + 4×0,5 = 9,5 → 10
    expect(get(r, 'refri')?.listQty).toBe(5)
    expect(get(r, 'agua')?.amount).toBe(11)
    expect(get(r, 'sal')?.amount).toBe(0.75) // 0,72 → 0,75
    expect(get(r, 'carvao')?.amount).toBe(8)
    expect(get(r, 'gelo')?.amount).toBe(25) // 11 + 12 = 23 → 25
    expect(get(r, 'pao')?.amount).toBe(20)
    expect(get(r, 'queijo')?.amount).toBe(11)
  })

  it('latas em vez de garrafas e sem cerveja quando ninguém bebe', () => {
    const r = computeChurrasco({ men: 2, women: 0, kids: 0, drinkers: 2, duration: 'normal' }, 'lata')
    expect(get(r, 'cerveja')).toMatchObject({ amount: 11, unit: 'latas' }) // 3,6 L ÷ 0,35
    expect(get(computeChurrasco({ men: 2, women: 0, kids: 0, drinkers: 0, duration: 'normal' }), 'cerveja')).toBeUndefined()
  })

  it('mínimos: 3 kg de carvão e 1 saco de gelo', () => {
    const r = computeChurrasco({ men: 0, women: 0, kids: 1, drinkers: 0, duration: 'normal' })
    expect(get(r, 'carvao')?.amount).toBe(3)
    expect(get(r, 'gelo')?.amount).toBe(5)
    expect(get(r, 'sal')?.amount).toBe(0.1)
  })

  it('churrasco longo (+25%)', () => {
    expect(computeChurrasco({ men: 4, women: 0, kids: 0, drinkers: 0, duration: 'longo' }).meatKg).toBe(2) // 1,6 × 1,25
  })
})
