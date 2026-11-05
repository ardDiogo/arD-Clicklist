import { Boxes, Camera, ChevronRight, Combine, PackageSearch, Plus, Search, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { PageHeader } from '@/components/layout/AppShell'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/feedback'
import { useCurrentHousehold } from '@/features/household/HouseholdProvider'
import { can } from '@/features/household/roles'
import { toMessage } from '@/lib/errors'
import { ListSkeleton, QtyFraction, Segmented, StatusDot, Stepper } from './components'
import { filterStock, groupStock, productSubtitle, type StockFilter, type StockItem } from './domain'
import { suggestMerges } from './api'
import { useStock } from './hooks'
import { useQuickMovement } from './useQuickMovement'

const GROUP_KEY = 'stock-group-by'

function readGroupBy(): 'location' | 'category' {
  try {
    return localStorage.getItem(GROUP_KEY) === 'category' ? 'category' : 'location'
  } catch {
    return 'location'
  }
}

export function StockPage() {
  const { household, role } = useCurrentHousehold()
  const canEdit = can.edit(role)
  const navigate = useNavigate()
  const { data, error, loading, reload, patch } = useStock(household.id)
  const quick = useQuickMovement(patch, reload)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<StockFilter>('all')
  const [groupBy, setGroupByState] = useState(readGroupBy)
  const [similar, setSimilar] = useState(0)

  // Quantos produtos parecidos podem ser juntados (silencioso se a migration não rodou).
  useEffect(() => {
    if (!canEdit) return
    suggestMerges(household.id).then((r) => setSimilar(r.length), () => setSimilar(0))
  }, [household.id, canEdit, data?.length])

  const setGroupBy = (v: 'location' | 'category') => {
    setGroupByState(v)
    try {
      localStorage.setItem(GROUP_KEY, v)
    } catch {
      /* ignora */
    }
  }

  const items = data ?? []
  const counts = useMemo(
    () => ({
      all: items.length,
      ideal: items.filter((i) => i.status === 'ok').length,
      restock: items.filter((i) => i.status === 'low').length,
      out: items.filter((i) => i.status === 'out').length,
      toBuy: items.filter((i) => i.to_buy_qty > 0).length,
    }),
    [items],
  )
  const groups = useMemo(() => groupStock(filterStock(items, query, filter), groupBy), [items, query, filter, groupBy])

  const addButton = canEdit ? (
    <div className="flex gap-2">
      {items.length > 0 && (
        <Link to="/inventario" aria-label="Conferir por fotos">
          <Button size="sm" variant="secondary" icon={<Camera className="size-4" />}>
            <span className="hidden sm:inline">Conferir</span>
          </Button>
        </Link>
      )}
      <Link to="/estoque/novo">
        <Button size="sm" icon={<Plus className="size-4" />}>
          Produto
        </Button>
      </Link>
    </div>
  ) : null

  return (
    <>
      <PageHeader
        title="Estoque"
        description={
          data ? `${counts.all} ${counts.all === 1 ? 'produto' : 'produtos'} · ${counts.toBuy} para comprar` : undefined
        }
        action={addButton}
      />

      {loading && !data ? (
        <ListSkeleton />
      ) : error && !data ? (
        <Card>
          <EmptyState
            icon={Boxes}
            title="Não foi possível carregar o estoque"
            description={toMessage(error)}
            action={<Button variant="secondary" onClick={() => void reload()}>Tentar novamente</Button>}
          />
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            icon={Boxes}
            title="Nenhum produto ainda"
            description="Cadastre os produtos que sua casa costuma ter, quanto quer manter de cada um e onde ficam guardados."
            action={addButton}
          />
        </Card>
      ) : (
        <div className="space-y-5">
          {similar > 0 && (
            <Link to="/estoque/parecidos" className="block">
              <Card className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-muted/50">
                <Combine className="size-4 shrink-0 text-accent-600" />
                <p className="min-w-0 flex-1 text-[14px]">
                  <span className="font-medium">
                    {similar} {similar === 1 ? 'produto parecido' : 'produtos parecidos'}
                  </span>{' '}
                  <span className="text-fg-muted">podem ser juntados (mesmo item, marca diferente)</span>
                </p>
                <ChevronRight className="size-4 text-fg-subtle" />
              </Card>
            </Link>
          )}
          <div className="space-y-3">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-subtle" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar produto, marca ou código"
                aria-label="Buscar no estoque"
                className="h-10 w-full rounded-[10px] border border-border bg-surface pr-9 pl-9 text-[15px] shadow-card placeholder:text-fg-subtle focus:border-accent-500 focus:ring-3 focus:ring-accent-500/15 focus:outline-none"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  aria-label="Limpar busca"
                  className="absolute top-1/2 right-2 grid size-7 -translate-y-1/2 place-items-center rounded-md text-fg-subtle hover:text-fg"
                >
                  <X className="size-4" />
                </button>
              )}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              {/* No celular a faixa rola de lado se não couber. */}
              <div className="-mx-1 max-w-full overflow-x-auto px-1 [scrollbar-width:none]">
                <Segmented
                  label="Filtro"
                  value={filter}
                  onChange={setFilter}
                  options={[
                    { value: 'all', label: 'Todos', count: counts.all },
                    { value: 'ideal', label: 'Ideal', count: counts.ideal },
                    { value: 'restock', label: 'Repor', count: counts.restock },
                    { value: 'out', label: 'Sem estoque', count: counts.out },
                  ]}
                />
              </div>
              <Segmented
                label="Agrupar por"
                value={groupBy}
                onChange={setGroupBy}
                options={[
                  { value: 'location', label: 'Ambiente' },
                  { value: 'category', label: 'Categoria' },
                ]}
              />
            </div>
          </div>

          {groups.length === 0 ? (
            <Card>
              <EmptyState
                icon={PackageSearch}
                title={
                  query
                    ? 'Nada encontrado'
                    : filter === 'out'
                      ? 'Nada em falta'
                      : filter === 'restock'
                        ? 'Nada abaixo do ideal'
                        : filter === 'ideal'
                          ? 'Nenhum produto no ideal'
                          : 'Tudo em dia'
                }
                description={
                  query
                    ? `Nenhum produto corresponde a “${query}”.`
                    : filter === 'ideal'
                      ? 'Nenhum produto está com a quantidade ideal em casa.'
                      : 'Nenhum produto neste filtro.'
                }
              />
            </Card>
          ) : (
            groups.map((group) => (
              <section key={group.key} className="animate-fade-in">
                <h2 className="mb-2 flex items-baseline gap-2 px-1 text-[12px] font-medium tracking-wide text-fg-subtle uppercase">
                  {group.label}
                  <span className="tabular-nums">{group.items.length}</span>
                </h2>
                <Card className="overflow-hidden">
                  <ul className="divide-y divide-border">
                    {group.items.map((item) => (
                      <StockRow
                        key={item.id}
                        item={item}
                        canEdit={canEdit}
                        onOpen={() => navigate(`/estoque/${item.id}`)}
                        onQuick={(dir) => void quick(item, dir)}
                      />
                    ))}
                  </ul>
                </Card>
              </section>
            ))
          )}
        </div>
      )}
    </>
  )
}

function StockRow({
  item,
  canEdit,
  onOpen,
  onQuick,
}: {
  item: StockItem
  canEdit: boolean
  onOpen: () => void
  onQuick: (direction: 1 | -1) => void
}) {
  const subtitle = productSubtitle(item)
  return (
    <li>
      <div
        role="link"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => (e.key === 'Enter' ? onOpen() : undefined)}
        className="flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-muted/60 focus-visible:bg-surface-muted/60 focus-visible:outline-none"
      >
        <StatusDot status={item.status} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] leading-5 font-medium">{item.product_name}</p>
          {subtitle && <p className="truncate text-[13px] leading-5 text-fg-muted">{subtitle}</p>}
        </div>
        <QtyFraction current={item.current_qty} ideal={item.ideal_qty} />
        {canEdit ? (
          <Stepper
            label={item.product_name}
            onDecrement={() => onQuick(-1)}
            onIncrement={() => onQuick(1)}
            disableDecrement={item.current_qty <= 0}
          />
        ) : (
          <ChevronRight className="size-4 text-fg-subtle" />
        )}
      </div>
    </li>
  )
}
