import { clsx } from 'clsx'
import { Archive, ArrowLeft, ArrowRightLeft, ClipboardCheck, History, ListX, Pencil, ShoppingCart } from 'lucide-react'
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { SelectField, TextField } from '@/components/ui/Field'
import { Alert, EmptyState } from '@/components/ui/feedback'
import { FullPageSpinner } from '@/components/ui/Spinner'
import { useToast } from '@/components/ui/Toast'
import { useCurrentHousehold } from '@/features/household/HouseholdProvider'
import { can } from '@/features/household/roles'
import { supabase } from '@/integrations/supabase/client'
import { toMessage } from '@/lib/errors'
import { formatDateTime } from '@/lib/format'
import { archiveItem, getStockItem, setListExclusion, listMovements, recordMovement, transferItem, type Movement } from './api'
import { StatusPill, Stepper } from './components'
import { formatQty, MOVEMENT_LABEL, newIdempotencyKey, parseQty, productSubtitle, type StockItem } from './domain'
import { PriceCard } from '@/features/receipts/PriceCard'
import { useLocations } from './hooks'
import { useQuickMovement } from './useQuickMovement'

export function StockItemPage() {
  const { id = '' } = useParams()
  const { household, role } = useCurrentHousehold()
  const canEdit = can.edit(role)
  const navigate = useNavigate()
  const [item, setItem] = useState<StockItem | null | undefined>(undefined)
  const [movements, setMovements] = useState<Movement[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try {
      const [i, m] = await Promise.all([getStockItem(id), listMovements(id)])
      setItem(i)
      setMovements(m)
      setError(null)
    } catch (e) {
      setError(toMessage(e))
    }
  }, [id])

  useEffect(() => {
    void reload()
    const channel = supabase()
      .channel(`stock-item:${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'household_products', filter: `id=eq.${id}` }, () => void reload())
      .subscribe()
    return () => {
      void supabase().removeChannel(channel)
    }
  }, [id, reload])

  const patch = useCallback((_: string, fn: (i: StockItem) => StockItem) => setItem((i) => (i ? fn(i) : i)), [])
  const quick = useQuickMovement(patch, reload)

  if (item === undefined) return error ? <Alert>{error}</Alert> : <FullPageSpinner />
  if (item === null) {
    return (
      <Card>
        <EmptyState
          icon={Archive}
          title="Produto não encontrado"
          description="Ele pode ter sido removido do estoque."
          action={<Button variant="secondary" onClick={() => navigate('/estoque')}>Ir para o estoque</Button>}
        />
      </Card>
    )
  }

  const subtitle = productSubtitle(item)

  return (
    <div className="space-y-5 animate-fade-in">
      <Link to="/estoque" className="inline-flex items-center gap-1.5 text-[13px] text-fg-muted hover:text-fg">
        <ArrowLeft className="size-4" /> Estoque
      </Link>

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[24px] leading-tight font-semibold tracking-[-0.025em]">{item.product_name}</h1>
          {subtitle && <p className="mt-1 text-[14px] text-fg-muted">{subtitle}</p>}
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px] text-fg-muted">
            {item.exclude_from_list ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-surface-muted px-2 py-0.5 text-[12px] font-medium text-fg-muted">
                <ListX className="size-3.5" /> Não envia à lista
              </span>
            ) : (
              <StatusPill status={item.status} />
            )}
            {item.location_name && <span>· {item.location_name}</span>}
            {item.category_name && <span>· {item.category_name}</span>}
          </div>
        </div>
        {canEdit && (
          <Link to={`/estoque/${item.id}/editar`}>
            <Button size="sm" variant="secondary" icon={<Pencil className="size-3.5" />}>
              Editar
            </Button>
          </Link>
        )}
      </div>

      {/* Números principais */}
      <Card className="grid grid-cols-3 divide-x divide-border">
        <Metric label="Em casa" value={formatQty(item.current_qty)} strong />
        <Metric label="Ideal" value={formatQty(item.ideal_qty)} />
        <Metric
          label="Comprar"
          value={formatQty(item.to_buy_qty)}
          accent={item.to_buy_qty > 0}
          icon={item.to_buy_qty > 0 ? <ShoppingCart className="size-3.5" /> : undefined}
        />
      </Card>

      {canEdit && (
        <>
          <Card className="flex items-center justify-between gap-4 p-5">
            <div>
              <p className="text-[14px] font-medium">Ajuste rápido</p>
              <p className="text-[13px] text-fg-muted">Usou ou guardou mais uma unidade.</p>
            </div>
            <Stepper
              size="lg"
              label={item.product_name}
              onDecrement={() => void quick(item, -1)}
              onIncrement={() => void quick(item, 1)}
              disableDecrement={item.current_qty <= 0}
            />
          </Card>
          <CountCard item={item} onDone={reload} />
          <TransferCard item={item} householdId={household.id} onDone={reload} />
          <ListExclusionCard item={item} onDone={reload} />
        </>
      )}

      <PriceCard householdProductId={item.id} />

      <Card>
        <CardHeader title="Histórico" description="Toda alteração de quantidade fica registrada." />
        {movements && movements.length > 0 ? (
          <ul className="divide-y divide-border border-t border-border">
            {movements.map((m) => (
              <MovementRow key={m.id} m={m} />
            ))}
          </ul>
        ) : (
          <EmptyState icon={History} title="Sem movimentações" description="Nada registrado ainda." />
        )}
      </Card>

      {canEdit && <ArchiveButton item={item} />}
    </div>
  )
}

function Metric({
  label,
  value,
  strong,
  accent,
  icon,
}: {
  label: string
  value: string
  strong?: boolean
  accent?: boolean
  icon?: ReactNode
}) {
  return (
    <div className="px-4 py-4 text-center">
      <p className="text-[12px] text-fg-muted">{label}</p>
      <p
        className={clsx(
          'mt-1 inline-flex items-center gap-1 text-[22px] leading-none font-semibold tabular-nums',
          strong ? 'text-fg' : 'text-fg-muted',
          accent && 'text-accent-600 dark:text-accent-500',
        )}
      >
        {icon}
        {value}
      </p>
    </div>
  )
}

function CountCard({ item, onDone }: { item: StockItem; onDone: () => Promise<void> }) {
  const toast = useToast()
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [key, setKey] = useState(newIdempotencyKey)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const qty = parseQty(value)
    if (qty === null) return setError('Informe uma quantidade válida (ex.: 2 ou 1,5).')
    if (qty === item.current_qty) return setError('A contagem é igual ao estoque atual.')
    setSaving(true)
    setError(null)
    try {
      await recordMovement(item.id, 'inventory_adjustment', qty, key, 'Contagem manual')
      toast.show(`Estoque de ${item.product_name}: ${formatQty(qty)}`)
      setValue('')
      setKey(newIdempotencyKey())
      await onDone()
    } catch (err) {
      setError(toMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader title="Contar estoque" description="Informe quantas embalagens há em casa agora." />
      <form onSubmit={onSubmit} className="flex items-start gap-2 px-5 pb-5" noValidate>
        <div className="flex-1">
          <TextField
            label="Quantidade contada"
            inputMode="decimal"
            placeholder={formatQty(item.current_qty)}
            value={value}
            onChange={(e) => {
              setValue(e.target.value)
              setError(null)
            }}
            error={error}
          />
        </div>
        <Button type="submit" variant="secondary" loading={saving} className="mt-[26px]" icon={<ClipboardCheck className="size-4" />}>
          Registrar
        </Button>
      </form>
      <div className="-mt-2 flex gap-2 px-5 pb-5">
        <Button
          size="sm"
          variant="danger"
          className="-ml-3"
          disabled={item.current_qty === 0 || saving}
          onClick={async () => {
            setSaving(true)
            try {
              await recordMovement(item.id, 'inventory_adjustment', 0, newIdempotencyKey(), 'Acabou')
              toast.show(`${item.product_name} marcado como acabado`)
              await onDone()
            } catch (err) {
              setError(toMessage(err))
            } finally {
              setSaving(false)
            }
          }}
        >
          Acabou
        </Button>
      </div>
    </Card>
  )
}

function TransferCard({ item, householdId, onDone }: { item: StockItem; householdId: string; onDone: () => Promise<void> }) {
  const { data: locations } = useLocations(householdId)
  const toast = useToast()
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  return (
    <Card>
      <CardHeader title="Onde fica guardado" />
      <div className="space-y-2 px-5 pb-5">
        {error && <Alert>{error}</Alert>}
        <SelectField
          label="Ambiente"
          value={item.location_id ?? ''}
          disabled={saving || !locations}
          onChange={async (e) => {
            const to = e.target.value
            if (!to) return
            setSaving(true)
            setError(null)
            try {
              await transferItem(item.id, to)
              toast.show(`Movido para ${locations?.find((l) => l.id === to)?.name ?? 'novo ambiente'}`)
              await onDone()
            } catch (err) {
              setError(toMessage(err))
            } finally {
              setSaving(false)
            }
          }}
        >
          {!item.location_id && <option value="">Sem ambiente</option>}
          {locations?.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </SelectField>
        <p className="flex items-center gap-1.5 text-[12px] text-fg-subtle">
          <ArrowRightLeft className="size-3" /> A mudança fica registrada como transferência.
        </p>
      </div>
    </Card>
  )
}

/** "Não envia à lista": para itens comprados de vez em quando que não devem ser repostos (ex.: marmitex). */
function ListExclusionCard({ item, onDone }: { item: StockItem; onDone: () => Promise<void> }) {
  const toast = useToast()
  const [saving, setSaving] = useState(false)
  const on = item.exclude_from_list

  async function toggle() {
    setSaving(true)
    try {
      const removed = await setListExclusion(item.id, !on)
      toast.show(
        !on
          ? `Marcado: não entra mais sozinho na lista${removed > 0 ? ' (removido da lista atual)' : ''}.`
          : 'Desmarcado: volta a entrar na lista quando faltar.',
      )
      await onDone()
    } catch (e) {
      toast.error(toMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="flex items-start justify-between gap-4 p-5">
      <div className="min-w-0">
        <p className="text-[14px] font-medium">Não envia à lista</p>
        <p className="mt-0.5 text-[13px] text-fg-muted">
          Para o que vocês compram de vez em quando e não precisa repor, como marmitex ou comida pronta. Não entra sozinho na lista
          (nem pelo estoque, nem pelo histórico) e não aparece como em falta. Ainda dá para adicionar à mão.
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label="Não envia à lista"
        disabled={saving}
        onClick={() => void toggle()}
        className={clsx(
          'relative mt-0.5 h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-50',
          on ? 'bg-accent-500' : 'bg-surface-muted ring-1 ring-border',
        )}
      >
        <span className={clsx('absolute top-0.5 left-0.5 size-6 rounded-full bg-white shadow transition-transform', on && 'translate-x-5')} />
      </button>
    </Card>
  )
}

function MovementRow({ m }: { m: Movement }) {
  const positive = m.quantity_delta > 0
  return (
    <li className="flex items-center gap-3 px-5 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-medium">{MOVEMENT_LABEL[m.type]}</p>
        <p className="truncate text-[12px] text-fg-muted">
          {formatDateTime(m.created_at)}
          {m.note ? ` · ${m.note}` : ''}
        </p>
      </div>
      {m.type === 'transfer' ? (
        <span className="text-[13px] text-fg-muted">—</span>
      ) : (
        <div className="text-right tabular-nums">
          <p className={clsx('text-[14px] font-semibold', positive ? 'text-accent-600 dark:text-accent-500' : 'text-fg')}>
            {positive ? '+' : '−'}
            {formatQty(Math.abs(m.quantity_delta))}
          </p>
          <p className="text-[12px] text-fg-subtle">
            {formatQty(m.quantity_before)} → {formatQty(m.quantity_after)}
          </p>
        </div>
      )}
    </li>
  )
}

function ArchiveButton({ item }: { item: StockItem }) {
  const navigate = useNavigate()
  const toast = useToast()
  return (
    <div className="pb-4">
      <Button
        variant="danger"
        size="sm"
        icon={<Archive className="size-4" />}
        className="-ml-3"
        onClick={async () => {
          if (!confirm(`Remover ${item.product_name} do estoque? O histórico será mantido.`)) return
          try {
            await archiveItem(item.id)
            toast.show(`${item.product_name} removido do estoque`)
            navigate('/estoque', { replace: true })
          } catch (e) {
            toast.error(toMessage(e))
          }
        }}
      >
        Remover do estoque
      </Button>
    </div>
  )
}
