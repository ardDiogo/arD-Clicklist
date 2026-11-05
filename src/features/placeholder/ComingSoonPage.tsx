import type { LucideIcon } from 'lucide-react'
import { PageHeader } from '@/components/layout/AppShell'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/feedback'

/** Tela honesta para módulos ainda não implementados — sem dados simulados. */
export function ComingSoonPage({
  title,
  icon,
  phase,
  description,
}: {
  title: string
  icon: LucideIcon
  phase: number
  description: string
}) {
  return (
    <>
      <PageHeader title={title} />
      <Card>
        <EmptyState icon={icon} title={`Chega na Fase ${phase}`} description={description} />
      </Card>
    </>
  )
}
