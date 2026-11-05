import { clsx } from 'clsx'
import { ArrowLeft, Ban, Check, ClipboardCheck, EyeOff, Pencil, RefreshCw, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Dialog } from '@/components/ui/Dialog'
import { Alert, Badge, EmptyState } from '@/components/ui/feedback'
import { FullPageSpinner } from '@/components/ui/Spinner'
import { useToast } from '@/components/ui/Toast'
import { useCurrentHousehold } from '@/features/household/HouseholdProvider'
import { can } from '@/features/household/roles'
import { formatQty, parseQty, productSubtitle, type StockItem } from '@/features/inventory/domain'
import { useLocations, useStock } from '@/features/inventory/hooks'
import { suggestProducts } from '@/features/receipts/domain'
import { generateList } from '@/features/shopping-list/api'
import { toMessage } from '@/lib/errors'
import { formatDateTime } from '@/lib/format'
import { analyzeScan, confirmScan, discardScan, getScan, getScanItems, getScanPhotoUrls, updateScanItem } from './api'
import {
  attentionReason,
  buildAdjustments,
  CONFIDENCE_LABEL,
  confidenceLevel,
  detectedLabel,
  sectionItems,
  type Scan,
  type ScanItem,
} from './domain'

export function ScanReviewPage() {
  const { id = '' } = useParams()
  const [params] = useSearchParams()
  const fromList = params.get('voltar') === 'lista'
  const { household, role } = useCurrentHousehold()
  const navigate = useNavigate()
  const toast = useToast()
  const { data: stock, reload: reloadStock } = useStock(household.id)
  const { data: locations } = useLocations(household.id)
  const [scan, setScan] = useState<Scan | null | undefined>(undefined)
  const [items, setItems] = useState<ScanItem[]>([])
  const [photos, setPhotos] = useState<{ position: number; url: string }[]>([])
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [reanalyzing, setReanalyzing] = useState(false)
  const [zoom, setZoom] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [s, i] = await Promise.all([getScan(id), getScanItems(id)])
      setScan(s)
      setItems(i)
    } catch (e) {
      setError(toMessage(e))
    }
  }, [id])

  useEffect(() => {
    void load()
    getScanPhotoUrls(id).then(setPhotos).catch(() => setPhotos([]))
  }, [id, load])

  const editable = scan?.status === 'draft' && can.edit(role)
  const sections = useMemo(() => sectionItems(items), [items])
  const stockById = useMemo(() => new Map((stock ?? []).map((s) => [s.id, s])), [stock])
  const adjustments = useMemo(() => buildAdjustments(items, stock ?? []), [items, stock])

  async function save(item: ScanItem, patch: Partial<ScanItem>) {
    const next = { ...item, ...patch }
    setItems((list) => list.map((i) => (i.id === item.id ? next : i)))
    try {
      await updateScanItem(next)
    } catch (e) {
      toast.error(toMessage(e))
      await load()
    }
  }

  async function reanalyze() {
    setReanalyzing(true)
    try {
      await analyzeScan(id)
      await load()
      toast.show('Fotos analisadas novamente')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : toMessage(e))
    } finally {
      setReanalyzing(false)
    }
  }

  if (error) return <Alert>{error}</Alert>
  if (scan === undefined) return <FullPageSpinner />
  if (!scan) {
    return (
      <Card>
        <EmptyState icon={Ban} title="Conferência não encontrada" action={<Button variant="secondary" onClick={() => navigate('/inventario')}>Voltar</Button>} />
      </Card>
    )
  }

  const locationName = locations?.find((l) => l.id === scan.location_id)?.name
  const rowProps = (item: ScanItem) => ({
    item,
    editable,
    stock: stock ?? [],
    product: item.household_product_id ? stockById.get(item.household_product_id) : undefined,
    onSave: (patch: Partial<ScanItem>) => void save(item, patch),
  })

  return (
    <div className={clsx('space-y-5 animate-fade-in', editable && 'pb-24')}>
      <Link to={fromList ? '/inventario?voltar=lista' : '/inventario'} className="inline-flex items-center gap-1.5 text-[13px] text-fg-muted hover:text-fg">
        <ArrowLeft className="size-4" /> Conferências
      </Link>

      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-[24px] leading-tight font-semibold tracking-[-0.025em]">{locationName ?? 'Conferência por fotos'}</h1>
          {scan.status === 'confirmed' && <Badge tone="accent">Confirmada</Badge>}
        </div>
        <p className="mt-1 text-[14px] text-fg-muted">{formatDateTime(scan.confirmed_at ?? scan.created_at)}</p>
      </div>

      {photos.length > 0 && (
        <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1">
          {photos.map((p) => (
            <button key={p.position} type="button" onClick={() => setZoom(p.url)} className="relative size-20 shrink-0 overflow-hidden rounded-lg border border-border">
              <img src={p.url} alt={`Foto ${p.position}`} className="size-full object-cover" />
              <span className="absolute top-1 left-1 grid size-5 place-items-center rounded-full bg-black/60 text-[11px] font-semibold text-white">{p.position}</span>
            </button>
          ))}
        </div>
      )}

      {scan.status === 'draft' && !scan.analyzed_at && (
        <Alert>
          As fotos ainda não foram analisadas.{' '}
          {editable && (
            <button type="button" className="font-semibold underline" onClick={() => void reanalyze()}>
              Analisar agora
            </button>
          )}
        </Alert>
      )}
      {scan.status === 'draft' && scan.analyzed_at && (
        <Alert tone="success">Nada foi alterado no estoque ainda. Confira as sugestões e confirme.</Alert>
      )}

      {sections.review.length > 0 && (
        <Section title="Para revisar" count={sections.review.length} hint="A IA não teve certeza: confirme o produto e a quantidade.">
          {sections.review.map((i) => <DetectedRow key={i.id} {...rowProps(i)} />)}
        </Section>
      )}

      {sections.notSeen.length > 0 && (
        <Section title="Não apareceram nas fotos" count={sections.notSeen.length} hint="Deveriam estar neste ambiente. Acabaram ou só não apareceram?">
          {sections.notSeen.map((i) => <NotSeenRow key={i.id} {...rowProps(i)} />)}
        </Section>
      )}

      {sections.ready.length > 0 && (
        <Section title={editable ? 'Prontos para ajustar' : 'Conferidos'} count={sections.ready.length}>
          {sections.ready.map((i) => <ReadyRow key={i.id} {...rowProps(i)} />)}
        </Section>
      )}

      {sections.ignored.length > 0 && (
        <p className="px-1 text-[13px] text-fg-subtle">
          {sections.ignored.length} {sections.ignored.length === 1 ? 'item ignorado' : 'itens ignorados'} (não controlados no estoque ou mantidos como estão).
        </p>
      )}

      {items.length === 0 && scan.analyzed_at && (
        <Card>
          <EmptyState icon={EyeOff} title="Nenhum produto identificado" description="Tente fotos mais próximas, de frente e com mais luz." />
        </Card>
      )}

      {editable && (
        <div className="flex flex-wrap justify-center gap-2">
          <Button size="sm" variant="ghost" loading={reanalyzing} icon={<RefreshCw className="size-3.5" />} onClick={() => void reanalyze()}>
            Analisar de novo
          </Button>
          <Button
            size="sm"
            variant="danger"
            icon={<Trash2 className="size-3.5" />}
            onClick={async () => {
              if (!confirm('Descartar esta conferência? Nada será alterado no estoque.')) return
              try {
                await discardScan(scan.id)
                navigate('/inventario', { replace: true })
              } catch (e) {
                toast.error(toMessage(e))
              }
            }}
          >
            Descartar
          </Button>
        </div>
      )}

      {editable && (
        <div className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+3.5rem)] z-10 border-t border-border bg-bg/90 backdrop-blur-xl lg:bottom-0 lg:left-60">
          <div className="mx-auto flex max-w-3xl items-center gap-3 px-5 py-3 lg:px-10">
            <div className="min-w-0 flex-1 text-[13px] leading-5">
              <p className="font-medium">
                {adjustments.length} {adjustments.length === 1 ? 'ajuste' : 'ajustes'} de estoque
              </p>
              {sections.review.length + sections.notSeen.length > 0 && (
                <p className="text-fg-muted">{sections.review.length + sections.notSeen.length} pendentes ficam como estão</p>
              )}
            </div>
            <Button icon={<ClipboardCheck className="size-4" />} onClick={() => setConfirming(true)}>
              Confirmar
            </Button>
          </div>
        </div>
      )}

      <Dialog open={confirming} onClose={() => setConfirming(false)} title="Confirmar conferência">
        <ConfirmBody
          note={fromList ? 'Depois de confirmar, a lista de compras é atualizada com o que falta.' : undefined}
          adjustments={adjustments}
          onCancel={() => setConfirming(false)}
          onConfirm={async () => {
            try {
              const n = await confirmScan(scan.id)
              setConfirming(false)
              if (fromList) {
                // Estoque conferido → lista recalculada (ideal − atual) e volta para ela.
                const r = await generateList(household.id)
                const changes = (r?.added ?? 0) + (r?.updated ?? 0)
                toast.show(
                  changes
                    ? `Despensa conferida · lista atualizada (+${r?.added ?? 0} itens)`
                    : 'Despensa conferida · a lista já estava em dia',
                )
                navigate('/lista')
                return
              }
              toast.show(n ? `Estoque ajustado em ${n} ${n === 1 ? 'produto' : 'produtos'}` : 'Conferência registrada, sem diferenças')
              await Promise.all([load(), reloadStock()])
            } catch (e) {
              toast.error(toMessage(e))
            }
          }}
        />
      </Dialog>

      <Dialog open={!!zoom} onClose={() => setZoom(null)} title="Foto">
        {zoom && <img src={zoom} alt="Foto ampliada" className="max-h-[70vh] w-full rounded-lg object-contain" />}
      </Dialog>
    </div>
  )
}

// -----------------------------------------------------------------------------
function Section({ title, count, hint, children }: { title: string; count: number; hint?: string; children: ReactNode }) {
  return (
    <section>
      <div className="mb-2 px-1">
        <h2 className="flex items-baseline gap-2 text-[12px] font-medium tracking-wide text-fg-subtle uppercase">
          {title} <span className="tabular-nums">{count}</span>
        </h2>
        {hint && <p className="mt-0.5 text-[12px] text-fg-muted">{hint}</p>}
      </div>
      <Card className="overflow-hidden">
        <ul className="divide-y divide-border">{children}</ul>
      </Card>
    </section>
  )
}

interface RowProps {
  item: ScanItem
  editable: boolean
  stock: StockItem[]
  product: StockItem | undefined
  onSave: (patch: Partial<ScanItem>) => void
}

function ConfidenceBadge({ item }: { item: ScanItem }) {
  const level = confidenceLevel(item.confidence)
  return (
    <span
      className={clsx(
        'inline-flex h-5 items-center rounded-md px-1.5 text-[11px] font-medium',
        level === 'high' && 'bg-accent-50 text-accent-700 dark:bg-accent-700/20 dark:text-accent-100',
        level === 'medium' && 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
        level === 'low' && 'bg-danger-soft text-danger',
      )}
      title={item.confidence !== null ? `${Math.round(item.confidence * 100)}%` : undefined}
    >
      {CONFIDENCE_LABEL[level]}
    </span>
  )
}

function ProductSelect({ item, stock, onChange }: { item: ScanItem; stock: StockItem[]; onChange: (id: string | null) => void }) {
  const suggestions = useMemo(
    () => (item.household_product_id ? [] : suggestProducts(detectedLabel(item), stock)),
    [item, stock],
  )
  return (
    <select
      aria-label="Produto do estoque"
      value={item.household_product_id ?? ''}
      onChange={(e) => onChange(e.target.value || null)}
      className={clsx(
        'h-9 w-full min-w-0 rounded-lg border bg-surface px-2.5 text-[14px] focus:border-accent-500 focus:outline-none',
        item.household_product_id ? 'border-border' : 'border-amber-400/70',
      )}
    >
      <option value="">Qual produto do estoque é este?</option>
      {suggestions.length > 0 && (
        <optgroup label="Sugestões">
          {suggestions.map((s) => (
            <option key={`s-${s.id}`} value={s.id}>
              {s.product_name} {productSubtitle(s) && `· ${productSubtitle(s)}`}
            </option>
          ))}
        </optgroup>
      )}
      <optgroup label="Estoque">
        {stock.map((s) => (
          <option key={s.id} value={s.id}>
            {s.product_name} {productSubtitle(s) && `· ${productSubtitle(s)}`}
          </option>
        ))}
      </optgroup>
    </select>
  )
}

function QtyInput({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <label className="inline-flex items-center gap-2 text-[13px] whitespace-nowrap text-fg-muted">
      {label}
      <input
        inputMode="decimal"
        value={value}
        placeholder="?"
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-16 rounded-lg border border-border bg-surface px-2 text-center text-[15px] font-semibold text-fg tabular-nums focus:border-accent-500 focus:outline-none"
      />
    </label>
  )
}

function DetectedRow({ item, editable, stock, product, onSave }: RowProps) {
  const [qty, setQty] = useState(item.confirmed_quantity !== null ? formatQty(item.confirmed_quantity) : '')
  const parsed = parseQty(qty)
  const reason = attentionReason(item)
  return (
    <li className="space-y-2.5 px-4 py-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[14px] font-medium">{detectedLabel(item)}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12px] text-fg-muted">
            <ConfidenceBadge item={item} />
            {reason && <span>{reason}</span>}
            {item.photo_positions.length > 0 && <span>· foto {item.photo_positions.join(', ')}</span>}
          </p>
        </div>
        <div className="shrink-0 text-right text-[12px] whitespace-nowrap text-fg-muted">
          <p>IA: <span className="font-semibold text-fg">{item.estimated_quantity !== null ? formatQty(item.estimated_quantity) : '?'}</span></p>
          {product && <p>sistema: {formatQty(product.current_qty)}</p>}
        </div>
      </div>
      {editable && (
        <>
          <ProductSelect item={item} stock={stock} onChange={(id) => onSave({ household_product_id: id })} />
          <div className="flex items-center gap-2">
            <QtyInput label="Quantidade" value={qty} onChange={setQty} />
            <Button size="sm" variant="ghost" className="ml-auto" onClick={() => onSave({ status: 'ignored' })}>
              Ignorar
            </Button>
            <Button
              size="sm"
              icon={<Check className="size-3.5" />}
              disabled={!item.household_product_id || parsed === null}
              onClick={() => onSave({ status: 'confirmed', confirmed_quantity: parsed })}
            >
              Confirmar
            </Button>
          </div>
        </>
      )}
    </li>
  )
}

function NotSeenRow({ item, editable, product, onSave }: RowProps) {
  const [qty, setQty] = useState('')
  const parsed = parseQty(qty)
  return (
    <li className="space-y-2.5 px-4 py-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[14px] font-medium">{product?.product_name ?? 'Produto'}</p>
          {product && productSubtitle(product) && <p className="text-[12px] text-fg-muted">{productSubtitle(product)}</p>}
        </div>
        <p className="shrink-0 text-[12px] whitespace-nowrap text-fg-muted">
          sistema: <span className="font-semibold text-fg">{formatQty(item.system_quantity)}</span>
        </p>
      </div>
      {editable && (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="danger" className="-ml-2" onClick={() => onSave({ status: 'confirmed', confirmed_quantity: 0 })}>
            Acabou
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onSave({ status: 'ignored' })}>
            Está lá, manter
          </Button>
          <div className="ml-auto flex items-center gap-2">
            <QtyInput label="Contei" value={qty} onChange={setQty} />
            <Button size="sm" variant="secondary" disabled={parsed === null} onClick={() => onSave({ status: 'confirmed', confirmed_quantity: parsed })}>
              OK
            </Button>
          </div>
        </div>
      )}
    </li>
  )
}

function ReadyRow({ item, editable, product, onSave }: RowProps) {
  const before = product?.current_qty ?? item.system_quantity
  const changed = before !== null && item.confirmed_quantity !== before
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <Check className="size-4 shrink-0 text-accent-600" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-medium">{product?.product_name ?? detectedLabel(item)}</p>
        <p className="text-[12px] text-fg-muted">
          {item.origin === 'expected' ? 'Não apareceu nas fotos' : detectedLabel(item)}
        </p>
      </div>
      <p className="text-right text-[13px] tabular-nums">
        {changed ? (
          <>
            <span className="text-fg-subtle">{formatQty(before)} → </span>
            <span className="font-semibold">{formatQty(item.confirmed_quantity)}</span>
          </>
        ) : (
          <span className="text-fg-muted">{formatQty(item.confirmed_quantity)} · sem mudança</span>
        )}
      </p>
      {editable && (
        <Button size="sm" variant="ghost" aria-label="Editar" onClick={() => onSave({ status: 'pending' })}>
          <Pencil className="size-3.5" />
        </Button>
      )}
    </li>
  )
}

function ConfirmBody({
  adjustments,
  note,
  onCancel,
  onConfirm,
}: {
  adjustments: ReturnType<typeof buildAdjustments>
  note?: string
  onCancel: () => void
  onConfirm: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  return (
    <div className="space-y-4 text-[14px]">
      {adjustments.length === 0 ? (
        <p className="text-fg-muted">Nenhuma diferença em relação ao estoque. A conferência fica registrada.</p>
      ) : (
        <>
          <p className="text-fg-muted">O estoque será ajustado para as quantidades que você conferiu:</p>
          <ul className="max-h-64 divide-y divide-border overflow-y-auto rounded-xl border border-border">
            {adjustments.map((a) => (
              <li key={a.householdProductId} className="flex items-center justify-between px-3 py-2">
                <span className="truncate">{a.name}</span>
                <span className="tabular-nums">
                  <span className="text-fg-subtle">{formatQty(a.before)} → </span>
                  <span className={clsx('font-semibold', a.after < a.before ? 'text-danger' : 'text-accent-600')}>{formatQty(a.after)}</span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {note && <p className="text-[13px] text-fg-muted">{note}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Voltar
        </Button>
        <Button
          loading={busy}
          onClick={async () => {
            setBusy(true)
            try {
              await onConfirm()
            } finally {
              setBusy(false)
            }
          }}
        >
          Confirmar
        </Button>
      </div>
    </div>
  )
}
