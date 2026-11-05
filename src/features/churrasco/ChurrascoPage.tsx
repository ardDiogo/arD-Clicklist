import { clsx } from 'clsx'
import {
  Baby,
  Beef,
  Beer,
  CupSoda,
  Drumstick,
  Flame,
  GlassWater,
  ListPlus,
  Minus,
  Plus,
  RotateCcw,
  Sandwich,
  Snowflake,
  Sparkle,
  User,
  UserRound,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { PageHeader } from '@/components/layout/AppShell'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { Dialog } from '@/components/ui/Dialog'
import { EmptyState } from '@/components/ui/feedback'
import { useToast } from '@/components/ui/Toast'
import { useCurrentHousehold } from '@/features/household/HouseholdProvider'
import { can } from '@/features/household/roles'
import { Segmented } from '@/features/inventory/components'
import { addCustomItem } from '@/features/shopping-list/api'
import { supabase } from '@/integrations/supabase/client'
import { toMessage } from '@/lib/errors'
import { computeChurrasco, fmt, normalizeInput, RULES, type BeerFormat, type ChurrascoInput, type Duration } from './domain'

const STORAGE_KEY = 'ard:churrasco'
const EMPTY: ChurrascoInput = { men: 0, women: 0, kids: 0, drinkers: 0, duration: 'normal' }

const ICONS: Record<string, LucideIcon> = {
  carnes: Beef,
  bovina: Beef,
  frango: Drumstick,
  linguica: Beef,
  cerveja: Beer,
  refri: CupSoda,
  agua: GlassWater,
  sal: Sparkle,
  carvao: Flame,
  gelo: Snowflake,
  pao: Sandwich,
  queijo: Sandwich,
}

function loadSaved(): { input: ChurrascoInput; beer: BeerFormat } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const v = JSON.parse(raw) as { input?: ChurrascoInput; beer?: BeerFormat }
      return { input: normalizeInput({ ...EMPTY, ...v.input }), beer: v.beer === 'lata' ? 'lata' : 'garrafa' }
    }
  } catch {
    // sem armazenamento local: começa vazio
  }
  return { input: EMPTY, beer: 'garrafa' }
}

export function ChurrascoPage() {
  const [input, setInput] = useState<ChurrascoInput>(() => loadSaved().input)
  const [beer, setBeer] = useState<BeerFormat>(() => loadSaved().beer)
  const [sending, setSending] = useState(false)
  const result = useMemo(() => computeChurrasco(input, beer), [input, beer])
  const adults = input.men + input.women

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ input, beer }))
    } catch {
      // ignora (modo privado)
    }
  }, [input, beer])

  const set = (patch: Partial<ChurrascoInput>) => setInput((prev) => normalizeInput({ ...prev, ...patch }))

  return (
    <>
      <PageHeader
        title="Churrascômetro"
        description="Quanto comprar para o churrasco, calculado pelo número de convidados."
        action={
          result.people > 0 ? (
            <Button size="sm" variant="ghost" icon={<RotateCcw className="size-4" />} onClick={() => setInput(EMPTY)}>
              Zerar
            </Button>
          ) : undefined
        }
      />

      <div className="space-y-5 animate-fade-in">
        <Card>
          <CardHeader title="Convidados" />
          <div className="grid gap-x-6 px-5 pb-2 sm:grid-cols-2">
            <Counter icon={User} label="Homens" value={input.men} onChange={(men) => set({ men })} />
            <Counter icon={UserRound} label="Mulheres" value={input.women} onChange={(women) => set({ women })} />
            <Counter icon={Baby} label="Crianças" value={input.kids} onChange={(kids) => set({ kids })} />
            <Counter
              icon={Beer}
              label="Bebem cerveja"
              hint={adults === 0 ? 'informe os adultos primeiro' : `de ${adults} ${adults === 1 ? 'adulto' : 'adultos'}`}
              value={input.drinkers}
              max={adults}
              onChange={(drinkers) => set({ drinkers })}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3.5">
            <span className="text-[14px] text-fg-muted">Duração</span>
            <Segmented<Duration>
              label="Duração do churrasco"
              value={input.duration}
              onChange={(duration) => set({ duration })}
              options={[
                { value: 'normal', label: 'Até 4 h' },
                { value: 'longo', label: 'Mais de 4 h' },
              ]}
            />
          </div>
        </Card>

        {result.people === 0 ? (
          <Card>
            <EmptyState icon={Flame} title="Quantos vêm?" description="Informe os convidados e a lista do churrasco aparece aqui na hora." />
          </Card>
        ) : (
          <Card>
            <CardHeader
              title={`Para ${result.people} ${result.people === 1 ? 'pessoa' : 'pessoas'}`}
              description={input.duration === 'longo' ? 'Churrasco longo: 25% a mais de comida e bebida' : 'Churrasco de até 4 horas'}
              action={
                input.drinkers > 0 ? (
                  <Segmented<BeerFormat>
                    label="Formato da cerveja"
                    value={beer}
                    onChange={setBeer}
                    options={[
                      { value: 'garrafa', label: '600 ml' },
                      { value: 'lata', label: 'Lata' },
                    ]}
                  />
                ) : undefined
              }
            />
            <ul className="divide-y divide-border border-t border-border">
              {result.items
                .filter((i) => !['bovina', 'frango', 'linguica'].includes(i.key))
                .map((i) => {
                  const Icon = ICONS[i.key] ?? Beef
                  return (
                    <li key={i.key} className="flex items-center gap-3 px-5 py-3">
                      <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent-50 text-accent-700 dark:bg-accent-700/20 dark:text-accent-100">
                        <Icon className="size-[18px]" strokeWidth={1.75} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[14px] font-medium">{i.label}</p>
                        {i.hint && <p className="text-[12px] text-fg-muted">{i.hint}</p>}
                      </div>
                      <p className="shrink-0 text-right text-[16px] font-semibold tabular-nums">
                        {fmt(i.amount)} <span className="text-[13px] font-normal text-fg-muted">{i.unit}</span>
                      </p>
                    </li>
                  )
                })}
            </ul>
            <div className="space-y-3 border-t border-border px-5 py-4">
              <AddToList items={result.items.filter((i) => i.listQty > 0)} sending={sending} setSending={setSending} />
              {input.drinkers > 0 && <p className="text-[12px] text-fg-subtle">Venda de bebida alcoólica proibida para menores de 18 anos.</p>}
              <details className="text-[12px] text-fg-muted">
                <summary className="cursor-pointer hover:text-fg">Como é calculado</summary>
                <ul className="mt-2 list-disc space-y-1 pl-4">
                  <li>
                    Carne: {fmt(RULES.meatKg.men * 1000)} g por homem, {fmt(RULES.meatKg.women * 1000)} g por mulher e {fmt(RULES.meatKg.kids * 1000)} g por criança —
                    55% bovina, 25% frango e 20% linguiça.
                  </li>
                  <li>Cerveja: {fmt(RULES.beerLitersPerDrinker)} L por pessoa que bebe.</li>
                  <li>Refrigerante/suco: 750 ml por adulto que não bebe, 250 ml por quem bebe e 500 ml por criança. Água: 500 ml por pessoa.</li>
                  <li>Sal grosso: 100 g por kg de carne. Carvão: 1 kg por kg de carne (mínimo 3 kg).</li>
                  <li>Gelo: 500 g por pessoa + 1 kg por quem bebe, em sacos de 5 kg.</li>
                  <li>Pão de alho: 1 por adulto e meio por criança. Queijo coalho: 1 espeto a cada 2 pessoas.</li>
                  <li>Mais de 4 horas: tudo 25% a mais. Os valores são arredondados para cima.</li>
                </ul>
              </details>
            </div>
          </Card>
        )}
      </div>
    </>
  )
}

function Counter({
  icon: Icon,
  label,
  hint,
  value,
  max,
  onChange,
}: {
  icon: LucideIcon
  label: string
  hint?: string
  value: number
  max?: number
  onChange: (v: number) => void
}) {
  const btn =
    'grid size-10 place-items-center rounded-full border border-border bg-surface text-fg-muted transition-[transform,color,background-color] hover:bg-surface-muted hover:text-fg active:scale-90 disabled:opacity-35 disabled:active:scale-100'
  return (
    <div className="flex items-center gap-3 border-b border-border py-3 last:border-b-0 sm:[&:nth-last-child(2)]:border-b-0">
      <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface-muted text-fg-muted">
        <Icon className="size-5" strokeWidth={1.6} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-medium">{label}</p>
        {hint && <p className="text-[12px] text-fg-subtle">{hint}</p>}
      </div>
      <div className="flex items-center gap-1.5">
        <button type="button" className={btn} aria-label={`Menos ${label.toLowerCase()}`} disabled={value <= 0} onClick={() => onChange(value - 1)}>
          <Minus className="size-4" />
        </button>
        <input
          type="number"
          inputMode="numeric"
          min={0}
          max={max}
          aria-label={label}
          value={value}
          onFocus={(e) => e.target.select()}
          onChange={(e) => onChange(Number(e.target.value))}
          className="h-10 w-12 rounded-lg border border-border bg-surface text-center text-[16px] font-semibold tabular-nums [appearance:textfield] focus:border-accent-500 focus:outline-none [&::-webkit-inner-spin-button]:appearance-none"
        />
        <button
          type="button"
          className={btn}
          aria-label={`Mais ${label.toLowerCase()}`}
          disabled={max !== undefined && value >= max}
          onClick={() => onChange(value + 1)}
        >
          <Plus className="size-4" />
        </button>
      </div>
    </div>
  )
}

function AddToList({
  items,
  sending,
  setSending,
}: {
  items: ReturnType<typeof computeChurrasco>['items']
  sending: boolean
  setSending: (v: boolean) => void
}) {
  const { household, role } = useCurrentHousehold()
  const toast = useToast()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set())

  if (!can.edit(role)) return null

  const openDialog = () => {
    setPicked(new Set(items.map((i) => i.key)))
    setOpen(true)
  }

  async function send() {
    setSending(true)
    try {
      const listId = await supabase().rpc('get_or_create_open_list', { p_household_id: household.id })
      if (listId.error || !listId.data) throw listId.error ?? new Error('Lista não encontrada')
      const chosen = items.filter((i) => picked.has(i.key))
      for (const i of chosen) await addCustomItem(listId.data, i.listName, i.listQty)
      setOpen(false)
      toast.show(`${chosen.length} ${chosen.length === 1 ? 'item adicionado' : 'itens adicionados'} à lista de compras.`, {
        tone: 'success',
        action: { label: 'Ver lista', onClick: () => navigate('/lista') },
      })
    } catch (e) {
      toast.error(toMessage(e))
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      <Button className="w-full" icon={<ListPlus className="size-4" />} onClick={openDialog}>
        Adicionar à lista de compras
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Adicionar à lista">
        <p className="mb-3 text-[13px] text-fg-muted">Os itens entram na lista aberta como itens avulsos. Se já existirem, a quantidade é somada.</p>
        <ul className="mb-4 divide-y divide-border rounded-xl border border-border">
          {items.map((i) => (
            <li key={i.key}>
              <label className="flex cursor-pointer items-center gap-3 px-4 py-2.5">
                <input
                  type="checkbox"
                  checked={picked.has(i.key)}
                  onChange={(e) =>
                    setPicked((prev) => {
                      const next = new Set(prev)
                      if (e.target.checked) next.add(i.key)
                      else next.delete(i.key)
                      return next
                    })
                  }
                  className="size-4 accent-[var(--color-accent-600)]"
                />
                <span className="min-w-0 flex-1 truncate text-[14px]">{i.listName}</span>
                <span className={clsx('shrink-0 text-[14px] font-semibold tabular-nums', !picked.has(i.key) && 'text-fg-subtle')}>{fmt(i.listQty)}</span>
              </label>
            </li>
          ))}
        </ul>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button onClick={() => void send()} disabled={sending || picked.size === 0}>
            {sending ? 'Adicionando…' : `Adicionar ${picked.size}`}
          </Button>
        </div>
      </Dialog>
    </>
  )
}
