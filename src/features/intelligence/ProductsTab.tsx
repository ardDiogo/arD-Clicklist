import { clsx } from 'clsx'
import { Link } from 'react-router'
import { Segmented } from '@/features/inventory/components'
import { formatCurrency } from '@/lib/format'
import { useState } from 'react'
import { ShareBars } from './charts'
import { fmtDay, fmtQty, overdueProducts, topBy } from './domain'
import type { ProductsData, ProductStat } from './types'
import { NotEnough, Section } from './ui'

function ProductName({ p }: { p: ProductStat }) {
  const text = (
    <>
      <span className="block truncate text-[14px] font-medium">{p.product_name}</span>
      <span className="block truncate text-[12px] text-fg-muted">{[p.brand_name, p.category_name].filter(Boolean).join(' · ')}</span>
    </>
  )
  return p.household_product_id ? (
    <Link to={`/estoque/${p.household_product_id}`} className="min-w-0 flex-1 hover:underline">
      {text}
    </Link>
  ) : (
    <div className="min-w-0 flex-1">{text}</div>
  )
}

type Rank = 'frequencia' | 'quantidade'

export function ProductsTab({ data }: { data: ProductsData }) {
  const [rank, setRank] = useState<Rank>('frequencia')
  const rows = data.products
  if (rows.length === 0) return <NotEnough>Nenhum item comprado no período com os filtros escolhidos.</NotEnough>

  const most = rank === 'frequencia' ? topBy(rows, (p) => p.receipts * 1e6 + p.quantity, 10) : topBy(rows, (p) => p.quantity, 10)
  const heavy = topBy(rows, (p) => p.total, 8)
  const withInterval = topBy(rows, (p) => p.avg_interval_days, 10, 'asc')
  const overdue = overdueProducts(rows)
  const longSince = topBy(rows, (p) => p.days_since_last, 8)
  const idleStock = rows
    .filter((p) => (p.current_qty ?? 0) > 0 && p.consumed === 0 && p.days_since_last >= 45)
    .sort((a, b) => b.days_since_last - a.days_since_last)
    .slice(0, 8)
  const linked = rows.filter((p) => p.household_product_id)

  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-2">
        <Section
          title="Mais comprados"
          description={rank === 'frequencia' ? 'Pelo número de comprovantes em que aparecem' : 'Pela quantidade adquirida'}
          action={
            <Segmented
              label="Ordenar por"
              value={rank}
              onChange={setRank}
              options={[
                { value: 'frequencia', label: 'Frequência' },
                { value: 'quantidade', label: 'Qtd.' },
              ]}
            />
          }
          flush
        >
          <ul className="divide-y divide-border border-t border-border">
            {most.map((p, i) => (
              <li key={p.key} className="flex items-center gap-3 px-5 py-2.5">
                <span className="w-5 shrink-0 text-right text-[12px] text-fg-subtle tabular-nums">{i + 1}</span>
                <ProductName p={p} />
                <div className="shrink-0 text-right text-[12px] text-fg-muted tabular-nums">
                  <span className="block font-medium text-fg">
                    {p.receipts} {p.receipts === 1 ? 'cupom' : 'cupons'}
                  </span>
                  {fmtQty(p.quantity, p.unit)} · {formatCurrency(p.total)}
                </div>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Os que mais pesam no orçamento" description="Valor gasto e participação no total do período" info="Participação = gasto no produto ÷ gasto total dos itens no período.">
          <ShareBars items={heavy.map((p) => ({ key: p.key, name: p.product_name, value: p.total, share: p.share }))} />
        </Section>
      </div>

      <Section
        title="Frequência de reposição"
        description="Intervalo médio entre compras confirmadas do mesmo produto"
        info="Calculado com todo o histórico até o fim do período. É o intervalo entre compras, não o consumo real: o consumo só é conhecido quando registrado no estoque."
        flush
      >
        {withInterval.length === 0 ? (
          <div className="px-5 pb-5">
            <NotEnough>Precisamos de pelo menos duas compras do mesmo produto em datas diferentes para calcular a frequência de reposição.</NotEnough>
          </div>
        ) : (
          <ul className="divide-y divide-border border-t border-border">
            {withInterval.map((p) => {
              const late = overdue.includes(p)
              return (
                <li key={p.key} className="flex items-center gap-3 px-5 py-2.5">
                  <ProductName p={p} />
                  <div className="shrink-0 text-right text-[12px] tabular-nums">
                    <span className="block font-medium">a cada ~{Math.round(p.avg_interval_days ?? 0)} dias</span>
                    <span className={clsx(late ? 'font-medium text-danger' : 'text-fg-muted')}>
                      última há {p.days_since_last} {p.days_since_last === 1 ? 'dia' : 'dias'}
                      {late && ' · atrasado'}
                    </span>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Section>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Há mais tempo sem compra" description="Tempo desde a última compra (histórico completo)" flush>
          <ul className="divide-y divide-border border-t border-border">
            {longSince.map((p) => (
              <li key={p.key} className="flex items-center gap-3 px-5 py-2.5">
                <ProductName p={p} />
                <div className="shrink-0 text-right text-[12px] text-fg-muted tabular-nums">
                  <span className="block font-medium text-fg">{p.days_since_last} dias</span>
                  {p.purchase_days} {p.purchase_days === 1 ? 'compra' : 'compras'} · última {fmtDay(p.last_date)}
                </div>
              </li>
            ))}
          </ul>
        </Section>

        <Section
          title="Parados no estoque"
          description="Com estoque, sem consumo registrado e 45+ dias desde a compra"
          info="Só aparece quando o estoque registrado é maior que zero. Se vocês não registram o consumo, o produto pode já ter sido usado — atualize o estoque para corrigir."
        >
          {idleStock.length === 0 ? (
            <NotEnough>Nenhum produto parado no estoque pelos critérios acima.</NotEnough>
          ) : (
            <ul className="space-y-2">
              {idleStock.map((p) => (
                <li key={p.key} className="flex items-center gap-3">
                  <ProductName p={p} />
                  <span className="shrink-0 text-[12px] text-fg-muted tabular-nums">
                    {fmtQty(p.current_qty ?? 0, p.unit)} · {p.days_since_last} dias
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <Section
        title="Comprado × consumido × em estoque"
        description="Três números diferentes — comprar não significa ter consumido"
        info="Comprado: soma das quantidades nos cupons do período. Consumido: só o que foi registrado como consumo no estoque. Baixa por contagem: reduções feitas no inventário (pode incluir consumo não registrado, perdas ou correções). Estoque: quantidade atual registrada."
        flush
      >
        {linked.length === 0 ? (
          <div className="px-5 pb-5">
            <NotEnough>Associe os itens das compras a produtos do estoque para comparar compra, consumo e estoque.</NotEnough>
          </div>
        ) : (
          <div className="overflow-x-auto border-t border-border">
            <table className="w-full min-w-[520px] text-left text-[13px] tabular-nums">
              <thead className="text-[12px] text-fg-subtle">
                <tr>
                  <th className="px-5 py-2 font-medium">Produto</th>
                  <th className="px-2 py-2 text-right font-medium">Comprado</th>
                  <th className="px-2 py-2 text-right font-medium">Consumido</th>
                  <th className="px-2 py-2 text-right font-medium">Baixa por contagem</th>
                  <th className="px-5 py-2 text-right font-medium">Estoque atual</th>
                </tr>
              </thead>
              <tbody>
                {topBy(linked, (p) => p.total, 15).map((p) => (
                  <tr key={p.key} className="border-t border-border">
                    <td className="max-w-48 truncate px-5 py-2">{p.product_name}</td>
                    <td className="px-2 py-2 text-right">{fmtQty(p.quantity, p.unit)}</td>
                    <td className="px-2 py-2 text-right">{p.consumed > 0 ? p.consumed.toLocaleString('pt-BR') : <span className="text-fg-subtle">—</span>}</td>
                    <td className="px-2 py-2 text-right">{p.counted_down > 0 ? p.counted_down.toLocaleString('pt-BR') : <span className="text-fg-subtle">—</span>}</td>
                    <td className="px-5 py-2 text-right">{p.current_qty !== null ? p.current_qty.toLocaleString('pt-BR') : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="px-5 py-2.5 text-[11px] text-fg-subtle">— = nada registrado no estoque. Sem registro de consumo, não dá para saber quanto foi usado.</p>
          </div>
        )}
      </Section>
    </div>
  )
}
