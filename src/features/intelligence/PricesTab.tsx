import { clsx } from 'clsx'
import { TrendingDown, TrendingUp } from 'lucide-react'
import { useState } from 'react'
import { SelectField } from '@/components/ui/Field'
import { formatCurrency } from '@/lib/format'
import { getPriceHistory } from './api'
import { PriceLine } from './charts'
import { fmtDay, fmtPct, normalizedPrice, topBy } from './domain'
import { useIntelQuery } from './hooks'
import type { DateRange, PriceStat } from './types'
import { NotEnough, Section, Stat, TabError } from './ui'

function RankList({
  title,
  info,
  rows,
  value,
  empty,
  neutral,
}: {
  neutral?: boolean
  title: string
  info: string
  rows: PriceStat[]
  value: (p: PriceStat) => number | null
  empty: string
}) {
  return (
    <Section title={title} info={info} flush>
      {rows.length === 0 ? (
        <div className="px-5 pb-5">
          <NotEnough>{empty}</NotEnough>
        </div>
      ) : (
        <ul className="divide-y divide-border border-t border-border">
          {rows.map((p) => {
            const v = value(p) ?? 0
            return (
              <li key={`${p.household_product_id}-${p.unit}`} className="flex items-center gap-3 px-5 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-medium">{p.product_name}</p>
                  <p className="truncate text-[12px] text-fg-muted tabular-nums">
                    {formatCurrency(p.min_price)} – {formatCurrency(p.max_price)} · {p.observations} {p.observations === 1 ? 'compra' : 'compras'}
                  </p>
                </div>
                {neutral ? (
                  <span className="text-[13px] font-semibold tabular-nums">{fmtPct(v, false)}</span>
                ) : (
                  <span className={clsx('inline-flex items-center gap-1 text-[13px] font-semibold tabular-nums', v > 0 ? 'text-danger' : v < 0 ? 'text-accent-600' : '')}>
                    {v > 0 ? <TrendingUp className="size-4" /> : v < 0 ? <TrendingDown className="size-4" /> : null}
                    {fmtPct(v)}
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </Section>
  )
}

export function PricesTab({ data, householdId, range }: { data: PriceStat[]; householdId: string; range: DateRange }) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  if (data.length === 0) {
    return <NotEnough>Nenhum produto associado foi comprado no período. O acompanhamento de preços usa apenas itens ligados a produtos do estoque.</NotEnough>
  }
  const selected = data.find((p) => p.household_product_id === selectedId) ?? topBy(data, (p) => p.observations * 1e6 + p.avg_price, 1)[0]!

  const up = topBy(data.filter((p) => (p.last_vs_prev_pct ?? 0) > 0), (p) => p.last_vs_prev_pct, 6)
  const down = topBy(data.filter((p) => (p.last_vs_prev_pct ?? 0) < 0), (p) => p.last_vs_prev_pct, 6, 'asc')
  const variable = topBy(data.filter((p) => p.observations >= 2 && (p.range_pct ?? 0) > 0), (p) => p.range_pct, 6)
  const spread = topBy(data.filter((p) => p.store_spread_pct !== null), (p) => p.store_spread_pct, 6)

  return (
    <div className="space-y-5">
      <Section
        title="Histórico de preço"
        description="Escolha um produto para ver a evolução no período"
        info="Preço líquido por unidade da nota (total pago na linha ÷ quantidade), já com descontos. A média é ponderada pela quantidade comprada."
      >
        <SelectField label="Produto" value={selected.household_product_id} onChange={(e) => setSelectedId(e.target.value)}>
          {[...data]
            .sort((a, b) => a.product_name.localeCompare(b.product_name, 'pt-BR'))
            .map((p) => (
              <option key={`${p.household_product_id}-${p.unit}`} value={p.household_product_id}>
                {p.product_name} ({p.observations})
              </option>
            ))}
        </SelectField>
        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Último preço" value={formatCurrency(selected.last_price)}>
            <span className="text-[12px] text-fg-muted">
              {fmtDay(selected.last_date)}
              {normalizedPrice(selected) && ` · ${normalizedPrice(selected)}`}
            </span>
          </Stat>
          <Stat label="Preço médio" value={formatCurrency(selected.avg_price)} info="Média ponderada pela quantidade comprada no período.">
            <span className="text-[12px] text-fg-muted">
              {selected.vs_prev_period_pct !== null ? `${fmtPct(selected.vs_prev_period_pct)} vs. período anterior` : 'sem período anterior'}
            </span>
          </Stat>
          <Stat label="Menor · maior" value={`${formatCurrency(selected.min_price)}`}>
            <span className="text-[12px] text-fg-muted tabular-nums">até {formatCurrency(selected.max_price)}</span>
          </Stat>
          <Stat label="Variação" value={selected.last_vs_prev_pct !== null ? fmtPct(selected.last_vs_prev_pct) : '—'} info="Último preço comparado com a compra anterior do mesmo produto.">
            <span className="text-[12px] text-fg-muted">
              {selected.store_spread_pct !== null && selected.cheapest_store
                ? `${fmtPct(selected.store_spread_pct, false)} entre mercados · menor no ${selected.cheapest_store}`
                : selected.observations < 2
                  ? '1 compra no período'
                  : 'vs. compra anterior'}
            </span>
          </Stat>
        </div>
        <div className="mt-5">
          <History householdId={householdId} productId={selected.household_product_id} range={range} avg={selected.avg_price} />
        </div>
      </Section>

      <div className="grid gap-5 lg:grid-cols-2">
        <RankList
          title="Mais encareceram"
          info="Último preço pago comparado com a compra anterior do mesmo produto."
          rows={up}
          value={(p) => p.last_vs_prev_pct}
          empty="Nenhum produto ficou mais caro — ou ainda não há duas compras do mesmo produto no período."
        />
        <RankList
          title="Mais ficaram baratos"
          info="Último preço pago comparado com a compra anterior do mesmo produto."
          rows={down}
          value={(p) => p.last_vs_prev_pct}
          empty="Nenhum produto ficou mais barato — ou ainda não há duas compras do mesmo produto no período."
        />
        <RankList
          neutral
          title="Maior variação de preço"
          info="Diferença entre o maior e o menor preço pago no período."
          rows={variable}
          value={(p) => p.range_pct}
          empty="Precisamos de mais compras registradas para medir a variação de preço dos produtos."
        />
        <RankList
          neutral
          title="Maior diferença entre mercados"
          info="Último preço em cada mercado no período: quanto o mais caro passa do mais barato."
          rows={spread}
          value={(p) => p.store_spread_pct}
          empty="Aparece quando o mesmo produto for comprado em dois mercados diferentes."
        />
      </div>
    </div>
  )
}

function History({ householdId, productId, range, avg }: { householdId: string; productId: string; range: DateRange; avg: number }) {
  const { data, error, loading } = useIntelQuery(`hist:${householdId}:${productId}:${range.from}:${range.to}`, () =>
    getPriceHistory(householdId, productId, range),
  )
  if (error) return <TabError error={error} />
  if (loading || !data) return <div className="h-48 animate-pulse rounded-lg bg-surface-muted" />
  if (data.length < 2) {
    return <NotEnough>Precisamos de mais compras registradas deste produto para mostrar a evolução do preço.</NotEnough>
  }
  return <PriceLine points={data} avg={avg} />
}
