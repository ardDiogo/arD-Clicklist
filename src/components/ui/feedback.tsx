import { clsx } from 'clsx'
import { AlertCircle, CheckCircle2, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

export function Alert({
  tone = 'error',
  children,
  className,
}: {
  tone?: 'error' | 'success'
  children: ReactNode
  className?: string
}) {
  const Icon = tone === 'error' ? AlertCircle : CheckCircle2
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={clsx(
        'flex gap-2.5 rounded-[10px] px-3 py-2.5 text-[13px] leading-5 animate-fade-in',
        tone === 'error' ? 'bg-danger-soft text-danger' : 'bg-accent-50 text-accent-700 dark:bg-accent-700/15 dark:text-accent-100',
        className,
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" strokeWidth={2} />
      <div>{children}</div>
    </div>
  )
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon
  title: string
  description?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <div className="grid size-11 place-items-center rounded-xl border border-border bg-surface-muted text-fg-muted">
        <Icon className="size-5" strokeWidth={1.75} />
      </div>
      <h3 className="mt-4 text-[15px] font-semibold text-fg">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-[13px] leading-5 text-fg-muted">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'accent' }) {
  return (
    <span
      className={clsx(
        'inline-flex h-5 items-center rounded-md px-1.5 text-[11px] font-medium',
        tone === 'accent'
          ? 'bg-accent-50 text-accent-700 dark:bg-accent-700/20 dark:text-accent-100'
          : 'bg-surface-muted text-fg-muted',
      )}
    >
      {children}
    </span>
  )
}
