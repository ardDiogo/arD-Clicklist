import { clsx } from 'clsx'
import { BarChart3 } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import { Link } from 'react-router'
import { PageHeader } from '@/components/layout/AppShell'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Alert, EmptyState } from '@/components/ui/feedback'
import { useCurrentHousehold } from '@/features/household/HouseholdProvider'
import { getBuyers, getFilterOptions, getMonthlyTotals, getOverview, getPrices, getProducts, getStores } from './api'
import { addMonthsDate, buildInsights, forecastNextMonth, todayBR } from './domain'
import { FilterBar } from './FilterBar'
import { FinanceTab } from './FinanceTab'
import { clearIntelCache, useIntelQuery, useIntelState, type Tab } from './hooks'
import { InsightsTab } from './InsightsTab'
import { PricesTab } from './PricesTab'
import { ProductsTab } from './ProductsTab'
import { StoresTab } from './StoresTab'
import { TabError, TabSkeleton } from './ui'

const TAB_LABEL: Record<Tab, string> = {
  financeiro: 'Financeiro',
  mercados: 'Mercados',
  produtos: 'Produtos',
  precos: 'Preços',
  insights: 'Insights',
}

export function IntelligencePage() {
  const { household } = useCurrentHousehold()
  const state = useIntelState()
  const { filters, range, tab } = state
  const hh = household.id

  // Dados frescos a cada visita à tela; o cache só evita refazer consultas ao trocar de aba.
  useEffect(() => () => clearIntelCache(), [])

  const fkey = `${hh}:${range.from}:${range.to}:${filters.store ?? ''}:${filters.category ?? ''}:${filters.product ?? ''}:${filters.brand ?? ''}`
  const options = useIntelQuery(`opts:${hh}`, () => getFilterOptions(hh))
  const ready = !!options.data && options.data.confirmed > 0
  const overview = useIntelQuery(ready ? `ov:${fkey}` : null, () => getOverview(hh, range, filters))
  const stores = useIntelQuery(ready ? `st:${fkey}` : null, () => getStores(hh, range, filters))
  const products = useIntelQuery(ready ? `pr:${fkey}` : null, () => getProducts(hh, range, filters))
  const prices = useIntelQuery(ready ? `pc:${fkey}` : null, () => getPrices(hh, range, filters))
  const buyers = useIntelQuery(ready ? `by:${fkey}` : null, () => getBuyers(hh, range, filters))
  const monthly = useIntelQuery(ready ? `mo:${hh}` : null, () => getMonthlyTotals(hh, `${addMonthsDate(todayBR(), -7).slice(0, 7)}-01`))

  const allLoaded = overview.data && stores.data && products.data && prices.data
  const insights = useMemo(
    () => (allLoaded ? buildInsights({ range, overview: overview.data, stores: stores.data, products: products.data, prices: prices.data, buyers: buyers.data }) : null),
    [allLoaded, range, overview.data, stores.data, products.data, prices.data, buyers.data],
  )
  const forecast = useMemo(() => (monthly.data ? forecastNextMonth(monthly.data) : null), [monthly.data])
  const itemFilter = !!(filters.category || filters.product || filters.brand)

  const header = <PageHeader title="Inteligência de compras" description="Onde a família gasta, como compra e onde pode economizar — só com dados reais." />

  if (options.error) {
    return (
      <>
        {header}
        <TabError error={options.error} />
      </>
    )
  }
  if (!options.data) {
    return (
      <>
        {header}
        <TabSkeleton />
      </>
    )
  }
  if (options.data.confirmed === 0) {
    const drafts = options.data.drafts
    return (
      <>
        {header}
        <Card>
          <EmptyState
            icon={BarChart3}
            title={drafts > 0 ? `${drafts} ${drafts === 1 ? 'compra aguardando' : 'compras aguardando'} confirmação` : 'Ainda não há compras confirmadas'}
            description={
              drafts > 0
                ? 'As análises usam apenas compras confirmadas. Confirme cada compra em Compras → Para revisar.'
                : 'As análises aparecem depois que você importar e confirmar comprovantes. Nenhum número é estimado sem dados reais.'
            }
            action={
              <Link to="/compras">
                <Button size="sm">{drafts > 0 ? 'Revisar e confirmar' : 'Registrar uma compra'}</Button>
              </Link>
            }
          />
        </Card>
      </>
    )
  }

  const tabContent = () => {
    switch (tab) {
      case 'financeiro':
        return overview.error ? (
          <TabError error={overview.error} />
        ) : !overview.data ? (
          <TabSkeleton />
        ) : (
          <FinanceTab data={overview.data} buyers={buyers.data} buyersError={buyers.error} forecast={forecast} insights={insights} onOpenInsights={() => state.setTab('insights')} itemFilter={itemFilter} />
        )
      case 'mercados':
        return stores.error ? <TabError error={stores.error} /> : !stores.data ? <TabSkeleton /> : <StoresTab data={stores.data} />
      case 'produtos':
        return products.error ? <TabError error={products.error} /> : !products.data ? <TabSkeleton /> : <ProductsTab data={products.data} />
      case 'precos':
        return prices.error ? (
          <TabError error={prices.error} />
        ) : !prices.data ? (
          <TabSkeleton />
        ) : (
          <PricesTab key={fkey} data={prices.data} householdId={hh} range={range} />
        )
      case 'insights': {
        const err = overview.error ?? stores.error ?? products.error ?? prices.error
        return err ? <TabError error={err} /> : !insights ? <TabSkeleton /> : <InsightsTab insights={insights} />
      }
    }
  }

  return (
    <>
      {header}
      {options.data.drafts > 0 && (
        <Link to="/compras" className="mb-4 block">
          <Alert tone="success">
            {options.data.drafts === 1 ? 'Há 1 compra aguardando confirmação.' : `Há ${options.data.drafts} compras aguardando confirmação.`} Ela
            {options.data.drafts === 1 ? '' : 's'} só {options.data.drafts === 1 ? 'entra' : 'entram'} nas análises depois de confirmada
            {options.data.drafts === 1 ? '' : 's'}. <span className="font-semibold underline underline-offset-2">Revisar</span>
          </Alert>
        </Link>
      )}

      <FilterBar
        filters={filters}
        range={range}
        options={options.data}
        onPreset={state.setPreset}
        onCustom={state.setCustom}
        onDimension={state.setDimension}
        onClear={state.clearDimensions}
      />

      <nav aria-label="Áreas da análise" className="sticky top-0 z-20 -mx-4 mb-5 border-b border-border bg-bg/90 px-4 backdrop-blur sm:mx-0 sm:px-0">
        <div role="tablist" className="flex gap-0.5 overflow-x-auto sm:gap-1 [scrollbar-width:none]">
          {(Object.keys(TAB_LABEL) as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              onClick={() => state.setTab(t)}
              className={clsx(
                '-mb-px shrink-0 grow border-b-2 px-1.5 py-2.5 text-[13px] font-medium sm:grow-0 sm:px-3 sm:text-[14px] whitespace-nowrap transition-colors',
                tab === t ? 'border-fg text-fg' : 'border-transparent text-fg-muted hover:text-fg',
              )}
            >
              {TAB_LABEL[t]}
              {t === 'insights' && insights && insights.length > 0 && (
                <span className="ml-1.5 hidden rounded-full bg-accent-500 px-1.5 py-px text-[11px] font-semibold text-white tabular-nums sm:inline">{insights.length}</span>
              )}
            </button>
          ))}
        </div>
      </nav>

      <div role="tabpanel" aria-label={TAB_LABEL[tab]} className="animate-fade-in pb-6">
        {tabContent()}
      </div>
    </>
  )
}
