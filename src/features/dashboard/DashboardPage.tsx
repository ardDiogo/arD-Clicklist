import { BarChart3, Camera, ChevronRight, Flame, ListChecks, Plus, ReceiptText } from 'lucide-react'
import { Link } from 'react-router'
import { PageHeader } from '@/components/layout/AppShell'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { useAuth } from '@/features/auth/AuthProvider'
import { useCurrentHousehold } from '@/features/household/HouseholdProvider'
import { can } from '@/features/household/roles'
import { StatusDot } from '@/features/inventory/components'
import { formatQty, productSubtitle } from '@/features/inventory/domain'
import { useStock } from '@/features/inventory/hooks'
import { InstallBanner } from '@/features/pwa/components'

function greeting(date = new Date()): string {
  const h = date.getHours()
  if (h < 12) return 'Bom dia'
  if (h < 18) return 'Boa tarde'
  return 'Boa noite'
}

export function DashboardPage() {
  const { user } = useAuth()
  const { household, role } = useCurrentHousehold()
  const { data } = useStock(household.id)
  const firstName = (user?.user_metadata?.full_name as string | undefined)?.split(' ')[0]

  const items = data ?? []
  const restock = items
    .filter((i) => i.to_buy_qty > 0)
    .sort((a, b) => (a.status === 'out' ? 0 : 1) - (b.status === 'out' ? 0 : 1) || b.to_buy_qty - a.to_buy_qty)
  const out = items.filter((i) => i.status === 'out').length
  const totalUnitsToBuy = restock.reduce((sum, i) => sum + i.to_buy_qty, 0)

  return (
    <>
      <PageHeader title={`${greeting()}${firstName ? `, ${firstName}` : ''}`} description={household.name} />
      <InstallBanner />

      {/* Números reais do estoque — sem dados fictícios */}
      <div className="grid grid-cols-3 gap-3 animate-fade-in">
        <Stat label="Produtos" value={data ? String(items.length) : '—'} to="/estoque" />
        <Stat label="Para repor" value={data ? String(restock.length) : '—'} tone={restock.length ? 'warn' : undefined} to="/estoque" />
        <Stat label="Em falta" value={data ? String(out) : '—'} tone={out ? 'danger' : undefined} to="/estoque" />
      </div>

      {data && items.length === 0 && (
        <Card className="mt-5 p-5">
          <p className="text-[15px] font-medium">Comece pelo estoque</p>
          <p className="mt-1 text-[13px] leading-5 text-fg-muted">
            Cadastre os produtos que sua casa costuma ter e quanto quer manter de cada um. O app passa a saber o que falta.
          </p>
          {can.edit(role) && (
            <Link to="/estoque/novo" className="mt-4 inline-block">
              <Button size="sm" icon={<Plus className="size-4" />}>
                Cadastrar primeiro produto
              </Button>
            </Link>
          )}
        </Card>
      )}

      {restock.length > 0 && (
        <Link to="/lista" className="mt-5 block">
          <Card className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-surface-muted/50">
            <div className="grid size-9 place-items-center rounded-lg bg-accent-50 text-accent-700 dark:bg-accent-700/20 dark:text-accent-100">
              <ListChecks className="size-[18px]" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-medium">Abrir lista de compras</p>
              <p className="text-[12px] text-fg-muted">Montada automaticamente com o que falta em casa.</p>
            </div>
            <ChevronRight className="size-4 text-fg-subtle" />
          </Card>
        </Link>
      )}

      <Link to="/churrasco" className="mt-3 block">
        <Card className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-surface-muted/50">
          <div className="grid size-9 place-items-center rounded-lg bg-surface-muted text-fg-muted">
            <Flame className="size-[18px]" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-medium">Churrascômetro</p>
            <p className="text-[12px] text-fg-muted">Quanto comprar de carne, bebida e carvão — e mande direto para a lista.</p>
          </div>
          <ChevronRight className="size-4 text-fg-subtle" />
        </Card>
      </Link>

      {restock.length > 0 && (
        <section className="mt-6">
          <div className="mb-2 flex items-baseline justify-between px-1">
            <h2 className="text-[12px] font-medium tracking-wide text-fg-subtle uppercase">Precisa repor</h2>
            <span className="text-[12px] text-fg-subtle">{formatQty(totalUnitsToBuy)} embalagens no total</span>
          </div>
          <Card className="overflow-hidden">
            <ul className="divide-y divide-border">
              {restock.slice(0, 6).map((i) => {
                const subtitle = productSubtitle(i)
                return (
                  <li key={i.id}>
                    <Link to={`/estoque/${i.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-muted/60">
                      <StatusDot status={i.status} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[14px] font-medium">{i.product_name}</p>
                        {subtitle && <p className="truncate text-[12px] text-fg-muted">{subtitle}</p>}
                      </div>
                      <div className="text-right">
                        <p className="text-[13px] font-semibold text-accent-600 tabular-nums dark:text-accent-500">
                          +{formatQty(i.to_buy_qty)}
                        </p>
                        <p className="text-[11px] text-fg-subtle tabular-nums">
                          {formatQty(i.current_qty)} de {formatQty(i.ideal_qty)}
                        </p>
                      </div>
                    </Link>
                  </li>
                )
              })}
            </ul>
            {restock.length > 6 && (
              <Link to="/estoque" className="flex items-center justify-center gap-1 border-t border-border py-2.5 text-[13px] text-fg-muted hover:text-fg">
                Ver todos ({restock.length}) <ChevronRight className="size-3.5" />
              </Link>
            )}
          </Card>
        </section>
      )}

      {can.edit(role) && (
        <Link to="/compras" className="mt-5 block">
          <Card className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-surface-muted/50">
            <div className="grid size-9 place-items-center rounded-lg bg-surface-muted text-fg-muted">
              <ReceiptText className="size-[18px]" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-medium">Registrar compra</p>
              <p className="text-[12px] text-fg-muted">Foto do cupom fiscal, lida com IA.</p>
            </div>
            <ChevronRight className="size-4 text-fg-subtle" />
          </Card>
        </Link>
      )}

      {can.edit(role) && items.length > 0 && (
        <Link to="/inventario" className="mt-3 block">
          <Card className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-surface-muted/50">
            <div className="grid size-9 place-items-center rounded-lg bg-surface-muted text-fg-muted">
              <Camera className="size-[18px]" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-medium">Conferir por fotos</p>
              <p className="text-[12px] text-fg-muted">Fotografe a despensa e confirme o que a IA encontrou.</p>
            </div>
            <ChevronRight className="size-4 text-fg-subtle" />
          </Card>
        </Link>
      )}

      <Link to="/inteligencia" className="mt-3 block">
        <Card className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-surface-muted/50">
          <div className="grid size-9 place-items-center rounded-lg bg-surface-muted text-fg-muted">
            <BarChart3 className="size-[18px]" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-medium">Inteligência de compras</p>
            <p className="text-[12px] text-fg-muted">Gastos, mercados, preços, produtos e onde dá para economizar.</p>
          </div>
          <ChevronRight className="size-4 text-fg-subtle" />
        </Card>
      </Link>

    </>
  )
}

function Stat({ label, value, tone, to }: { label: string; value: string; tone?: 'warn' | 'danger'; to: string }) {
  return (
    <Link to={to}>
      <Card className="px-4 py-3.5 transition-colors hover:bg-surface-muted/50">
        <p className="text-[12px] text-fg-muted">{label}</p>
        <p
          className={
            'mt-1 text-[24px] leading-none font-semibold tabular-nums ' +
            (tone === 'danger' ? 'text-danger' : tone === 'warn' ? 'text-amber-600 dark:text-amber-400' : 'text-fg')
          }
        >
          {value}
        </p>
      </Card>
    </Link>
  )
}

