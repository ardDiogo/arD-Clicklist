import { onlyDigits } from './types'

export interface NfceQr {
  url: string
  accessKey: string | null
}

/**
 * Interpreta o conteúdo do QR Code de uma NFC-e.
 * Formatos comuns:
 *   v2: https://…/qrcode?p=CHAVE44|2|1|1|HASH
 *   v1: https://…?chNFe=CHAVE44&nVersao=100&…
 * Só aceita endereços de portais públicos (*.gov.br).
 */
export function parseNfceQr(text: string): NfceQr | null {
  const raw = text.trim()
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (!['http:', 'https:'].includes(url.protocol)) return null
  if (!isGovBrHost(url.hostname)) return null

  const p = url.searchParams.get('p') ?? url.searchParams.get('chNFe') ?? ''
  const fromParam = onlyDigits(p.split('|')[0])
  const anywhere = raw.match(/\d{44}/)?.[0] ?? null
  const accessKey = fromParam.length === 44 ? fromParam : anywhere
  return { url: url.toString(), accessKey }
}

export function isGovBrHost(hostname: string): boolean {
  const h = hostname.toLowerCase()
  return h === 'gov.br' || h.endsWith('.gov.br')
}

/** UF a partir dos dois primeiros dígitos da chave (código IBGE). */
const UF_BY_CODE: Record<string, string> = {
  '11': 'RO', '12': 'AC', '13': 'AM', '14': 'RR', '15': 'PA', '16': 'AP', '17': 'TO',
  '21': 'MA', '22': 'PI', '23': 'CE', '24': 'RN', '25': 'PB', '26': 'PE', '27': 'AL', '28': 'SE', '29': 'BA',
  '31': 'MG', '32': 'ES', '33': 'RJ', '35': 'SP', '41': 'PR', '42': 'SC', '43': 'RS',
  '50': 'MS', '51': 'MT', '52': 'GO', '53': 'DF',
}

export function ufFromAccessKey(key: string | null): string | null {
  return key ? (UF_BY_CODE[key.slice(0, 2)] ?? null) : null
}
