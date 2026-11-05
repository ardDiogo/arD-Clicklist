import { cleanText, finalizeReceipt, onlyDigits, parseBrNumber, type ReceiptData, type ReceiptItem } from './types'

/**
 * Extrai a NFC-e da página pública de consulta da SEFAZ (layout padrão usado por
 * SP, RS/SVRS e diversos outros estados: tabela #tabResult com spans txtTit,
 * RCod, Rqtd, RUN, RvlUnit e valor). Retorna null se o layout não for reconhecido.
 */
export function parseNfceHtml(html: string, sourceUrl?: string): ReceiptData | null {
  const items = parseItems(html)
  if (items.length === 0) return null

  const store = cleanText(html.match(/class="txtTopo"[^>]*>([\s\S]*?)<\/div>/i)?.[1]) || null
  const cnpj = onlyDigits(html.match(/CNPJ:?\s*(?:<[^>]+>\s*)*([\d./-]{14,18})/i)?.[1])
  const total = matchTotal(html, /Valor\s+a\s+pagar\s*R\$\s*:?/i) ?? matchTotal(html, /Valor\s+total\s*R\$\s*:?/i)
  const discount = matchTotal(html, /Descontos?\s*R\$\s*:?/i)
  const keyText = html.match(/class="chave"[^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? ''
  const key = onlyDigits(keyText).length === 44 ? onlyDigits(keyText) : (html.match(/\b(\d{4}(?:\s?\d{4}){10})\b/)?.[1] ?? '')

  return finalizeReceipt({
    store_name: store,
    store_cnpj: cnpj || null,
    purchased_at: parseEmission(html),
    access_key: onlyDigits(key) || null,
    total,
    discount,
    source_url: sourceUrl ?? null,
    items,
  })
}

function parseItems(html: string): ReceiptItem[] {
  // Cada item começa em um span "txtTit" (nome do produto).
  const chunks = html.split(/<span[^>]*class="txtTit[^"]*"[^>]*>/i).slice(1)
  const items: ReceiptItem[] = []
  for (const chunk of chunks) {
    const description = cleanText(chunk.slice(0, chunk.indexOf('</span>')))
    // Alguns layouts repetem txtTit para o valor total da linha; ignora sem quantidade.
    const qty = parseBrNumber(field(chunk, 'Rqtd', /Qtde\.?\s*:?/i))
    if (!description || qty === null) continue
    const code = chunk.match(/class="RCod"[^>]*>\s*\(?\s*C[oó]digo\s*:?\s*([^)<]*)/i)?.[1] ?? ''
    const unit = cleanText(field(chunk, 'RUN', /UN\s*:?/i)) || null
    const unitPrice = parseBrNumber(field(chunk, 'RvlUnit', /Vl\.?\s*Unit\.?\s*:?/i))
    const total = parseBrNumber(chunk.match(/class="valor"[^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? null)
    const digits = onlyDigits(code)
    items.push({
      description,
      ean: digits.length >= 8 && digits.length <= 14 ? digits : null,
      quantity: qty,
      unit: unit ? unit.toUpperCase() : null,
      unit_price: unitPrice,
      discount: 0,
      total: total ?? Math.round(qty * (unitPrice ?? 0) * 100) / 100,
    })
  }
  return items
}

/** Conteúdo de um span por classe, sem o rótulo em <strong>. */
function field(chunk: string, cls: string, label: RegExp): string | null {
  const m = chunk.match(new RegExp(`class="${cls}"[^>]*>([\\s\\S]*?)</span>`, 'i'))
  if (!m?.[1]) return null
  // Normalmente o rótulo vem em <strong>; se não vier, remove-o só do início.
  if (/<strong>/i.test(m[1])) return cleanText(m[1].replace(/<strong>[\s\S]*?<\/strong>/i, ''))
  return cleanText(m[1]).replace(new RegExp(`^${label.source}`, 'i'), '').trim()
}

function matchTotal(html: string, label: RegExp): number | null {
  const idx = html.search(label)
  if (idx < 0) return null
  const after = html.slice(idx, idx + 400)
  const m = after.match(/class="totalNumb[^"]*"[^>]*>\s*([\d.,]+)/i) ?? after.match(/>\s*([\d.]*\d,\d{2})\s*</)
  return parseBrNumber(m?.[1] ?? null)
}

/** "Emissão: 07/11/2026 18:30:12" → ISO com fuso de Brasília. */
function parseEmission(html: string): string | null {
  const text = cleanText(html)
  const m = text.match(/Emiss[aã]o:?\s*(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?/i)
  if (!m) return null
  const [, d, mo, y, h, mi, s] = m
  return `${y}-${mo}-${d}T${h}:${mi}:${s ?? '00'}-03:00`
}
