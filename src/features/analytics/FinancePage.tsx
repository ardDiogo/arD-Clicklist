import { clsx } from 'clsx'
import { ArrowDownRight, ArrowUpRight, BarChart3, Store, TrendingDown, TrendingUp } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { PageHeader } from '@/components/layout/AppShell'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { Alert, EmptyState } from '@/components/ui/feedback'
import { useCurrentHousehold } from '@/features/household/HouseholdProvider'
import { Segmented } from '@/features/inventory/components'
import { productSubtitle } from '@/features/inventory/domain'
import { toMessage } from '@/lib/errors'
import { formatCurrency, formatDate } from '@/lib/format'
import { loadFinance, type FinanceData } from './api'
import { CategoryBars, MonthlyBars } from './charts'
import {
  addMonths,
  categoryBreakdown,
  currentMonthKey,
  fillMonths,
  forecastNextPurchase,
  monthLabel,
  percentChange,
  topPriceChanges,
} from './domain'

type Period = '3' | '6' | '12'

export function FinancePage() {
  const { household } = useCurrentHousehold()
  const [period, setPeriod] = useState<Period>('6')
  const [data, setData] = useState<FinanceData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const thisMonth = currentMonthKey()
  const [selected, setSelected] = useState(thisMonth)

  useEffect(() => {
    let active = true
    setError(null)
    loadFinance(household.id, Number(period))
      .then((d) => active && setData(d))
      .catch((e) => active && setError(toMessage(e)))
    return () => {
      active = false
    }
  }, [household.id, period])

  const series = useMemo(() => (data ? fillMonths(data.monthly, Number(period)) : []), [data, period])
  const breakdown = useMemo(() => (data ? categoryBreakdown(data.categories, selected) : null), [data, selected])
  const forecast = useMemo(() => (data ? forecastNextPurchase(data.purchases) : null), [data])

  const current = series.find((s) => s.month === thisMonth)?.total ?? 0
  const previous = series.find((s) => s.month === addMonths(thisMonth, -1))?.total ?? 0
  const delta = percentChange(current, previous)
  const periodTotal = series.reduce((s, m) => s + Math.round(m.total * 100), 0) / 100
  const periodPurchases = series.reduce((s, m) => s + m.purchases, 0)
  const avgTicket = periodPurchases ? periodTotal / periodPurchases : null
  const monthsWithData = series.filter((s) => s.total > 0).length
  const monthlyAvg = monthsWithData ? periodTotal / monthsWithData : null

  const header = (
    <PageHeader
      title="Financeiro"
      description="Calculado a partir das compras confirmadas."
      action={
        <Segmented
          label="Período"
          value={period}
          onChange={setPeriod}
          options={[
            { value: '3', label: '3m' },
            { value: '6', label: '6m' },
            { value: '12', label: '12m' },
          ]}
        />
      }
    />
  )

  if (error) {
    return (
      <>
        {header}
        <Alert>{error}</Alert>
      </>
    )
  }
  if (!data) {
    return (
      <>
        {header}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl bg-surface-muted" />
          ))}
        </div>
      </>
    )
  }

  const pendingNotice =
    data.pendingDrafts > 0 ? (
      <Link to="/compras" className="mb-5 block">
        <Alert tone="success">
          {data.pendingDrafts === 1
            ? 'Há 1 compra aguardando sua confirmação. Ela só entra nos números depois de confirmada.'
            : `Há ${data.pendingDrafts} compras aguardando sua confirmação. Elas só entram nos números depois de confirmadas.`}{' '}
          <span className="font-semibold underline underline-offset-2">Revisar agora</span>
        </Alert>
      </Link>
    ) : null

  if (data.purchases.length === 0) {
    return (
      <>
        {header}
        {data.pendingDrafts > 0 ? (
          <Card>
            <EmptyState
              icon={BarChart3}
              title={`${data.pendingDrafts} ${data.pendingDrafts === 1 ? 'compra aguardando' : 'compras aguardando'} confirmação`}
              description="Os preços e gastos já foram lidos, mas só entram no Financeiro depois que você confirmar cada compra em Compras → Para revisar."
              action={
                <Link to="/compras">
                  <Button size="sm">Revisar e confirmar</Button>
                </Link>
              }
            />
          </Card>
        ) : (
          <Card>
            <EmptyState
              icon={BarChart3}
              title="Ainda não há compras confirmadas"
              description="Os indicadores aparecem depois que você importar e confirmar comprovantes. Nenhum número é estimado sem dados reais."
              action={
                <Link to="/compras">
                  <Button size="sm">Registrar uma compra</Button>
                </Link>
              }
            />
          </Card>
        )}
      </>
    )
  }

  const nextValue =
    data.openList && data.openList.estimatedTotal > 0
      ? { value: data.openList.estimatedTotal, note: `lista atual${data.openList.withoutPrice ? ` · ${data.openList.withoutPrice} sem preço` : ''}` }
      : avgTicket
        ? { value: avgTicket, note: 'pela média das compras' }
        : null

  return (
    <>
      {header}
      {pendingNotice}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 animate-fade-in">
        <Stat label={`Gasto em ${monthLabel(thisMonth, true).split(' ')[0]}`} value={formatCurrency(current)}>
          {delta !== null && (
            <span className="inline-flex items-center gap-0.5 text-[12px] whitespace-nowrap text-fg-muted">
              {delta > 0 ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
              {delta > 0 ? '+' : ''}
              {delta.toLocaleString('pt-BR')}% vs. {monthLabel(addMonths(thisMonth, -1)).split('/')[0]}
            </span>
          )}
        </Stat>
        <Stat label="Média mensal" value={monthlyAvg ? formatCurrency(monthlyAvg) : '—'}>
          <span className="text-[12px] text-fg-muted">
            {monthsWithData} {monthsWithData === 1 ? 'mês' : 'meses'} com compras
          </span>
        </Stat>
        <Stat label="Valor médio da compra" value={avgTicket ? formatCurrency(avgTicket) : '—'}>
          <span className="text-[12px] text-fg-muted">
            {periodPurchases} {periodPurchases === 1 ? 'compra' : 'compras'} no período
          </span>
        </Stat>
        <Stat label="Próxima compra" value={nextValue ? `≈ ${formatCurrency(nextValue.value)}` : '—'}>
          <span className="text-[12px] text-fg-muted">
            {forecast?.nextDate ? `prevista p/ ${formatDate(forecast.nextDate)}` : 'sem histórico suficiente'}
            {nextValue && <span className="block text-fg-subtle">{nextValue.note}</span>}
          </span>
        </Stat>
      </div>

      <div className="mt-5 space-y-5">
        <Card>
          <CardHeader title="Gasto por mês" description={`Total no período: ${formatCurrency(periodTotal)} · toque em um mês para ver as categorias`} />
          <div className="px-5 pb-5">
            <MonthlyBars data={series} selected={selected} onSelect={setSelected} />
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Gastos por categoria"
            description={`${monthLabel(selected, true)}${breakdown?.total ? ` · ${formatCurrency(breakdown.total)}` : ''}`}
          />
          <div className="px-5 pb-5">
            {breakdown && breakdown.items.length > 0 ? (
              <CategoryBars items={breakdown.items} />
            ) : (
              <p className="text-[14px] text-fg-muted">Nenhuma compra confirmada neste mês.</p>
            )}
          </div>
        </Card>

        <div className="grid gap-5 lg:grid-cols-2">
          <PriceChangesCard rows={data.priceChanges} />
          <StoresCard rows={data.stores} />
        </div>

        <p className="px-1 pb-4 text-[12px] text-fg-subtle">
          Valores de compras confirmadas. A previsão é uma estimativa, não um valor garantido.
        </p>
      </div>
    </>
  )
}

function Stat({ label, value, children }: { label: string; value: string; children?: ReactNode }) {
  return (
    <Card className="px-4 py-3.5">
      <p className="truncate text-[12px] text-fg-muted first-letter:uppercase">{label}</p>
      <p className="mt-1 truncate text-[20px] leading-tight font-semibold tabular-nums">{value}</p>
      <div className="mt-1">{children}</div>
    </Card>
  )
}

function PriceChangesCard({ rows }: { rows: FinanceData['priceChanges'] }) {
  const top = topPriceChanges(rows, 6)
  return (
    <Card>
      <CardHeader title="Maiores variações de preço" description="Último preço pago vs. o anterior, por embalagem." />
      {top.length === 0 ? (
        <p className="px-5 pb-5 text-[14px] text-fg-muted">Aparecem quando o mesmo produto for comprado pelo menos duas vezes.</p>
      ) : (
        <ul className="divide-y divide-border border-t border-border">
          {top.map((r) => {
            const up = (r.variation_pct ?? 0) > 0
            return (
              <li key={r.household_product_id}>
                <Link to={`/estoque/${r.household_product_id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-surface-muted/60">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-medium">{r.product_name}</p>
                    <p className="truncate text-[12px] text-fg-muted">
                      {[productSubtitle({ ...r }), `${formatCurrency(r.previous_price)} → ${formatCurrency(r.last_price)}`].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <span className={clsx('inline-flex items-center gap-1 text-[13px] font-semibold tabular-nums', up ? 'text-danger' : 'text-accent-600')}>
                    {up ? <TrendingUp className="size-4" /> : <TrendingDown className="size-4" />}
                    {up ? '+' : ''}
                    {(r.variation_pct ?? 0).toLocaleString('pt-BR')}%
                    <span className="sr-only">{up ? 'aumento' : 'redução'}</span>
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

function StoresCard({ rows }: { rows: FinanceData['stores'] }) {
  return (
    <Card>
      <CardHeader title="Estabelecimentos" description="Onde a família mais compra." />
      {rows.length === 0 ? (
        <p className="px-5 pb-5 text-[14px] text-fg-muted">Sem compras confirmadas.</p>
      ) : (
        <ul className="divide-y divide-border border-t border-border">
          {rows.map((s) => (
            <li key={s.store_key} className="flex items-center gap-3 px-5 py-3">
              <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface-muted text-fg-muted">
                <Store className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-medium">{s.store_name}</p>
                <p className="text-[12px] text-fg-muted">
                  {s.visits} {s.visits === 1 ? 'compra' : 'compras'} · média {formatCurrency(s.avg_ticket)} · última {formatDate(s.last_visit)}
                </p>
              </div>
              <span className="text-[14px] font-semibold tabular-nums">{formatCurrency(s.total)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
