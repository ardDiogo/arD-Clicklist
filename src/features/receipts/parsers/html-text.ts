import { decodeEntities } from './types'

/**
 * Converte a página da SEFAZ em texto legível preservando a estrutura de linhas
 * e colunas (para a IA extrair os itens quando o layout do estado é desconhecido).
 * Remove scripts, estilos, cabeçalhos HTML e espaços excessivos.
 */
export function htmlToText(html: string, maxChars = 60_000): string {
  const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? html
  const text = decodeEntities(
    body
      .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(br|hr)\s*\/?>/gi, '\n')
      .replace(/<\/(tr|p|div|li|h[1-6]|table|section|article|header|footer)>/gi, '\n')
      .replace(/<\/(td|th)>/gi, ' | ')
      .replace(/<[^>]+>/g, ' '),
  )
  return text
    .split('\n')
    .map((l) => l.replace(/[ \t ]+/g, ' ').replace(/(\s*\|\s*)+$/, '').trim())
    .filter((l) => l && l !== '|')
    .join('\n')
    .slice(0, maxChars)
}
