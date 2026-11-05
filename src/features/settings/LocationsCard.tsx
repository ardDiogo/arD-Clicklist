import { Check, Pencil, Plus, Trash2, X } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { Alert } from '@/components/ui/feedback'
import { Spinner } from '@/components/ui/Spinner'
import { useCurrentHousehold } from '@/features/household/HouseholdProvider'
import { can } from '@/features/household/roles'
import { archiveLocation, createLocation, renameLocation, type Location } from '@/features/inventory/api'
import { useLocations } from '@/features/inventory/hooks'
import { toMessage } from '@/lib/errors'

const inputClass =
  'h-9 min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 text-[14px] focus:border-accent-500 focus:ring-3 focus:ring-accent-500/15 focus:outline-none'

function friendly(e: unknown): string {
  return /locations_unique_name/.test(String((e as { message?: string })?.message))
    ? 'Já existe um ambiente com esse nome.'
    : toMessage(e)
}

/** Ambientes da casa (Despensa, Geladeira…), personalizáveis pela família. */
export function LocationsCard() {
  const { household, role } = useCurrentHousehold()
  const canEdit = can.edit(role)
  const { data, reload } = useLocations(household.id)
  const [error, setError] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [adding, setAdding] = useState(false)

  async function onAdd(e: FormEvent) {
    e.preventDefault()
    if (!newName.trim()) return
    setAdding(true)
    setError(null)
    try {
      const maxSort = Math.max(0, ...(data ?? []).map((l) => l.sort_order))
      await createLocation(household.id, newName, maxSort + 10)
      setNewName('')
      await reload()
    } catch (err) {
      setError(friendly(err))
    } finally {
      setAdding(false)
    }
  }

  return (
    <Card>
      <CardHeader title="Ambientes" description="Onde os produtos ficam guardados." />
      {error && <Alert className="mx-5 mb-3">{error}</Alert>}
      {!data ? (
        <div className="grid place-items-center py-6 text-fg-subtle">
          <Spinner />
        </div>
      ) : (
        <ul className="divide-y divide-border border-t border-border">
          {data.map((l) => (
            <LocationRow key={l.id} location={l} canEdit={canEdit} onChanged={reload} onError={setError} />
          ))}
        </ul>
      )}
      {canEdit && (
        <form onSubmit={onAdd} className="flex gap-2 border-t border-border px-5 py-3">
          <input
            className={inputClass}
            placeholder="Novo ambiente (ex.: Adega)"
            aria-label="Nome do novo ambiente"
            maxLength={60}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <Button type="submit" size="sm" variant="secondary" loading={adding} disabled={!newName.trim()} icon={<Plus className="size-4" />}>
            Adicionar
          </Button>
        </form>
      )}
    </Card>
  )
}

function LocationRow({
  location,
  canEdit,
  onChanged,
  onError,
}: {
  location: Location
  canEdit: boolean
  onChanged: () => Promise<void>
  onError: (m: string | null) => void
}) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(location.name)
  const [busy, setBusy] = useState(false)

  async function run(fn: () => Promise<void>) {
    setBusy(true)
    onError(null)
    try {
      await fn()
      await onChanged()
      setEditing(false)
    } catch (e) {
      onError(friendly(e))
    } finally {
      setBusy(false)
    }
  }

  if (editing) {
    return (
      <li className="flex items-center gap-2 px-5 py-2">
        <input
          className={inputClass}
          value={name}
          maxLength={60}
          autoFocus
          aria-label="Nome do ambiente"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && name.trim()) void run(() => renameLocation(location.id, name))
            if (e.key === 'Escape') setEditing(false)
          }}
        />
        <Button size="sm" variant="ghost" aria-label="Salvar" loading={busy} disabled={!name.trim()} onClick={() => void run(() => renameLocation(location.id, name))}>
          <Check className="size-4" />
        </Button>
        <Button size="sm" variant="ghost" aria-label="Cancelar" onClick={() => { setName(location.name); setEditing(false) }}>
          <X className="size-4" />
        </Button>
      </li>
    )
  }

  return (
    <li className="flex items-center gap-2 px-5 py-2.5">
      <span className="flex-1 text-[14px]">{location.name}</span>
      {canEdit && (
        <>
          <Button size="sm" variant="ghost" aria-label={`Renomear ${location.name}`} onClick={() => setEditing(true)}>
            <Pencil className="size-3.5" />
          </Button>
          <Button
            size="sm"
            variant="danger"
            aria-label={`Remover ${location.name}`}
            disabled={busy}
            onClick={() => {
              if (confirm(`Remover o ambiente “${location.name}”? Os produtos dele ficarão sem ambiente.`)) {
                void run(() => archiveLocation(location.id))
              }
            }}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </>
      )}
    </li>
  )
}
