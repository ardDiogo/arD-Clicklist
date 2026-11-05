/** Formato comum de um comprovante extraído (QR/HTML da SEFAZ, XML ou IA). */
export interface ReceiptItem {
  description: string
  ean: string | null
  quantity: number
  unit: string | null
  unit_price: number | null
  discount: number
  total: number
}

export interface ReceiptData {
  store_name: string | null
  store_cnpj: string | null
  purchased_at: string | null
  access_key: string | null
  total: number | null
  discount: number | null
  source_url?: string | null
  items: ReceiptItem[]
}

/** "1.234,56" → 1234.56 · "0,640" → 0.64 · "12.5" → 12.5 */
export function parseBrNumber(input: string | null | undefined): number | null {
  if (input === null || input === undefined) return null
  const s = input.replace(/&nbsp;|\s|R\$/gi, '')
  if (!s) return null
  const normalized = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s
  const n = Number(normalized)
  return Number.isFinite(n) ? n : null
}

export function onlyDigits(s: string | null | undefined): string {
  return (s ?? '').replace(/\D/g, '')
}

/** EAN válido (8–14 dígitos, não "SEM GTIN" nem zeros). */
export function cleanEan(s: string | null | undefined): string | null {
  const d = onlyDigits(s)
  if (d.length < 8 || d.length > 14 || /^0+$/.test(d)) return null
  return d
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name: string) => ENTITIES[name.toLowerCase()] ?? m)
}

export function cleanText(s: string | null | undefined): string {
  return decodeEntities((s ?? '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
}

/** Validação final comum: descarta linhas vazias e garante números coerentes. */
export function finalizeReceipt(data: ReceiptData): ReceiptData {
  const items = data.items
    .filter((i) => i.description.trim())
    .map((i) => {
      const quantity = i.quantity > 0 ? i.quantity : 1
      const total =
        Number.isFinite(i.total) && i.total >= 0
          ? round2(i.total)
          : round2(quantity * (i.unit_price ?? 0) - (i.discount || 0))
      return { ...i, quantity, total, discount: round2(Math.max(0, i.discount || 0)) }
    })
  const key = onlyDigits(data.access_key)
  const cnpj = onlyDigits(data.store_cnpj)
  return {
    ...data,
    access_key: key.length === 44 ? key : null,
    store_cnpj: cnpj.length === 14 ? cnpj : null,
    items,
  }
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100
}
