import { describe, expect, it } from 'vitest'
import nfceHtml from '../__fixtures__/nfce-sp.html?raw'
import nfeXml from '../__fixtures__/nfce.xml?raw'
import { parseNfceHtml } from './nfce-html'
import { parseNfeXml } from './nfe-xml'
import { isGovBrHost, parseNfceQr, ufFromAccessKey } from './qrcode'
import { cleanEan, finalizeReceipt, parseBrNumber } from './types'

const FIXTURES: Record<string, string> = { 'nfce-sp.html': nfceHtml, 'nfce.xml': nfeXml }
const fixture = (name: string) => FIXTURES[name] ?? ''
const KEY = '35261112345678000190650010000123451000123456'

describe('parseNfceQr', () => {
  it('lê QR v2 (p=chave|…)', () => {
    const r = parseNfceQr(`https://www.nfce.fazenda.sp.gov.br/qrcode?p=${KEY}|2|1|1|ABCDEF0123`)
    expect(r?.accessKey).toBe(KEY)
    expect(r?.url).toContain('fazenda.sp.gov.br')
  })
  it('lê QR v1 (chNFe=)', () => {
    expect(parseNfceQr(`http://nfce.sefaz.rs.gov.br/consulta?chNFe=${KEY}&nVersao=100`)?.accessKey).toBe(KEY)
  })
  it('recusa endereços fora de gov.br e textos que não são URL', () => {
    expect(parseNfceQr(`https://evil.com/?p=${KEY}`)).toBeNull()
    expect(parseNfceQr('https://fazenda.sp.gov.br.evil.com/')).toBeNull()
    expect(parseNfceQr('não é url')).toBeNull()
    expect(parseNfceQr('javascript:alert(1)')).toBeNull()
  })
  it('valida host e UF', () => {
    expect(isGovBrHost('www.sefaz.ba.gov.br')).toBe(true)
    expect(isGovBrHost('gov.br.example.com')).toBe(false)
    expect(ufFromAccessKey(KEY)).toBe('SP')
  })
})

describe('parseNfceHtml (layout padrão SEFAZ)', () => {
  const r = parseNfceHtml(fixture('nfce-sp.html'), 'https://sefaz')
  it('extrai estabelecimento, data, chave e totais', () => {
    expect(r?.store_name).toBe('SUPERMERCADO EXEMPLO LTDA')
    expect(r?.store_cnpj).toBe('12345678000190')
    expect(r?.purchased_at).toBe('2026-11-07T18:30:12-03:00')
    expect(r?.access_key).toBe(KEY)
    expect(r?.total).toBe(41.36)
    expect(r?.discount).toBe(1)
    expect(r?.source_url).toBe('https://sefaz')
  })
  it('extrai itens com quantidade, unidade, preço e EAN', () => {
    expect(r?.items).toHaveLength(3)
    expect(r?.items[0]).toEqual({
      description: 'KETCHUP BONARE ZERO 380G',
      ean: '7896000000017',
      quantity: 2,
      unit: 'UN',
      unit_price: 8.99,
      discount: 0,
      total: 17.98,
    })
    expect(r?.items[1]?.description).toBe('CAFÉ MELITTA TRAD 500G')
    expect(r?.items[2]).toMatchObject({ quantity: 0.64, unit: 'KG', ean: null, total: 4.48 })
  })
  it('retorna null para página sem itens reconhecíveis', () => {
    expect(parseNfceHtml('<html><body>Consulta indisponível</body></html>')).toBeNull()
  })
})

describe('parseNfeXml', () => {
  const r = parseNfeXml(fixture('nfce.xml'))
  it('extrai cabeçalho', () => {
    expect(r?.store_name).toBe('Mercado Exemplo')
    expect(r?.store_cnpj).toBe('12345678000190')
    expect(r?.access_key).toBe(KEY)
    expect(r?.purchased_at).toBe('2026-11-07T18:30:12-03:00')
    expect(r?.total).toBe(54.2)
    expect(r?.discount).toBe(0.5)
  })
  it('extrai itens, desconto, entidades e ignora "SEM GTIN"', () => {
    expect(r?.items).toHaveLength(3)
    expect(r?.items[1]).toEqual({
      description: 'PÃO FRANCÊS KG',
      ean: null,
      quantity: 0.532,
      unit: 'KG',
      unit_price: 15,
      discount: 0.5,
      total: 7.48,
    })
    expect(r?.items[2]?.description).toBe('LEITE & CIA 1L')
  })
  it('aceita prefixos de namespace e recusa XML que não é NF-e', () => {
    const prefixed = fixture('nfce.xml').replace(/<(\/?)(det|prod|xProd|qCom|vProd|infNFe)\b/g, '<$1nfe:$2')
    expect(parseNfeXml(prefixed)?.items).toHaveLength(3)
    expect(parseNfeXml('<root><a>1</a></root>')).toBeNull()
  })
})

describe('helpers', () => {
  it('números brasileiros', () => {
    expect(parseBrNumber('1.234,56')).toBe(1234.56)
    expect(parseBrNumber('&nbsp;8,99')).toBe(8.99)
    expect(parseBrNumber('R$ 0,640')).toBe(0.64)
    expect(parseBrNumber('')).toBeNull()
  })
  it('EAN', () => {
    expect(cleanEan('SEM GTIN')).toBeNull()
    expect(cleanEan('00000000')).toBeNull()
    expect(cleanEan('7896000000017')).toBe('7896000000017')
  })
  it('finalizeReceipt descarta linhas vazias e corrige números', () => {
    const r = finalizeReceipt({
      store_name: null,
      store_cnpj: '123',
      purchased_at: null,
      access_key: '999',
      total: null,
      discount: null,
      items: [
        { description: ' ', ean: null, quantity: 1, unit: null, unit_price: 1, discount: 0, total: 1 },
        { description: 'X', ean: null, quantity: 0, unit: null, unit_price: 2.5, discount: 0, total: Number.NaN },
      ],
    })
    expect(r.items).toEqual([{ description: 'X', ean: null, quantity: 1, unit: null, unit_price: 2.5, discount: 0, total: 2.5 }])
    expect(r.store_cnpj).toBeNull()
    expect(r.access_key).toBeNull()
  })
})
