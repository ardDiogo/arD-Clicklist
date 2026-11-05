import { CalendarClock, Camera, History, ListChecks, RefreshCw, RotateCcw, ShoppingCart, Sparkles } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
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
import { addCustomItem, addProduct, completeList, generateList, removeItem, resetList, setChecked, suggestFromHistory, updateItem } from './api'
import { AddItemBar, ListRow } from './components'
import { listTotals, missingFromList, organizeList, type ListItem } from './domain'
import { useOpenShoppingList } from './hooks'

export function ShoppingListPage() {
  const { household, role } = useCurrentHousehold()
  const canEdit = can.edit(role)
  const toast = useToast()
  const navigate = useNavigate()
  const { list, items, removed, loading, error, reload, patchItem } = useOpenShoppingList(household.id, canEdit)
  const { data: stock } = useStock(household.id)
  const [syncing, setSyncing] = useState(false)
  const [suggesting, setSuggesting] = useState(false)
  const [finishing, setFinishing] = useState(false)
  const [resetting, setResetting] = useState(false)

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

  async function suggest() {
    setSuggesting(true)
    try {
      const r = await suggestFromHistory(household.id, 3)
      await reload()
      if (!r || r.months_with_data === 0) {
        toast.show('Ainda não há compras dos últimos 3 meses para calcular o consumo')
      } else if (r.added === 0) {
        const reasons = [
          r.already_in_list ? `${r.already_in_list} já ${r.already_in_list === 1 ? 'está' : 'estão'} na lista` : null,
          r.covered_by_stock ? `${r.covered_by_stock} com estoque suficiente em casa` : null,
          r.removed_by_user ? `${r.removed_by_user} removido${r.removed_by_user === 1 ? '' : 's'} por você (adicione pela busca)` : null,
        ].filter(Boolean)
        toast.show(reasons.length ? `Nada novo para sugerir: ${reasons.join(' · ')}` : 'Nada novo: a lista já cobre o consumo médio dos últimos meses')
      } else {
        toast.show(`+${r.added} ${r.added === 1 ? 'item sugerido' : 'itens sugeridos'} pelo consumo dos últimos ${r.months_with_data} meses`)
      }
    } catch (e) {
      toast.error(toMessage(e))
    } finally {
      setSuggesting(false)
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

          {canEdit && (
            <BuildListCard
              suggesting={suggesting}
              onSuggest={() => void suggest()}
              onPhotos={() => navigate('/inventario?voltar=lista')}
              onReset={items.length > 0 ? () => setResetting(true) : undefined}
            />
          )}

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
                description="O estoque está em dia. Itens que acabarem aparecem aqui automaticamente — ou use a sugestão pelo consumo dos últimos meses."
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
        <ResetDialog
          open={resetting}
          itemCount={items.length}
          checkedCount={totals.checkedCount}
          onClose={() => setResetting(false)}
          onConfirm={async () => {
            try {
              const r = await resetList(household.id, 3)
              setResetting(false)
              await reload()
              const added = (r?.added_from_stock ?? 0) + (r?.added_from_history ?? 0)
              toast.show(
                added
                  ? `Lista recomeçada: ${added} ${added === 1 ? 'item' : 'itens'} (${r?.added_from_stock ?? 0} pelo estoque, ${r?.added_from_history ?? 0} pelo consumo)`
                  : 'Lista recomeçada: nada falta em casa no momento',
              )
            } catch (e) {
              toast.error(toMessage(e))
            }
          }}
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
  // O estoque entra pelo cupom (Compras). Lançar pela lista é exceção, para compras sem cupom.
  const [apply, setApply] = useState(false)
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
              <span className="font-medium">Lançar no estoque agora (compra sem cupom)</span>
              <span className="block text-[13px] text-fg-muted">
                Deixe desmarcado se for registrar o cupom em Compras — é o cupom que dá entrada no estoque, com quantidades e
                preços reais. Marque só se não houver cupom; aí os {stockItems.length}{' '}
                {stockItems.length === 1 ? 'produto marcado entra' : 'produtos marcados entram'} pela quantidade da lista.
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

/** As duas formas de montar a lista: pelo histórico de compras ou conferindo a despensa por fotos. */
function BuildListCard({
  suggesting,
  onSuggest,
  onPhotos,
  onReset,
}: {
  suggesting: boolean
  onSuggest: () => void
  onPhotos: () => void
  onReset?: () => void
}) {
  const option =
    'flex min-w-0 items-start gap-3 rounded-xl border border-border bg-surface p-3.5 text-left shadow-card transition-[background-color,transform] hover:bg-surface-muted/60 active:scale-[0.99] disabled:opacity-60'
  return (
    <section aria-label="Montar a lista">
      <div className="mb-2 flex items-center justify-between gap-2 px-1">
        <h2 className="text-[12px] font-medium tracking-wide text-fg-subtle uppercase">Montar a lista</h2>
        {onReset && (
          <button
            type="button"
            onClick={onReset}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] font-medium text-fg-muted hover:bg-surface-muted hover:text-fg"
          >
            <RotateCcw className="size-3.5" /> Recomeçar lista
          </button>
        )}
      </div>
      <div className="grid gap-2.5 sm:grid-cols-2">
        <button type="button" className={option} onClick={onSuggest} disabled={suggesting}>
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent-50 text-accent-700 dark:bg-accent-700/20 dark:text-accent-100">
            {suggesting ? <RefreshCw className="size-[18px] animate-spin" /> : <CalendarClock className="size-[18px]" />}
          </span>
          <span className="min-w-0">
            <span className="block text-[14px] font-medium">Pelo consumo dos últimos meses</span>
            <span className="block text-[12px] leading-4 text-fg-muted">
              Média das compras dos 3 meses anteriores, descontando o que há em casa.
            </span>
          </span>
        </button>
        <button type="button" className={option} onClick={onPhotos}>
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface-muted text-fg-muted">
            <Camera className="size-[18px]" />
          </span>
          <span className="min-w-0">
            <span className="block text-[14px] font-medium">Pelas fotos da despensa</span>
            <span className="block text-[12px] leading-4 text-fg-muted">
              Fotografe os armários, confirme o que há em casa e a lista mostra o que falta.
            </span>
          </span>
        </button>
      </div>
    </section>
  )
}

/** Confirmação antes de recomeçar: a ação apaga ajustes manuais e itens no carrinho. */
function ResetDialog({
  open,
  itemCount,
  checkedCount,
  onClose,
  onConfirm,
}: {
  open: boolean
  itemCount: number
  checkedCount: number
  onClose: () => void
  onConfirm: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  return (
    <Dialog open={open} onClose={onClose} title="Recomeçar a lista?">
      <div className="space-y-4 text-[14px] leading-5">
        <p className="text-fg-muted">
          Os {itemCount} {itemCount === 1 ? 'item atual sai' : 'itens atuais saem'} da lista
          {checkedCount > 0 ? `, inclusive ${checkedCount} já ${checkedCount === 1 ? 'marcado' : 'marcados'} no carrinho` : ''}. Ajustes
          manuais e itens avulsos também são apagados.
        </p>
        <p>
          A lista é montada de novo com <strong>o que falta em casa</strong> (quanto manter − estoque atual) e completada pelo{' '}
          <strong>consumo dos últimos 3 meses</strong>.
        </p>
        <p className="text-[13px] text-fg-subtle">Estoque, compras e listas anteriores não são alterados.</p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button
            loading={busy}
            icon={<RotateCcw className="size-4" />}
            onClick={async () => {
              setBusy(true)
              try {
                await onConfirm()
              } finally {
                setBusy(false)
              }
            }}
          >
            Recomeçar
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
