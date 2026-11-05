import { clsx } from 'clsx'
import { AlertCircle, CheckCircle2, Undo2 } from 'lucide-react'
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'

type Tone = 'success' | 'error'

interface Toast {
  id: number
  tone: Tone
  message: string
  action?: { label: string; onClick: () => void }
}

interface ToastApi {
  show: (message: string, opts?: { tone?: Tone; action?: Toast['action'] }) => void
  error: (message: string) => void
}

const ToastContext = createContext<ToastApi | null>(null)

/** Feedback discreto para ações rápidas (ex.: "−1 Ketchup"). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), [])

  const show = useCallback<ToastApi['show']>(
    (message, opts) => {
      const id = nextId.current++
      setToasts((t) => [...t.slice(-2), { id, message, tone: opts?.tone ?? 'success', action: opts?.action }])
      setTimeout(() => dismiss(id), opts?.action ? 5000 : 2800)
    },
    [dismiss],
  )

  const api = useMemo<ToastApi>(() => ({ show, error: (m) => show(m, { tone: 'error' }) }), [show])

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-4 bottom-[calc(env(safe-area-inset-bottom)+5rem)] z-40 flex flex-col items-center gap-2 lg:bottom-6"
      >
        {toasts.map((t) => {
          const Icon = t.tone === 'error' ? AlertCircle : CheckCircle2
          return (
            <div
              key={t.id}
              role={t.tone === 'error' ? 'alert' : 'status'}
              className="pointer-events-auto flex max-w-sm items-center gap-2.5 rounded-xl bg-fg py-2.5 pr-2 pl-3.5 text-[13px] text-bg shadow-lg animate-fade-in"
            >
              <Icon className={clsx('size-4 shrink-0', t.tone === 'error' ? 'text-red-400' : 'text-accent-500')} />
              <span className="flex-1">{t.message}</span>
              {t.action && (
                <button
                  type="button"
                  onClick={() => {
                    t.action?.onClick()
                    dismiss(t.id)
                  }}
                  className="inline-flex items-center gap-1 rounded-lg px-2 py-1 font-medium text-bg/90 hover:bg-bg/10"
                >
                  <Undo2 className="size-3.5" />
                  {t.action.label}
                </button>
              )}
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast deve ser usado dentro de <ToastProvider>')
  return ctx
}
