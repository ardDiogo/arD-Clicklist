import { clsx } from 'clsx'
import { CalendarRange, SlidersHorizontal, X } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { SelectField, TextField } from '@/components/ui/Field'
import { PRESETS, rangeLabel } from './domain'
import type { Dimension } from './hooks'
import type { DateRange, FilterOptions, IntelFilters, Preset } from './types'

const DIM_LABEL: Record<Dimension, string> = { store: 'Mercado', category: 'Categoria', product: 'Produto', brand: 'Marca' }

export function FilterBar({
  filters,
  range,
  options,
  onPreset,
  onCustom,
  onDimension,
  onClear,
}: {
  filters: IntelFilters
  range: DateRange
  options: FilterOptions | null
  onPreset: (p: Preset) => void
  onCustom: (from: string, to: string) => void
  onDimension: (d: Dimension, v: string | undefined) => void
  onClear: () => void
}) {
  const [open, setOpen] = useState(false)
  const nameOf = (d: Dimension, id: string | undefined): string | null => {
    if (!id) return null
    if (!options) return '…'
    const found =
      d === 'store'
        ? options.stores.find((s) => s.key === id)?.name
        : d === 'category'
          ? options.categories.find((c) => c.id === id)?.name
          : d === 'product'
            ? options.products.find((p) => p.id === id)?.name
            : options.brands.find((b) => b.id === id)?.name
    return found ?? 'Selecionado'
  }
  const active = (['store', 'category', 'product', 'brand'] as Dimension[])
    .map((d) => ({ d, id: filters[d], name: nameOf(d, filters[d]) }))
    .filter((x) => x.id)

  return (
    <div className="mb-5 space-y-2.5">
      <div className="flex items-center gap-2">
        <div role="radiogroup" aria-label="Período" className="-mx-1 flex min-w-0 flex-1 gap-1 overflow-x-auto px-1 py-0.5 [scrollbar-width:none]">
          {PRESETS.map((p) => (
            <button
              key={p.value}
              type="button"
              role="radio"
              aria-checked={filters.preset === p.value}
              onClick={() => onPreset(p.value)}
              className={clsx(
                'h-8 shrink-0 rounded-full px-3 text-[13px] font-medium whitespace-nowrap transition-colors',
                filters.preset === p.value ? 'bg-fg text-bg' : 'bg-surface-muted text-fg-muted hover:text-fg',
              )}
            >
              {p.short}
            </button>
          ))}
        </div>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setOpen(true)}
          icon={<SlidersHorizontal className="size-4" />}
          aria-label={`Filtros${active.length ? ` (${active.length} ativos)` : ''}`}
        >
          <span className="hidden sm:inline">Filtros</span>
          {active.length > 0 && <span className="tabular-nums">{active.length}</span>}
        </Button>
      </div>

      {filters.preset === 'custom' && (
        <div className="grid grid-cols-2 gap-2 sm:max-w-md">
          <TextField label="De" type="date" value={range.from} max={range.to} onChange={(e) => e.target.value && onCustom(e.target.value, range.to)} />
          <TextField label="Até" type="date" value={range.to} min={range.from} onChange={(e) => e.target.value && onCustom(range.from, e.target.value)} />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-fg-muted">
        <span className="inline-flex items-center gap-1">
          <CalendarRange className="size-3.5" /> {rangeLabel(range)}
        </span>
        {active.map((a) => (
          <span key={a.d} className="inline-flex items-center gap-1 rounded-full bg-accent-50 py-0.5 pr-1 pl-2.5 text-accent-700 dark:bg-accent-500/15 dark:text-accent-100">
            {DIM_LABEL[a.d]}: <span className="max-w-36 truncate font-medium">{a.name}</span>
            <button type="button" aria-label={`Remover filtro ${DIM_LABEL[a.d]}`} onClick={() => onDimension(a.d, undefined)} className="grid size-5 place-items-center rounded-full hover:bg-black/5">
              <X className="size-3" />
            </button>
          </span>
        ))}
        {active.length > 1 && (
          <button type="button" onClick={onClear} className="font-medium underline-offset-2 hover:text-fg hover:underline">
            Limpar filtros
          </button>
        )}
      </div>

      <Dialog open={open} onClose={() => setOpen(false)} title="Filtrar análises">
        <div className="space-y-3">
          {!options ? (
            <p className="text-[14px] text-fg-muted">Carregando opções…</p>
          ) : (
            <>
              <SelectField label="Mercado" value={filters.store ?? ''} onChange={(e) => onDimension('store', e.target.value || undefined)}>
                <option value="">Todos</option>
                {options.stores.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.name} ({s.visits})
                  </option>
                ))}
              </SelectField>
              <SelectField label="Categoria" value={filters.category ?? ''} onChange={(e) => onDimension('category', e.target.value || undefined)}>
                <option value="">Todas</option>
                {options.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </SelectField>
              <SelectField label="Produto" value={filters.product ?? ''} onChange={(e) => onDimension('product', e.target.value || undefined)}>
                <option value="">Todos</option>
                {options.products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </SelectField>
              <SelectField
                label="Marca"
                hint={options.brands.length === 0 ? 'Nenhum produto comprado tem marca cadastrada ainda.' : undefined}
                value={filters.brand ?? ''}
                disabled={options.brands.length === 0}
                onChange={(e) => onDimension('brand', e.target.value || undefined)}
              >
                <option value="">Todas</option>
                {options.brands.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </SelectField>
              <p className="text-[12px] text-fg-subtle">Os filtros valem para todas as abas. Com filtro de categoria, produto ou marca, os totais somam só os itens filtrados.</p>
            </>
          )}
          <div className="flex justify-between gap-2 pt-1">
            <Button variant="ghost" onClick={onClear} disabled={active.length === 0}>
              Limpar
            </Button>
            <Button onClick={() => setOpen(false)}>Ver resultados</Button>
          </div>
        </div>
      </Dialog>
    </div>
  )
}
