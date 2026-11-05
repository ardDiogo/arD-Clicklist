import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { toMessage } from '@/lib/errors'
import { PRESETS, resolveRange, todayBR } from './domain'
import type { DateRange, IntelFilters, Preset } from './types'

export type Tab = 'financeiro' | 'mercados' | 'produtos' | 'precos' | 'insights'
const TABS: Tab[] = ['financeiro', 'mercados', 'produtos', 'precos', 'insights']

export type Dimension = 'store' | 'category' | 'product' | 'brand'
const PARAM: Record<Dimension, string> = { store: 'mercado', category: 'cat', product: 'produto', brand: 'marca' }

/**
 * Filtros e aba ficam na URL: sobrevivem à troca de aba, ao voltar do detalhe
 * de um produto e podem ser compartilhados com outro membro da família.
 */
export function useIntelState() {
  const [params, setParams] = useSearchParams()
  const presetParam = params.get('p') as Preset | null
  const filters: IntelFilters = useMemo(
    () => ({
      preset: presetParam && PRESETS.some((p) => p.value === presetParam) ? presetParam : '6m',
      from: params.get('de') ?? undefined,
      to: params.get('ate') ?? undefined,
      store: params.get('mercado') ?? undefined,
      category: params.get('cat') ?? undefined,
      product: params.get('produto') ?? undefined,
      brand: params.get('marca') ?? undefined,
    }),
    [params, presetParam],
  )
  const tabParam = params.get('aba') as Tab | null
  const tab: Tab = tabParam && TABS.includes(tabParam) ? tabParam : 'financeiro'
  const today = todayBR()
  const range: DateRange = useMemo(() => resolveRange(filters, today), [filters, today])

  const update = useCallback(
    (patch: Record<string, string | undefined>) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          for (const [k, v] of Object.entries(patch)) {
            if (v) next.set(k, v)
            else next.delete(k)
          }
          return next
        },
        { replace: true },
      )
    },
    [setParams],
  )

  return {
    filters,
    range,
    tab,
    setTab: (t: Tab) => update({ aba: t === 'financeiro' ? undefined : t }),
    setPreset: (p: Preset) =>
      update(p === 'custom' ? { p, de: range.from, ate: range.to } : { p: p === '6m' ? undefined : p, de: undefined, ate: undefined }),
    setCustom: (from: string, to: string) => update({ p: 'custom', de: from, ate: to }),
    setDimension: (dim: Dimension, value: string | undefined) => update({ [PARAM[dim]]: value }),
    clearDimensions: () => update({ mercado: undefined, cat: undefined, produto: undefined, marca: undefined }),
    activeDimensions: [filters.store, filters.category, filters.product, filters.brand].filter(Boolean).length,
  }
}

// Cache durante a visita à tela: trocar de aba não refaz consultas já feitas.
const cache = new Map<string, unknown>()
export function clearIntelCache() {
  cache.clear()
}

export function useIntelQuery<T>(key: string | null, fetcher: () => Promise<T>) {
  const [state, setState] = useState<{ key: string | null; data: T | null; error: string | null }>({ key: null, data: null, error: null })

  useEffect(() => {
    if (!key) return
    if (cache.has(key)) {
      setState({ key, data: cache.get(key) as T, error: null })
      return
    }
    let active = true
    fetcher().then(
      (data) => {
        cache.set(key, data)
        if (active) setState({ key, data, error: null })
      },
      (e) => active && setState({ key, data: null, error: toMessage(e) }),
    )
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const fresh = state.key === key
  return { data: fresh ? state.data : null, error: fresh ? state.error : null, loading: !!key && (!fresh || (!state.data && !state.error)) }
}
