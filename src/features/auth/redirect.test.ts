import { describe, expect, it } from 'vitest'
import { safeNext, withNext } from './redirect'

describe('safeNext', () => {
  it('aceita rotas internas', () => {
    expect(safeNext('/convite/abc')).toBe('/convite/abc')
  })
  it('bloqueia redirecionamento externo', () => {
    expect(safeNext('https://evil.com')).toBe('/')
    expect(safeNext('//evil.com')).toBe('/')
    expect(safeNext('/\\evil.com')).toBe('/')
    expect(safeNext(null)).toBe('/')
  })
  it('monta query string', () => {
    expect(withNext('/entrar', '/convite/x y')).toBe('/entrar?next=%2Fconvite%2Fx%20y')
    expect(withNext('/entrar', 'https://evil.com')).toBe('/entrar')
  })
})
