import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/integrations/supabase/client'
import { generateList, getOpenList, listItems, removedProductIds, type ShoppingList } from './api'
import type { ListItem } from './domain'

interface State {
  list: ShoppingList | null
  items: ListItem[]
  removed: Set<string>
  loading: boolean
  error: unknown
}

/**
 * Lista aberta da família, sincronizada em tempo real.
 * Se ainda não existe lista aberta e o usuário pode editar, ela é criada e
 * preenchida automaticamente a partir do estoque — sem trabalho manual.
 */
export function useOpenShoppingList(householdId: string, canEdit: boolean) {
  const [state, setState] = useState<State>({ list: null, items: [], removed: new Set(), loading: true, error: null })
  const listIdRef = useRef<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async () => {
    try {
      let list = await getOpenList(householdId)
      if (!list && canEdit) {
        await generateList(householdId)
        list = await getOpenList(householdId)
      }
      listIdRef.current = list?.id ?? null
      if (!list) {
        setState({ list: null, items: [], removed: new Set(), loading: false, error: null })
        return
      }
      const [items, removed] = await Promise.all([listItems(list.id), removedProductIds(list.id)])
      setState({ list, items, removed, loading: false, error: null })
    } catch (error) {
      setState((s) => ({ ...s, loading: false, error }))
    }
  }, [householdId, canEdit])

  useEffect(() => {
    setState((s) => ({ ...s, loading: true }))
    void load()
    const schedule = () => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => void load(), 200)
    }
    const filter = `household_id=eq.${householdId}`
    const channel = supabase()
      .channel(`shopping:${householdId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shopping_list_items', filter }, schedule)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shopping_lists', filter }, schedule)
      .subscribe()
    const onVisible = () => document.visibilityState === 'visible' && schedule()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      if (timer.current) clearTimeout(timer.current)
      document.removeEventListener('visibilitychange', onVisible)
      void supabase().removeChannel(channel)
    }
  }, [householdId, load])

  const patchItem = useCallback((id: string, fn: (i: ListItem) => ListItem | null) => {
    setState((s) => ({
      ...s,
      items: s.items.flatMap((i) => {
        if (i.id !== id) return [i]
        const next = fn(i)
        return next ? [next] : []
      }),
    }))
  }, [])

  return { ...state, reload: load, patchItem }
}
