import { History, ListChecks, RefreshCw, ShoppingCart, Sparkles } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { PageHeader } from '@/components/layout/AppShell'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Dialog } from '@/components/ui/Dialog'
import { EmptyState } from '@/components/ui/feedback'
import { useToast } from '@/components/ui/Toast'
import { useCurrentHousehold } from '@/features/household/HouseholdProvider'
import { can } from '@/features/household/roles'
import { ListSkeleton } from '@/features/inventory/components'
import { useStock } from '@/features/inventory/hooks'
import { toMessage } from '@/lib/errors'
import { formatCurrency } from '@/lib/format'
import { addCustomItem, addProduct, completeList, generateList, removeItem, setChecked, updateItem } from './api'
import { AddItemBar, ListRow } from './components'
import { listTotals, missingFromList, organizeList, type ListItem } from './domain'
import { useOpenShoppingList } from './hooks'

export function ShoppingListPage() {
  const { household, role } = useCurrentHousehold()
  const canEdit = can.edit(role)
  const toast = useToast()
  const { list, items, removed, loading, error, reload, patchItem } = useOpenShoppingList(household.id, canEdit)
  const { data: stock } = useStock(household.id)
  const [syncing, setSyncing] = useState(false)
  const [finishing, setFinishing] = useState(false)

  const { pending, checked } = useMemo(() => organizeList(items), [items])
  const totals = useMemo(() => listTotals(items), [items])
  const missing = useMemo(() => (stock ? missingFromList(stock, items, removed) : []), [stock, items, removed])

  async function act(fn: () => Promise<unknown>, rollback = true) {
    try {
      await fn()
    } catch (e) {
      toast.error(toMessage(e))
      if (rollback) await reload()
    }
  }

  async function sync() {
    setSyncing(true)
    try {
      const r = await generateList(household.id)
      await reload()
      const changes = (r?.added ?? 0) + (r?.updated ?? 0) + (r?.removed ?? 0)
      toast.show(changes ? `Lista atualizada: +${r?.added ?? 0} itens` : 'A lista já está em dia com o estoque')
    } catch (e) {
      toast.error(toMessage(e))
    } finally {
      setSyncing(false)
    }
  }

  const toggle = (i: ListItem) => {
    const next = !i.checked_at
    patchItem(i.id, (x) => ({ ...x, checked_at: next ? new Date().toISOString() : null }))
    void act(() => setChecked(i.id, next))
  }
  const setQty = (i: ListItem, qty: number) => {
    patchItem(i.id, (x) => ({
      ...x,
      quantity: qty,
      estimated_total: x.estimated_unit_price !== null ? Math.round(x.estimated_unit_price * qty * 100) / 100 : null,
    }))
    void act(() => updateItem(i.id, qty, i.estimated_unit_price, i.notes))
  }
  const remove = (i: ListItem) => {
    patchItem(i.id, () => null)
    void act(async () => {
      await removeItem(i.id)
      toast.show(`${i.name} removido da lista`)
    })
  }

  const rowProps = (i: ListItem) => ({
    item: i,
    canEdit,
    onToggle: () => toggle(i),
    onQuantity: (q: number) => setQty(i, q),
    onSave: async (price: number | null, notes: string | null) => {
      await act(() => updateItem(i.id, i.quantity, price, notes))
      await reload()
    },
    onRemove: () => remove(i),
  })

  const historyLink = (
    <Link to="/lista/historico">
      <Button size="sm" variant="ghost" icon={<History className="size-4" />}>
        Histórico
      </Button>
    </Link>
  )

  const description = list
    ? `${totals.itemCount} ${totals.itemCount === 1 ? 'item' : 'itens'}${totals.checkedCount ? ` · ${totals.checkedCount} no carrinho` : ''}`
    : undefined

  return (
    <>
      <PageHeader title="Lista de compras" description={description} action={historyLink} />

      {loading && !list ? (
        <ListSkeleton rows={6} />
      ) : error && !list ? (
        <Card>
          <EmptyState
            icon={ListChecks}
            title="Não foi possível carregar a lista"
            description={toMessage(error)}
            action={<Button variant="secondary" onClick={() => void reload()}>Tentar novamente</Button>}
          />
        </Card>
      ) : !list ? (
        <Card>
          <EmptyState icon={ListChecks} title="Nenhuma lista aberta" description="Um editor da família pode criar a próxima lista." />
        </Card>
      ) : (
        <div className="space-y-5 pb-24">
          {canEdit && stock && <AddItemBar stock={stock} onAddProduct={(s) => act(() => addProduct(list.id, s.id, Math.max(1, s.to_buy_qty || 1)).then(reload))} onAddCustom={(n) => act(() => addCustomItem(list.id, n).then(reload))} />}

          {canEdit && missing.length > 0 && (
            <button
              type="button"
              onClick={() => void sync()}
              disabled={syncing}
              className="flex w-full items-center gap-3 rounded-xl border border-accent-500/25 bg-accent-50 px-4 py-3 text-left text-accent-700 transition-colors hover:bg-accent-100/60 dark:bg-accent-700/15 dark:text-accent-100"
            >
              <Sparkles className="size-4 shrink-0" />
              <span className="flex-1 text-[14px]">
                {missing.length === 1
                  ? `${missing[0]?.product_name} está faltando e não está na lista.`
                  : `${missing.length} produtos estão faltando e não estão na lista.`}
              </span>
              <span className="inline-flex items-center gap-1 text-[13px] font-semibold">
                <RefreshCw className={syncing ? 'size-3.5 animate-spin' : 'size-3.5'} /> Incluir
              </span>
            </button>
          )}

          {items.length === 0 ? (
            <Card>
              <EmptyState
                icon={ShoppingCart}
                title="Nada para comprar"
                description="O estoque está em dia. Itens que acabarem aparecem aqui automaticamente."
              />
            </Card>
          ) : (
            <>
              {pending.map((g) => (
                <section key={g.key} className="animate-fade-in">
                  <h2 className="mb-2 flex items-baseline gap-2 px-1 text-[12px] font-medium tracking-wide text-fg-subtle uppercase">
                    {g.label} <span className="tabular-nums">{g.items.length}</span>
                  </h2>
                  <Card className="overflow-hidden">
                    <ul className="divide-y divide-border">
                      {g.items.map((i) => (
                        <ListRow key={i.id} {...rowProps(i)} />
                      ))}
                    </ul>
                  </Card>
                </section>
              ))}
              {pending.length === 0 && (
                <Card className="px-5 py-4 text-center text-[14px] text-fg-muted">Tudo no carrinho. 🎉</Card>
              )}
              {checked.length > 0 && (
                <section>
                  <h2 className="mb-2 flex items-baseline gap-2 px-1 text-[12px] font-medium tracking-wide text-fg-subtle uppercase">
                    No carrinho <span className="tabular-nums">{checked.length}</span>
                  </h2>
                  <Card className="overflow-hidden opacity-90">
                    <ul className="divide-y divide-border">
                      {checked.map((i) => (
                        <ListRow key={i.id} {...rowProps(i)} />
                      ))}
                    </ul>
                  </Card>
                </section>
              )}
            </>
          )}

          {canEdit && missing.length === 0 && items.length > 0 && (
            <div className="flex justify-center">
              <Button size="sm" variant="ghost" loading={syncing} icon={<RefreshCw className="size-3.5" />} onClick={() => void sync()}>
                Atualizar pelo estoque
              </Button>
            </div>
          )}
        </div>
      )}

      {list && items.length > 0 && (
        <FooterBar
          estimated={totals.estimatedTotal}
          withoutPrice={totals.withoutPrice}
          checkedCount={totals.checkedCount}
          canEdit={canEdit}
          onFinish={() => setFinishing(true)}
        />
      )}

      {list && (
        <FinishDialog
          open={finishing}
          onClose={() => setFinishing(false)}
          items={items}
          onConfirm={async (apply) => {
            try {
              const applied = await completeList(list.id, apply)
              setFinishing(false)
              toast.show(apply && applied ? `Compra finalizada · ${applied} itens lançados no estoque` : 'Compra finalizada')
              await reload()
            } catch (e) {
              toast.error(toMessage(e))
            }
          }}
        />
      )}
    </>
  )
}

function FooterBar({
  estimated,
  withoutPrice,
  checkedCount,
  canEdit,
  onFinish,
}: {
  estimated: number
  withoutPrice: number
  checkedCount: number
  canEdit: boolean
  onFinish: () => void
}) {
  return (
    <div className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+3.5rem)] z-10 border-t border-border bg-bg/90 backdrop-blur-xl lg:bottom-0 lg:left-60">
      <div className="mx-auto flex max-w-3xl items-center gap-3 px-5 py-3 lg:px-10">
        <div className="min-w-0 flex-1">
          <p className="text-[12px] text-fg-muted">Total estimado</p>
          <p className="truncate text-[17px] leading-tight font-semibold tabular-nums">
            {estimated > 0 ? formatCurrency(estimated) : '—'}
            {withoutPrice > 0 && (
              <span className="ml-1.5 text-[12px] font-normal text-fg-subtle">
                {withoutPrice} sem preço
              </span>
            )}
          </p>
        </div>
        {canEdit && (
          <Button onClick={onFinish} disabled={checkedCount === 0} icon={<ShoppingCart className="size-4" />}>
            Finalizar
          </Button>
        )}
      </div>
    </div>
  )
}

function FinishDialog({
  open,
  onClose,
  items,
  onConfirm,
}: {
  open: boolean
  onClose: () => void
  items: ListItem[]
  onConfirm: (applyToStock: boolean) => Promise<void>
}) {
  const checked = items.filter((i) => i.checked_at)
  const stockItems = checked.filter((i) => i.household_product_id)
  const leftBehind = items.length - checked.length
  const [apply, setApply] = useState(true)
  const [busy, setBusy] = useState(false)

  return (
    <Dialog open={open} onClose={onClose} title="Finalizar compra">
      <div className="space-y-4 text-[14px] leading-5">
        <p className="text-fg-muted">
          {checked.length} {checked.length === 1 ? 'item marcado' : 'itens marcados'}.
          {leftBehind > 0 && ` ${leftBehind} não ${leftBehind === 1 ? 'marcado fica' : 'marcados ficam'} de fora e volta${leftBehind === 1 ? '' : 'm'} na próxima lista se ainda faltar${leftBehind === 1 ? '' : 'em'}.`}
        </p>
        {stockItems.length > 0 && (
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border p-3">
            <input
              type="checkbox"
              checked={apply}
              onChange={(e) => setApply(e.target.checked)}
              className="mt-0.5 size-4 accent-[var(--color-accent-600)]"
            />
            <span>
              <span className="font-medium">Adicionar ao estoque</span>
              <span className="block text-[13px] text-fg-muted">
                Confirmo que recebi os {stockItems.length} {stockItems.length === 1 ? 'produto marcado' : 'produtos marcados'}. As
                quantidades entram como compra.
              </span>
            </span>
          </label>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Voltar
          </Button>
          <Button
            loading={busy}
            onClick={async () => {
              setBusy(true)
              try {
                await onConfirm(apply && stockItems.length > 0)
              } finally {
                setBusy(false)
              }
            }}
          >
            Finalizar compra
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
