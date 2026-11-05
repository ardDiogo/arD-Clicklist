import { clsx } from 'clsx'
import { AlertTriangle, Lightbulb, TrendingDown } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import type { Insight } from './types'
import { NotEnough } from './ui'

const TONE = {
  positive: { icon: TrendingDown, cls: 'bg-accent-50 text-accent-700 dark:bg-accent-700/20 dark:text-accent-100', label: 'Oportunidade' },
  warning: { icon: AlertTriangle, cls: 'bg-danger-soft text-danger', label: 'Atenção' },
  neutral: { icon: Lightbulb, cls: 'bg-surface-muted text-fg-muted', label: 'Observação' },
} as const

export function InsightsTab({ insights }: { insights: Insight[] }) {
  if (insights.length === 0) {
    return (
      <NotEnough>
        Nenhuma observação relevante neste período. Os insights aparecem quando os dados mostram algo concreto — por exemplo, uma variação de preço de 5% ou
        mais, gastos 10% acima do período anterior ou o mesmo produto em mercados diferentes. Nada é sugerido sem dados reais.
      </NotEnough>
    )
  }
  return (
    <div className="space-y-3">
      <p className="px-1 text-[13px] text-fg-muted">
        Observações geradas por regras fixas sobre os números calculados das suas compras confirmadas — sem IA generativa e sem estimativas inventadas.
      </p>
      {insights.map((i) => {
        const t = TONE[i.tone]
        const Icon = t.icon
        return (
          <Card key={i.id} className="px-4 py-4 sm:px-5">
            <div className="flex items-start gap-3">
              <div className={clsx('grid size-9 shrink-0 place-items-center rounded-lg', t.cls)}>
                <Icon className="size-[18px]" />
                <span className="sr-only">{t.label}</span>
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-[15px] leading-snug font-semibold">{i.title}</h3>
                <p className="mt-1 text-[14px] leading-relaxed text-fg-muted">{i.description}</p>
                <dl className="mt-3 grid gap-x-4 gap-y-1 text-[12px] sm:grid-cols-2">
                  <div className="flex gap-1.5">
                    <dt className="text-fg-subtle">Indicador:</dt>
                    <dd className="font-medium tabular-nums">{i.metric}</dd>
                  </div>
                  <div className="flex gap-1.5">
                    <dt className="text-fg-subtle">Período:</dt>
                    <dd>{i.period}</dd>
                  </div>
                  <div className="flex gap-1.5">
                    <dt className="text-fg-subtle">Origem:</dt>
                    <dd>{i.source}</dd>
                  </div>
                  {i.confidence && (
                    <div className="flex gap-1.5">
                      <dt className="text-fg-subtle">Confiança:</dt>
                      <dd className="font-medium">{i.confidence}</dd>
                    </div>
                  )}
                </dl>
              </div>
            </div>
          </Card>
        )
      })}
    </div>
  )
}
