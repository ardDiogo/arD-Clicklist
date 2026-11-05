/**
 * Garante que o parâmetro "next" só redirecione para rotas internas
 * (evita open redirect para domínios externos).
 */
export function safeNext(next: string | null | undefined, fallback = '/'): string {
  if (!next) return fallback
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return fallback
  return next
}

export function withNext(path: string, next: string | null | undefined): string {
  const safe = safeNext(next, '')
  return safe ? `${path}?next=${encodeURIComponent(safe)}` : path
}
