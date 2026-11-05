import { ArrowLeft } from 'lucide-react'
import { useEffect, useId, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { SelectField, TextField } from '@/components/ui/Field'
import { Alert } from '@/components/ui/feedback'
import { FullPageSpinner } from '@/components/ui/Spinner'
import { useToast } from '@/components/ui/Toast'
import { useCurrentHousehold } from '@/features/household/HouseholdProvider'
import { can } from '@/features/household/roles'
import type { MeasureUnit } from '@/integrations/supabase/database.types'
import { toMessage } from '@/lib/errors'
import { createTrackedProduct, getStockItem, listBrandNames, updateTrackedProduct } from './api'
import { formatQty, parseQty, UNIT_OPTIONS } from './domain'
import { useCategories, useLocations } from './hooks'

interface FormState {
  name: string
  brandName: string
  categoryId: string
  presentation: string
  packageSize: string
  unit: MeasureUnit
  barcode: string
  locationId: string
  idealQty: string
  currentQty: string
  notes: string
}

const EMPTY: FormState = {
  name: '',
  brandName: '',
  categoryId: '',
  presentation: '',
  packageSize: '',
  unit: 'un',
  barcode: '',
  locationId: '',
  idealQty: '1',
  currentQty: '0',
  notes: '',
}

type Errors = Partial<Record<keyof FormState, string>>

function validate(f: FormState, isNew: boolean): Errors {
  const e: Errors = {}
  if (!f.name.trim()) e.name = 'Informe o nome do produto.'
  if (f.packageSize.trim() && (parseQty(f.packageSize) === null || parseQty(f.packageSize) === 0)) {
    e.packageSize = 'Tamanho inválido.'
  }
  if (parseQty(f.idealQty) === null) e.idealQty = 'Quantidade inválida.'
  if (isNew && parseQty(f.currentQty) === null) e.currentQty = 'Quantidade inválida.'
  const digits = f.barcode.replace(/\D/g, '')
  if (f.barcode.trim() && (digits.length < 8 || digits.length > 14)) e.barcode = 'O código deve ter de 8 a 14 dígitos.'
  return e
}

export function ProductFormPage() {
  const { id } = useParams()
  const isNew = !id
  const { household, role } = useCurrentHousehold()
  const navigate = useNavigate()
  const toast = useToast()
  const categories = useCategories()
  const { data: locations } = useLocations(household.id)
  const [brands, setBrands] = useState<string[]>([])
  const [form, setForm] = useState<FormState | null>(isNew ? EMPTY : null)
  const [errors, setErrors] = useState<Errors>({})
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const brandListId = useId()

  useEffect(() => {
    listBrandNames().then(setBrands).catch(() => setBrands([]))
  }, [])

  useEffect(() => {
    if (isNew) return
    getStockItem(id)
      .then((item) => {
        if (!item) return navigate('/estoque', { replace: true })
        setForm({
          name: item.product_name,
          brandName: item.brand_name ?? '',
          categoryId: item.category_id ?? '',
          presentation: item.presentation ?? '',
          packageSize: item.package_size ? formatQty(item.package_size) : '',
          unit: item.unit,
          barcode: item.barcode ?? '',
          locationId: item.location_id ?? '',
          idealQty: formatQty(item.ideal_qty),
          currentQty: formatQty(item.current_qty),
          notes: item.notes ?? '',
        })
      })
      .catch((e) => setSubmitError(toMessage(e)))
  }, [id, isNew, navigate])

  if (!can.edit(role)) return <Navigate to="/estoque" replace />
  if (!form) return submitError ? <Alert>{submitError}</Alert> : <FullPageSpinner />

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => (f ? { ...f, [key]: value } : f))
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }))
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!form) return
    const v = validate(form, isNew)
    setErrors(v)
    if (Object.keys(v).length) return
    setSaving(true)
    setSubmitError(null)
    const input = {
      name: form.name,
      brandName: form.brandName,
      categoryId: form.categoryId || null,
      presentation: form.presentation,
      packageSize: form.packageSize.trim() ? parseQty(form.packageSize) : null,
      unit: form.unit,
      barcode: form.barcode,
      idealQty: parseQty(form.idealQty) ?? 0,
      notes: form.notes,
    }
    try {
      if (isNew) {
        const newId = await createTrackedProduct(household.id, {
          ...input,
          locationId: form.locationId || null,
          currentQty: parseQty(form.currentQty) ?? 0,
        })
        toast.show(`${form.name.trim()} cadastrado`)
        navigate(`/estoque/${newId}`, { replace: true })
      } else {
        await updateTrackedProduct(id, input)
        toast.show('Alterações salvas')
        navigate(`/estoque/${id}`, { replace: true })
      }
    } catch (err) {
      const msg = toMessage(err)
      setSubmitError(
        /products_unique_barcode/.test(String((err as { message?: string })?.message))
          ? 'Já existe um produto com este código de barras.'
          : msg,
      )
      setSaving(false)
    }
  }

  return (
    <div className="animate-fade-in">
      <Link
        to={isNew ? '/estoque' : `/estoque/${id}`}
        className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-fg-muted hover:text-fg"
      >
        <ArrowLeft className="size-4" /> {isNew ? 'Estoque' : 'Voltar'}
      </Link>
      <h1 className="mb-6 text-[24px] leading-tight font-semibold tracking-[-0.025em]">
        {isNew ? 'Novo produto' : 'Editar produto'}
      </h1>

      <form onSubmit={onSubmit} noValidate className="space-y-5">
        {submitError && <Alert>{submitError}</Alert>}

        <Card className="space-y-4 p-5">
          <h2 className="text-[13px] font-semibold text-fg-muted">Produto</h2>
          <TextField
            label="Nome"
            placeholder="Ex.: Ketchup, Sabonete, Arroz"
            value={form.name}
            maxLength={120}
            onChange={(e) => set('name', e.target.value)}
            error={errors.name}
            autoFocus={isNew}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label="Marca"
              placeholder="Ex.: Bonare"
              list={brandListId}
              value={form.brandName}
              maxLength={60}
              onChange={(e) => set('brandName', e.target.value)}
            />
            <datalist id={brandListId}>
              {brands.map((b) => (
                <option key={b} value={b} />
              ))}
            </datalist>
            <SelectField label="Categoria" value={form.categoryId} onChange={(e) => set('categoryId', e.target.value)}>
              <option value="">Sem categoria</option>
              {categories?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </SelectField>
          </div>
          <TextField
            label="Apresentação"
            placeholder="Ex.: Zero açúcar, refil, lata"
            value={form.presentation}
            maxLength={60}
            onChange={(e) => set('presentation', e.target.value)}
            hint="Diferencia versões do mesmo produto."
          />
          <div className="grid grid-cols-[1fr_auto] gap-3">
            <TextField
              label="Tamanho da embalagem"
              placeholder="Ex.: 380"
              inputMode="decimal"
              value={form.packageSize}
              onChange={(e) => set('packageSize', e.target.value)}
              error={errors.packageSize}
            />
            <SelectField label="Unidade" value={form.unit} onChange={(e) => set('unit', e.target.value as MeasureUnit)}>
              {UNIT_OPTIONS.map((u) => (
                <option key={u.value} value={u.value}>
                  {u.label}
                </option>
              ))}
            </SelectField>
          </div>
          <TextField
            label="Código de barras"
            placeholder="Opcional"
            inputMode="numeric"
            value={form.barcode}
            onChange={(e) => set('barcode', e.target.value)}
            error={errors.barcode}
          />
        </Card>

        <Card className="space-y-4 p-5">
          <div>
            <h2 className="text-[13px] font-semibold text-fg-muted">Estoque</h2>
            <p className="mt-0.5 text-[13px] text-fg-subtle">Quantidades em embalagens (ex.: 3 ketchups).</p>
          </div>
          {isNew && (
            <SelectField label="Onde fica guardado" value={form.locationId} onChange={(e) => set('locationId', e.target.value)}>
              <option value="">Sem ambiente</option>
              {locations?.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </SelectField>
          )}
          <div className="grid grid-cols-2 gap-3">
            <TextField
              label="Quanto manter"
              inputMode="decimal"
              value={form.idealQty}
              onChange={(e) => set('idealQty', e.target.value)}
              error={errors.idealQty}
              hint="Estoque ideal"
            />
            {isNew ? (
              <TextField
                label="Quanto tem agora"
                inputMode="decimal"
                value={form.currentQty}
                onChange={(e) => set('currentQty', e.target.value)}
                error={errors.currentQty}
                hint="Estoque atual"
              />
            ) : (
              <TextField
                label="Quanto tem agora"
                value={form.currentQty}
                disabled
                hint="Altere pela contagem."
              />
            )}
          </div>
          <TextField
            label="Observações"
            placeholder="Opcional"
            value={form.notes}
            maxLength={500}
            onChange={(e) => set('notes', e.target.value)}
          />
        </Card>

        <div className="flex justify-end gap-2 pb-4">
          <Button variant="ghost" onClick={() => navigate(-1)}>
            Cancelar
          </Button>
          <Button type="submit" loading={saving}>
            {isNew ? 'Cadastrar produto' : 'Salvar'}
          </Button>
        </div>
      </form>
    </div>
  )
}
