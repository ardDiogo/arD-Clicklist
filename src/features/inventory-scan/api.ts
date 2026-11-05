import { FunctionsHttpError } from '@supabase/supabase-js'
import { compressImage, sha256Hex } from '@/features/receipts/api'
import { supabase } from '@/integrations/supabase/client'
import type { InventoryItemStatus, Json } from '@/integrations/supabase/database.types'
import type { Scan, ScanItem } from './domain'

export const MAX_PHOTOS = 8

function unwrap<T>(result: { data: T | null; error: unknown }): T {
  if (result.error) throw result.error
  return result.data as T
}

const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic' }

/**
 * Fluxo completo: cria a conferência, envia as fotos (comprimidas) ao Storage privado,
 * pede a análise à IA e grava o resultado como rascunho. Retorna o id da conferência.
 */
export async function createAndAnalyzeScan(
  householdId: string,
  locationId: string | null,
  photos: File[],
  onProgress?: (step: string) => void,
): Promise<string> {
  if (photos.length === 0) throw new Error('Adicione pelo menos uma foto.')
  if (photos.length > MAX_PHOTOS) throw new Error(`Envie no máximo ${MAX_PHOTOS} fotos por conferência.`)

  const scanId = unwrap(
    await supabase().rpc('create_inventory_scan', { p_household_id: householdId, p_location_id: locationId }),
  )

  for (const [idx, file] of photos.entries()) {
    onProgress?.(`Enviando foto ${idx + 1} de ${photos.length}…`)
    const blob = await compressImage(file, 2000, 0.85)
    const mime = blob === file ? file.type || 'image/jpeg' : 'image/jpeg'
    if (!EXT[mime]) throw new Error('Formato de imagem não suportado.')
    if (blob.size > 10 * 1024 * 1024) throw new Error('Foto muito grande (máximo 10 MB).')
    const sha = await sha256Hex(blob)
    const path = `${householdId}/scans/${scanId}/${idx + 1}-${sha.slice(0, 12)}.${EXT[mime]}`
    const { error } = await supabase().storage.from('inventory-photos').upload(path, blob, { contentType: mime, upsert: false })
    if (error) throw new Error(`Não foi possível enviar a foto ${idx + 1}: ${error.message}`)
    unwrap(
      await supabase().rpc('register_inventory_photo', {
        p_scan_id: scanId,
        p_position: idx + 1,
        p_storage_path: path,
        p_mime_type: mime,
        p_size_bytes: blob.size,
        p_sha256: sha,
      }),
    )
  }

  await analyzeScan(scanId, onProgress)
  return scanId
}

/** (Re)analisa as fotos de uma conferência em rascunho. */
export async function analyzeScan(scanId: string, onProgress?: (step: string) => void): Promise<void> {
  onProgress?.('Analisando as fotos com IA…')
  const { data, error } = await supabase().functions.invoke('inventory-ai', { body: { scan_id: scanId } })
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const payload = await error.context.json().catch(() => null)
      throw new Error(payload?.error ?? 'O serviço de IA não respondeu. Tente novamente.')
    }
    throw new Error('Serviço indisponível. Verifique se a função "inventory-ai" foi publicada no Supabase.')
  }
  const { detections, model } = data as { detections: unknown[]; model?: string }
  unwrap(
    await supabase().rpc('save_inventory_detections', {
      p_scan_id: scanId,
      p_detections: detections as Json,
      p_model: model ?? null,
    }),
  )
}

export interface ScanSummary extends Scan {
  location_name: string | null
  photoCount: number
}

export async function listScans(householdId: string, limit = 30): Promise<ScanSummary[]> {
  const client = supabase()
  const scans = unwrap(
    await client
      .from('inventory_scans')
      .select('*')
      .eq('household_id', householdId)
      .neq('status', 'discarded')
      .order('created_at', { ascending: false })
      .limit(limit),
  )
  if (scans.length === 0) return []
  const [locs, files] = await Promise.all([
    client.from('locations').select('id, name').eq('household_id', householdId),
    client.from('inventory_scan_files').select('scan_id').in(
      'scan_id',
      scans.map((s) => s.id),
    ),
  ])
  const locName = new Map((locs.data ?? []).map((l) => [l.id, l.name]))
  const count = new Map<string, number>()
  for (const f of files.data ?? []) count.set(f.scan_id, (count.get(f.scan_id) ?? 0) + 1)
  return scans.map((s) => ({
    ...s,
    location_name: s.location_id ? (locName.get(s.location_id) ?? null) : null,
    photoCount: count.get(s.id) ?? 0,
  }))
}

export async function getScan(id: string): Promise<Scan | null> {
  return unwrap(await supabase().from('inventory_scans').select('*').eq('id', id).maybeSingle())
}

export async function getScanItems(id: string): Promise<ScanItem[]> {
  return unwrap(await supabase().from('inventory_scan_items').select('*').eq('scan_id', id).order('created_at'))
}

export async function getScanPhotoUrls(id: string): Promise<{ position: number; url: string }[]> {
  const files = unwrap(
    await supabase().from('inventory_scan_files').select('position, storage_path').eq('scan_id', id).order('position'),
  )
  if (files.length === 0) return []
  const { data } = await supabase()
    .storage.from('inventory-photos')
    .createSignedUrls(
      files.map((f) => f.storage_path),
      600,
    )
  return files
    .map((f, i) => ({ position: f.position, url: data?.[i]?.signedUrl ?? '' }))
    .filter((p) => p.url)
}

export async function updateScanItem(
  item: Pick<ScanItem, 'id' | 'household_product_id' | 'confirmed_quantity' | 'status'>,
): Promise<void> {
  unwrap(
    await supabase().rpc('update_inventory_item', {
      p_item_id: item.id,
      p_household_product_id: item.household_product_id,
      p_confirmed_quantity: item.confirmed_quantity,
      p_status: item.status as InventoryItemStatus,
    }),
  )
}

export async function confirmScan(id: string): Promise<number> {
  const rows = unwrap(await supabase().rpc('confirm_inventory_scan', { p_scan_id: id }))
  return rows[0]?.adjusted_items ?? 0
}

export async function discardScan(id: string): Promise<void> {
  unwrap(await supabase().rpc('discard_inventory_scan', { p_scan_id: id }))
}
