import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/features/auth/AuthProvider'
import { listMyHouseholds, type Membership } from './api'

interface HouseholdState {
  memberships: Membership[]
  current: Membership | null
  loading: boolean
  error: unknown
  select: (householdId: string) => void
  refresh: () => Promise<void>
}

const HouseholdContext = createContext<HouseholdState | null>(null)

const storageKey = (userId: string) => `current-household:${userId}`

function readStored(userId: string): string | null {
  try {
    return localStorage.getItem(storageKey(userId))
  } catch {
    return null
  }
}

export function HouseholdProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth()
  const userId = user?.id ?? null
  const [memberships, setMemberships] = useState<Membership[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Para qual usuário as famílias já foram carregadas (evita "piscar" o onboarding
  // enquanto a sessão ou a primeira consulta ainda estão em andamento).
  const [loadedFor, setLoadedFor] = useState<string | null>(null)
  const [error, setError] = useState<unknown>(null)
  const loading = authLoading || (userId !== null && loadedFor !== userId)

  const refresh = useCallback(async () => {
    if (!userId) return
    try {
      const rows = await listMyHouseholds(userId)
      setMemberships(rows)
      setError(null)
    } catch (e) {
      setError(e)
    } finally {
      setLoadedFor(userId)
    }
  }, [userId])

  useEffect(() => {
    if (!userId) {
      setMemberships([])
      setSelectedId(null)
      setLoadedFor(null)
      return
    }
    setSelectedId(readStored(userId))
    void refresh()

    // Se outro admin adicionar/remover o usuário, a lista é atualizada em tempo real.
    const channel = supabase()
      .channel(`memberships:${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'household_members', filter: `user_id=eq.${userId}` },
        () => void refresh(),
      )
      .subscribe()
    return () => {
      void supabase().removeChannel(channel)
    }
  }, [userId, refresh])

  const select = useCallback(
    (householdId: string) => {
      setSelectedId(householdId)
      if (userId) {
        try {
          localStorage.setItem(storageKey(userId), householdId)
        } catch {
          /* armazenamento indisponível: segue só em memória */
        }
      }
    },
    [userId],
  )

  const current = useMemo(
    () => memberships.find((m) => m.household.id === selectedId) ?? memberships[0] ?? null,
    [memberships, selectedId],
  )

  const value = useMemo<HouseholdState>(
    () => ({ memberships, current, loading, error, select, refresh }),
    [memberships, current, loading, error, select, refresh],
  )

  return <HouseholdContext.Provider value={value}>{children}</HouseholdContext.Provider>
}

export function useHousehold(): HouseholdState {
  const ctx = useContext(HouseholdContext)
  if (!ctx) throw new Error('useHousehold deve ser usado dentro de <HouseholdProvider>')
  return ctx
}

/** Para telas que só renderizam com uma família selecionada (garantido pelo guard). */
export function useCurrentHousehold(): Membership {
  const { current } = useHousehold()
  if (!current) throw new Error('Nenhuma família selecionada')
  return current
}
