import { initials } from '@/lib/format'

export function Avatar({ name, fallback }: { name: string | null | undefined; fallback?: string }) {
  return (
    <span
      aria-hidden
      className="grid size-8 shrink-0 place-items-center rounded-full bg-surface-muted text-[12px] font-semibold text-fg-muted ring-1 ring-border"
    >
      {initials(name, fallback)}
    </span>
  )
}
