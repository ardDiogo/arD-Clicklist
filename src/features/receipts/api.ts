import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from '@/integrations/supabase/client'
import type { Json, PurchaseSource, Views } from '@/integrations/supabase/database.types'
import type { Purchase, PurchaseItem } from './domain'
import { htmlToText } from './parsers/html-text'
import { parseNfceHtml } from './parsers/nfce-html'
import { parseNfeXml } from './parsers/nfe-xml'
import { parseNfceQr, ufFromAccessKey } from './parsers/qrcode'
import { finalizeReceipt, type ReceiptData } from './parsers/types'

export type ProductPrices = Views<'household_product_prices'>
export type PriceHistoryRow = Views<'product_price_history'>

const MAX_UPLOAD = 10 * 1024 * 1024

function unwrap<T>(result: { data: T | null; error: unknown }): T {
  if (result.error) throw result.error
  return result.data as T
}

/** Erro amigável vindo de uma Edge Function ({ error: "..." }). */
async function invoke<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase().functions.invoke(name, { body })
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const payload = await error.context.json().catch(() => null)
      throw new Error(payload?.error ?? 'O serviço não respondeu. Tente novamente.')
    }
    throw new Error(
      /Failed to send|fetch/i.test(error.message)
        ? `Serviço indisponível. Verifique se a função "${name}" foi publicada no Supabase (com "Verify JWT" desligado).`
        : error.message,
    )
  }
  return data as T
}

// -----------------------------------------------------------------------------
// Arquivos
// -----------------------------------------------------------------------------
export async function sha256Hex(blob: Blob): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Reduz fotos grandes (celulares geram 4–8 MB) para ~2000px JPEG.
 * Mantém legibilidade para a IA e economiza armazenamento. HEIC segue como está.
 */
export async function compressImage(file: File, maxSide = 2000, quality = 0.85): Promise<Blob> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file
  const bitmap = await createImageBitmap(file).catch(() => null)
  if (!bitmap) return file
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  if (scale === 1 && file.size < 1.5 * 1024 * 1024) return file
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', quality))
  return blob && blob.size < file.size ? blob : file
}

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'application/xml': 'xml',
  'text/xml': 'xml',
}

/** Envia o original para o Storage privado (pasta da família) e registra no banco. */
export async function uploadReceiptFile(householdId: string, blob: Blob, mimeType: string): Promise<string> {
  if (!EXT[mimeType]) throw new Error('Formato não suportado. Use foto (JPG/PNG/WEBP/HEIC) ou XML.')
  if (blob.size > MAX_UPLOAD) throw new Error('Arquivo muito grande (máximo 10 MB).')
  const sha = await sha256Hex(blob)
  const path = `${householdId}/${sha.slice(0, 16)}-${crypto.randomUUID()}.${EXT[mimeType]}`
  const { error } = await supabase().storage.from('receipts').upload(path, blob, { contentType: mimeType, upsert: false })
  if (error) throw new Error(`Não foi possível enviar o arquivo: ${error.message}`)
  return unwrap(
    await supabase().rpc('register_purchase_file', {
      p_household_id: householdId,
      p_storage_path: path,
      p_mime_type: mimeType,
      p_size_bytes: blob.size,
      p_sha256: sha,
    }),
  )
}

export async function signedFileUrl(path: string): Promise<string | null> {
  const { data } = await supabase().storage.from('receipts').createSignedUrl(path, 120)
  return data?.signedUrl ?? null
}

// -----------------------------------------------------------------------------
// Importação
// -----------------------------------------------------------------------------
async function createDraft(householdId: string, source: PurchaseSource, data: ReceiptData, fileId?: string): Promise<string> {
  return unwrap(
    await supabase().rpc('create_purchase_draft', {
      p_household_id: householdId,
      p_source: source,
      p_data: data as unknown as Json,
      p_file_id: fileId ?? null,
    }),
  )
}

/** QR Code da NFC-e → página pública da SEFAZ (via Edge Function) → rascunho. */
export async function importFromQr(householdId: string, qrText: string): Promise<string> {
  const qr = parseNfceQr(qrText)
  if (!qr) throw new Error('Este QR Code não parece ser de uma NFC-e (o link precisa ser de um portal gov.br).')
  const { html, finalUrl } = await invoke<{ html: string; finalUrl: string }>('nfce-proxy', { url: qr.url })
  let data = parseNfceHtml(html, finalUrl)
  if (!data) {
    // Layout do estado não reconhecido (ex.: portal de MG): a IA lê o TEXTO da página.
    const uf = ufFromAccessKey(qr.accessKey)
    try {
      const fromText = await invoke<ReceiptData>('receipt-ai', { text: htmlToText(html) })
      data = finalizeReceipt({ ...fromText, source_url: finalUrl })
    } catch (e) {
      throw new Error(
        `Não consegui ler a página da SEFAZ${uf ? ` de ${uf}` : ''} (${e instanceof Error ? e.message : 'erro desconhecido'}). ` +
          'Use a opção "Foto do cupom" ou o arquivo XML.',
      )
    }
  }
  return createDraft(householdId, 'nfce_qrcode', { ...data, access_key: data.access_key ?? qr.accessKey })
}

/** Arquivo XML da NF-e/NFC-e → rascunho (o original fica guardado). */
export async function importXml(householdId: string, file: File): Promise<string> {
  const text = await file.text()
  const data = parseNfeXml(text)
  if (!data) throw new Error('Este arquivo não é um XML de NF-e/NFC-e válido.')
  const fileId = await uploadReceiptFile(householdId, file, 'application/xml')
  return createDraft(householdId, 'xml', data, fileId)
}

/** Foto do cupom → IA (Edge Function) → rascunho para revisão. */
export async function importPhoto(householdId: string, file: File): Promise<string> {
  const blob = await compressImage(file)
  const mime = blob === file ? file.type || 'image/jpeg' : 'image/jpeg'
  const fileId = await uploadReceiptFile(householdId, blob, mime)
  const data = await invoke<ReceiptData>('receipt-ai', { file_id: fileId })
  return createDraft(householdId, 'photo', finalizeReceipt(data), fileId)
}

// -----------------------------------------------------------------------------
// Compras
// -----------------------------------------------------------------------------
export interface PurchaseSummary extends Purchase {
  itemCount: number
}

export async function listPurchases(householdId: string, limit = 50): Promise<PurchaseSummary[]> {
  const client = supabase()
  const rows = unwrap(
    await client
      .from('purchases')
      .select('*')
      .eq('household_id', householdId)
      .neq('status', 'discarded')
      .order('created_at', { ascending: false })
      .limit(limit),
  )
  if (rows.length === 0) return []
  const items = unwrap(
    await client
      .from('purchase_items')
      .select('purchase_id')
      .in(
        'purchase_id',
        rows.map((r) => r.id),
      ),
  )
  const counts = new Map<string, number>()
  for (const i of items) counts.set(i.purchase_id, (counts.get(i.purchase_id) ?? 0) + 1)
  return rows.map((r) => ({ ...r, itemCount: counts.get(r.id) ?? 0 }))
}

export async function getPurchase(id: string): Promise<Purchase | null> {
  return unwrap(await supabase().from('purchases').select('*').eq('id', id).maybeSingle())
}

export async function getPurchaseItems(id: string): Promise<PurchaseItem[]> {
  return unwrap(await supabase().from('purchase_items').select('*').eq('purchase_id', id).order('line_number'))
}

export async function getPurchaseFiles(id: string) {
  return unwrap(await supabase().from('purchase_files').select('id, storage_path, mime_type').eq('purchase_id', id))
}

export async function updatePurchaseItem(
  item: Pick<PurchaseItem, 'id' | 'household_product_id' | 'received' | 'ignored' | 'stock_quantity'>,
): Promise<void> {
  unwrap(
    await supabase().rpc('update_purchase_item', {
      p_item_id: item.id,
      p_household_product_id: item.household_product_id,
      p_received: item.received,
      p_ignored: item.ignored,
      p_stock_quantity: item.stock_quantity,
    }),
  )
}

export async function updatePurchaseHeader(id: string, storeName: string | null, purchasedAt: string | null): Promise<void> {
  unwrap(await supabase().rpc('update_purchase_header', { p_purchase_id: id, p_store_name: storeName, p_purchased_at: purchasedAt }))
}

/** Corrige o nome do estabelecimento (também em compras confirmadas). Retorna quantas compras mudaram. */
export async function renamePurchaseStore(id: string, storeName: string, applyToSameName: boolean): Promise<number> {
  return unwrap(
    await supabase().rpc('rename_purchase_store', {
      p_purchase_id: id,
      p_store_name: storeName.trim(),
      p_apply_to_same_name: applyToSameName,
    }),
  )
}

export async function confirmPurchase(id: string): Promise<number> {
  const rows = unwrap(await supabase().rpc('confirm_purchase', { p_purchase_id: id }))
  return rows[0]?.applied_items ?? 0
}

export async function discardPurchase(id: string): Promise<void> {
  unwrap(await supabase().rpc('discard_purchase', { p_purchase_id: id }))
}

// -----------------------------------------------------------------------------
// Preços
// -----------------------------------------------------------------------------
export async function getProductPrices(householdProductId: string): Promise<ProductPrices | null> {
  return unwrap(
    await supabase().from('household_product_prices').select('*').eq('household_product_id', householdProductId).maybeSingle(),
  )
}

export async function getPriceHistory(householdProductId: string, limit = 10): Promise<PriceHistoryRow[]> {
  return unwrap(
    await supabase()
      .from('product_price_history')
      .select('*')
      .eq('household_product_id', householdProductId)
      .order('purchased_at', { ascending: false })
      .limit(limit),
  )
}
