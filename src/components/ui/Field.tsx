import { clsx } from 'clsx'
import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react'

const controlClass =
  'h-10 w-full rounded-[10px] border border-border bg-surface px-3 text-[15px] text-fg ' +
  'placeholder:text-fg-subtle shadow-card transition-colors ' +
  'focus:border-accent-500 focus:outline-none focus:ring-3 focus:ring-accent-500/15 ' +
  'disabled:bg-surface-muted disabled:text-fg-muted'

interface FieldShellProps {
  label: string
  hint?: ReactNode
  error?: string | null
  id: string
  children: ReactNode
  trailing?: ReactNode
}

function FieldShell({ label, hint, error, id, children, trailing }: FieldShellProps) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-[13px] font-medium text-fg">
          {label}
        </label>
        {trailing}
      </div>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-[13px] text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-[13px] text-fg-muted">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  hint?: ReactNode
  error?: string | null
  trailing?: ReactNode
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, hint, error, trailing, className, id, ...props },
  ref,
) {
  const autoId = useId()
  const fieldId = id ?? autoId
  return (
    <FieldShell label={label} hint={hint} error={error} id={fieldId} trailing={trailing}>
      <input
        ref={ref}
        id={fieldId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined}
        className={clsx(controlClass, error && 'border-danger', className)}
        {...props}
      />
    </FieldShell>
  )
})

export interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string
  hint?: ReactNode
}

export function SelectField({ label, hint, className, id, children, ...props }: SelectFieldProps) {
  const autoId = useId()
  const fieldId = id ?? autoId
  return (
    <FieldShell label={label} hint={hint} id={fieldId}>
      <select id={fieldId} className={clsx(controlClass, 'appearance-none pr-8', className)} {...props}>
        {children}
      </select>
    </FieldShell>
  )
}
