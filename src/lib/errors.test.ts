import { describe, expect, it } from 'vitest'
import { toMessage } from './errors'

describe('toMessage', () => {
  it('traduz erros conhecidos do Supabase Auth', () => {
    expect(toMessage({ message: 'Invalid login credentials' })).toBe('E-mail ou senha incorretos.')
  })
  it('repassa mensagens das funções SQL pelo código de erro', () => {
    expect(toMessage({ message: 'Este convite expirou', code: '22023' })).toBe('Este convite expirou')
  })
  it('esconde mensagens técnicas desconhecidas', () => {
    expect(toMessage({ message: 'relation "x" does not exist', code: '42P01' })).toBe(
      'Algo deu errado. Tente novamente.',
    )
  })
  it('trata permissão negada', () => {
    expect(toMessage({ message: 'permission denied for table households', code: '42501' })).toBe(
      'Você não tem permissão para esta ação.',
    )
  })
})
