import { Avatar } from '@/components/ui/Avatar'
import { formatCurrency } from '@/lib/format'
import { fmtDay, fmtShare } from './domain'
import type { BuyerStat } from './types'
import { Delta, NotEnough, Section } from './ui'

/** Gastos por comprador (campo “Comprado por” de cada compra). */
export function BuyersSection({ buyers, error }: { buyers: BuyerStat[] | null; error: string | null }) {
  return (
    <Section
      title="Por comprador"
      description="Quem fez as compras do período"
      info="Usa o campo “Comprado por” de cada compra (por padrão, quem registrou o comprovante; dá para trocar na tela da compra). A variação compara com o período anterior de mesma duração."
      flush
    >
      {error ? (
        <div className="px-5 pb-5">
          <NotEnough>
            {/PGRST202|42883|function|schema cache/i.test(error)
              ? 'Para ver esta análise, rode a migration 20261119000100_intel_buyers.sql no Supabase.'
              : `Não foi possível carregar: ${error}`}
          </NotEnough>
        </div>
      ) : !buyers ? (
        <div className="mx-5 mb-5 h-24 animate-pulse rounded-lg bg-surface-muted" />
      ) : buyers.length === 0 ? (
        <div className="px-5 pb-5">
          <NotEnough>Nenhuma compra no período.</NotEnough>
        </div>
      ) : (
        <>
          <ul className="divide-y divide-border border-t border-border">
            {buyers.map((b) => (
              <li key={b.user_id ?? 'none'} className="px-5 py-3.5">
                <div className="flex items-center gap-3">
                  <Avatar name={b.user_id ? b.name : null} fallback="?" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-medium">{b.name}</p>
                    <p className="truncate text-[12px] text-fg-muted">
                      {b.purchases} {b.purchases === 1 ? 'compra' : 'compras'} · ticket {formatCurrency(b.avg_ticket)}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-[14px] font-semibold tabular-nums">{formatCurrency(b.total)}</p>
                    <p className="text-[12px] text-fg-subtle tabular-nums">{fmtShare(b.share)}</p>
                  </div>
                </div>
                <div className="mt-2.5 ml-11 h-1.5 rounded-full bg-surface-muted">
                  <div className="h-1.5 rounded-full bg-accent-500" style={{ width: `${Math.max(2, b.share * 100)}%` }} />
                </div>
                <div className="mt-1.5 ml-11 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] text-fg-muted">
                  <Delta pct={b.change_pct} />
                  <span>
                    {b.products} {b.products === 1 ? 'produto' : 'produtos'}
                    {b.top_store && (b.stores > 1 ? ` · mais no ${b.top_store}` : ` · ${b.top_store}`)}
                  </span>
                  <span>última {fmtDay(b.last_date)}</span>
                </div>
              </li>
            ))}
          </ul>
          {buyers.some((b) => !b.user_id) && (
            <p className="border-t border-border px-5 py-2.5 text-[11px] text-fg-subtle">
              “Não informado”: compras sem comprador definido. Abra a compra e escolha em “Comprado por”.
            </p>
          )}
        </>
      )}
    </Section>
  )
}
