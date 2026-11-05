import { describe, expect, it } from 'vitest'
import { can, inviteUrl } from './roles'

describe('permissões (espelho do banco, só para a UI)', () => {
  it('somente admin gerencia membros', () => {
    expect(can.manageMembers('admin')).toBe(true)
    expect(can.manageMembers('editor')).toBe(false)
    expect(can.manageMembers('viewer')).toBe(false)
  })
  it('admin e editor podem editar', () => {
    expect(can.edit('admin')).toBe(true)
    expect(can.edit('editor')).toBe(true)
    expect(can.edit('viewer')).toBe(false)
    expect(can.edit(null)).toBe(false)
  })
  it('gera link de convite', () => {
    expect(inviteUrl('https://app.com/', 'abc')).toBe('https://app.com/convite/abc')
  })
})
