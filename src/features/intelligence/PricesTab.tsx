import { clsx } from 'clsx'
import { TrendingDown, TrendingUp } from 'lucide-react'
import { useMemo, useState } from 'react'
import { SelectField } from '@/components/ui/Field'
import { Badge } from '@/components/ui/feedback'
import { formatCurrency } from '@/lib/format'
import { getPriceHistory } from './api'
import { PriceLine } from './charts'
import { fmtDay, fmtPct, perBase, prettyVariant, topBy } from './domain'
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
  title: string
  info: string
  rows: PriceStat[]
  value: (p: PriceStat) => number | null
  empty: string
  neutral?: boolean
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
              <li key={p.variant_key} className="flex items-center gap-3 px-5 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-medium">{p.product_name}</p>
                  <p className="truncate text-[12px] text-fg-muted">{prettyVariant(p.variant_label, 40)}</p>
                  <p className="truncate text-[12px] text-fg-subtle tabular-nums">
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
  // Produtos genéricos (cada um com uma ou mais marcas/apresentações)
  const products = useMemo(() => {
    const map = new Map<string, { id: string; name: string; variants: PriceStat[]; observations: number }>()
    for (const p of data) {
      const g = map.get(p.household_product_id) ?? { id: p.household_product_id, name: p.product_name, variants: [], observations: 0 }
      g.variants.push(p)
      g.observations += p.observations
      map.set(p.household_product_id, g)
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
  }, [data])

  const [productId, setProductId] = useState<string | null>(null)
  const [variantKey, setVariantKey] = useState<string | null>(null)

  if (data.length === 0) {
    return <NotEnough>Nenhum produto associado foi comprado no período. O acompanhamento de preços usa apenas itens ligados a produtos do estoque.</NotEnough>
  }

  const product =
    products.find((p) => p.id === productId) ?? [...products].sort((a, b) => b.observations - a.observations)[0]!
  const variants = [...product.variants].sort((a, b) => b.observations - a.observations)
  const selected = variants.find((v) => v.variant_key === variantKey) ?? variants[0]!

  // Marca mais barata por kg/L (só quando dá para comparar pelo tamanho na nota)
  const comparable = variants.filter((v) => v.price_per_base !== null && v.base_unit)
  const sameBase = comparable.length >= 2 && comparable.every((v) => v.base_unit === comparable[0]!.base_unit)
  const cheapest = sameBase ? topBy(comparable, (v) => v.price_per_base, 1, 'asc')[0] : null

  const up = topBy(data.filter((p) => (p.last_vs_prev_pct ?? 0) > 0), (p) => p.last_vs_prev_pct, 6)
  const down = topBy(data.filter((p) => (p.last_vs_prev_pct ?? 0) < 0), (p) => p.last_vs_prev_pct, 6, 'asc')
  const variable = topBy(data.filter((p) => p.observations >= 2 && (p.range_pct ?? 0) > 0), (p) => p.range_pct, 6)
  const spread = topBy(data.filter((p) => p.store_spread_pct !== null), (p) => p.store_spread_pct, 6)

  return (
    <div className="space-y-5">
      <Section
        title="Preço por produto e marca"
        description="O produto é genérico; cada marca/apresentação tem seus próprios preços"
        info="Marcas são separadas pelo código de barras da nota (ou pela descrição, quando não há código). Preço líquido por unidade da nota, já com descontos. O preço por kg/L usa o tamanho escrito na nota (ex.: 450G, CX12)."
      >
        <SelectField
          label="Produto"
          value={product.id}
          onChange={(e) => {
            setProductId(e.target.value)
            setVariantKey(null)
          }}
        >
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.variants.length} {p.variants.length === 1 ? 'marca' : 'marcas'})
            </option>
          ))}
        </SelectField>

        <div className="mt-4">
          <p className="mb-2 text-[12px] font-medium tracking-wide text-fg-subtle uppercase">Marcas compradas</p>
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
            {variants.map((v) => {
              const active = v.variant_key === selected.variant_key
              return (
                <li key={v.variant_key}>
                  <button
                    type="button"
                    onClick={() => setVariantKey(v.variant_key)}
                    aria-pressed={active}
                    className={clsx('flex w-full items-center gap-3 px-4 py-3 text-left transition-colors', active ? 'bg-surface-muted' : 'hover:bg-surface-muted/50')}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate text-[14px] font-medium">{prettyVariant(v.variant_label)}</span>
                        {cheapest?.variant_key === v.variant_key && <Badge tone="accent">Mais barata por {v.base_unit}</Badge>}
                      </span>
                      <span className="block truncate text-[12px] text-fg-muted">
                        {v.last_store ? `${v.last_store} · ` : ''}
                        {fmtDay(v.last_date)} · {v.observations} {v.observations === 1 ? 'compra' : 'compras'}
                      </span>
                    </span>
                    <span className="shrink-0 text-right tabular-nums">
                      <span className="block text-[14px] font-semibold">{formatCurrency(v.last_price)}</span>
                      {perBase(v) && <span className="block text-[12px] text-fg-muted">{perBase(v)}</span>}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
          {variants.length > 1 && !sameBase && (
            <p className="mt-2 text-[12px] text-fg-subtle">Para indicar a marca mais barata, a nota precisa trazer o tamanho (ex.: 450G) de todas elas.</p>
          )}
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Último preço" value={formatCurrency(selected.last_price)}>
            <span className="text-[12px] text-fg-muted">
              {fmtDay(selected.last_date)}
              {perBase(selected) && ` · ${perBase(selected)}`}
            </span>
          </Stat>
          <Stat label="Preço médio" value={formatCurrency(selected.avg_price)} info="Média ponderada pela quantidade comprada desta marca no período.">
            <span className="text-[12px] text-fg-muted">
              {selected.vs_prev_period_pct !== null ? `${fmtPct(selected.vs_prev_period_pct)} vs. período anterior` : 'sem período anterior'}
            </span>
          </Stat>
          <Stat label="Menor · maior" value={formatCurrency(selected.min_price)}>
            <span className="text-[12px] text-fg-muted tabular-nums">até {formatCurrency(selected.max_price)}</span>
          </Stat>
          <Stat
            label="Variação"
            value={selected.last_vs_prev_pct !== null ? fmtPct(selected.last_vs_prev_pct) : '—'}
            info="Último preço comparado com a compra anterior da MESMA marca."
          >
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
          <History householdId={householdId} productId={product.id} variantKey={selected.variant_key} range={range} avg={selected.avg_price} />
        </div>
      </Section>

      <div className="grid gap-5 lg:grid-cols-2">
        <RankList
          title="Mais encareceram"
          info="Último preço pago comparado com a compra anterior da mesma marca."
          rows={up}
          value={(p) => p.last_vs_prev_pct}
          empty="Nenhuma marca ficou mais cara — ou ainda não há duas compras da mesma marca no período."
        />
        <RankList
          title="Mais ficaram baratos"
          info="Último preço pago comparado com a compra anterior da mesma marca."
          rows={down}
          value={(p) => p.last_vs_prev_pct}
          empty="Nenhuma marca ficou mais barata — ou ainda não há duas compras da mesma marca no período."
        />
        <RankList
          neutral
          title="Maior variação de preço"
          info="Diferença entre o maior e o menor preço pago pela mesma marca no período."
          rows={variable}
          value={(p) => p.range_pct}
          empty="Precisamos de mais compras registradas para medir a variação de preço."
        />
        <RankList
          neutral
          title="Maior diferença entre mercados"
          info="Mesma marca em mercados diferentes: quanto o mais caro passa do mais barato (último preço em cada um)."
          rows={spread}
          value={(p) => p.store_spread_pct}
          empty="Aparece quando a mesma marca for comprada em dois mercados diferentes."
        />
      </div>
    </div>
  )
}

function History({
  householdId,
  productId,
  variantKey,
  range,
  avg,
}: {
  householdId: string
  productId: string
  variantKey: string
  range: DateRange
  avg: number
}) {
  const { data, error, loading } = useIntelQuery(`hist:${householdId}:${productId}:${range.from}:${range.to}`, () =>
    getPriceHistory(householdId, productId, range),
  )
  if (error) return <TabError error={error} />
  if (loading || !data) return <div className="h-48 animate-pulse rounded-lg bg-surface-muted" />
  const points = data.filter((p) => p.variant_key === variantKey)
  if (points.length < 2) {
    return <NotEnough>Precisamos de mais compras desta marca para mostrar a evolução do preço.</NotEnough>
  }
  return <PriceLine points={points} avg={avg} />
}
