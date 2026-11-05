import { clsx } from 'clsx'
import { TrendingDown, TrendingUp } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Card, CardHeader } from '@/components/ui/Card'
import { formatQty } from '@/features/inventory/domain'
import { formatCurrency, formatDate } from '@/lib/format'
import { getPriceHistory, getProductPrices, type PriceHistoryRow, type ProductPrices } from './api'
import { priceVariation } from './domain'

/** Indicadores reais de preço do produto (só compras confirmadas). */
export function PriceCard({ householdProductId }: { householdProductId: string }) {
  const [stats, setStats] = useState<ProductPrices | null | undefined>(undefined)
  const [history, setHistory] = useState<PriceHistoryRow[]>([])

  useEffect(() => {
    let active = true
    Promise.all([getProductPrices(householdProductId), getPriceHistory(householdProductId, 5)])
      .then(([s, h]) => {
        if (!active) return
        setStats(s)
        setHistory(h)
      })
      .catch(() => active && setStats(null))
    return () => {
      active = false
    }
  }, [householdProductId])

  if (stats === undefined) return null

  if (!stats) {
    return (
      <Card>
        <CardHeader title="Preços" description="Aparecem aqui depois da primeira compra confirmada com comprovante." />
      </Card>
    )
  }

  const variation = priceVariation(stats.last_price, stats.previous_price)

  return (
    <Card>
      <CardHeader
        title="Preços"
        description={`Por embalagem · ${stats.purchases} ${stats.purchases === 1 ? 'compra' : 'compras'} registradas`}
      />
      <div className="grid grid-cols-2 gap-px border-t border-border bg-border sm:grid-cols-4">
        <PriceStat label="Último" value={formatCurrency(stats.last_price)} sub={stats.last_store ?? formatDate(stats.last_purchased_at)} strong>
          {variation !== null && variation !== 0 && (
            <span className={clsx('inline-flex items-center gap-0.5 text-[11px] font-medium', variation > 0 ? 'text-danger' : 'text-accent-600')}>
              {variation > 0 ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
              {variation > 0 ? '+' : ''}
              {variation.toLocaleString('pt-BR')}%
            </span>
          )}
        </PriceStat>
        <PriceStat label="Média" value={formatCurrency(stats.avg_price)} />
        <PriceStat label="Menor" value={formatCurrency(stats.min_price)} />
        <PriceStat label="Maior" value={formatCurrency(stats.max_price)} />
      </div>
      {history.length > 0 && (
        <ul className="divide-y divide-border border-t border-border">
          {history.map((h) => (
            <li key={h.id} className="flex items-center gap-3 px-5 py-2.5 text-[13px]">
              <span className="w-20 shrink-0 text-fg-muted tabular-nums">{formatDate(h.purchased_at)}</span>
              <span className="min-w-0 flex-1 truncate text-fg-muted">{h.store_name ?? '—'}</span>
              <span className="text-fg-subtle tabular-nums">{formatQty(h.stock_quantity)}×</span>
              <span className="w-20 text-right font-medium tabular-nums">{formatCurrency(h.unit_cost)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function PriceStat({
  label,
  value,
  sub,
  strong,
  children,
}: {
  label: string
  value: string
  sub?: string
  strong?: boolean
  children?: ReactNode
}) {
  return (
    <div className="bg-surface px-5 py-3">
      <p className="text-[12px] text-fg-muted">{label}</p>
      <p className={clsx('mt-0.5 text-[16px] font-semibold tabular-nums', !strong && 'text-fg-muted')}>{value}</p>
      {children}
      {sub && <p className="truncate text-[11px] text-fg-subtle">{sub}</p>}
    </div>
  )
}
