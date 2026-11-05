import { Navigate, Outlet, useLocation } from 'react-router'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/feedback'
import { FullPageSpinner } from '@/components/ui/Spinner'
import { useAuth } from '@/features/auth/AuthProvider'
import { withNext } from '@/features/auth/redirect'
import { useHousehold } from '@/features/household/HouseholdProvider'
import { toMessage } from '@/lib/errors'
import { WifiOff } from 'lucide-react'

/** Exige sessão; senão redireciona ao login preservando o destino. */
export function RequireAuth() {
  const { session, loading } = useAuth()
  const location = useLocation()
  if (loading) return <FullPageSpinner />
  if (!session) return <Navigate to={withNext('/entrar', location.pathname + location.search)} replace />
  return <Outlet />
}

/** Exige uma família; sem nenhuma, leva ao onboarding. */
export function RequireHousehold() {
  const { current, loading, error, refresh } = useHousehold()
  if (loading) return <FullPageSpinner />
  if (error && !current) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <EmptyState
          icon={WifiOff}
          title="Não foi possível carregar sua família"
          description={toMessage(error)}
          action={<Button variant="secondary" onClick={() => void refresh()}>Tentar novamente</Button>}
        />
      </div>
    )
  }
  if (!current) return <Navigate to="/familia/nova" replace />
  return <Outlet />
}
