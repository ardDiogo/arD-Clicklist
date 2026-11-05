import { useEffect, useRef, type ReactNode } from 'react'

/** Diálogo modal acessível (bottom sheet no celular, centralizado no desktop). */
export function Dialog({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (open && !el.open) el.showModal()
    if (!open && el.open) el.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      aria-label={title}
      className="m-0 mt-auto w-full max-w-none bg-transparent p-0 backdrop:bg-black/40 backdrop:backdrop-blur-[2px] sm:m-auto sm:max-w-md"
    >
      <div className="rounded-t-2xl border border-border bg-surface p-5 pb-[max(env(safe-area-inset-bottom),1.25rem)] text-fg shadow-xl animate-fade-in sm:rounded-2xl">
        <h2 className="text-[17px] font-semibold tracking-[-0.01em]">{title}</h2>
        <div className="mt-3">{children}</div>
      </div>
    </dialog>
  )
}
