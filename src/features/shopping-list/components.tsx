import { clsx } from 'clsx'
import { Check, ChevronDown, Minus, Plus, Search, Trash2 } from 'lucide-react'
import { useMemo, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/Button'
import { formatQty, normalize, productSubtitle, type StockItem } from '@/features/inventory/domain'
import { formatCurrency } from '@/lib/format'
import { parsePrice, stepQuantity, type ListItem } from './domain'

// -----------------------------------------------------------------------------
// Barra de inclusão: busca no estoque ou adiciona item avulso
// -----------------------------------------------------------------------------
export function AddItemBar({
  stock,
  onAddProduct,
  onAddCustom,
}: {
  stock: StockItem[]
  onAddProduct: (item: StockItem) => Promise<void>
  onAddCustom: (name: string) => Promise<void>
}) {
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const q = normalize(query)

  const matches = useMemo(() => {
    if (!q) return []
    return stock
      .filter((s) => normalize(`${s.product_name} ${s.brand_name ?? ''}`).includes(q))
      .slice(0, 6)
  }, [stock, q])

  async function run(fn: () => Promise<void>) {
    setBusy(true)
    try {
      await fn()
      setQuery('')
    } finally {
      setBusy(false)
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!query.trim() || busy) return
    const exact = matches.find((m) => normalize(m.product_name) === q)
    void run(() => (exact ? onAddProduct(exact) : onAddCustom(query)))
  }

  return (
    <div className="relative">
      <form onSubmit={onSubmit}>
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-subtle" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Adicionar item…"
          aria-label="Adicionar item à lista"
          enterKeyHint="done"
          disabled={busy}
          className="h-11 w-full rounded-xl border border-border bg-surface pr-3 pl-9 text-[15px] shadow-card placeholder:text-fg-subtle focus:border-accent-500 focus:ring-3 focus:ring-accent-500/15 focus:outline-none"
        />
      </form>
      {query.trim() && (
        <div className="absolute inset-x-0 top-full z-10 mt-1.5 overflow-hidden rounded-xl border border-border bg-surface shadow-lg animate-fade-in">
          {matches.map((m) => (
            <button
              key={m.id}
              type="button"
              disabled={busy}
              onClick={() => void run(() => onAddProduct(m))}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-surface-muted"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-medium">{m.product_name}</p>
                <p className="truncate text-[12px] text-fg-muted">{productSubtitle(m) || m.location_name || 'Do estoque'}</p>
              </div>
              <span className="text-[12px] text-fg-subtle tabular-nums">
                {formatQty(m.current_qty)}/{formatQty(m.ideal_qty)}
              </span>
            </button>
          ))}
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(() => onAddCustom(query))}
            className="flex w-full items-center gap-2 border-t border-border px-4 py-2.5 text-left text-[14px] text-fg-muted hover:bg-surface-muted"
          >
            <Plus className="size-4" />
            Adicionar “{query.trim()}” como item avulso
          </button>
        </div>
      )}
    </div>
  )
}

// -----------------------------------------------------------------------------
// Linha da lista
// -----------------------------------------------------------------------------
export function ListRow({
  item,
  canEdit,
  onToggle,
  onQuantity,
  onSave,
  onRemove,
}: {
  item: ListItem
  canEdit: boolean
  onToggle: () => void
  onQuantity: (qty: number) => void
  onSave: (price: number | null, notes: string | null) => Promise<void>
  onRemove: () => void
}) {
  const [open, setOpen] = useState(false)
  const checked = Boolean(item.checked_at)
  const subtitle = [
    item.household_product_id ? productSubtitle({ ...item, unit: item.unit ?? 'un' }) : 'Item avulso',
    item.notes,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <li className={clsx('transition-colors', open && 'bg-surface-muted/40')}>
      <div className="flex items-center gap-3 py-2.5 pr-3 pl-3">
        <button
          type="button"
          role="checkbox"
          aria-checked={checked}
          aria-label={checked ? `Desmarcar ${item.name}` : `Marcar ${item.name} como pego`}
          disabled={!canEdit}
          onClick={onToggle}
          className={clsx(
            'grid size-9 shrink-0 place-items-center rounded-full transition-transform active:scale-90',
            'disabled:active:scale-100',
          )}
        >
          <span
            className={clsx(
              'grid size-[26px] place-items-center rounded-full border-2 transition-colors',
              checked ? 'border-accent-600 bg-accent-600 text-white' : 'border-border bg-surface',
            )}
          >
            {checked && <Check className="size-4" strokeWidth={3} />}
          </span>
        </button>

        <button type="button" className="min-w-0 flex-1 text-left" onClick={() => canEdit && setOpen((o) => !o)}>
          <p className={clsx('truncate text-[15px] leading-5 font-medium', checked && 'text-fg-subtle line-through')}>
            {item.name}
          </p>
          <p className="truncate text-[12px] leading-5 text-fg-muted">
            {subtitle}
            {item.estimated_unit_price !== null && (
              <span className="text-fg-subtle"> · ≈ {formatCurrency(item.estimated_total)}</span>
            )}
          </p>
        </button>

        {canEdit && !checked ? (
          <div className="flex items-center rounded-full border border-border bg-surface">
            <button
              type="button"
              aria-label={`Diminuir ${item.name}`}
              disabled={item.quantity <= 1}
              onClick={() => onQuantity(stepQuantity(item.quantity, -1))}
              className="grid size-8 place-items-center rounded-full text-fg-muted hover:text-fg disabled:opacity-30"
            >
              <Minus className="size-3.5" />
            </button>
            <span className="min-w-6 text-center text-[14px] font-semibold tabular-nums">{formatQty(item.quantity)}</span>
            <button
              type="button"
              aria-label={`Aumentar ${item.name}`}
              onClick={() => onQuantity(stepQuantity(item.quantity, 1))}
              className="grid size-8 place-items-center rounded-full text-fg-muted hover:text-fg"
            >
              <Plus className="size-3.5" />
            </button>
          </div>
        ) : (
          <span className={clsx('px-2 text-[14px] font-semibold tabular-nums', checked && 'text-fg-subtle')}>
            {formatQty(item.quantity)}×
          </span>
        )}
        {canEdit && (
          <button
            type="button"
            aria-label={open ? 'Fechar detalhes' : 'Detalhes'}
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            className="-ml-1 grid size-7 place-items-center rounded-md text-fg-subtle hover:text-fg"
          >
            <ChevronDown className={clsx('size-4 transition-transform', open && 'rotate-180')} />
          </button>
        )}
      </div>
      {open && canEdit && <ItemDetails item={item} onSave={onSave} onRemove={onRemove} onDone={() => setOpen(false)} />}
    </li>
  )
}

function ItemDetails({
  item,
  onSave,
  onRemove,
  onDone,
}: {
  item: ListItem
  onSave: (price: number | null, notes: string | null) => Promise<void>
  onRemove: () => void
  onDone: () => void
}) {
  const [price, setPrice] = useState(
    item.estimated_unit_price !== null ? item.estimated_unit_price.toFixed(2).replace('.', ',') : '',
  )
  const [notes, setNotes] = useState(item.notes ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const field =
    'h-9 w-full rounded-lg border border-border bg-surface px-3 text-[14px] focus:border-accent-500 focus:ring-3 focus:ring-accent-500/15 focus:outline-none'

  async function save(e: FormEvent) {
    e.preventDefault()
    const parsed = parsePrice(price)
    if (parsed === undefined) return setError('Preço inválido. Use, por exemplo, 4,99.')
    setSaving(true)
    try {
      await onSave(parsed, notes.trim() || null)
      onDone()
    } finally {
      setSaving(false)
    }
  }

  const origin = item.origin === 'stock' ? (item.manually_edited ? 'Do estoque, ajustado por você' : 'Do estoque') : 'Incluído manualmente'

  return (
    <form onSubmit={save} className="space-y-3 px-4 pb-4 pl-[60px] animate-fade-in">
      <div className="grid grid-cols-[7.5rem_1fr] gap-2">
        <label className="space-y-1">
          <span className="text-[12px] font-medium text-fg-muted">Preço unitário</span>
          <input className={field} inputMode="decimal" placeholder="R$ 0,00" value={price} onChange={(e) => { setPrice(e.target.value); setError(null) }} />
        </label>
        <label className="space-y-1">
          <span className="text-[12px] font-medium text-fg-muted">Observação</span>
          <input className={field} maxLength={300} placeholder="Ex.: o de vidro" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
      </div>
      {error && <p className="text-[12px] text-danger">{error}</p>}
      <p className="text-[12px] text-fg-subtle">
        {origin}
        {item.current_qty !== null && item.ideal_qty !== null && ` · em casa ${formatQty(item.current_qty)} de ${formatQty(item.ideal_qty)}`}
      </p>
      <div className="flex items-center justify-between">
        <Button size="sm" variant="danger" className="-ml-3" icon={<Trash2 className="size-3.5" />} onClick={onRemove}>
          Remover
        </Button>
        <Button size="sm" type="submit" variant="secondary" loading={saving}>
          Salvar
        </Button>
      </div>
    </form>
  )
}
