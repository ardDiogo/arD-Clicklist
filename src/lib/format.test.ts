import { describe, expect, it } from 'vitest'
import { formatCurrency, formatDate, initials } from './format'

const nbsp = / /g

describe('formatCurrency', () => {
  it('formata NUMERIC vindo como string em BRL', () => {
    expect(formatCurrency('1234.5').replace(nbsp, ' ')).toBe('R$ 1.234,50')
  })
  it('formata número', () => {
    expect(formatCurrency(0).replace(nbsp, ' ')).toBe('R$ 0,00')
  })
  it('retorna traço para vazio ou inválido', () => {
    expect(formatCurrency(null)).toBe('—')
    expect(formatCurrency('')).toBe('—')
    expect(formatCurrency('abc')).toBe('—')
  })
})

describe('formatDate', () => {
  it('usa formato brasileiro', () => {
    expect(formatDate(new Date(2026, 10, 5))).toBe('05/11/2026')
  })
  it('lida com valores inválidos', () => {
    expect(formatDate(null)).toBe('—')
    expect(formatDate('não é data')).toBe('—')
  })
})

describe('initials', () => {
  it('usa primeira e última palavra', () => {
    expect(initials('Diogo de Araújo')).toBe('DA')
    expect(initials('  diogo ')).toBe('D')
    expect(initials(null, '?')).toBe('?')
  })
})
