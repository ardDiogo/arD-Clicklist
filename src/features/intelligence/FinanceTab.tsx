import { clsx } from 'clsx'
import { ChevronRight, Sparkles } from 'lucide-react'
import { formatCurrency } from '@/lib/format'
import { SpendSeries, ShareBars, TicketBars } from './charts'
import { bucketLabel, fmtDay, fmtPct, pctChange, rangeLabel } from './domain'
import type { Insight, Overview } from './types'
import { Delta, NotEnough, Section, Stat } from './ui'

export function FinanceTab({
  data,
  forecast,
  insights,
  onOpenInsights,
  itemFilter,
}: {
  data: Overview
  forecast: { value: number; min: number; max: number; months: number } | null
  insights: Insight[] | null
  onOpenInsights: () => void
  itemFilter: boolean
}) {
  const k = data.kpis
  const p = data.previous_kpis
  const prevLabel = `${fmtDay(data.previous.from)} a ${fmtDay(data.previous.to)}`

  if (k.purchases === 0) {
    return (
      <NotEnough>
        Nenhuma compra confirmada entre {rangeLabel(data.period)}
        {itemFilter ? ' com os filtros escolhidos' : ''}. Escolha um período maior ou limpe os filtros.
        {p.purchases > 0 && ` No período anterior (${prevLabel}) foram ${p.purchases} ${p.purchases === 1 ? 'compra' : 'compras'}.`}
      </NotEnough>
    )
  }

  const outliers = data.tickets.filter((t) => t.outlier).length

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat
          label="Total gasto"
          value={formatCurrency(k.total)}
          info={
            itemFilter
              ? 'Soma dos itens que atendem aos filtros, nas compras confirmadas do período.'
              : 'Soma do valor pago em cada comprovante confirmado do período. Rascunhos não entram.'
          }
        >
          <Delta pct={pctChange(k.total, p.total)} />
        </Stat>
        <Stat label="Compras" value={k.purchases.toLocaleString('pt-BR')} info="Comprovantes confirmados no período.">
          <Delta pct={pctChange(k.purchases, p.purchases)} goodWhenDown={false} />
        </Stat>
        <Stat label="Ticket médio" value={formatCurrency(k.avg_ticket)} info="Total gasto dividido pelo número de compras.">
          <Delta pct={pctChange(k.avg_ticket, p.avg_ticket)} />
        </Stat>
        <Stat
          label="Economia potencial"
          value={data.savings.products > 0 ? formatCurrency(data.savings.total) : '—'}
          info="Hipotética: quanto teria custado a menos se cada produto tivesse sido comprado pelo menor preço visto em outro mercado (até 90 dias de diferença). Não é dinheiro economizado."
        >
          <span className="text-[12px] text-fg-muted">
            {data.savings.products > 0
              ? `em ${data.savings.products} ${data.savings.products === 1 ? 'produto' : 'produtos'}`
              : k.stores < 2
                ? 'exige compras em 2+ mercados'
                : 'nenhum preço menor encontrado'}
          </span>
        </Stat>
        <Stat label="Mercados visitados" value={k.stores.toLocaleString('pt-BR')} info="Estabelecimentos diferentes (pelo CNPJ ou pelo nome).">
          <Delta pct={pctChange(k.stores, p.stores)} goodWhenDown={false} />
        </Stat>
        <Stat
          label="Produtos diferentes"
          value={k.products.toLocaleString('pt-BR')}
          info="Produtos distintos comprados no período. Itens não associados contam pela descrição."
        >
          <span className="text-[12px] text-fg-muted">{k.items} itens nos cupons</span>
        </Stat>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-border bg-surface px-4 py-3.5 shadow-card">
          <p className="text-[12px] text-fg-muted">Próximo mês (estimativa)</p>
          {forecast ? (
            <>
              <p className="mt-1 text-[20px] leading-tight font-semibold tabular-nums">≈ {formatCurrency(forecast.value)}</p>
              <p className="mt-1 text-[12px] text-fg-muted">
                Média dos últimos {forecast.months} meses fechados · variou de {formatCurrency(forecast.min)} a {formatCurrency(forecast.max)}
              </p>
            </>
          ) : (
            <p className="mt-1 text-[13px] text-fg-muted">Precisamos de pelo menos 2 meses completos com compras para estimar o próximo mês.</p>
          )}
        </div>
        <button
          type="button"
          onClick={onOpenInsights}
          className="flex items-start gap-3 rounded-xl border border-border bg-surface px-4 py-3.5 text-left shadow-card transition-colors hover:bg-surface-muted/50"
        >
          <Sparkles className="mt-0.5 size-4 shrink-0 text-accent-600" />
          <span className="min-w-0 flex-1">
            <span className="block text-[12px] text-fg-muted">Insights do arD</span>
            <span className="mt-0.5 block text-[14px] leading-snug font-medium">
              {insights === null ? 'Calculando…' : insights[0]?.title ?? 'Sem observações relevantes neste período'}
            </span>
            {insights && insights.length > 1 && <span className="mt-0.5 block text-[12px] text-fg-muted">+{insights.length - 1} observações</span>}
          </span>
          <ChevronRight className="size-4 shrink-0 self-center text-fg-subtle" />
        </button>
      </div>

      <Section
        title="Evolução dos gastos"
        description={`Por ${data.granularity === 'day' ? 'dia' : data.granularity === 'week' ? 'semana' : 'mês'} · ${formatCurrency(k.total)} no período, ${formatCurrency(p.total)} no anterior`}
        info={`Barras: período escolhido. Traço cinza: ponto equivalente do período anterior (${prevLabel}).`}
      >
        <SpendSeries data={data.series} granularity={data.granularity} />
        <TrendNote series={data.series} granularity={data.granularity} />
      </Section>

      <Section
        title="Gastos por categoria"
        description="Soma dos itens pela categoria do produto"
        info="Itens que ainda não foram ligados a um produto aparecem como “Não associados”. A variação compara com o período anterior de mesma duração."
      >
        {data.categories.filter((c) => c.total > 0).length === 0 ? (
          <NotEnough>Sem itens no período.</NotEnough>
        ) : (
          <>
            <ShareBars
              items={data.categories
                .filter((c) => c.total > 0)
                .map((c) => ({
                  key: c.name,
                  name: c.name,
                  value: c.total,
                  share: c.share,
                  note: c.change_pct !== null ? fmtPct(c.change_pct) : c.prev_total === 0 ? 'novo' : undefined,
                }))}
            />
            <p className="mt-3 text-[11px] text-fg-subtle">Ao lado do nome: variação contra o período anterior.</p>
          </>
        )}
      </Section>

      <Section
        title="Ticket médio por compra"
        description={outliers > 0 ? `${outliers} ${outliers === 1 ? 'compra' : 'compras'} fora do padrão` : 'Valor de cada compra no período'}
        info="Uma compra é marcada como fora do padrão quando passa do 3º quartil + 1,5 × o intervalo interquartil das compras do período (precisa de pelo menos 4 compras)."
      >
        <TicketBars tickets={data.tickets} avg={k.avg_ticket} />
        {data.tickets.length < 4 && <p className="mt-2 text-[12px] text-fg-muted">Com menos de 4 compras não dá para identificar compras fora do padrão.</p>}
      </Section>
    </div>
  )
}

/** Tendência simples: compara a média da 1ª metade com a 2ª metade da série. */
function TrendNote({ series, granularity }: { series: Overview['series']; granularity: Overview['granularity'] }) {
  const withData = series.filter((s) => s.total > 0)
  if (withData.length < 4) {
    return <p className="mt-3 text-[12px] text-fg-muted">Ainda há poucas compras no período para identificar uma tendência.</p>
  }
  const half = Math.floor(series.length / 2)
  const sum = (xs: Overview['series']) => xs.reduce((s, x) => s + x.total, 0)
  const a = sum(series.slice(0, half))
  const b = sum(series.slice(half))
  const pct = pctChange(b, a)
  if (pct === null) return null
  const first = series[half]
  return (
    <p className={clsx('mt-3 text-[12px]', Math.abs(pct) < 10 ? 'text-fg-muted' : pct > 0 ? 'text-danger' : 'text-accent-600')}>
      {Math.abs(pct) < 10
        ? 'Gastos estáveis ao longo do período.'
        : `Tendência de ${pct > 0 ? 'alta' : 'queda'}: ${fmtPct(pct)} na segunda metade do período${first ? ` (a partir de ${bucketLabel(first.bucket, granularity, true)})` : ''}.`}
    </p>
  )
}
