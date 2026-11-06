import { ArrowLeft, ArrowLeftRight, ArrowRight, Combine, PackageCheck, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Alert, EmptyState } from '@/components/ui/feedback'
import { useToast } from '@/components/ui/Toast'
import { useCurrentHousehold } from '@/features/household/HouseholdProvider'
import { can } from '@/features/household/roles'
import { toMessage } from '@/lib/errors'
import { dismissMerge, mergeProducts, suggestMerges, type MergeSuggestion } from './api'
import { ListSkeleton } from './components'
import { formatQty } from './domain'

/**
 * Produtos parecidos: o mesmo item genérico cadastrado mais de uma vez (marcas ou
 * descrições diferentes da nota). Juntar deixa um item só no estoque e na lista;
 * a marca continua registrada em cada compra, como referência de preço.
 */
export function MergeSuggestionsPage() {
  const { household, role } = useCurrentHousehold()
  const canEdit = can.edit(role)
  const toast = useToast()
  const [rows, setRows] = useState<MergeSuggestion[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [swapped, setSwapped] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    try {
      setRows(await suggestMerges(household.id))
      setError(null)
    } catch (e) {
      setError(toMessage(e))
    }
  }, [household.id])

  useEffect(() => {
    void load()
  }, [load])

  // Direção escolhida pelo usuário (⇄ inverte quem fica)
  const dir = (r: MergeSuggestion) =>
    swapped.has(r.from_id)
      ? { from: r.into_id, fromName: r.into_name, fromQty: r.into_qty, into: r.from_id, intoName: r.from_name, intoQty: r.from_qty }
      : { from: r.from_id, fromName: r.from_name, fromQty: r.from_qty, into: r.into_id, intoName: r.into_name, intoQty: r.into_qty }

  async function merge(list: MergeSuggestion[]) {
    setBusy(list.length === 1 ? list[0]!.from_id : 'all')
    let done = 0
    try {
      for (const r of list) {
        const d = dir(r)
        await mergeProducts(d.from, d.into)
        done++
      }
      const d0 = dir(list[0]!)
      toast.show(done === 1 ? `“${d0.fromName}” juntado em “${d0.intoName}”` : `${done} produtos juntados`)
    } catch (e) {
      toast.error(`${done > 0 ? `${done} juntados; ` : ''}${toMessage(e)}`)
    } finally {
      setBusy(null)
      await load()
    }
  }

  async function dismiss(r: MergeSuggestion) {
    setBusy(r.from_id)
    try {
      await dismissMerge(r.from_id, r.into_id)
      toast.show('Ok, não vamos sugerir este par de novo')
    } catch (e) {
      toast.error(toMessage(e))
    } finally {
      setBusy(null)
      await load()
    }
  }

  const high = rows?.filter((r) => r.confidence === 'alta') ?? []
  const medium = rows?.filter((r) => r.confidence === 'media') ?? []

  const row = (r: MergeSuggestion, kind: 'alta' | 'media') => {
    const d = dir(r)
    return (
      <li key={r.from_id} className="flex flex-wrap items-center gap-3 px-4 py-3.5">
        <div className={kind === 'media' ? 'min-w-0 basis-full sm:basis-0 sm:flex-1' : 'min-w-0 flex-1'}>
          <p className="flex flex-wrap items-center gap-1.5 text-[14px]">
            <Link to={`/estoque/${d.from}`} className="font-medium hover:underline">
              {d.fromName}
            </Link>
            <ArrowRight className="size-3.5 text-fg-subtle" />
            <Link to={`/estoque/${d.into}`} className="font-medium text-accent-700 hover:underline dark:text-accent-100">
              {d.intoName}
            </Link>
          </p>
          <p className="text-[12px] text-fg-muted tabular-nums">
            Em casa: {formatQty(d.fromQty)} + {formatQty(d.intoQty)} = {formatQty(d.fromQty + d.intoQty)} · fica “{d.intoName}”
          </p>
        </div>
        {canEdit && (
          <div className={kind === 'media' ? 'flex w-full items-center justify-end gap-1.5 sm:w-auto' : 'flex items-center gap-1.5'}>
            {kind === 'media' && (
              <>
                <button
                  type="button"
                  aria-label="Inverter: manter o outro produto"
                  title="Inverter quem fica"
                  disabled={!!busy}
                  onClick={() =>
                    setSwapped((prev) => {
                      const next = new Set(prev)
                      if (next.has(r.from_id)) next.delete(r.from_id)
                      else next.add(r.from_id)
                      return next
                    })
                  }
                  className="grid size-8 place-items-center rounded-lg text-fg-muted hover:bg-surface-muted hover:text-fg"
                >
                  <ArrowLeftRight className="size-4" />
                </button>
                <Button size="sm" variant="ghost" icon={<X className="size-3.5" />} disabled={!!busy} onClick={() => void dismiss(r)}>
                  Não são o mesmo
                </Button>
              </>
            )}
            <Button size="sm" variant="secondary" loading={busy === r.from_id} disabled={!!busy} onClick={() => void merge([r])}>
              Juntar
            </Button>
          </div>
        )}
      </li>
    )
  }

  return (
    <div className="animate-fade-in">
      <Link to="/estoque" className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-fg-muted hover:text-fg">
        <ArrowLeft className="size-4" /> Estoque
      </Link>
      <div className="mb-6">
        <h1 className="text-[24px] leading-tight font-semibold tracking-[-0.025em]">Produtos parecidos</h1>
        <p className="mt-1 text-[14px] text-fg-muted">
          O mesmo item cadastrado mais de uma vez (marca ou descrição diferente). Ao juntar, fica um item só no estoque e na lista; a marca continua
          em cada compra, como referência de preço.
        </p>
      </div>

      {error ? (
        <Alert>
          {error}
          {/function|PGRST202|42883/i.test(error) && ' — rode a migration 20261127000100_merge_suggestions_v2.sql no Supabase.'}
        </Alert>
      ) : !rows ? (
        <ListSkeleton rows={4} />
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState icon={PackageCheck} title="Nenhum produto parecido" description="Cada item genérico está cadastrado uma vez só." />
        </Card>
      ) : (
        <div className="space-y-6">
          {high.length > 0 && (
            <section>
              <div className="mb-2 flex items-center justify-between gap-3 px-1">
                <h2 className="text-[12px] font-medium tracking-wide text-fg-subtle uppercase">Mesmo item · {high.length}</h2>
                {canEdit && high.length > 1 && (
                  <Button size="sm" icon={<Combine className="size-4" />} loading={busy === 'all'} disabled={!!busy} onClick={() => void merge(high)}>
                    Juntar todos
                  </Button>
                )}
              </div>
              <Card className="overflow-hidden">
                <ul className="divide-y divide-border">{high.map((r) => row(r, 'alta'))}</ul>
              </Card>
            </section>
          )}
          {medium.length > 0 && (
            <section>
              <h2 className="mb-1 px-1 text-[12px] font-medium tracking-wide text-fg-subtle uppercase">Talvez sejam o mesmo · {medium.length}</h2>
              <p className="mb-2 px-1 text-[12px] text-fg-muted">
                Começam com a mesma palavra. Confira um a um: use ⇄ para escolher qual fica, ou “Não são o mesmo” para esconder a sugestão.
              </p>
              <Card className="overflow-hidden">
                <ul className="divide-y divide-border">{medium.map((r) => row(r, 'media'))}</ul>
              </Card>
            </section>
          )}
        </div>
      )}
    </div>
  )
}
