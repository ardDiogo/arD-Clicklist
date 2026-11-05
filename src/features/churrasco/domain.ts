/**
 * Churrascômetro — estimativa de compras para um churrasco.
 * Regras simples e conservadoras (médias usadas em churrascarias e açougues);
 * tudo é arredondado para cima para não faltar.
 */

export type Duration = 'normal' | 'longo'
export type BeerFormat = 'garrafa' | 'lata'

export interface ChurrascoInput {
  men: number
  women: number
  kids: number
  /** Quantos adultos bebem cerveja (nunca mais que o total de adultos). */
  drinkers: number
  duration: Duration
}

export interface ChurrascoItem {
  key: string
  label: string
  /** Valor exibido (já arredondado). */
  amount: number
  unit: string
  /** Detalhe opcional (ex.: "3 sacos de 5 kg"). */
  hint?: string
  /** Nome e quantidade usados ao enviar para a lista de compras. */
  listName: string
  listQty: number
}

export interface ChurrascoResult {
  people: number
  adults: number
  meatKg: number
  items: ChurrascoItem[]
}

/** Consumo por pessoa em um churrasco de até ~4 horas. */
export const RULES = {
  meatKg: { men: 0.4, women: 0.3, kids: 0.2 },
  meatSplit: { bovina: 0.55, frango: 0.25, linguica: 0.2 },
  beerLitersPerDrinker: 1.8,
  softLiters: { nonDrinkerAdult: 0.75, drinker: 0.25, kid: 0.5 },
  waterLitersPerPerson: 0.5,
  saltKgPerMeatKg: 0.1,
  charcoalKgPerMeatKg: 1,
  charcoalMinKg: 3,
  iceKg: { perPerson: 0.5, perDrinker: 1, bag: 5 },
  garlicBread: { adult: 1, kid: 0.5 },
  cheesePerPerson: 0.5,
  longFactor: 1.25,
} as const

const up = (n: number, step: number) => Math.ceil(n / step - 1e-9) * step
const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d
const int = (n: number) => Math.max(0, Math.floor(Number.isFinite(n) ? n : 0))

export function normalizeInput(i: ChurrascoInput): ChurrascoInput {
  const men = int(i.men)
  const women = int(i.women)
  const kids = int(i.kids)
  return { men, women, kids, drinkers: Math.min(int(i.drinkers), men + women), duration: i.duration }
}

export function computeChurrasco(raw: ChurrascoInput, beer: BeerFormat = 'garrafa'): ChurrascoResult {
  const i = normalizeInput(raw)
  const adults = i.men + i.women
  const people = adults + i.kids
  const f = i.duration === 'longo' ? RULES.longFactor : 1
  if (people === 0) return { people: 0, adults: 0, meatKg: 0, items: [] }

  const meatKg = round(up((i.men * RULES.meatKg.men + i.women * RULES.meatKg.women + i.kids * RULES.meatKg.kids) * f, 0.1), 1)
  const bovina = round(up(meatKg * RULES.meatSplit.bovina, 0.1), 1)
  const frango = round(up(meatKg * RULES.meatSplit.frango, 0.1), 1)
  const linguica = round(up(meatKg * RULES.meatSplit.linguica, 0.1), 1)

  const beerL = i.drinkers * RULES.beerLitersPerDrinker * f
  const bottles = Math.ceil(beerL / 0.6 - 1e-9)
  const cans = Math.ceil(beerL / 0.35 - 1e-9)

  const nonDrinkers = adults - i.drinkers
  const softL = Math.ceil(
    (nonDrinkers * RULES.softLiters.nonDrinkerAdult + i.drinkers * RULES.softLiters.drinker + i.kids * RULES.softLiters.kid) * f - 1e-9,
  )
  const waterL = Math.ceil(people * RULES.waterLitersPerPerson * f - 1e-9)
  const saltKg = round(Math.max(0.1, up(meatKg * RULES.saltKgPerMeatKg, 0.05)), 2)
  const charcoalKg = Math.max(RULES.charcoalMinKg, Math.ceil(meatKg * RULES.charcoalKgPerMeatKg - 1e-9))
  const iceKg = Math.max(RULES.iceKg.bag, up(people * RULES.iceKg.perPerson + i.drinkers * RULES.iceKg.perDrinker, RULES.iceKg.bag))
  const garlic = Math.ceil(adults * RULES.garlicBread.adult + i.kids * RULES.garlicBread.kid - 1e-9)
  const cheese = Math.ceil(people * RULES.cheesePerPerson - 1e-9)

  const items: ChurrascoItem[] = [
    {
      key: 'carnes',
      label: 'Carnes',
      amount: meatKg,
      unit: 'kg',
      hint: `${fmt(bovina)} kg bovina · ${fmt(frango)} kg frango · ${fmt(linguica)} kg linguiça`,
      listName: '',
      listQty: 0,
    },
    { key: 'bovina', label: 'Carne bovina', amount: bovina, unit: 'kg', listName: 'Carne bovina para churrasco (kg)', listQty: bovina },
    { key: 'frango', label: 'Frango', amount: frango, unit: 'kg', listName: 'Frango para churrasco (kg)', listQty: frango },
    { key: 'linguica', label: 'Linguiça', amount: linguica, unit: 'kg', listName: 'Linguiça para churrasco (kg)', listQty: linguica },
  ]
  if (i.drinkers > 0) {
    items.push(
      beer === 'garrafa'
        ? {
            key: 'cerveja',
            label: 'Cerveja (garrafa 600 ml)',
            amount: bottles,
            unit: bottles === 1 ? 'garrafa' : 'garrafas',
            hint: `${fmt(round(beerL, 1))} L · ou ${cans} latas de 350 ml`,
            listName: 'Cerveja garrafa 600 ml',
            listQty: bottles,
          }
        : {
            key: 'cerveja',
            label: 'Cerveja (lata 350 ml)',
            amount: cans,
            unit: cans === 1 ? 'lata' : 'latas',
            hint: `${fmt(round(beerL, 1))} L · ou ${bottles} garrafas de 600 ml`,
            listName: 'Cerveja lata 350 ml',
            listQty: cans,
          },
    )
  }
  items.push(
    {
      key: 'refri',
      label: 'Refrigerante / suco',
      amount: softL,
      unit: 'L',
      hint: `${Math.ceil(softL / 2)} ${Math.ceil(softL / 2) === 1 ? 'garrafa' : 'garrafas'} de 2 L`,
      listName: 'Refrigerante 2 L',
      listQty: Math.ceil(softL / 2),
    },
    {
      key: 'agua',
      label: 'Água',
      amount: waterL,
      unit: 'L',
      hint: `${Math.ceil(waterL / 1.5)} ${Math.ceil(waterL / 1.5) === 1 ? 'garrafa' : 'garrafas'} de 1,5 L`,
      listName: 'Água mineral 1,5 L',
      listQty: Math.ceil(waterL / 1.5),
    },
    { key: 'sal', label: 'Sal grosso', amount: saltKg, unit: 'kg', hint: '1 pacote de 1 kg dá para até 10 kg de carne', listName: 'Sal grosso 1 kg', listQty: Math.ceil(saltKg) },
    {
      key: 'carvao',
      label: 'Carvão',
      amount: charcoalKg,
      unit: 'kg',
      hint: `${Math.ceil(charcoalKg / 5)} ${Math.ceil(charcoalKg / 5) === 1 ? 'saco' : 'sacos'} de 5 kg`,
      listName: 'Carvão 5 kg',
      listQty: Math.ceil(charcoalKg / 5),
    },
    {
      key: 'gelo',
      label: 'Gelo',
      amount: iceKg,
      unit: 'kg',
      hint: `${iceKg / RULES.iceKg.bag} ${iceKg / RULES.iceKg.bag === 1 ? 'saco' : 'sacos'} de 5 kg`,
      listName: 'Gelo 5 kg',
      listQty: iceKg / RULES.iceKg.bag,
    },
    { key: 'pao', label: 'Pão de alho', amount: garlic, unit: 'un', listName: 'Pão de alho', listQty: garlic },
    { key: 'queijo', label: 'Queijo coalho', amount: cheese, unit: 'espetos', listName: 'Queijo coalho (espetos)', listQty: cheese },
  )
  return { people, adults, meatKg, items }
}

export function fmt(n: number): string {
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })
}
