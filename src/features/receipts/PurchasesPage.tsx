import { BarChart3, ChevronRight, ExternalLink, FileCode2, ImageUp, QrCode, ReceiptText, ScanText } from 'lucide-react'
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
import { importFromQr, importPhoto, importXml, listPurchases, SefazReadError, type PurchaseSummary } from './api'
import { SOURCE_LABEL } from './domain'
import { QrScanner } from './QrScanner'

export function PurchasesPage() {
  const { household, role } = useCurrentHousehold()
  const canEdit = can.edit(role)
  const navigate = useNavigate()
  const [purchases, setPurchases] = useState<PurchaseSummary[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [qrOpen, setQrOpen] = useState(false)
  const [processing, setProcessing] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sefazUrl, setSefazUrl] = useState<string | null>(null)
  const photoRef = useRef<HTMLInputElement>(null)
  const printRef = useRef<HTMLInputElement>(null)
  const [buyers, setBuyers] = useState<Map<string, string>>(new Map())

  useEffect(() => {
    listMembers(household.id).then(
      (ms) => setBuyers(new Map(ms.filter((m) => m.fullName).map((m) => [m.userId, m.fullName!.split(' ')[0]!]))),
      () => setBuyers(new Map()),
    )
  }, [household.id])
  const xmlRef = useRef<HTMLInputElement>(null)

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
    setSefazUrl(null)
    setProcessing(label)
    try {
      const id = await fn()
      setQrOpen(false)
      navigate(`/compras/${id}`)
    } catch (e) {
      setError(e instanceof Error && !('code' in e) ? e.message : toMessage(e))
      if (e instanceof SefazReadError) setSefazUrl(e.sefazUrl)
    } finally {
      setProcessing(null)
    }
  }

  const onQr = useCallback(
    (text: string) => void run('Consultando a SEFAZ…', () => importFromQr(household.id, text)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [household.id],
  )

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
          <div className="grid grid-cols-3 gap-2.5">
            <ImportButton icon={QrCode} label="QR Code" hint="NFC-e" onClick={() => { setError(null); setQrOpen(true) }} disabled={!!processing} />
            <ImportButton icon={ScanText} label="Foto" hint="Leitura com IA" onClick={() => photoRef.current?.click()} disabled={!!processing} />
            <ImportButton icon={FileCode2} label="XML" hint="NF-e / NFC-e" onClick={() => xmlRef.current?.click()} disabled={!!processing} />
          </div>
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
          <input
            ref={xmlRef}
            type="file"
            accept=".xml,application/xml,text/xml"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) void run('Lendo o XML…', () => importXml(household.id, f))
            }}
          />
          {/* Print da página da SEFAZ (galeria, sem abrir a câmera). */}
          <input
            ref={printRef}
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) void run('Lendo o print da nota com IA…', () => importPhoto(household.id, f))
            }}
          />
          {processing && !qrOpen && (
            <Card className="flex items-center gap-3 px-4 py-3 text-[14px] text-fg-muted animate-fade-in">
              <Spinner className="size-4" /> {processing}
            </Card>
          )}
          {error && !qrOpen && <ImportError error={error} sefazUrl={sefazUrl} onPrint={() => printRef.current?.click()} />}
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
            description="Leia o QR Code do cupom fiscal, fotografe o cupom ou envie o XML. Você revisa tudo antes de atualizar o estoque."
          />
        </Card>
      ) : (
        <div className="space-y-6">
          {drafts.length > 0 && <PurchaseList title="Para revisar" items={drafts} buyers={buyers} highlight />}
          {confirmed.length > 0 && <PurchaseList title="Confirmadas" items={confirmed} buyers={buyers} />}
        </div>
      )}

      <Dialog open={qrOpen} onClose={() => setQrOpen(false)} title="Ler QR Code da NFC-e">
        {qrOpen && (
          <div className="space-y-3">
            {processing ? (
              <div className="flex flex-col items-center gap-3 py-10 text-[14px] text-fg-muted">
                <Spinner /> {processing}
              </div>
            ) : (
              <QrScanner onResult={onQr} busy={!!processing} />
            )}
            {error && (
              <ImportError
                error={error}
                sefazUrl={sefazUrl}
                onPrint={() => {
                  setQrOpen(false)
                  printRef.current?.click()
                }}
              />
            )}
          </div>
        )}
      </Dialog>
    </>
  )
}

/** Erro de importação; para QR com falha na SEFAZ, oferece abrir a nota e enviar o print. */
function ImportError({ error, sefazUrl, onPrint }: { error: string; sefazUrl: string | null; onPrint: () => void }) {
  if (!sefazUrl) return <Alert>{error}</Alert>
  return (
    <div className="space-y-2.5">
      <Alert>{error}</Alert>
      <p className="px-1 text-[13px] text-fg-muted">
        Abra a nota no site da SEFAZ, tire um print da lista de itens e envie aqui: a IA lê o print. Se a lista não couber
        numa tela, diminua o zoom da página ou adicione os itens que faltarem na revisão.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <a href={sefazUrl} target="_blank" rel="noopener noreferrer">
          <Button variant="secondary" className="w-full" icon={<ExternalLink className="size-4" />}>
            Abrir na SEFAZ
          </Button>
        </a>
        <Button className="w-full" icon={<ImageUp className="size-4" />} onClick={onPrint}>
          Enviar print
        </Button>
      </div>
    </div>
  )
}

function ImportButton({
  icon: Icon,
  label,
  hint,
  onClick,
  disabled,
}: {
  icon: typeof QrCode
  label: string
  hint: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex flex-col items-center gap-1.5 rounded-xl border border-border bg-surface px-2 py-4 shadow-card transition-[transform,background-color] hover:bg-surface-muted/60 active:scale-[0.98] disabled:opacity-50"
    >
      <Icon className="size-6 text-fg" strokeWidth={1.6} />
      <span className="text-[14px] font-medium">{label}</span>
      <span className="text-[11px] text-fg-muted">{hint}</span>
    </button>
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
