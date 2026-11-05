import { clsx } from 'clsx'
import { useState } from 'react'
import { formatCurrency } from '@/lib/format'
import { monthLabel, niceTicks, type MonthPoint } from './domain'

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/**
 * Gasto mensal: barras verticais finas, uma série (sem legenda), grade recessiva,
 * tooltip ao passar/tocar, mês selecionado em destaque e tabela acessível.
 */
export function MonthlyBars({
  data,
  selected,
  onSelect,
}: {
  data: MonthPoint[]
  selected: string
  onSelect: (month: string) => void
}) {
  const [hover, setHover] = useState<string | null>(null)
  const max = Math.max(...data.map((d) => d.total), 0)
  const ticks = niceTicks(max)
  const top = ticks[ticks.length - 1] || 1
  const active = hover ?? selected
  const activePoint = data.find((d) => d.month === active)

  return (
    <figure className="space-y-2">
      <div className="mb-5 h-5 text-[13px] text-fg-muted" aria-live="polite">
        {activePoint && (
          <>
            <span className="font-medium text-fg">{capitalize(monthLabel(activePoint.month, true))}</span>
            {' · '}
            <span className="font-semibold text-fg tabular-nums">{formatCurrency(activePoint.total)}</span>
            {' · '}
            {activePoint.purchases} {activePoint.purchases === 1 ? 'compra' : 'compras'}
          </>
        )}
      </div>
      <div className="relative h-44">
        {/* Grade recessiva */}
        {ticks.map((t) => (
          <div key={t} className="pointer-events-none absolute inset-x-0 flex items-center gap-2" style={{ bottom: `${(t / top) * 100}%` }}>
            <span className="w-12 shrink-0 -translate-y-1/2 text-right text-[11px] text-fg-subtle tabular-nums">
              {t >= 1000 ? `${(t / 1000).toLocaleString('pt-BR')} mil` : t.toLocaleString('pt-BR')}
            </span>
            <span className={clsx('h-px flex-1 -translate-y-1/2', t === 0 ? 'bg-border' : 'bg-border/60')} />
          </div>
        ))}
        <div className="absolute inset-y-0 right-0 left-14 flex items-end gap-[2px]" role="list" aria-label="Gasto por mês">
          {data.map((d) => {
            const h = (d.total / top) * 100
            const isActive = d.month === active
            return (
              <button
                key={d.month}
                type="button"
                role="listitem"
                aria-label={`${monthLabel(d.month, true)}: ${formatCurrency(d.total)}`}
                aria-pressed={d.month === selected}
                onMouseEnter={() => setHover(d.month)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(d.month)}
                onBlur={() => setHover(null)}
                onClick={() => onSelect(d.month)}
                className="group flex h-full flex-1 items-end justify-center focus-visible:outline-none"
              >
                <span
                  className={clsx(
                    'w-full max-w-9 rounded-t-[4px] bg-accent-500 transition-opacity',
                    !isActive && 'opacity-45 group-hover:opacity-70',
                    d.total === 0 && 'opacity-0',
                    'group-focus-visible:ring-2 group-focus-visible:ring-accent-500 group-focus-visible:ring-offset-2 group-focus-visible:ring-offset-surface',
                  )}
                  style={{ height: `${Math.max(h, d.total > 0 ? 1.5 : 0)}%` }}
                />
              </button>
            )
          })}
        </div>
      </div>
      <div className="ml-14 flex gap-[2px]">
        {data.map((d) => (
          <span key={d.month} className={clsx('flex-1 text-center text-[11px]', d.month === active ? 'font-medium text-fg' : 'text-fg-subtle')}>
            {monthLabel(d.month).split('/')[0]}
          </span>
        ))}
      </div>
      <details className="pt-1 text-[13px]">
        <summary className="cursor-pointer text-fg-muted hover:text-fg">Ver tabela</summary>
        <table className="mt-2 w-full text-left tabular-nums">
          <thead className="text-[12px] text-fg-subtle">
            <tr>
              <th className="py-1 font-medium">Mês</th>
              <th className="py-1 text-right font-medium">Compras</th>
              <th className="py-1 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.month} className="border-t border-border">
                <td className="py-1.5">{capitalize(monthLabel(d.month, true))}</td>
                <td className="py-1.5 text-right">{d.purchases}</td>
                <td className="py-1.5 text-right">{formatCurrency(d.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  )
}

/** Gasto por categoria: barras horizontais de uma cor, com rótulo direto de valor e %. */
export function CategoryBars({ items }: { items: { name: string; total: number; share: number }[] }) {
  const max = Math.max(...items.map((i) => i.total), 0) || 1
  return (
    <ul className="space-y-3" aria-label="Gasto por categoria">
      {items.map((i) => (
        <li key={i.name} title={`${i.name}: ${formatCurrency(i.total)} (${Math.round(i.share * 100)}%)`}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-[13px]">
            <span className="truncate">{i.name}</span>
            <span className="shrink-0 tabular-nums">
              <span className="font-semibold">{formatCurrency(i.total)}</span>
              <span className="ml-1.5 text-fg-subtle">{Math.round(i.share * 100)}%</span>
            </span>
          </div>
          <div className="h-2 rounded-full bg-surface-muted">
            <div className="h-2 rounded-full bg-accent-500" style={{ width: `${Math.max(2, (i.total / max) * 100)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  )
}
