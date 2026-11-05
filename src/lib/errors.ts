/**
 * Converte erros do Supabase/PostgREST/Auth em mensagens pt-BR amigáveis.
 * Erros levantados pelas nossas funções SQL já vêm em português.
 */
const AUTH_MESSAGES: Record<string, string> = {
  'Invalid login credentials': 'E-mail ou senha incorretos.',
  'Email not confirmed': 'Confirme seu e-mail antes de entrar. Verifique sua caixa de entrada.',
  'User already registered': 'Já existe uma conta com este e-mail.',
  'Password should be at least 6 characters': 'A senha precisa ter pelo menos 6 caracteres.',
  'New password should be different from the old password.': 'A nova senha precisa ser diferente da atual.',
  'Unable to validate email address: invalid format': 'E-mail inválido.',
  'Failed to fetch': 'Sem conexão com o servidor. Verifique sua internet.',
}

const SQL_DOMAIN_CODES = new Set(['22023', '42501', 'P0002', '28000'])

export function toMessage(error: unknown, fallback = 'Algo deu errado. Tente novamente.'): string {
  if (!error) return fallback
  const raw =
    typeof error === 'string'
      ? error
      : typeof error === 'object' && 'message' in error && typeof error.message === 'string'
        ? error.message
        : ''
  if (!raw) return fallback
  if (AUTH_MESSAGES[raw]) return AUTH_MESSAGES[raw]
  if (/rate limit/i.test(raw)) return 'Muitas tentativas. Aguarde alguns minutos e tente de novo.'
  if (/permission denied|row-level security/i.test(raw)) return 'Você não tem permissão para esta ação.'
  if (/JWT|session/i.test(raw) && /expired|missing|invalid/i.test(raw)) {
    return 'Sua sessão expirou. Entre novamente.'
  }
  // Erros levantados pelas nossas funções SQL usam estes códigos e já vêm em pt-BR.
  const code =
    typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : ''
  if (SQL_DOMAIN_CODES.has(code)) return raw
  return fallback
}
