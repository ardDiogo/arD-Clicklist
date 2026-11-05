import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/integrations/supabase/client'
import { listCategories, listLocations, listStock, type Category, type Location } from './api'
import type { StockItem } from './domain'

type Loadable<T> = { data: T | null; error: unknown; loading: boolean }

/**
 * Estoque da família com sincronização em tempo real: qualquer alteração
 * feita por outro membro (ou por outra aba) dispara um recarregamento.
 */
export function useStock(householdId: string) {
  const [state, setState] = useState<Loadable<StockItem[]>>({ data: null, error: null, loading: true })
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const reload = useCallback(async () => {
    try {
      const data = await listStock(householdId)
      setState({ data, error: null, loading: false })
    } catch (error) {
      setState((s) => ({ ...s, error, loading: false }))
    }
  }, [householdId])

  useEffect(() => {
    setState({ data: null, error: null, loading: true })
    void reload()

    // Agrupa rajadas de eventos (ex.: várias movimentações) em um único reload.
    const schedule = () => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => void reload(), 250)
    }
    const filter = `household_id=eq.${householdId}`
    const channel = supabase()
      .channel(`stock:${householdId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'household_products', filter }, schedule)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'locations', filter }, schedule)
      .subscribe()

    // Ao voltar para o app (PWA em segundo plano), garante dados atualizados.
    const onVisible = () => document.visibilityState === 'visible' && schedule()
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      if (timer.current) clearTimeout(timer.current)
      document.removeEventListener('visibilitychange', onVisible)
      void supabase().removeChannel(channel)
    }
  }, [householdId, reload])

  /** Atualização otimista local; o realtime/reload confirma depois. */
  const patch = useCallback((id: string, fn: (item: StockItem) => StockItem) => {
    setState((s) => (s.data ? { ...s, data: s.data.map((i) => (i.id === id ? fn(i) : i)) } : s))
  }, [])

  return { ...state, reload, patch }
}

export function useLocations(householdId: string) {
  const [state, setState] = useState<Loadable<Location[]>>({ data: null, error: null, loading: true })
  const reload = useCallback(async () => {
    try {
      setState({ data: await listLocations(householdId), error: null, loading: false })
    } catch (error) {
      setState((s) => ({ ...s, error, loading: false }))
    }
  }, [householdId])
  useEffect(() => {
    void reload()
  }, [reload])
  return { ...state, reload }
}

let categoriesCache: Promise<Category[]> | null = null

/** Categorias padrão mudam raramente: cache em memória por sessão. */
export function useCategories() {
  const [data, setData] = useState<Category[] | null>(null)
  useEffect(() => {
    categoriesCache ??= listCategories().catch((e) => {
      categoriesCache = null
      throw e
    })
    let active = true
    categoriesCache.then((c) => active && setData(c)).catch(() => active && setData([]))
    return () => {
      active = false
    }
  }, [])
  return data
}
