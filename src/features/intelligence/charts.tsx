import { clsx } from 'clsx'
import { useState } from 'react'
import { formatCurrency } from '@/lib/format'
import { niceTicks } from '@/features/analytics/domain'
import { bucketLabel, fmtDay } from './domain'
import type { Overview, PricePoint, Ticket } from './types'

const compact = (t: number) => (t >= 1000 ? `${(t / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil` : t.toLocaleString('pt-BR'))

function Grid({ ticks, top }: { ticks: number[]; top: number }) {
  return (
    <>
      {ticks.map((t) => (
        <div key={t} className="pointer-events-none absolute inset-x-0 flex items-center gap-2" style={{ bottom: `${(t / top) * 100}%` }}>
          <span className="w-12 shrink-0 -translate-y-1/2 text-right text-[11px] text-fg-subtle tabular-nums">{compact(t)}</span>
          <span className={clsx('h-px flex-1 -translate-y-1/2', t === 0 ? 'bg-border' : 'bg-border/60')} />
        </div>
      ))}
    </>
  )
}

/**
 * Evolução dos gastos: barras finas do período atual e um traço cinza com o
 * valor do ponto equivalente do período anterior. Tooltip ao tocar/passar.
 */
export function SpendSeries({ data, granularity }: { data: Overview['series']; granularity: Overview['granularity'] }) {
  const [active, setActive] = useState<number | null>(null)
  const max = Math.max(...data.map((d) => Math.max(d.total, d.prev_total)), 0)
  const ticks = niceTicks(max)
  const top = ticks[ticks.length - 1] || 1
  const point = active !== null ? data[active] : null
  const every = Math.ceil(data.length / 8)

  return (
    <figure>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="min-h-5 text-[13px] text-fg-muted" aria-live="polite">
          {point ? (
            <>
              <span className="font-medium text-fg">{bucketLabel(point.bucket, granularity, true)}</span>
              {' · '}
              <span className="font-semibold text-fg tabular-nums">{formatCurrency(point.total)}</span>
              {' · '}
              {point.purchases} {point.purchases === 1 ? 'compra' : 'compras'}
              <span className="text-fg-subtle"> · anterior {formatCurrency(point.prev_total)}</span>
            </>
          ) : (
            'Toque em uma barra para ver os valores'
          )}
        </div>
        <div className="flex items-center gap-3 text-[12px] text-fg-muted">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm bg-accent-500" /> Período
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-3 rounded-full bg-fg-subtle" /> Anterior
          </span>
        </div>
      </div>
      <div className="relative mt-4 h-44">
        <Grid ticks={ticks} top={top} />
        <div className="absolute inset-y-0 right-0 left-14 flex items-end gap-[2px]">
          {data.map((d, i) => (
            <button
              key={d.bucket}
              type="button"
              aria-label={`${bucketLabel(d.bucket, granularity, true)}: ${formatCurrency(d.total)}; período anterior ${formatCurrency(d.prev_total)}`}
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
              onClick={() => setActive(i)}
              className="group relative flex h-full flex-1 items-end justify-center focus-visible:outline-none"
            >
              <span
                className={clsx(
                  'w-full max-w-8 rounded-t-[4px] bg-accent-500 transition-opacity',
                  active !== null && active !== i ? 'opacity-40' : 'opacity-90',
                  d.total === 0 && 'opacity-0',
                )}
                style={{ height: `${d.total > 0 ? Math.max((d.total / top) * 100, 1.5) : 0}%` }}
              />
              {d.prev_total > 0 && (
                <span
                  className="pointer-events-none absolute left-1/2 h-0.5 w-[70%] max-w-8 -translate-x-1/2 rounded-full bg-fg-subtle"
                  style={{ bottom: `${(d.prev_total / top) * 100}%` }}
                />
              )}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-1.5 ml-14 flex gap-[2px]">
        {data.map((d, i) => (
          <span key={d.bucket} className={clsx('flex-1 text-center text-[11px]', active === i ? 'font-medium text-fg' : 'text-fg-subtle')}>
            {i % every === 0 ? bucketLabel(d.bucket, granularity) : ''}
          </span>
        ))}
      </div>
      <details className="pt-2 text-[13px]">
        <summary className="cursor-pointer text-fg-muted hover:text-fg">Ver tabela</summary>
        <table className="mt-2 w-full text-left tabular-nums">
          <thead className="text-[12px] text-fg-subtle">
            <tr>
              <th className="py-1 font-medium">Período</th>
              <th className="py-1 text-right font-medium">Compras</th>
              <th className="py-1 text-right font-medium">Total</th>
              <th className="py-1 text-right font-medium">Anterior</th>
            </tr>
          </thead>
          <tbody>
            {data
              .filter((d) => d.total > 0 || d.prev_total > 0)
              .map((d) => (
                <tr key={d.bucket} className="border-t border-border">
                  <td className="py-1.5">{bucketLabel(d.bucket, granularity, true)}</td>
                  <td className="py-1.5 text-right">{d.purchases}</td>
                  <td className="py-1.5 text-right">{formatCurrency(d.total)}</td>
                  <td className="py-1.5 text-right text-fg-muted">{formatCurrency(d.prev_total)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </details>
    </figure>
  )
}

/** Valor de cada compra (ticket), com as fora do padrão marcadas por ícone e rótulo. */
export function TicketBars({ tickets, avg }: { tickets: Ticket[]; avg: number | null }) {
  const [active, setActive] = useState<number | null>(null)
  const max = Math.max(...tickets.map((t) => t.total), 0)
  const ticks = niceTicks(max)
  const top = ticks[ticks.length - 1] || 1
  const t = active !== null ? tickets[active] : null
  return (
    <figure>
      <div className="mb-3 min-h-5 text-[13px] text-fg-muted" aria-live="polite">
        {t ? (
          <>
            <span className="font-medium text-fg">{fmtDay(t.date)}</span> · {t.store_name} ·{' '}
            <span className="font-semibold text-fg tabular-nums">{formatCurrency(t.total)}</span>
            {t.outlier && <span className="ml-1 font-medium text-danger">· fora do padrão</span>}
          </>
        ) : (
          `Cada barra é uma compra · média ${formatCurrency(avg)}`
        )}
      </div>
      <div className="relative mt-4 h-36">
        <Grid ticks={ticks} top={top} />
        {avg !== null && avg > 0 && (
          <div className="pointer-events-none absolute right-0 left-14 border-t border-dashed border-fg-subtle" style={{ bottom: `${(avg / top) * 100}%` }} />
        )}
        <div className="absolute inset-y-0 right-0 left-14 flex items-end gap-[2px]">
          {tickets.map((x, i) => (
            <button
              key={x.purchase_id}
              type="button"
              aria-label={`${fmtDay(x.date)}, ${x.store_name}: ${formatCurrency(x.total)}${x.outlier ? ', fora do padrão' : ''}`}
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
              onClick={() => setActive(i)}
              className="relative flex h-full flex-1 items-end justify-center focus-visible:outline-none"
            >
              {x.outlier && (
                <span className="absolute text-[10px] font-bold text-danger" style={{ bottom: `calc(${(x.total / top) * 100}% + 2px)` }} aria-hidden>
                  !
                </span>
              )}
              <span
                className={clsx('w-full max-w-6 rounded-t-[4px]', x.outlier ? 'bg-danger' : 'bg-accent-500', active !== null && active !== i ? 'opacity-40' : 'opacity-90')}
                style={{ height: `${Math.max((x.total / top) * 100, 1.5)}%` }}
              />
            </button>
          ))}
        </div>
      </div>
      <p className="mt-2 ml-14 text-[11px] text-fg-subtle">Linha tracejada: ticket médio · ! = compra fora do padrão</p>
    </figure>
  )
}

/** Barras horizontais com rótulo direto (valor e participação). */
export function ShareBars({
  items,
}: {
  items: { key: string; name: string; value: number; share: number; note?: string }[]
}) {
  const max = Math.max(...items.map((i) => i.value), 0) || 1
  return (
    <ul className="space-y-3">
      {items.map((i) => (
        <li key={i.key} title={`${i.name}: ${formatCurrency(i.value)} (${Math.round(i.share * 100)}%)`}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-[13px]">
            <span className="min-w-0 truncate">
              {i.name}
              {i.note && <span className="ml-1.5 text-[12px] text-fg-subtle">{i.note}</span>}
            </span>
            <span className="shrink-0 tabular-nums">
              <span className="font-semibold">{formatCurrency(i.value)}</span>
              <span className="ml-1.5 text-fg-subtle">{Math.round(i.share * 100)}%</span>
            </span>
          </div>
          <div className="h-2 rounded-full bg-surface-muted">
            <div className="h-2 rounded-full bg-accent-500" style={{ width: `${Math.max(2, (i.value / max) * 100)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  )
}

/** Evolução do preço de um produto: linha de 2px, pontos ≥8px, média tracejada. */
export function PriceLine({ points, avg }: { points: PricePoint[]; avg: number | null }) {
  const [active, setActive] = useState<number | null>(null)
  const W = 600
  const H = 180
  const padL = 52
  const padR = 12
  const padT = 12
  const padB = 24
  const prices = points.map((p) => p.unit_price)
  const lo = Math.min(...prices, avg ?? Infinity)
  const hi = Math.max(...prices, avg ?? -Infinity)
  const span = hi - lo || hi * 0.1 || 1
  const yMin = Math.max(0, lo - span * 0.25)
  const yMax = hi + span * 0.25
  const x = (i: number) => (points.length === 1 ? (padL + W - padR) / 2 : padL + (i / (points.length - 1)) * (W - padL - padR))
  const y = (v: number) => padT + (1 - (v - yMin) / (yMax - yMin)) * (H - padT - padB)
  const ticks = [yMin, (yMin + yMax) / 2, yMax]
  const p = active !== null ? points[active] : null

  return (
    <figure>
      <div className="mb-2 min-h-5 text-[13px] text-fg-muted" aria-live="polite">
        {p ? (
          <>
            <span className="font-medium text-fg">{fmtDay(p.local_date)}</span> · {p.store_name} ·{' '}
            <span className="font-semibold text-fg tabular-nums">{formatCurrency(p.unit_price)}</span>
            <span className="text-fg-subtle">
              {' '}
              / {p.unit.toLowerCase()}
              {p.discount > 0 && ` · desconto ${formatCurrency(p.discount)}`}
            </span>
          </>
        ) : (
          'Toque em um ponto para ver a compra'
        )}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full overflow-visible" role="img" aria-label="Evolução do preço">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} className="stroke-border" strokeWidth={1} />
            <text x={padL - 8} y={y(t) + 4} textAnchor="end" className="fill-fg-subtle text-[11px] tabular-nums">
              {formatCurrency(t).replace('R$', '').trim()}
            </text>
          </g>
        ))}
        {avg !== null && (
          <line x1={padL} x2={W - padR} y1={y(avg)} y2={y(avg)} className="stroke-fg-subtle" strokeWidth={1.5} strokeDasharray="4 4" />
        )}
        {points.length > 1 && (
          <polyline
            points={points.map((pt, i) => `${x(i)},${y(pt.unit_price)}`).join(' ')}
            fill="none"
            className="stroke-accent-500"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}
        {points.map((pt, i) => (
          <g key={`${pt.local_date}-${i}`}>
            <circle cx={x(i)} cy={y(pt.unit_price)} r={active === i ? 6 : 4.5} className="fill-accent-500 stroke-surface" strokeWidth={2} />
            <circle
              cx={x(i)}
              cy={y(pt.unit_price)}
              r={16}
              fill="transparent"
              tabIndex={0}
              role="button"
              aria-label={`${fmtDay(pt.local_date)}, ${pt.store_name}: ${formatCurrency(pt.unit_price)}`}
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
              onClick={() => setActive(i)}
              className="cursor-pointer focus:outline-none"
            />
          </g>
        ))}
        {points.length > 0 && (
          <>
            <text x={x(0)} y={H - 4} textAnchor={points.length === 1 ? 'middle' : 'start'} className="fill-fg-subtle text-[11px]">
              {fmtDay(points[0]!.local_date, false)}
            </text>
            {points.length > 1 && (
              <text x={x(points.length - 1)} y={H - 4} textAnchor="end" className="fill-fg-subtle text-[11px]">
                {fmtDay(points[points.length - 1]!.local_date, false)}
              </text>
            )}
          </>
        )}
      </svg>
      {avg !== null && <p className="mt-1 text-[11px] text-fg-subtle">Linha tracejada: preço médio ponderado no período</p>}
    </figure>
  )
}
