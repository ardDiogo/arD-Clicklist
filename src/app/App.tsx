import { ListChecks, ReceiptText } from 'lucide-react'
import { createBrowserRouter, Navigate, Outlet, RouterProvider } from 'react-router'
import { AppShell } from '@/components/layout/AppShell'
import { ToastProvider } from '@/components/ui/Toast'
import { AuthProvider } from '@/features/auth/AuthProvider'
import { ForgotPasswordPage, LoginPage, ResetPasswordPage, SignupPage } from '@/features/auth/pages'
import { DashboardPage } from '@/features/dashboard/DashboardPage'
import { HouseholdProvider } from '@/features/household/HouseholdProvider'
import { AcceptInvitePage, CreateHouseholdPage } from '@/features/household/pages'
import { ProductFormPage } from '@/features/inventory/ProductFormPage'
import { StockItemPage } from '@/features/inventory/StockItemPage'
import { StockPage } from '@/features/inventory/StockPage'
import { ComingSoonPage } from '@/features/placeholder/ComingSoonPage'
import { SettingsPage } from '@/features/settings/SettingsPage'
import { useTheme } from '@/hooks/useTheme'
import { isSupabaseConfigured } from '@/lib/env'
import { RequireAuth, RequireHousehold } from './guards'
import { SetupRequired } from './SetupRequired'

function Providers() {
  return (
    <AuthProvider>
      <HouseholdProvider>
        <ToastProvider>
          <Outlet />
        </ToastProvider>
      </HouseholdProvider>
    </AuthProvider>
  )
}

const router = createBrowserRouter([
  {
    element: <Providers />,
    children: [
      { path: '/entrar', element: <LoginPage /> },
      { path: '/cadastro', element: <SignupPage /> },
      { path: '/recuperar-senha', element: <ForgotPasswordPage /> },
      { path: '/redefinir-senha', element: <ResetPasswordPage /> },
      {
        element: <RequireAuth />,
        children: [
          { path: '/familia/nova', element: <CreateHouseholdPage /> },
          { path: '/convite/:token', element: <AcceptInvitePage /> },
          {
            element: <RequireHousehold />,
            children: [
              {
                element: <AppShell />,
                children: [
                  { index: true, element: <DashboardPage /> },
                  { path: '/estoque', element: <StockPage /> },
                  { path: '/estoque/novo', element: <ProductFormPage /> },
                  { path: '/estoque/:id', element: <StockItemPage /> },
                  { path: '/estoque/:id/editar', element: <ProductFormPage /> },
                  {
                    path: '/lista',
                    element: (
                      <ComingSoonPage
                        title="Lista de compras"
                        icon={ListChecks}
                        phase={3}
                        description="Lista compartilhada em tempo real, gerada a partir do que falta em casa."
                      />
                    ),
                  },
                  {
                    path: '/compras',
                    element: (
                      <ComingSoonPage
                        title="Compras"
                        icon={ReceiptText}
                        phase={4}
                        description="Importação de comprovantes (QR Code da NFC-e, XML ou foto) com revisão antes de atualizar o estoque."
                      />
                    ),
                  },
                  { path: '/ajustes', element: <SettingsPage /> },
                ],
              },
            ],
          },
        ],
      },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
])

export function App() {
  useTheme()
  if (!isSupabaseConfigured) return <SetupRequired />
  return <RouterProvider router={router} />
}
