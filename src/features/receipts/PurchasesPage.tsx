import { BarChart3, Camera, ChevronRight, Images, ReceiptText, ScanText } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { PageHeader } from '@/components/layout/AppShell'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Dialog } from '@/components/ui/Dialog'
import { Alert, Badge, EmptyState } from '@/components/ui/feedback'
import { Spinner } from '@/components/ui/Spinner'
import { listMembers } from '@/features/household/api'
import { useCurrentHousehold } from '@/features/household/HouseholdProvider'
import { can } from '@/features/household/roles'
import { ListSkeleton } from '@/features/inventory/components'
import { supabase } from '@/integrations/supabase/client'
import { toMessage } from '@/lib/errors'
import { formatCurrency, formatDate } from '@/lib/format'
import { importPhoto, listPurchases, type PurchaseSummary } from './api'
import { SOURCE_LABEL } from './domain'

export function PurchasesPage() {
  const { household, role } = useCurrentHousehold()
  const canEdit = can.edit(role)
  const navigate = useNavigate()
  const [purchases, setPurchases] = useState<PurchaseSummary[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [processing, setProcessing] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const photoRef = useRef<HTMLInputElement>(null)
  const galleryRef = useRef<HTMLInputElement>(null)
  const [photoMenu, setPhotoMenu] = useState(false)
  const [buyers, setBuyers] = useState<Map<string, string>>(new Map())

  useEffect(() => {
    listMembers(household.id).then(
      (ms) => setBuyers(new Map(ms.filter((m) => m.fullName).map((m) => [m.userId, m.fullName!.split(' ')[0]!]))),
      () => setBuyers(new Map()),
    )
  }, [household.id])

  const load = useCallback(async () => {
    try {
      setPurchases(await listPurchases(household.id))
      setLoadError(null)
    } catch (e) {
      setLoadError(toMessage(e))
    }
  }, [household.id])

  useEffect(() => {
    void load()
    const channel = supabase()
      .channel(`purchases:${household.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'purchases', filter: `household_id=eq.${household.id}` }, () => void load())
      .subscribe()
    return () => {
      void supabase().removeChannel(channel)
    }
  }, [household.id, load])

  async function run(label: string, fn: () => Promise<string>) {
    setError(null)
    setProcessing(label)
    try {
      const id = await fn()
      navigate(`/compras/${id}`)
    } catch (e) {
      setError(e instanceof Error && !('code' in e) ? e.message : toMessage(e))
    } finally {
      setProcessing(null)
    }
  }

  const drafts = purchases?.filter((p) => p.status === 'draft') ?? []
  const confirmed = purchases?.filter((p) => p.status === 'confirmed') ?? []

  return (
    <>
      <PageHeader
        title="Compras"
        description="Comprovantes atualizam o estoque depois da sua revisão."
        action={
          <Link to="/inteligencia">
            <Button size="sm" variant="ghost" icon={<BarChart3 className="size-4" />}>
              Inteligência
            </Button>
          </Link>
        }
      />

      {canEdit && (
        <section className="mb-6 space-y-3">
          <button
            type="button"
            onClick={() => {
              setError(null)
              setPhotoMenu(true)
            }}
            disabled={!!processing}
            className="flex w-full items-center gap-4 rounded-xl border border-border bg-surface px-5 py-4 text-left shadow-card transition-[transform,background-color] hover:bg-surface-muted/60 active:scale-[0.99] disabled:opacity-50"
          >
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-accent-50 text-accent-700 dark:bg-accent-700/20 dark:text-accent-100">
              <ScanText className="size-6" strokeWidth={1.6} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-medium">Registrar compra pela foto do cupom</span>
              <span className="block text-[13px] text-fg-muted">Tire uma foto ou escolha da galeria — a IA lê os itens e você revisa.</span>
            </span>
            <ChevronRight className="size-4 shrink-0 text-fg-subtle" />
          </button>
          <input
            ref={photoRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) void run('Lendo o cupom com IA…', () => importPhoto(household.id, f))
            }}
          />
          {/* Foto do cupom já salva na galeria (sem abrir a câmera). */}
          <input
            ref={galleryRef}
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) void run('Lendo o cupom com IA…', () => importPhoto(household.id, f))
            }}
          />
          <Dialog open={photoMenu} onClose={() => setPhotoMenu(false)} title="Foto do cupom">
            <div className="grid gap-2.5">
              <Button
                icon={<Camera className="size-4" />}
                onClick={() => {
                  setPhotoMenu(false)
                  photoRef.current?.click()
                }}
              >
                Tirar foto agora
              </Button>
              <Button
                variant="secondary"
                icon={<Images className="size-4" />}
                onClick={() => {
                  setPhotoMenu(false)
                  galleryRef.current?.click()
                }}
              >
                Escolher da galeria
              </Button>
              <p className="pt-1 text-[12px] text-fg-muted">
                Funciona com foto do cupom impresso ou print da nota no site da SEFAZ. Fotografe reto, com boa luz e o cupom inteiro.
              </p>
            </div>
          </Dialog>
          {processing && (
            <Card className="flex items-center gap-3 px-4 py-3 text-[14px] text-fg-muted animate-fade-in">
              <Spinner className="size-4" /> {processing}
            </Card>
          )}
          {error && <Alert>{error}</Alert>}
        </section>
      )}

      {loadError ? (
        <Alert>{loadError}</Alert>
      ) : !purchases ? (
        <ListSkeleton rows={3} />
      ) : purchases.length === 0 ? (
        <Card>
          <EmptyState
            icon={ReceiptText}
            title="Nenhuma compra registrada"
            description="Fotografe o cupom fiscal: a IA lê os itens e você revisa tudo antes de atualizar o estoque."
          />
        </Card>
      ) : (
        <div className="space-y-6">
          {drafts.length > 0 && <PurchaseList title="Para revisar" items={drafts} buyers={buyers} highlight />}
          {confirmed.length > 0 && <PurchaseList title="Confirmadas" items={confirmed} buyers={buyers} />}
        </div>
      )}

    </>
  )
}



function PurchaseList({
  title,
  items,
  buyers,
  highlight,
}: {
  title: string
  items: PurchaseSummary[]
  buyers: Map<string, string>
  highlight?: boolean
}) {
  return (
    <section>
      <h2 className="mb-2 flex items-baseline gap-2 px-1 text-[12px] font-medium tracking-wide text-fg-subtle uppercase">
        {title} <span className="tabular-nums">{items.length}</span>
      </h2>
      <Card className="overflow-hidden">
        <ul className="divide-y divide-border">
          {items.map((p) => (
            <li key={p.id}>
              <Link to={`/compras/${p.id}`} className="flex items-center gap-3 px-4 py-3.5 hover:bg-surface-muted/60">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-medium">{p.store_name ?? 'Estabelecimento não identificado'}</p>
                  <p className="text-[13px] text-fg-muted">
                    {formatDate(p.purchased_at ?? p.created_at)} · {p.itemCount} {p.itemCount === 1 ? 'item' : 'itens'} ·{' '}
                    {SOURCE_LABEL[p.source]}
                    {p.bought_by && buyers.get(p.bought_by) && ` · ${buyers.get(p.bought_by)}`}
                  </p>
                </div>
                <div className="text-right">
                  {p.total_amount !== null && <p className="text-[14px] font-semibold tabular-nums">{formatCurrency(p.total_amount)}</p>}
                  {highlight && <Badge tone="accent">Revisar</Badge>}
                </div>
                <ChevronRight className="size-4 text-fg-subtle" />
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </section>
  )
}
