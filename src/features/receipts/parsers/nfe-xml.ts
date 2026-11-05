import { cleanEan, cleanText, finalizeReceipt, onlyDigits, type ReceiptData, type ReceiptItem } from './types'

/**
 * Lê o XML de uma NF-e/NFC-e (modelo 55 ou 65), com ou sem o envelope <nfeProc>.
 * Implementação por expressões regulares: o layout da SEFAZ é rígido e isso evita
 * depender de DOMParser (funciona no navegador, em testes e em Edge Functions).
 */
export function parseNfeXml(xml: string): ReceiptData | null {
  // Remove prefixos de namespace (<nfe:det> → <det>).
  const doc = xml.replace(/<(\/?)[a-zA-Z0-9]+:/g, '<$1')
  if (!/<infNFe\b/i.test(doc)) return null

  const emit = block(doc, 'emit') ?? ''
  const ide = block(doc, 'ide') ?? ''
  const icmsTot = block(doc, 'ICMSTot') ?? ''

  const items: ReceiptItem[] = []
  for (const m of doc.matchAll(/<det\b[^>]*>([\s\S]*?)<\/det>/gi)) {
    const prod = block(m[1] ?? '', 'prod') ?? ''
    const quantity = num(tag(prod, 'qCom')) ?? 1
    const gross = num(tag(prod, 'vProd')) ?? 0
    const discount = num(tag(prod, 'vDesc')) ?? 0
    items.push({
      description: cleanText(tag(prod, 'xProd')),
      ean: cleanEan(tag(prod, 'cEAN')) ?? cleanEan(tag(prod, 'cEANTrib')),
      quantity,
      unit: cleanText(tag(prod, 'uCom')).toUpperCase() || null,
      unit_price: num(tag(prod, 'vUnCom')),
      discount,
      total: Math.round((gross - discount) * 100) / 100,
    })
  }
  if (items.length === 0) return null

  const key = doc.match(/<infNFe[^>]*\bId="NFe(\d{44})"/i)?.[1] ?? onlyDigits(tag(doc, 'chNFe'))
  const dh = tag(ide, 'dhEmi') || (tag(ide, 'dEmi') ? `${tag(ide, 'dEmi')}T12:00:00-03:00` : '')

  return finalizeReceipt({
    store_name: cleanText(tag(emit, 'xFant')) || cleanText(tag(emit, 'xNome')) || null,
    store_cnpj: onlyDigits(tag(emit, 'CNPJ')) || null,
    purchased_at: dh || null,
    access_key: key || null,
    total: num(tag(icmsTot, 'vNF')),
    discount: num(tag(icmsTot, 'vDesc')),
    items,
  })
}

function block(xml: string, name: string): string | null {
  return xml.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i'))?.[1] ?? null
}

function tag(xml: string, name: string): string {
  return xml.match(new RegExp(`<${name}\\b[^>]*>([^<]*)</${name}>`, 'i'))?.[1]?.trim() ?? ''
}

/** Números no XML usam ponto decimal (padrão SEFAZ). */
function num(s: string): number | null {
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}
