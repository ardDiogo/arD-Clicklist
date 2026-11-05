import { ArrowLeft, Check, ChevronRight, History, PackageCheck, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { useToast } from '@/components/ui/Toast'
import { can } from '@/features/household/roles'
import { Card } from '@/components/ui/Card'
import { Alert, Badge, EmptyState } from '@/components/ui/feedback'
import { FullPageSpinner } from '@/components/ui/Spinner'
import { useCurrentHousehold } from '@/features/household/HouseholdProvider'
import { ListSkeleton } from '@/features/inventory/components'
import { formatQty } from '@/features/inventory/domain'
import { toMessage } from '@/lib/errors'
import { formatCurrency, formatDate, formatDateTime } from '@/lib/format'
import { getList, listHistory, listItems, removeList, type ListSummary, type ShoppingList } from './api'
import { listTotals, organizeList, type ListItem } from './domain'

function Back({ to, label }: { to: string; label: string }) {
  return (
    <Link to={to} className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-fg-muted hover:text-fg">
      <ArrowLeft className="size-4" /> {label}
    </Link>
  )
}

/** Confirmação de remoção. Se a lista lançou no estoque, oferece desfazer (marcado por padrão). */
function RemoveListDialog({
  list,
  onClose,
  onRemoved,
}: {
  list: Pick<ShoppingList, 'id' | 'stock_applied_at' | 'completed_at'> | null
  onClose: () => void
  onRemoved: () => void
}) {
  const toast = useToast()
  const [revert, setRevert] = useState(true)
  const [busy, setBusy] = useState(false)
  if (!list) return null
  const hadStock = !!list.stock_applied_at

  async function confirm() {
    if (!list) return
    setBusy(true)
    try {
      const n = await removeList(list.id, revert)
      toast.show(
        hadStock && revert
          ? `Lista removida · ${n} ${n === 1 ? 'produto estornado' : 'produtos estornados'} do estoque`
          : 'Lista removida',
      )
      onRemoved()
    } catch (e) {
      toast.error(toMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onClose={onClose} title="Remover lista">
      <div className="space-y-4 text-[14px] leading-5">
        <p className="text-fg-muted">A lista de {formatDate(list.completed_at)} sai do histórico. Isso não pode ser desfeito.</p>
        {hadStock && (
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border p-3">
            <input type="checkbox" checked={revert} onChange={(e) => setRevert(e.target.checked)} className="mt-0.5 size-4 accent-[var(--color-accent-600)]" />
            <span>
              <span className="font-medium">Desfazer o lançamento no estoque</span>
              <span className="block text-[13px] text-fg-muted">
                Esta lista lançou os itens comprados no estoque. Desfaça se o cupom da mesma compra foi (ou será) registrado em Compras, para
                não contar duas vezes. O que já foi consumido não fica negativo.
              </span>
            </span>
          </label>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button variant="danger" loading={busy} onClick={() => void confirm()} icon={<Trash2 className="size-4" />}>
            Remover
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

export function ListHistoryPage() {
  const { household, role } = useCurrentHousehold()
  const canEdit = can.edit(role)
  const [removing, setRemoving] = useState<ListSummary | null>(null)
  const [lists, setLists] = useState<ListSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listHistory(household.id).then(setLists).catch((e) => setError(toMessage(e)))
  }, [household.id])

  return (
    <div className="animate-fade-in">
      <Back to="/lista" label="Lista atual" />
      <h1 className="mb-6 text-[24px] leading-tight font-semibold tracking-[-0.025em]">Listas anteriores</h1>
      {error ? (
        <Alert>{error}</Alert>
      ) : !lists ? (
        <ListSkeleton rows={4} />
      ) : lists.length === 0 ? (
        <Card>
          <EmptyState icon={History} title="Nenhuma compra finalizada" description="Quando você finalizar uma lista, ela aparece aqui." />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-border">
            {lists.map((l) => (
              <li key={l.id} className="flex items-center">
                <Link to={`/lista/${l.id}`} className="flex min-w-0 flex-1 items-center gap-3 py-3.5 pl-4 hover:bg-surface-muted/60">
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] font-medium">{formatDate(l.completed_at)}</p>
                    <p className="text-[13px] text-fg-muted">
                      {l.itemCount} {l.itemCount === 1 ? 'item comprado' : 'itens comprados'}
                      {l.estimatedTotal !== null && ` · ≈ ${formatCurrency(l.estimatedTotal)}`}
                    </p>
                  </div>
                  {l.stock_applied_at && <Badge tone="accent">No estoque</Badge>}
                  <ChevronRight className="size-4 text-fg-subtle" />
                </Link>
                {canEdit && (
                  <button
                    type="button"
                    aria-label={`Remover lista de ${formatDate(l.completed_at)}`}
                    onClick={() => setRemoving(l)}
                    className="grid size-12 shrink-0 place-items-center text-fg-subtle hover:text-danger"
                  >
                    <Trash2 className="size-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
      <RemoveListDialog
        list={removing}
        onClose={() => setRemoving(null)}
        onRemoved={() => {
          setLists((prev) => prev?.filter((x) => x.id !== removing?.id) ?? prev)
          setRemoving(null)
        }}
      />
    </div>
  )
}

export function ListDetailPage() {
  const { id = '' } = useParams()
  const { role } = useCurrentHousehold()
  const navigate = useNavigate()
  const [removing, setRemoving] = useState(false)
  const [list, setList] = useState<ShoppingList | null | undefined>(undefined)
  const [items, setItems] = useState<ListItem[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([getList(id), listItems(id)])
      .then(([l, i]) => {
        setList(l)
        setItems(i)
      })
      .catch((e) => setError(toMessage(e)))
  }, [id])

  const { pending, checked } = useMemo(() => organizeList(items), [items])
  const totals = useMemo(() => listTotals(items.filter((i) => i.checked_at)), [items])

  if (error) return <Alert>{error}</Alert>
  if (list === undefined) return <FullPageSpinner />
  if (!list) {
    return (
      <>
        <Back to="/lista/historico" label="Listas anteriores" />
        <Card>
          <EmptyState icon={History} title="Lista não encontrada" />
        </Card>
      </>
    )
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <Back to="/lista/historico" label="Listas anteriores" />
        <h1 className="text-[24px] leading-tight font-semibold tracking-[-0.025em]">
          Compra de {formatDate(list.completed_at ?? list.created_at)}
        </h1>
        <p className="mt-1 text-[14px] text-fg-muted">
          Finalizada em {formatDateTime(list.completed_at)}
          {totals.estimatedTotal > 0 && ` · ≈ ${formatCurrency(totals.estimatedTotal)} estimado`}
        </p>
        {list.stock_applied_at && (
          <p className="mt-3 inline-flex items-center gap-1.5 text-[13px] text-accent-700 dark:text-accent-100">
            <PackageCheck className="size-4" /> Itens comprados lançados no estoque
          </p>
        )}
        {can.edit(role) && list.status !== 'open' && (
          <div className="mt-3">
            <Button size="sm" variant="danger" icon={<Trash2 className="size-4" />} onClick={() => setRemoving(true)}>
              Remover lista
            </Button>
          </div>
        )}
        {removing && (
          <RemoveListDialog list={list} onClose={() => setRemoving(false)} onRemoved={() => navigate('/lista/historico', { replace: true })} />
        )}
      </div>

      <section>
        <h2 className="mb-2 px-1 text-[12px] font-medium tracking-wide text-fg-subtle uppercase">Comprados · {checked.length}</h2>
        <Card className="overflow-hidden">
          {checked.length === 0 ? (
            <p className="px-4 py-3 text-[14px] text-fg-muted">Nenhum item marcado.</p>
          ) : (
            <ul className="divide-y divide-border">
              {checked.map((i) => (
                <li key={i.id} className="flex items-center gap-3 px-4 py-3">
                  <Check className="size-4 text-accent-600" />
                  <span className="min-w-0 flex-1 truncate text-[14px]">{i.name}</span>
                  <span className="text-[13px] text-fg-muted tabular-nums">
                    {formatQty(i.quantity)}×{i.estimated_total !== null && ` · ${formatCurrency(i.estimated_total)}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>

      {pending.length > 0 && (
        <section>
          <h2 className="mb-2 px-1 text-[12px] font-medium tracking-wide text-fg-subtle uppercase">
            Não comprados · {pending.reduce((n, g) => n + g.items.length, 0)}
          </h2>
          <Card className="overflow-hidden">
            <ul className="divide-y divide-border">
              {pending.flatMap((g) => g.items).map((i) => (
                <li key={i.id} className="flex items-center gap-3 px-4 py-3 text-fg-muted">
                  <span className="size-4" />
                  <span className="min-w-0 flex-1 truncate text-[14px]">{i.name}</span>
                  <span className="text-[13px] tabular-nums">{formatQty(i.quantity)}×</span>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}
    </div>
  )
}
