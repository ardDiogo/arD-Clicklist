import { clsx } from 'clsx'
import { BarChart3, Boxes, House, ListChecks, ReceiptText, Settings, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { NavLink, Outlet } from 'react-router'
import { useHousehold } from '@/features/household/HouseholdProvider'
import { Logo, Wordmark } from './Logo'
import { OfflineBanner } from '@/features/pwa/components'

interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  /** No celular a barra tem 5 posições; itens extras ficam só no menu lateral. */
  desktopOnly?: boolean
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Início', icon: House },
  { to: '/estoque', label: 'Estoque', icon: Boxes },
  { to: '/lista', label: 'Lista', icon: ListChecks },
  { to: '/compras', label: 'Compras', icon: ReceiptText },
  { to: '/financeiro', label: 'Financeiro', icon: BarChart3, desktopOnly: true },
  { to: '/ajustes', label: 'Ajustes', icon: Settings },
]

function HouseholdSwitcher() {
  const { memberships, current, select } = useHousehold()
  if (!current) return null
  if (memberships.length < 2) {
    return <p className="truncate text-[13px] text-fg-muted">{current.household.name}</p>
  }
  return (
    <select
      aria-label="Família"
      value={current.household.id}
      onChange={(e) => select(e.target.value)}
      className="-ml-1 max-w-full truncate rounded-md bg-transparent px-1 py-0.5 text-[13px] text-fg-muted hover:bg-surface-muted focus:outline-none"
    >
      {memberships.map((m) => (
        <option key={m.household.id} value={m.household.id}>
          {m.household.name}
        </option>
      ))}
    </select>
  )
}

export function AppShell() {
  return (
    <div className="min-h-dvh lg:flex">
      <div className="fixed inset-x-0 top-0 z-40">
        <OfflineBanner />
      </div>
      {/* Sidebar — desktop */}
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-border bg-surface/60 px-3 py-5 lg:flex">
        <div className="flex items-center gap-2.5 px-2">
          <Logo size={30} />
          <div className="min-w-0">
            <Wordmark className="block text-[15px] leading-tight" />
            <HouseholdSwitcher />
          </div>
        </div>
        <nav className="mt-8 space-y-0.5" aria-label="Principal">
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                clsx(
                  'flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-[14px] transition-colors',
                  isActive
                    ? 'bg-surface-muted font-medium text-fg'
                    : 'text-fg-muted hover:bg-surface-muted/70 hover:text-fg',
                )
              }
            >
              <Icon className="size-[18px]" strokeWidth={1.75} />
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>

      {/* Header — mobile */}
      <header className="sticky top-0 z-20 flex items-center gap-2.5 border-b border-border bg-bg/85 px-5 pt-[max(env(safe-area-inset-top),0.75rem)] pb-3 backdrop-blur-xl lg:hidden">
        <Logo size={26} />
        <div className="min-w-0 flex-1">
          <HouseholdSwitcher />
        </div>
      </header>

      <main className="min-w-0 flex-1 pb-[calc(env(safe-area-inset-bottom)+5.5rem)] lg:pb-10">
        <div className="mx-auto w-full max-w-3xl px-5 pt-6 lg:px-10 lg:pt-10">
          <Outlet />
        </div>
      </main>

      {/* Tab bar — mobile */}
      <nav
        aria-label="Principal"
        className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-bg/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden"
      >
        <div className="mx-auto grid max-w-md grid-cols-5">
          {NAV_ITEMS.filter((i) => !i.desktopOnly).map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                clsx(
                  'flex h-14 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors',
                  isActive ? 'text-fg' : 'text-fg-subtle',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <Icon className="size-[22px]" strokeWidth={isActive ? 2 : 1.6} />
                  {label}
                </>
              )}
            </NavLink>
          ))}
        </div>
      </nav>

    </div>
  )
}

export function PageHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="mb-6 flex items-end justify-between gap-4 animate-fade-in">
      <div className="min-w-0">
        <h1 className="text-[24px] leading-tight font-semibold tracking-[-0.025em]">{title}</h1>
        {description && <p className="mt-1 text-[14px] text-fg-muted">{description}</p>}
      </div>
      {action}
    </div>
  )
}
