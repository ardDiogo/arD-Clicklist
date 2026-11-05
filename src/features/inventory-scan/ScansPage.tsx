import { ArrowLeft, Camera, ChevronRight, ImagePlus, ScanSearch, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { SelectField } from '@/components/ui/Field'
import { Alert, Badge } from '@/components/ui/feedback'
import { Spinner } from '@/components/ui/Spinner'
import { useCurrentHousehold } from '@/features/household/HouseholdProvider'
import { can } from '@/features/household/roles'
import { ListSkeleton } from '@/features/inventory/components'
import { useLocations } from '@/features/inventory/hooks'
import { toMessage } from '@/lib/errors'
import { formatDateTime } from '@/lib/format'
import { createAndAnalyzeScan, listScans, MAX_PHOTOS, type ScanSummary } from './api'

export function ScansPage() {
  const { household, role } = useCurrentHousehold()
  const canEdit = can.edit(role)
  const [scans, setScans] = useState<ScanSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setScans(await listScans(household.id))
    } catch (e) {
      setError(toMessage(e))
    }
  }, [household.id])

  useEffect(() => {
    void load()
  }, [load])

  const drafts = scans?.filter((s) => s.status === 'draft') ?? []
  const done = scans?.filter((s) => s.status === 'confirmed') ?? []

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <Link to="/estoque" className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-fg-muted hover:text-fg">
          <ArrowLeft className="size-4" /> Estoque
        </Link>
        <h1 className="text-[24px] leading-tight font-semibold tracking-[-0.025em]">Conferir por fotos</h1>
        <p className="mt-1 text-[14px] text-fg-muted">
          Fotografe um ambiente e a IA sugere o que há nele. Você confirma antes de qualquer ajuste no estoque.
        </p>
      </div>

      {canEdit && <NewScanCard householdId={household.id} />}

      {error ? (
        <Alert>{error}</Alert>
      ) : !scans ? (
        <ListSkeleton rows={2} />
      ) : scans.length === 0 ? null : (
        <>
          {drafts.length > 0 && <ScanList title="Para revisar" scans={drafts} highlight />}
          {done.length > 0 && <ScanList title="Conferências anteriores" scans={done} />}
        </>
      )}
    </div>
  )
}

function NewScanCard({ householdId }: { householdId: string }) {
  const navigate = useNavigate()
  const { data: locations } = useLocations(householdId)
  const [locationId, setLocationId] = useState('')
  const [photos, setPhotos] = useState<File[]>([])
  const [progress, setProgress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  const galleryRef = useRef<HTMLInputElement>(null)
  const previews = useMemo(() => photos.map((f) => URL.createObjectURL(f)), [photos])

  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews])

  function add(files: FileList | null) {
    if (!files) return
    const images = [...files].filter((f) => f.type.startsWith('image/'))
    setError(null)
    setPhotos((p) => {
      const next = [...p, ...images]
      if (next.length > MAX_PHOTOS) setError(`Use no máximo ${MAX_PHOTOS} fotos por conferência.`)
      return next.slice(0, MAX_PHOTOS)
    })
  }

  async function analyze() {
    setError(null)
    try {
      const id = await createAndAnalyzeScan(householdId, locationId || null, photos, setProgress)
      navigate(`/inventario/${id}`)
    } catch (e) {
      setError(e instanceof Error && !('code' in e) ? e.message : toMessage(e))
      setProgress(null)
    }
  }

  return (
    <Card>
      <CardHeader title="Nova conferência" description="Fotos de frente, com boa luz e os rótulos visíveis funcionam melhor." />
      <div className="space-y-4 px-5 pb-5">
        <SelectField label="Ambiente" value={locationId} onChange={(e) => setLocationId(e.target.value)} disabled={!!progress}
          hint="Com o ambiente, o app também aponta o que deveria estar lá e não apareceu.">
          <option value="">Sem ambiente específico</option>
          {locations?.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </SelectField>

        {photos.length > 0 && (
          <div className="grid grid-cols-4 gap-2">
            {previews.map((url, i) => (
              <div key={url} className="relative aspect-square overflow-hidden rounded-lg border border-border bg-surface-muted">
                <img src={url} alt={`Foto ${i + 1}`} className="size-full object-cover" />
                <span className="absolute top-1 left-1 grid size-5 place-items-center rounded-full bg-black/60 text-[11px] font-semibold text-white">
                  {i + 1}
                </span>
                {!progress && (
                  <button
                    type="button"
                    aria-label={`Remover foto ${i + 1}`}
                    onClick={() => setPhotos((p) => p.filter((_, j) => j !== i))}
                    className="absolute top-1 right-1 grid size-6 place-items-center rounded-full bg-black/60 text-white"
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => { add(e.target.files); e.target.value = '' }} />
        <input ref={galleryRef} type="file" accept="image/*" multiple className="sr-only" onChange={(e) => { add(e.target.files); e.target.value = '' }} />

        {progress ? (
          <div className="flex items-center gap-3 rounded-xl bg-surface-muted px-4 py-3 text-[14px] text-fg-muted">
            <Spinner className="size-4" /> {progress}
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" icon={<Camera className="size-4" />} onClick={() => cameraRef.current?.click()} disabled={photos.length >= MAX_PHOTOS}>
              Tirar foto
            </Button>
            <Button variant="secondary" icon={<ImagePlus className="size-4" />} onClick={() => galleryRef.current?.click()} disabled={photos.length >= MAX_PHOTOS}>
              Galeria
            </Button>
            <Button className="ml-auto" icon={<ScanSearch className="size-4" />} disabled={photos.length === 0} onClick={() => void analyze()}>
              Analisar {photos.length > 0 ? `${photos.length} ${photos.length === 1 ? 'foto' : 'fotos'}` : ''}
            </Button>
          </div>
        )}
        {error && <Alert>{error}</Alert>}
      </div>
    </Card>
  )
}

function ScanList({ title, scans, highlight }: { title: string; scans: ScanSummary[]; highlight?: boolean }) {
  return (
    <section>
      <h2 className="mb-2 flex items-baseline gap-2 px-1 text-[12px] font-medium tracking-wide text-fg-subtle uppercase">
        {title} <span className="tabular-nums">{scans.length}</span>
      </h2>
      <Card className="overflow-hidden">
        <ul className="divide-y divide-border">
          {scans.map((s) => (
            <li key={s.id}>
              <Link to={`/inventario/${s.id}`} className="flex items-center gap-3 px-4 py-3.5 hover:bg-surface-muted/60">
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-medium">{s.location_name ?? 'Vários ambientes'}</p>
                  <p className="text-[13px] text-fg-muted">
                    {formatDateTime(s.confirmed_at ?? s.created_at)} · {s.photoCount} {s.photoCount === 1 ? 'foto' : 'fotos'}
                  </p>
                </div>
                {highlight && <Badge tone="accent">{s.analyzed_at ? 'Revisar' : 'Não analisada'}</Badge>}
                <ChevronRight className="size-4 text-fg-subtle" />
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </section>
  )
}
