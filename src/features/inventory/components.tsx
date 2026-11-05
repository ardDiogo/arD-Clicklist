import { clsx } from 'clsx'
import { Minus, Plus } from 'lucide-react'
import type { StockStatus } from '@/integrations/supabase/database.types'
import { formatQty, STATUS_LABEL } from './domain'

const dotClass: Record<StockStatus, string> = {
  out: 'bg-danger',
  low: 'bg-amber-500',
  ok: 'bg-accent-500',
  untracked: 'bg-fg-subtle/50',
}

export function StatusDot({ status, className }: { status: StockStatus; className?: string }) {
  return (
    <span
      role="img"
      aria-label={STATUS_LABEL[status]}
      title={STATUS_LABEL[status]}
      className={clsx('inline-block size-2 shrink-0 rounded-full', dotClass[status], className)}
    />
  )
}

export function StatusPill({ status }: { status: StockStatus }) {
  return (
    <span
      className={clsx(
        'inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-medium',
        status === 'out' && 'bg-danger-soft text-danger',
        status === 'low' && 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
        status === 'ok' && 'bg-accent-50 text-accent-700 dark:bg-accent-700/20 dark:text-accent-100',
        status === 'untracked' && 'bg-surface-muted text-fg-muted',
      )}
    >
      <StatusDot status={status} />
      {STATUS_LABEL[status]}
    </span>
  )
}

/** Quantidade "atual / ideal" com destaque para o atual. */
export function QtyFraction({ current, ideal }: { current: number; ideal: number }) {
  return (
    <span className="tabular-nums">
      <span className="text-[15px] font-semibold text-fg">{formatQty(current)}</span>
      {ideal > 0 && <span className="text-[13px] text-fg-subtle"> / {formatQty(ideal)}</span>}
    </span>
  )
}

export function Stepper({
  onDecrement,
  onIncrement,
  disableDecrement,
  label,
  size = 'sm',
}: {
  onDecrement: () => void
  onIncrement: () => void
  disableDecrement?: boolean
  label: string
  size?: 'sm' | 'lg'
}) {
  const btn = clsx(
    'grid place-items-center rounded-full border border-border bg-surface text-fg-muted transition-[transform,color,background-color]',
    'hover:text-fg hover:bg-surface-muted active:scale-90 disabled:opacity-35 disabled:active:scale-100',
    size === 'sm' ? 'size-8' : 'size-11',
  )
  const icon = size === 'sm' ? 'size-4' : 'size-5'
  return (
    <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
      <button type="button" className={btn} onClick={onDecrement} disabled={disableDecrement} aria-label={`Usar 1 — ${label}`}>
        <Minus className={icon} strokeWidth={2} />
      </button>
      <button type="button" className={btn} onClick={onIncrement} aria-label={`Adicionar 1 — ${label}`}>
        <Plus className={icon} strokeWidth={2} />
      </button>
    </div>
  )
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string; count?: number }[]
  label: string
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-[10px] bg-surface-muted p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={clsx(
            'flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium whitespace-nowrap transition-all',
            value === o.value ? 'bg-surface text-fg shadow-card' : 'text-fg-muted hover:text-fg',
          )}
        >
          {o.label}
          {o.count !== undefined && (
            <span className={clsx('tabular-nums', value === o.value ? 'text-fg-muted' : 'text-fg-subtle')}>{o.count}</span>
          )}
        </button>
      ))}
    </div>
  )
}

export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="divide-y divide-border rounded-xl border border-border bg-surface" aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3.5">
          <div className="flex-1 space-y-2">
            <div className="h-3.5 w-2/5 animate-pulse rounded bg-surface-muted" />
            <div className="h-3 w-1/4 animate-pulse rounded bg-surface-muted" />
          </div>
          <div className="h-8 w-20 animate-pulse rounded-full bg-surface-muted" />
        </div>
      ))}
    </div>
  )
}
