import jsQR from 'jsqr'
import { Camera, ImageUp, Link2 } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/Button'
import { Alert } from '@/components/ui/feedback'

type Detector = { detect: (src: CanvasImageSource) => Promise<{ rawValue: string }[]> }

function nativeDetector(): Detector | null {
  const Ctor = (globalThis as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector
  try {
    return Ctor ? new Ctor({ formats: ['qr_code'] }) : null
  } catch {
    return null
  }
}

function decodeCanvas(canvas: HTMLCanvasElement): string | null {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
  return jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })?.data ?? null
}

async function decodeImageFile(file: File): Promise<string | null> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const native = nativeDetector()
  if (native) {
    const found = await native.detect(canvas).catch(() => [])
    if (found[0]?.rawValue) return found[0].rawValue
  }
  return decodeCanvas(canvas)
}

/**
 * Lê o QR Code da NFC-e. Usa a câmera (BarcodeDetector nativo quando existe,
 * senão jsQR), aceita uma foto do QR ou o link colado manualmente.
 */
export function QrScanner({ onResult, busy }: { onResult: (text: string) => void; busy: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [mode, setMode] = useState<'camera' | 'link'>('camera')
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [link, setLink] = useState('')
  const [fileError, setFileError] = useState<string | null>(null)
  const done = useRef(false)

  useEffect(() => {
    if (mode !== 'camera' || busy) return
    done.current = false
    let stream: MediaStream | null = null
    let raf = 0
    let stopped = false
    const canvas = document.createElement('canvas')
    const native = nativeDetector()

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError('Este navegador não permite usar a câmera. Envie uma foto do QR Code ou cole o link.')
        return
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
          audio: false,
        })
      } catch {
        setCameraError('Não foi possível acessar a câmera. Verifique a permissão ou envie uma foto do QR Code.')
        return
      }
      if (stopped || !videoRef.current) return
      videoRef.current.srcObject = stream
      await videoRef.current.play().catch(() => undefined)
      const tick = async () => {
        if (stopped || done.current) return
        const v = videoRef.current
        if (v && v.readyState >= 2 && v.videoWidth) {
          let text: string | null = null
          if (native) {
            const found = await native.detect(v).catch(() => [])
            text = found[0]?.rawValue ?? null
          } else {
            const scale = Math.min(1, 800 / v.videoWidth)
            canvas.width = Math.round(v.videoWidth * scale)
            canvas.height = Math.round(v.videoHeight * scale)
            canvas.getContext('2d', { willReadFrequently: true })?.drawImage(v, 0, 0, canvas.width, canvas.height)
            text = decodeCanvas(canvas)
          }
          if (text) {
            done.current = true
            navigator.vibrate?.(60)
            onResult(text)
            return
          }
        }
        raf = requestAnimationFrame(() => void tick())
      }
      raf = requestAnimationFrame(() => void tick())
    }
    void start()

    return () => {
      stopped = true
      cancelAnimationFrame(raf)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [mode, busy, onResult])

  async function onFile(file: File | undefined) {
    if (!file) return
    setFileError(null)
    const text = await decodeImageFile(file).catch(() => null)
    if (text) onResult(text)
    else setFileError('Não encontrei um QR Code nesta imagem. Tente aproximar e focar o código.')
  }

  function onLink(e: FormEvent) {
    e.preventDefault()
    if (link.trim()) onResult(link.trim())
  }

  return (
    <div className="space-y-3">
      {mode === 'camera' ? (
        cameraError ? (
          <Alert>{cameraError}</Alert>
        ) : (
          <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-black">
            <video ref={videoRef} playsInline muted className="size-full object-cover" />
            <div className="pointer-events-none absolute inset-[18%] rounded-2xl border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
            <p className="absolute inset-x-0 bottom-3 text-center text-[13px] text-white/90">Aponte para o QR Code do cupom</p>
          </div>
        )
      ) : (
        <form onSubmit={onLink} className="space-y-2">
          <textarea
            value={link}
            onChange={(e) => setLink(e.target.value)}
            rows={3}
            placeholder="Cole aqui o link do QR Code (https://…gov.br/…)"
            className="w-full rounded-xl border border-border bg-surface p-3 text-[14px] focus:border-accent-500 focus:ring-3 focus:ring-accent-500/15 focus:outline-none"
          />
          <Button type="submit" block loading={busy} disabled={!link.trim()}>
            Ler comprovante
          </Button>
        </form>
      )}
      {fileError && <Alert>{fileError}</Alert>}
      <div className="flex flex-wrap justify-center gap-2">
        {mode === 'link' ? (
          <Button size="sm" variant="ghost" icon={<Camera className="size-4" />} onClick={() => setMode('camera')}>
            Usar câmera
          </Button>
        ) : (
          <Button size="sm" variant="ghost" icon={<Link2 className="size-4" />} onClick={() => setMode('link')}>
            Colar link
          </Button>
        )}
        <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium text-fg-muted hover:bg-surface-muted hover:text-fg">
          <ImageUp className="size-4" /> Foto do QR Code
          <input type="file" accept="image/*" className="sr-only" onChange={(e) => void onFile(e.target.files?.[0])} />
        </label>
      </div>
    </div>
  )
}
