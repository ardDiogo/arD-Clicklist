import { clsx } from 'clsx'
import { AlertTriangle, ArrowLeft, Ban, CheckCircle2, ExternalLink, FileImage, PackageCheck, Pencil, Plus, RotateCcw, Trash2, Undo2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Dialog } from '@/components/ui/Dialog'
import { SelectField, TextField } from '@/components/ui/Field'
import { Alert, Badge, EmptyState } from '@/components/ui/feedback'
import { FullPageSpinner } from '@/components/ui/Spinner'
import { useToast } from '@/components/ui/Toast'
import { useCurrentHousehold } from '@/features/household/HouseholdProvider'
import { can } from '@/features/household/roles'
import { createTrackedProduct } from '@/features/inventory/api'
import { formatQty, parseQty, productSubtitle, type StockItem } from '@/features/inventory/domain'
import { parsePrice } from '@/features/shopping-list/domain'
import { useLocations, useStock } from '@/features/inventory/hooks'
import { toMessage } from '@/lib/errors'
import { formatCurrency, formatDateTime } from '@/lib/format'
import {
  confirmPurchase,
  addPurchaseItem,
  deletePurchaseItem,
  removePurchase,
  reopenPurchase,
  updatePurchaseItemValues,
  getPurchase,
  getPurchaseFiles,
  getPurchaseItems,
  signedFileUrl,
  renamePurchaseStore,
  updatePurchaseItem,
} from './api'
import { autoProductName, reviewSummary, SOURCE_LABEL, suggestProducts, titleCase, type Purchase, type PurchaseItem } from './domain'

const NEW = '__new__'

/**
 * Aviso de leitura possivelmente incompleta: a soma dos itens não bate com o total,
 * nem considerando o desconto geral. Tolerância evita alarmes por arredondamento.
 */
function totalMismatch(subtotal: number, total: number | null, discount: number | null): boolean {
  if (total === null) return false
  const tolerance = Math.max(1, total * 0.02)
  return Math.abs(subtotal - total) > tolerance && Math.abs(subtotal - (total + (discount ?? 0))) > tolerance
}

export function ReviewPage() {
  const { id = '' } = useParams()
  const { household, role } = useCurrentHousehold()
  const navigate = useNavigate()
  const toast = useToast()
  const { data: stock, reload: reloadStock } = useStock(household.id)
  const [purchase, setPurchase] = useState<Purchase | null | undefined>(undefined)
  const [items, setItems] = useState<PurchaseItem[]>([])
  const [files, setFiles] = useState<{ storage_path: string; mime_type: string }[]>([])
  const [error, setError] = useState<string | null>(null)
  const [creatingFor, setCreatingFor] = useState<PurchaseItem | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [action, setAction] = useState<'reopen' | 'remove' | null>(null)
  const [adding, setAdding] = useState(false)

  const load = useCallback(async () => {
    try {
      const [p, i, f] = await Promise.all([getPurchase(id), getPurchaseItems(id), getPurchaseFiles(id)])
      setPurchase(p)
      setItems(i)
      setFiles(f)
    } catch (e) {
      setError(toMessage(e))
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  const editable = purchase?.status === 'draft' && can.edit(role)
  const summary = useMemo(() => reviewSummary(items), [items])
  const stockById = useMemo(() => new Map((stock ?? []).map((s) => [s.id, s])), [stock])

  async function save(item: PurchaseItem, patch: Partial<PurchaseItem>) {
    const next = { ...item, ...patch }
    setItems((list) => list.map((i) => (i.id === item.id ? next : i)))
    try {
      await updatePurchaseItem(next)
    } catch (e) {
      toast.error(toMessage(e))
      await load()
    }
  }

  if (error) return <Alert>{error}</Alert>
  if (purchase === undefined) return <FullPageSpinner />
  if (!purchase) {
    return (
      <Card>
        <EmptyState icon={Ban} title="Compra não encontrada" action={<Button variant="secondary" onClick={() => navigate('/compras')}>Voltar</Button>} />
      </Card>
    )
  }

  const subtotal = items.reduce((s, i) => s + Math.round(i.total_price * 100), 0) / 100

  return (
    <div className={clsx('space-y-5 animate-fade-in', editable && 'pb-24')}>
      <Link to="/compras" className="inline-flex items-center gap-1.5 text-[13px] text-fg-muted hover:text-fg">
        <ArrowLeft className="size-4" /> Compras
      </Link>

      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-[24px] leading-tight font-semibold tracking-[-0.025em]">
            {purchase.store_name ?? 'Estabelecimento não identificado'}
          </h1>
          {can.edit(role) && purchase.status !== 'discarded' && (
            <button
              type="button"
              aria-label="Editar nome do estabelecimento"
              onClick={() => setRenaming(true)}
              className="grid size-8 place-items-center rounded-lg text-fg-subtle hover:bg-surface-muted hover:text-fg"
            >
              <Pencil className="size-4" />
            </button>
          )}
          {purchase.status === 'confirmed' && <Badge tone="accent">Confirmada</Badge>}
          {purchase.status === 'discarded' && <Badge>Descartada</Badge>}
        </div>
        <p className="mt-1 text-[14px] text-fg-muted">
          {formatDateTime(purchase.purchased_at ?? purchase.created_at)} · {SOURCE_LABEL[purchase.source]}
          {purchase.total_amount !== null && ` · ${formatCurrency(purchase.total_amount)}`}
        </p>
        <div className="mt-2 flex flex-wrap gap-3">
          {files.map((f) => (
            <OriginalFileLink key={f.storage_path} path={f.storage_path} mime={f.mime_type} />
          ))}
          {purchase.source_url && (
            <a href={purchase.source_url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-[13px] text-fg-muted underline-offset-4 hover:text-fg hover:underline">
              <ExternalLink className="size-3.5" /> Consulta na SEFAZ
            </a>
          )}
        </div>
      </div>

      {purchase.status === 'draft' && (
        <Alert tone="success">
          Nada foi lançado no estoque ainda. Confira os produtos, desmarque o que não chegou e confirme.
        </Alert>
      )}
      {totalMismatch(subtotal, purchase.total_amount, purchase.discount_amount) && (
        <Alert>
          A soma dos itens ({formatCurrency(subtotal)}) não bate com o total do cupom ({formatCurrency(purchase.total_amount)}). Confira se a leitura
          pegou todos os itens.
        </Alert>
      )}

      <Card className="overflow-hidden">
        <ul className="divide-y divide-border">
          {items.map((item) => (
            <ReviewRow
              key={item.id}
              item={item}
              editable={editable}
              stock={stock ?? []}
              matched={item.household_product_id ? stockById.get(item.household_product_id) : undefined}
              onSave={(patch) => void save(item, patch)}
              onCreate={() => setCreatingFor(item)}
              onEditValues={async (d, q, t) => {
                try {
                  await updatePurchaseItemValues(item.id, d, q, t)
                  await load()
                } catch (e) {
                  toast.error(toMessage(e))
                }
              }}
              onDelete={async () => {
                if (!confirm(`Excluir "${item.description}" desta compra?`)) return
                try {
                  await deletePurchaseItem(item.id)
                  await load()
                } catch (e) {
                  toast.error(toMessage(e))
                }
              }}
            />
          ))}
        </ul>
        {editable &&
          (adding ? (
            <ItemValuesForm
              submitLabel="Adicionar"
              onCancel={() => setAdding(false)}
              onSubmit={async (d, q, t) => {
                try {
                  await addPurchaseItem(purchase.id, d, q, t)
                  setAdding(false)
                  await load()
                } catch (e) {
                  toast.error(toMessage(e))
                }
              }}
            />
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="flex w-full items-center justify-center gap-1.5 border-t border-border py-3 text-[13px] font-medium text-fg-muted hover:bg-surface-muted/60 hover:text-fg"
            >
              <Plus className="size-4" /> Adicionar item
            </button>
          ))}
      </Card>

      {purchase.status === 'draft' && can.edit(role) && (
        <div className="flex justify-center">
          <Button
            size="sm"
            variant="danger"
            icon={<Trash2 className="size-3.5" />}
            onClick={async () => {
              if (!confirm('Descartar esta leitura? Nada será lançado no estoque.')) return
              try {
                await removePurchase(purchase.id)
                toast.show('Leitura descartada')
                navigate('/compras', { replace: true })
              } catch (e) {
                toast.error(toMessage(e))
              }
            }}
          >
            Descartar leitura
          </Button>
        </div>
      )}

      {purchase.status === 'confirmed' && can.edit(role) && (
        <div className="flex flex-wrap justify-center gap-2">
          <Button size="sm" variant="secondary" icon={<RotateCcw className="size-3.5" />} onClick={() => setAction('reopen')}>
            Editar compra
          </Button>
          <Button size="sm" variant="danger" icon={<Trash2 className="size-3.5" />} onClick={() => setAction('remove')}>
            Remover compra
          </Button>
        </div>
      )}

      <Dialog
        open={action !== null}
        onClose={() => setAction(null)}
        title={action === 'remove' ? 'Remover esta compra?' : 'Editar esta compra?'}
      >
        <PurchaseActionBody
          action={action}
          onCancel={() => setAction(null)}
          onConfirm={async () => {
            try {
              if (action === 'remove') {
                await removePurchase(purchase.id)
                setAction(null)
                toast.show('Compra removida e estoque estornado')
                navigate('/compras', { replace: true })
              } else {
                await reopenPurchase(purchase.id)
                setAction(null)
                toast.show('Compra reaberta: corrija e confirme de novo')
                await load()
              }
            } catch (e) {
              toast.error(toMessage(e))
            }
          }}
        />
      </Dialog>

      {editable && (
        <div className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+3.5rem)] z-10 border-t border-border bg-bg/90 backdrop-blur-xl lg:bottom-0 lg:left-60">
          <div className="mx-auto flex max-w-3xl items-center gap-3 px-5 py-3 lg:px-10">
            <div className="min-w-0 flex-1 text-[13px] leading-5">
              <p className="font-medium">
                {summary.toStock} {summary.toStock === 1 ? 'item entra' : 'itens entram'} no estoque
              </p>
              {summary.newProducts > 0 && (
                <p className="text-fg-muted">
                  {summary.newProducts} {summary.newProducts === 1 ? 'produto novo será cadastrado' : 'produtos novos serão cadastrados'}
                </p>
              )}
            </div>
            <Button icon={<PackageCheck className="size-4" />} onClick={() => setConfirming(true)}>
              Confirmar
            </Button>
          </div>
        </div>
      )}

      {creatingFor && (
        <QuickCreateDialog
          item={creatingFor}
          householdId={household.id}
          onClose={() => setCreatingFor(null)}
          onCreated={async (newId) => {
            const target = creatingFor
            setCreatingFor(null)
            await reloadStock()
            await save(target, { household_product_id: newId, ignored: false })
            toast.show('Produto criado e associado')
          }}
        />
      )}

      {renaming && (
        <RenameStoreDialog
          current={purchase.store_name}
          onClose={() => setRenaming(false)}
          onSave={async (name, applyAll) => {
            try {
              const n = await renamePurchaseStore(purchase.id, name, applyAll)
              setRenaming(false)
              toast.show(n > 1 ? `Nome atualizado em ${n} compras` : 'Nome do estabelecimento atualizado')
              await load()
            } catch (e) {
              toast.error(toMessage(e))
            }
          }}
        />
      )}

      <Dialog open={confirming} onClose={() => setConfirming(false)} title="Confirmar recebimento">
        <ConfirmBody
          summary={summary}
          onCancel={() => setConfirming(false)}
          onConfirm={async () => {
            try {
              const applied = await confirmPurchase(purchase.id)
              setConfirming(false)
              toast.show(applied ? `Compra confirmada · ${applied} itens no estoque` : 'Compra confirmada')
              await load()
            } catch (e) {
              toast.error(toMessage(e))
            }
          }}
        />
      </Dialog>
    </div>
  )
}

function ReviewRow({
  item,
  editable,
  stock,
  matched,
  onSave,
  onCreate,
  onEditValues,
  onDelete,
}: {
  item: PurchaseItem
  editable: boolean
  stock: StockItem[]
  matched: StockItem | undefined
  onSave: (patch: Partial<PurchaseItem>) => void
  onCreate: () => void
  onEditValues: (description: string, quantity: number, total: number) => Promise<void>
  onDelete: () => void
}) {
  const [editingValues, setEditingValues] = useState(false)
  const suggestions = useMemo(
    () => (item.household_product_id ? [] : suggestProducts(item.description, stock)),
    [item.description, item.household_product_id, stock],
  )
  const [qtyText, setQtyText] = useState(formatQty(item.stock_quantity))
  useEffect(() => setQtyText(formatQty(item.stock_quantity)), [item.stock_quantity])

  const active = !item.ignored && item.household_product_id && item.received && item.stock_quantity > 0

  return (
    <li className={clsx('space-y-2.5 px-4 py-3.5', item.ignored && 'opacity-60')}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[14px] leading-5 font-medium break-words">{item.description}</p>
          <p className="text-[12px] text-fg-muted tabular-nums">
            {formatQty(item.quantity)} {item.unit ?? 'UN'}
            {item.unit_price !== null && ` × ${formatCurrency(item.unit_price)}`}
            {item.discount > 0 && ` − ${formatCurrency(item.discount)} desc.`}
          </p>
        </div>
        <p className="text-[14px] font-semibold tabular-nums">{formatCurrency(item.total_price)}</p>
        {editable && !editingValues && (
          <button
            type="button"
            aria-label={`Editar ${item.description}`}
            onClick={() => setEditingValues(true)}
            className="-mr-1 grid size-7 shrink-0 place-items-center rounded-md text-fg-subtle hover:bg-surface-muted hover:text-fg"
          >
            <Pencil className="size-3.5" />
          </button>
        )}
      </div>
      {editingValues && (
        <ItemValuesForm
          initial={item}
          submitLabel="Salvar"
          onCancel={() => setEditingValues(false)}
          onDelete={onDelete}
          onSubmit={async (d, q, t) => {
            await onEditValues(d, q, t)
            setEditingValues(false)
          }}
        />
      )}

      {item.hint && !item.ignored && (
        <p className="flex items-start gap-1.5 text-[12px] text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {item.hint}
        </p>
      )}

      {item.ignored ? (
        <div className="flex items-center justify-between text-[13px] text-fg-muted">
          <span>Não é item de estoque</span>
          {editable && (
            <Button size="sm" variant="ghost" icon={<Undo2 className="size-3.5" />} onClick={() => onSave({ ignored: false })}>
              Desfazer
            </Button>
          )}
        </div>
      ) : !editable ? (
        <p className="flex items-center gap-1.5 text-[13px] text-fg-muted">
          {active ? <CheckCircle2 className="size-4 text-accent-600" /> : <Ban className="size-4" />}
          {matched ? `${matched.product_name}${active ? ` · +${formatQty(item.stock_quantity)}` : ' · não lançado'}` : 'Sem produto associado'}
        </p>
      ) : (
        <div className="space-y-2">
          <div className="flex gap-2">
            <select
              aria-label={`Produto para ${item.description}`}
              value={item.household_product_id ?? ''}
              onChange={(e) => {
                const v = e.target.value
                if (v === NEW) return onCreate()
                onSave({ household_product_id: v || null })
              }}
              className={clsx(
                'h-9 min-w-0 flex-1 rounded-lg border bg-surface px-2.5 text-[14px] focus:border-accent-500 focus:outline-none',
                'border-border',
              )}
            >
              <option value="">{suggestions.length ? 'Novo produto (ou escolha um existente…)' : 'Novo produto (cadastro automático)'}</option>
              {suggestions.length > 0 && (
                <optgroup label="Sugestões">
                  {suggestions.map((s) => (
                    <option key={`s-${s.id}`} value={s.id}>
                      {s.product_name} {productSubtitle(s) && `· ${productSubtitle(s)}`}
                    </option>
                  ))}
                </optgroup>
              )}
              <optgroup label="Estoque">
                {stock.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.product_name} {productSubtitle(s) && `· ${productSubtitle(s)}`}
                  </option>
                ))}
              </optgroup>
              <option value={NEW}>+ Criar novo produto…</option>
            </select>
            <Button size="sm" variant="ghost" onClick={() => onSave({ ignored: true, household_product_id: null })} title="Não é item de estoque (ex.: sacola)">
              Ignorar
            </Button>
          </div>
          {!item.household_product_id && (
            <p className="text-[12px] text-accent-700 dark:text-accent-100">
              Será cadastrado como produto novo: <span className="font-medium">{autoProductName(item.description)}</span>
            </p>
          )}
          {suggestions[0] && !item.household_product_id && (
            <button
              type="button"
              onClick={() => onSave({ household_product_id: suggestions[0]!.id })}
              className="text-[12px] font-medium text-accent-700 hover:underline dark:text-accent-100"
            >
              Usar “{suggestions[0].product_name}”?
            </button>
          )}
          {item.household_product_id && (
            <div className="flex items-center gap-3 text-[13px]">
              <label className="inline-flex cursor-pointer items-center gap-2">
                <input type="checkbox" checked={item.received} onChange={(e) => onSave({ received: e.target.checked })} className="size-4 accent-[var(--color-accent-600)]" />
                Recebido
              </label>
              <label className="ml-auto inline-flex items-center gap-2 text-fg-muted">
                Entra no estoque
                <input
                  inputMode="decimal"
                  value={qtyText}
                  disabled={!item.received}
                  onChange={(e) => setQtyText(e.target.value)}
                  onBlur={() => {
                    const q = parseQty(qtyText)
                    if (q === null) return setQtyText(formatQty(item.stock_quantity))
                    if (q !== item.stock_quantity) onSave({ stock_quantity: q })
                  }}
                  className="h-8 w-16 rounded-lg border border-border bg-surface px-2 text-center text-[14px] tabular-nums focus:border-accent-500 focus:outline-none disabled:opacity-50"
                />
                <span className="text-[12px]">emb.</span>
              </label>
            </div>
          )}
        </div>
      )}
    </li>
  )
}

function ConfirmBody({
  summary,
  onCancel,
  onConfirm,
}: {
  summary: ReturnType<typeof reviewSummary>
  onCancel: () => void
  onConfirm: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  return (
    <div className="space-y-4 text-[14px] leading-5">
      <p>
        Confirmo que recebi os produtos marcados. <strong>{summary.toStock}</strong>{' '}
        {summary.toStock === 1 ? 'item entra' : 'itens entram'} no estoque como compra.
      </p>
      {(summary.newProducts > 0 || summary.notReceived > 0) && (
        <ul className="list-disc space-y-1 pl-5 text-[13px] text-fg-muted">
          {summary.newProducts > 0 && (
            <li>
              {summary.newProducts} {summary.newProducts === 1 ? 'item ainda não existe' : 'itens ainda não existem'} no cadastro e{' '}
              {summary.newProducts === 1 ? 'será cadastrado' : 'serão cadastrados'} automaticamente (nome, embalagem e categoria
              pelo cupom; ajuste depois em Estoque).
            </li>
          )}
          {summary.notReceived > 0 && <li>{summary.notReceived} desmarcados não entram no estoque.</li>}
        </ul>
      )}
      <p className="text-[13px] text-fg-muted">Os preços ficam no histórico e o app aprende a associar esses produtos da próxima vez.</p>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Voltar
        </Button>
        <Button
          loading={busy}
          onClick={async () => {
            setBusy(true)
            try {
              await onConfirm()
            } finally {
              setBusy(false)
            }
          }}
        >
          Confirmar compra
        </Button>
      </div>
    </div>
  )
}

function QuickCreateDialog({
  item,
  householdId,
  onClose,
  onCreated,
}: {
  item: PurchaseItem
  householdId: string
  onClose: () => void
  onCreated: (id: string) => Promise<void>
}) {
  const { data: locations } = useLocations(householdId)
  const [name, setName] = useState(titleCase(item.description))
  const [brand, setBrand] = useState('')
  const [locationId, setLocationId] = useState('')
  const [ideal, setIdeal] = useState(String(Math.max(1, Math.round(item.stock_quantity || 1))))
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const idealQty = parseQty(ideal)
    if (!name.trim()) return setError('Informe o nome.')
    if (idealQty === null) return setError('Quantidade ideal inválida.')
    setBusy(true)
    setError(null)
    try {
      const id = await createTrackedProduct(householdId, {
        name,
        brandName: brand,
        categoryId: null,
        presentation: '',
        packageSize: null,
        unit: 'un',
        barcode: item.ean ?? '',
        idealQty,
        notes: '',
        locationId: locationId || null,
        currentQty: 0,
      })
      await onCreated(id)
    } catch (err) {
      setError(toMessage(err))
      setBusy(false)
    }
  }

  return (
    <Dialog open onClose={onClose} title="Novo produto">
      <form onSubmit={submit} className="space-y-3">
        <p className="text-[13px] text-fg-muted">
          Do cupom: <span className="font-medium text-fg">{item.description}</span>
        </p>
        {error && <Alert>{error}</Alert>}
        <TextField label="Nome" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Marca" value={brand} maxLength={60} onChange={(e) => setBrand(e.target.value)} />
          <TextField label="Quanto manter" inputMode="decimal" value={ideal} onChange={(e) => setIdeal(e.target.value)} />
        </div>
        <SelectField label="Onde fica guardado" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
          <option value="">Sem ambiente</option>
          {locations?.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </SelectField>
        <p className="text-[12px] text-fg-subtle">
          O estoque começa em zero; a quantidade da compra entra quando você confirmar. Detalhes podem ser completados depois.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={busy}>
            Criar e associar
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

function OriginalFileLink({ path, mime }: { path: string; mime: string }) {
  return (
    <button
      type="button"
      onClick={async () => {
        const url = await signedFileUrl(path)
        if (url) window.open(url, '_blank', 'noopener')
      }}
      className="inline-flex items-center gap-1 text-[13px] text-fg-muted underline-offset-4 hover:text-fg hover:underline"
    >
      <FileImage className="size-3.5" /> {mime.startsWith('image/') ? 'Ver foto original' : 'Ver XML original'}
    </button>
  )
}

function RenameStoreDialog({
  current,
  onClose,
  onSave,
}: {
  current: string | null
  onClose: () => void
  onSave: (name: string, applyToSameName: boolean) => Promise<void>
}) {
  const [name, setName] = useState(current ?? '')
  const [applyAll, setApplyAll] = useState(true)
  const [busy, setBusy] = useState(false)
  return (
    <Dialog open onClose={onClose} title="Estabelecimento">
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault()
          if (!name.trim()) return
          setBusy(true)
          try {
            await onSave(name, applyAll)
          } finally {
            setBusy(false)
          }
        }}
      >
        <TextField label="Nome do supermercado" placeholder="Ex.: Mart Minas Araguari" value={name} maxLength={160} autoFocus onChange={(e) => setName(e.target.value)} />
        {current && (
          <label className="flex cursor-pointer items-start gap-3 text-[14px]">
            <input type="checkbox" checked={applyAll} onChange={(e) => setApplyAll(e.target.checked)} className="mt-0.5 size-4 accent-[var(--color-accent-600)]" />
            <span>
              Aplicar a todas as compras registradas como <strong>“{current}”</strong>
            </span>
          </label>
        )}
        <p className="text-[12px] text-fg-subtle">Só muda o nome exibido. Valores, itens e estoque não são alterados.</p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button type="submit" loading={busy} disabled={!name.trim()}>
            Salvar
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

/** Formulário de descrição, quantidade e valor total de um item da compra. */
function ItemValuesForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
  onDelete,
}: {
  initial?: Pick<PurchaseItem, 'description' | 'quantity' | 'total_price'>
  submitLabel: string
  onSubmit: (description: string, quantity: number, total: number) => Promise<void>
  onCancel: () => void
  onDelete?: () => void
}) {
  const [description, setDescription] = useState(initial?.description ?? '')
  const [qty, setQty] = useState(initial ? formatQty(initial.quantity) : '1')
  const [total, setTotal] = useState(initial ? initial.total_price.toFixed(2).replace('.', ',') : '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const field =
    'h-9 w-full rounded-lg border border-border bg-surface px-2.5 text-[14px] focus:border-accent-500 focus:ring-3 focus:ring-accent-500/15 focus:outline-none'
  return (
    <form
      className="space-y-2 bg-surface-muted/40 px-4 py-3"
      onSubmit={async (e) => {
        e.preventDefault()
        const q = parseQty(qty)
        const t = parsePrice(total)
        if (!description.trim()) return setError('Informe a descrição.')
        if (q === null || q <= 0) return setError('Quantidade inválida.')
        if (t === undefined || t === null) return setError('Valor inválido. Use, por exemplo, 8,99.')
        setBusy(true)
        try {
          await onSubmit(description, q, t)
        } finally {
          setBusy(false)
        }
      }}
    >
      <input className={field} aria-label="Descrição" placeholder="Descrição (ex.: ARROZ 5KG)" value={description} maxLength={200} onChange={(e) => setDescription(e.target.value)} />
      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1">
          <span className="text-[12px] text-fg-muted">Quantidade</span>
          <input className={field} inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} />
        </label>
        <label className="space-y-1">
          <span className="text-[12px] text-fg-muted">Valor total (R$)</span>
          <input className={field} inputMode="decimal" placeholder="0,00" value={total} onChange={(e) => setTotal(e.target.value)} />
        </label>
      </div>
      {error && <p className="text-[12px] text-danger">{error}</p>}
      <div className="flex items-center justify-between gap-2">
        {onDelete ? (
          <Button size="sm" variant="danger" className="-ml-3" icon={<Trash2 className="size-3.5" />} onClick={onDelete}>
            Excluir item
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancelar
          </Button>
          <Button size="sm" type="submit" loading={busy}>
            {submitLabel}
          </Button>
        </div>
      </div>
    </form>
  )
}

function PurchaseActionBody({
  action,
  onCancel,
  onConfirm,
}: {
  action: 'reopen' | 'remove' | null
  onCancel: () => void
  onConfirm: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  return (
    <div className="space-y-4 text-[14px] leading-5">
      {action === 'remove' ? (
        <>
          <p>As quantidades que esta compra colocou no estoque serão <strong>estornadas</strong>, e ela sai do histórico de preços e do Financeiro.</p>
          <p className="text-[13px] text-fg-muted">
            Se parte já foi consumida, só o que ainda existe em casa é estornado. O histórico de movimentações fica registrado.
          </p>
        </>
      ) : (
        <>
          <p>
            A compra volta para <strong>revisão</strong>: as quantidades lançadas no estoque são estornadas e você pode corrigir itens,
            quantidades, valores e produtos.
          </p>
          <p className="text-[13px] text-fg-muted">Ao confirmar de novo, o estoque e os preços são lançados com os valores corrigidos.</p>
        </>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Cancelar
        </Button>
        <Button
          variant={action === 'remove' ? 'danger' : 'primary'}
          loading={busy}
          onClick={async () => {
            setBusy(true)
            try {
              await onConfirm()
            } finally {
              setBusy(false)
            }
          }}
        >
          {action === 'remove' ? 'Remover compra' : 'Editar compra'}
        </Button>
      </div>
    </div>
  )
}
