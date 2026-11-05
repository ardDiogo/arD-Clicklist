import { ArrowLeft, ArrowRight, Combine, PackageCheck } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Alert, EmptyState } from '@/components/ui/feedback'
import { useToast } from '@/components/ui/Toast'
import { useCurrentHousehold } from '@/features/household/HouseholdProvider'
import { can } from '@/features/household/roles'
import { toMessage } from '@/lib/errors'
import { mergeProducts, suggestMerges, type MergeSuggestion } from './api'
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

  async function merge(list: MergeSuggestion[]) {
    setBusy(list.length === 1 ? list[0]!.from_id : 'all')
    let done = 0
    try {
      for (const r of list) {
        await mergeProducts(r.from_id, r.into_id)
        done++
      }
      toast.show(done === 1 ? `“${list[0]!.from_name}” juntado em “${list[0]!.into_name}”` : `${done} produtos juntados`)
    } catch (e) {
      toast.error(`${done > 0 ? `${done} juntados; ` : ''}${toMessage(e)}`)
    } finally {
      setBusy(null)
      await load()
    }
  }

  return (
    <div className="animate-fade-in">
      <Link to="/estoque" className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-fg-muted hover:text-fg">
        <ArrowLeft className="size-4" /> Estoque
      </Link>
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[24px] leading-tight font-semibold tracking-[-0.025em]">Produtos parecidos</h1>
          <p className="mt-1 text-[14px] text-fg-muted">
            O mesmo item cadastrado mais de uma vez (marca ou descrição diferente). Ao juntar, fica um item só no estoque e na lista; a marca
            continua em cada compra, como referência de preço.
          </p>
        </div>
      </div>

      {error ? (
        <Alert>
          {error}
          {/function|PGRST202|42883/i.test(error) && ' — rode a migration 20261122000100_generic_products.sql no Supabase.'}
        </Alert>
      ) : !rows ? (
        <ListSkeleton rows={4} />
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState icon={PackageCheck} title="Nenhum produto parecido" description="Cada item genérico está cadastrado uma vez só." />
        </Card>
      ) : (
        <>
          {canEdit && rows.length > 1 && (
            <div className="mb-3 flex justify-end">
              <Button size="sm" icon={<Combine className="size-4" />} loading={busy === 'all'} disabled={!!busy} onClick={() => void merge(rows)}>
                Juntar todos ({rows.length})
              </Button>
            </div>
          )}
          <Card className="overflow-hidden">
            <ul className="divide-y divide-border">
              {rows.map((r) => (
                <li key={r.from_id} className="flex flex-wrap items-center gap-3 px-4 py-3.5">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-1.5 text-[14px]">
                      <Link to={`/estoque/${r.from_id}`} className="font-medium hover:underline">
                        {r.from_name}
                      </Link>
                      <ArrowRight className="size-3.5 text-fg-subtle" />
                      <Link to={`/estoque/${r.into_id}`} className="font-medium text-accent-700 hover:underline dark:text-accent-100">
                        {r.into_name}
                      </Link>
                    </p>
                    <p className="text-[12px] text-fg-muted tabular-nums">
                      Em casa: {formatQty(r.from_qty)} + {formatQty(r.into_qty)} = {formatQty(r.from_qty + r.into_qty)}
                    </p>
                  </div>
                  {canEdit && (
                    <Button size="sm" variant="secondary" loading={busy === r.from_id} disabled={!!busy} onClick={() => void merge([r])}>
                      Juntar
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </Card>
          <p className="mt-3 px-1 text-[12px] text-fg-subtle">
            Confira antes de juntar: a sugestão compara as palavras do nome. Se um par não for o mesmo item, é só não juntar. Depois de juntar, as
            próximas notas com aquela descrição já entram no produto certo.
          </p>
        </>
      )}
    </div>
  )
}
