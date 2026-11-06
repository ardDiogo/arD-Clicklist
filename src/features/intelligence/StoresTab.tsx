import { Store } from 'lucide-react'
import { Badge } from '@/components/ui/feedback'
import { formatCurrency } from '@/lib/format'
import { ShareBars } from './charts'
import { fmtDay, fmtPct, prettyVariant, rangeLabel, topBy } from './domain'
import type { StoresData } from './types'
import { NotEnough, Section, Stat } from './ui'

export function StoresTab({ data }: { data: StoresData }) {
  const r = data.ranking
  if (r.length === 0) return <NotEnough>Nenhuma compra confirmada no período com os filtros escolhidos.</NotEnough>

  const mostVisited = topBy(r, (s) => s.visits, 1)[0]
  const mostSpent = r[0]
  const lowestTicket = r.length >= 2 ? topBy(r, (s) => s.avg_ticket, 1, 'asc')[0] : null
  const cheapest = data.price_index.length >= 2 ? data.price_index[0] : null
  const enoughBasket = cheapest && cheapest.compared >= 3
  const windowText = rangeLabel(data.window)

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat small label="Mais frequentado" value={mostVisited?.store_name ?? '—'}>
          <span className="text-[12px] text-fg-muted">
            {mostVisited?.visits} {mostVisited?.visits === 1 ? 'visita' : 'visitas'}
          </span>
        </Stat>
        <Stat small label="Onde mais gastamos" value={mostSpent?.store_name ?? '—'}>
          <span className="text-[12px] text-fg-muted tabular-nums">
            {formatCurrency(mostSpent?.total)} · {Math.round((mostSpent?.share ?? 0) * 100)}%
          </span>
        </Stat>
        <Stat small label="Menor ticket médio" value={lowestTicket?.store_name ?? '—'} info="Valor médio por compra. Não indica preço mais barato — compras menores puxam a média para baixo.">
          <span className="text-[12px] text-fg-muted tabular-nums">{lowestTicket ? formatCurrency(lowestTicket.avg_ticket) : 'exige 2+ mercados'}</span>
        </Stat>
        <Stat
          label="Melhor preço na cesta"
          value={enoughBasket ? cheapest.store_name : '—'}
          info="Compara o último preço do MESMO produto (mesma marca e apresentação) em cada mercado. Não usa o total gasto. Exige 2+ mercados e 3+ produtos em comum."
        >
          <span className="text-[12px] text-fg-muted">
            {enoughBasket ? `${cheapest.wins} de ${cheapest.compared} produtos mais baratos` : 'dados insuficientes'}
          </span>
        </Stat>
      </div>

      <Section title="Gastos por mercado" description="Visitas, total gasto e participação no período" flush>
        <div className="px-5 pb-4">
          <ShareBars
            items={r.map((s) => ({
              key: s.store_key,
              name: s.store_name,
              value: s.total,
              share: s.share,
              note: `${s.visits} ${s.visits === 1 ? 'visita' : 'visitas'}`,
            }))}
          />
        </div>
        <div className="overflow-x-auto border-t border-border">
          <table className="w-full min-w-[480px] text-left text-[13px] tabular-nums">
            <thead className="text-[12px] text-fg-subtle">
              <tr>
                <th className="px-5 py-2 font-medium">Mercado</th>
                <th className="px-2 py-2 text-right font-medium">Visitas</th>
                <th className="px-2 py-2 text-right font-medium">Ticket médio</th>
                <th className="px-5 py-2 text-right font-medium">Última</th>
              </tr>
            </thead>
            <tbody>
              {r.map((s) => (
                <tr key={s.store_key} className="border-t border-border">
                  <td className="max-w-56 truncate px-5 py-2">{s.store_name}</td>
                  <td className="px-2 py-2 text-right">{s.visits}</td>
                  <td className="px-2 py-2 text-right">{formatCurrency(s.avg_ticket)}</td>
                  <td className="px-5 py-2 text-right">{fmtDay(s.last_visit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section
        title="Comparador de preços"
        description={`Mesmo produto em mercados diferentes · preços de ${windowText}`}
        info="Compara a MESMA marca/apresentação (mesmo código de barras ou mesma descrição na nota) em mercados diferentes. Usa o último preço líquido pago em cada mercado, já com desconto. A janela tem no mínimo os últimos 90 dias."
        flush
      >
        {data.stores_with_prices < 2 ? (
          <div className="px-5 pb-5">
            <NotEnough>
              Todas as compras com produtos associados são de um único mercado. Para comparar preços, registre compras em pelo menos dois mercados diferentes.
            </NotEnough>
          </div>
        ) : data.basket.length === 0 ? (
          <div className="px-5 pb-5">
            <NotEnough>Ainda não há produtos iguais comprados em mercados diferentes. A comparação aparece assim que o mesmo produto for comprado em dois mercados.</NotEnough>
          </div>
        ) : (
          <ul className="divide-y divide-border border-t border-border">
            {data.basket.slice(0, 25).map((b) => (
              <li key={`${b.variant_label}-${b.unit}`} className="px-5 py-3">
                <div className="mb-1.5 flex items-baseline justify-between gap-3">
                  <p className="min-w-0 truncate text-[14px] font-medium">
                    {b.product_name}
                    <span className="block truncate text-[12px] font-normal text-fg-muted">{prettyVariant(b.variant_label)}</span>
                  </p>
                  <span className="shrink-0 text-[12px] text-fg-muted tabular-nums">diferença {fmtPct(b.spread_pct, false)}</span>
                </div>
                <ul className="space-y-1">
                  {b.prices.map((p) => (
                    <li key={p.store_key} className="flex items-center gap-2 text-[13px] tabular-nums">
                      <span className="min-w-0 flex-1 truncate text-fg-muted">{p.store_name}</span>
                      <span className="text-[11px] text-fg-subtle">{fmtDay(p.date, false)}</span>
                      <span className={p.store_key === b.best_store_key ? 'font-semibold' : ''}>
                        {formatCurrency(p.price)}
                        <span className="text-[11px] font-normal text-fg-subtle">/{b.unit.toLowerCase()}</span>
                      </span>
                      {p.store_key === b.best_store_key && <Badge tone="accent">Melhor</Badge>}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section
          title="Ranking de mercados mais econômicos"
          description="Pela cesta de produtos comparáveis"
          info="Índice = média de (preço no mercado ÷ menor preço encontrado) nos produtos comparáveis. 1,00 = sempre o mais barato."
        >
          {data.price_index.length < 2 ? (
            <NotEnough>Precisamos de compras em pelo menos 2 mercados com produtos em comum para montar o ranking.</NotEnough>
          ) : (
            <>
              <ol className="space-y-2.5">
                {data.price_index.map((s, i) => (
                  <li key={s.store_key} className="flex items-center gap-3">
                    <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-surface-muted text-[12px] font-semibold tabular-nums">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] font-medium">{s.store_name}</p>
                      <p className="text-[12px] text-fg-muted">
                        mais barato em {s.wins} de {s.compared} {s.compared === 1 ? 'produto' : 'produtos'}
                      </p>
                    </div>
                    <span className="shrink-0 text-[13px] tabular-nums">{s.index === 1 ? 'menor preço' : `+${fmtPct((s.index - 1) * 100, false)}`}</span>
                  </li>
                ))}
              </ol>
              {data.price_index[0] && data.price_index[0].compared < 3 && (
                <p className="mt-3 text-[12px] text-fg-muted">Confiança baixa: poucos produtos em comum entre os mercados.</p>
              )}
            </>
          )}
        </Section>

        <Section
          title="Onde poderíamos economizar"
          description="Economia potencial no período (hipotética)"
          info="Para cada compra, compara com o menor preço do mesmo produto em OUTRO mercado até 90 dias antes ou depois. É uma estimativa, não dinheiro economizado."
        >
          {data.savings.length === 0 ? (
            <NotEnough>
              {data.stores_with_prices < 2
                ? 'Com compras em um único mercado não há com o que comparar.'
                : 'Nenhum produto foi comprado mais caro do que em outro mercado no período.'}
            </NotEnough>
          ) : (
            <ul className="space-y-2.5">
              {data.savings.slice(0, 8).map((s) => (
                <li key={`${s.variant_label}-${s.unit}`} className="flex items-center gap-3">
                  <div className="grid size-7 shrink-0 place-items-center rounded-lg bg-surface-muted text-fg-muted">
                    <Store className="size-3.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-medium">{s.product_name}</p>
                    <p className="truncate text-[12px] text-fg-muted">
                      {prettyVariant(s.variant_label, 36)} · {s.best_store_name}: {formatCurrency(s.best_price)}
                    </p>
                  </div>
                  <span className="shrink-0 text-[13px] font-semibold text-accent-600 tabular-nums">{formatCurrency(s.saving)}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  )
}
