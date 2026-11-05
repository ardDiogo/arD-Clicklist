import type { AuthChangeEvent, Session, User } from '@supabase/supabase-js'
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { supabase } from '@/integrations/supabase/client'

interface AuthState {
  session: Session | null
  user: User | null
  loading: boolean
  /** Último evento do Supabase Auth (ex.: PASSWORD_RECOVERY). */
  lastEvent: AuthChangeEvent | null
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [lastEvent, setLastEvent] = useState<AuthChangeEvent | null>(null)

  useEffect(() => {
    const client = supabase()
    let active = true

    client.auth.getSession().then(({ data }) => {
      if (!active) return
      setSession(data.session)
      setLoading(false)
    })

    const { data } = client.auth.onAuthStateChange((event, next) => {
      setSession(next)
      setLastEvent(event)
      setLoading(false)
    })

    return () => {
      active = false
      data.subscription.unsubscribe()
    }
  }, [])

  const value = useMemo<AuthState>(
    () => ({
      session,
      user: session?.user ?? null,
      loading,
      lastEvent,
      signOut: async () => {
        await supabase().auth.signOut()
      },
    }),
    [session, loading, lastEvent],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth deve ser usado dentro de <AuthProvider>')
  return ctx
}
