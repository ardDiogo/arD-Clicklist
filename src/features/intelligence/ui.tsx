import { clsx } from 'clsx'
import { ArrowDownRight, ArrowUpRight, Info, Minus } from 'lucide-react'
import { useId, useState, type ReactNode } from 'react'
import { Card, CardHeader } from '@/components/ui/Card'
import { Alert } from '@/components/ui/feedback'
import { fmtPct } from './domain'

/** Ícone "i" que abre uma explicação curta (funciona no toque, não só no hover). */
export function InfoTip({ children, label = 'Como é calculado' }: { children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  return (
    <span className="relative inline-flex align-middle">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        onBlur={() => setOpen(false)}
        className="grid size-5 place-items-center rounded-full text-fg-subtle hover:text-fg"
      >
        <Info className="size-3.5" />
      </button>
      {open && (
        <span
          id={id}
          role="tooltip"
          className="absolute top-6 left-1/2 z-30 w-60 -translate-x-1/2 rounded-lg border border-border bg-surface p-3 text-left text-[12px] leading-relaxed font-normal text-fg-muted shadow-lg"
        >
          {children}
        </span>
      )}
    </span>
  )
}

/** Variação vs. período anterior. `goodWhenDown` para gastos (cair é bom). */
export function Delta({ pct, goodWhenDown = true, suffix = 'vs. anterior' }: { pct: number | null; goodWhenDown?: boolean; suffix?: string }) {
  if (pct === null) return <span className="text-[12px] text-fg-subtle">sem comparação</span>
  const up = pct > 0
  const good = pct === 0 ? null : goodWhenDown ? !up : up
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-0.5 text-[12px] whitespace-nowrap tabular-nums',
        good === null ? 'text-fg-muted' : good ? 'text-accent-600' : 'text-danger',
      )}
    >
      {pct === 0 ? <Minus className="size-3.5" /> : up ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
      {fmtPct(pct)} <span className="text-fg-subtle">{suffix}</span>
    </span>
  )
}

export function Stat({
  label,
  value,
  info,
  small,
  children,
}: {
  label: string
  value: ReactNode
  info?: ReactNode
  /** Texto (ex.: nome do mercado) em vez de número: fonte menor, até 2 linhas. */
  small?: boolean
  children?: ReactNode
}) {
  return (
    <Card className="min-w-0 px-4 py-3.5">
      <p className="flex items-center gap-1 text-[12px] text-fg-muted">
        <span className="truncate">{label}</span>
        {info && <InfoTip>{info}</InfoTip>}
      </p>
      <p className={clsx('mt-1 leading-tight font-semibold', small ? 'line-clamp-2 text-[16px]' : 'truncate text-[20px] tabular-nums')}>{value}</p>
      <div className="mt-1 min-h-4">{children}</div>
    </Card>
  )
}

export function Section({
  title,
  description,
  info,
  action,
  children,
  flush,
}: {
  title: string
  description?: ReactNode
  info?: ReactNode
  action?: ReactNode
  children: ReactNode
  flush?: boolean
}) {
  return (
    <Card>
      <CardHeader
        title={
          <span className="inline-flex items-center gap-1">
            {title}
            {info && <InfoTip>{info}</InfoTip>}
          </span>
        }
        description={description}
        action={action}
      />
      <div className={flush ? '' : 'px-5 pb-5'}>{children}</div>
    </Card>
  )
}

/** Mensagem contextual quando faltam dados — nunca um gráfico vazio sem explicação. */
export function NotEnough({ children }: { children: ReactNode }) {
  return <p className="rounded-lg bg-surface-muted/60 px-4 py-3 text-[13px] leading-relaxed text-fg-muted">{children}</p>
}

export function TabSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Carregando">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-xl bg-surface-muted" />
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-xl bg-surface-muted" />
    </div>
  )
}

export function TabError({ error }: { error: string }) {
  return (
    <Alert>
      Não foi possível carregar esta análise: {error}
      {/função|function|does not exist|schema cache/i.test(error) && ' — rode a migration 20261118000100_purchase_intelligence.sql no Supabase.'}
    </Alert>
  )
}
