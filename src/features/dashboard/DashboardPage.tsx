import { Boxes, Camera, ListChecks, ReceiptText, type LucideIcon } from 'lucide-react'
import { Link } from 'react-router'
import { PageHeader } from '@/components/layout/AppShell'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/feedback'
import { useAuth } from '@/features/auth/AuthProvider'
import { useCurrentHousehold } from '@/features/household/HouseholdProvider'

function greeting(date = new Date()): string {
  const h = date.getHours()
  if (h < 12) return 'Bom dia'
  if (h < 18) return 'Boa tarde'
  return 'Boa noite'
}

interface Module {
  icon: LucideIcon
  title: string
  description: string
  phase: number
}

/**
 * Nesta fase ainda não existem produtos/estoque no banco, então o painel não
 * mostra números — apenas o que vem a seguir. Nenhum dado fictício é exibido.
 */
const MODULES: Module[] = [
  { icon: Boxes, title: 'Produtos e estoque', description: 'Cadastre o que sua casa usa e quanto quer manter.', phase: 2 },
  { icon: ListChecks, title: 'Lista automática', description: 'Gerada pela diferença entre o ideal e o que há em casa.', phase: 3 },
  { icon: ReceiptText, title: 'Comprovantes', description: 'QR Code da NFC-e atualiza o estoque após sua confirmação.', phase: 4 },
  { icon: Camera, title: 'Inventário por fotos', description: 'Fotografe os armários para conferir o estoque.', phase: 5 },
]

export function DashboardPage() {
  const { user } = useAuth()
  const { household } = useCurrentHousehold()
  const firstName = (user?.user_metadata?.full_name as string | undefined)?.split(' ')[0]

  return (
    <>
      <PageHeader title={`${greeting()}${firstName ? `, ${firstName}` : ''}`} description={household.name} />

      <Card className="p-5 animate-fade-in">
        <p className="text-[14px] font-medium">Sua família está pronta.</p>
        <p className="mt-1 text-[13px] leading-5 text-fg-muted">
          Convide quem divide as compras com você em{' '}
          <Link to="/ajustes" className="font-medium text-fg underline-offset-4 hover:underline">
            Ajustes
          </Link>
          . Os próximos módulos aparecem aqui conforme forem liberados.
        </p>
      </Card>

      <h2 className="mt-8 mb-3 text-[12px] font-medium tracking-wide text-fg-subtle uppercase">Em construção</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {MODULES.map(({ icon: Icon, title, description, phase }) => (
          <Card key={title} className="flex gap-3 p-4">
            <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface-muted text-fg-muted">
              <Icon className="size-[18px]" strokeWidth={1.75} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-[14px] font-medium">{title}</p>
                <Badge>Fase {phase}</Badge>
              </div>
              <p className="mt-0.5 text-[13px] leading-5 text-fg-muted">{description}</p>
            </div>
          </Card>
        ))}
      </div>
    </>
  )
}
