import { createBrowserRouter, Navigate, Outlet, RouterProvider } from 'react-router'
import { AppShell } from '@/components/layout/AppShell'
import { UpdatePrompt } from '@/components/layout/UpdatePrompt'
import { ToastProvider } from '@/components/ui/Toast'
import { AuthProvider } from '@/features/auth/AuthProvider'
import { ForgotPasswordPage, LoginPage, ResetPasswordPage, SignupPage } from '@/features/auth/pages'
import { DashboardPage } from '@/features/dashboard/DashboardPage'
import { HouseholdProvider } from '@/features/household/HouseholdProvider'
import { AcceptInvitePage, CreateHouseholdPage } from '@/features/household/pages'
import { ProductFormPage } from '@/features/inventory/ProductFormPage'
import { StockItemPage } from '@/features/inventory/StockItemPage'
import { StockPage } from '@/features/inventory/StockPage'
import { ScanReviewPage } from '@/features/inventory-scan/ScanReviewPage'
import { ScansPage } from '@/features/inventory-scan/ScansPage'
import { PurchasesPage } from '@/features/receipts/PurchasesPage'
import { ReviewPage } from '@/features/receipts/ReviewPage'
import { SettingsPage } from '@/features/settings/SettingsPage'
import { ListDetailPage, ListHistoryPage } from '@/features/shopping-list/HistoryPages'
import { ShoppingListPage } from '@/features/shopping-list/ShoppingListPage'
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
                  { path: '/inventario', element: <ScansPage /> },
                  { path: '/inventario/:id', element: <ScanReviewPage /> },
                  { path: '/lista', element: <ShoppingListPage /> },
                  { path: '/lista/historico', element: <ListHistoryPage /> },
                  { path: '/lista/:id', element: <ListDetailPage /> },
                  { path: '/compras', element: <PurchasesPage /> },
                  { path: '/compras/:id', element: <ReviewPage /> },
                  {
                    path: '/inteligencia',
                    lazy: async () => ({ Component: (await import('@/features/intelligence/IntelligencePage')).IntelligencePage }),
                  },
                  { path: '/financeiro', element: <Navigate to="/inteligencia" replace /> },
                  {
                    path: '/churrasco',
                    lazy: async () => ({ Component: (await import('@/features/churrasco/ChurrascoPage')).ChurrascoPage }),
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
  return (
    <>
      <RouterProvider router={router} />
      {/* Registra o service worker desde a primeira tela (inclusive login) e avisa sobre versões novas. */}
      <UpdatePrompt />
    </>
  )
}
