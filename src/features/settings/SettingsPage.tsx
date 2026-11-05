import { clsx } from 'clsx'
import { Check, Copy, LogOut, Monitor, RefreshCw, Moon, Sun, UserPlus, X } from 'lucide-react'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { PageHeader } from '@/components/layout/AppShell'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { SelectField, TextField } from '@/components/ui/Field'
import { Alert, Badge } from '@/components/ui/feedback'
import { Spinner } from '@/components/ui/Spinner'
import { useAuth } from '@/features/auth/AuthProvider'
import {
  createInvite,
  listMembers,
  listPendingInvites,
  removeMember,
  renameHousehold,
  revokeInvite,
  updateMemberRole,
  type Member,
  type PendingInvite,
} from '@/features/household/api'
import { useCurrentHousehold, useHousehold } from '@/features/household/HouseholdProvider'
import { can, inviteUrl, ROLE_DESCRIPTION, ROLE_LABEL } from '@/features/household/roles'
import { useTheme, type ThemePreference } from '@/hooks/useTheme'
import type { HouseholdRole } from '@/integrations/supabase/database.types'
import { supabase } from '@/integrations/supabase/client'
import { toMessage } from '@/lib/errors'
import { formatDate } from '@/lib/format'
import { InstallSettingsCard } from '@/features/pwa/components'
import { LocationsCard } from './LocationsCard'

const ROLES: HouseholdRole[] = ['admin', 'editor', 'viewer']

export function SettingsPage() {
  return (
    <>
      <PageHeader title="Ajustes" description="Família, membros, ambientes e preferências." />
      <div className="space-y-5">
        <HouseholdCard />
        <MembersCard />
        <LocationsCard />
        <PreferencesCard />
        <InstallSettingsCard />
        <AccountCard />
      </div>
    </>
  )
}

// -----------------------------------------------------------------------------
function HouseholdCard() {
  const { household, role } = useCurrentHousehold()
  const { refresh } = useHousehold()
  const [name, setName] = useState(household.name)
  const [status, setStatus] = useState<{ tone: 'error' | 'success'; text: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const isAdmin = can.manageMembers(role)

  useEffect(() => setName(household.name), [household.name])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setStatus(null)
    try {
      await renameHousehold(household.id, name)
      await refresh()
      setStatus({ tone: 'success', text: 'Nome atualizado.' })
    } catch (err) {
      setStatus({ tone: 'error', text: toMessage(err) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader title="Família" description={`Criada em ${formatDate(household.created_at)}`} />
      <form onSubmit={onSubmit} className="space-y-3 px-5 pb-5">
        {status && <Alert tone={status.tone}>{status.text}</Alert>}
        <TextField
          label="Nome"
          value={name}
          maxLength={80}
          disabled={!isAdmin}
          onChange={(e) => setName(e.target.value)}
          hint={isAdmin ? undefined : 'Somente administradores podem alterar.'}
        />
        {isAdmin && (
          <div className="flex justify-end">
            <Button type="submit" size="sm" variant="secondary" loading={saving} disabled={!name.trim() || name.trim() === household.name}>
              Salvar
            </Button>
          </div>
        )}
      </form>
    </Card>
  )
}

// -----------------------------------------------------------------------------
function MembersCard() {
  const { household, role } = useCurrentHousehold()
  const { user } = useAuth()
  const { refresh: refreshHouseholds } = useHousehold()
  const isAdmin = can.manageMembers(role)
  const [members, setMembers] = useState<Member[] | null>(null)
  const [invites, setInvites] = useState<PendingInvite[]>([])
  const [error, setError] = useState<string | null>(null)
  const [inviting, setInviting] = useState(false)

  const load = useCallback(async () => {
    try {
      const [m, i] = await Promise.all([
        listMembers(household.id),
        isAdmin ? listPendingInvites(household.id) : Promise.resolve([]),
      ])
      setMembers(m)
      setInvites(i)
      setError(null)
    } catch (e) {
      setError(toMessage(e))
    }
  }, [household.id, isAdmin])

  useEffect(() => {
    setMembers(null)
    void load()
    // Novos membros aparecem em tempo real para todos da família.
    const channel = supabase()
      .channel(`members:${household.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'household_members', filter: `household_id=eq.${household.id}` },
        () => void load(),
      )
      .subscribe()
    return () => {
      void supabase().removeChannel(channel)
    }
  }, [household.id, load])

  async function run(action: () => Promise<void>) {
    setError(null)
    try {
      await action()
      await load()
    } catch (e) {
      setError(toMessage(e))
    }
  }

  return (
    <Card>
      <CardHeader
        title="Membros"
        description="Todos veem e editam os mesmos dados, conforme o papel."
        action={
          isAdmin && !inviting ? (
            <Button size="sm" variant="secondary" icon={<UserPlus className="size-4" />} onClick={() => setInviting(true)}>
              Convidar
            </Button>
          ) : null
        }
      />
      <div className="px-5 pb-2">{error && <Alert className="mb-3">{error}</Alert>}</div>

      {inviting && (
        <InviteForm
          householdId={household.id}
          onClose={() => setInviting(false)}
          onCreated={() => void load()}
        />
      )}

      {members === null ? (
        <div className="grid place-items-center py-8 text-fg-subtle">
          <Spinner />
        </div>
      ) : (
        <ul className="divide-y divide-border border-t border-border">
          {members.map((m) => {
            const isMe = m.userId === user?.id
            return (
              <li key={m.userId} className="flex items-center gap-3 px-5 py-3">
                <Avatar name={m.fullName} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-medium">
                    {m.fullName ?? 'Sem nome'} {isMe && <span className="font-normal text-fg-subtle">(você)</span>}
                  </p>
                  <p className="text-[12px] text-fg-muted">Desde {formatDate(m.joinedAt)}</p>
                </div>
                {isAdmin && !isMe ? (
                  <div className="flex items-center gap-1">
                    <select
                      aria-label={`Papel de ${m.fullName ?? 'membro'}`}
                      value={m.role}
                      onChange={(e) =>
                        void run(() => updateMemberRole(household.id, m.userId, e.target.value as HouseholdRole))
                      }
                      className="h-8 rounded-lg border border-border bg-surface px-2 text-[13px] focus:outline-none"
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABEL[r]}
                        </option>
                      ))}
                    </select>
                    <Button
                      size="sm"
                      variant="danger"
                      aria-label={`Remover ${m.fullName ?? 'membro'}`}
                      onClick={() => {
                        if (confirm(`Remover ${m.fullName ?? 'este membro'} da família?`)) {
                          void run(() => removeMember(household.id, m.userId))
                        }
                      }}
                    >
                      <X className="size-4" />
                    </Button>
                  </div>
                ) : (
                  <Badge tone={m.role === 'admin' ? 'accent' : 'neutral'}>{ROLE_LABEL[m.role]}</Badge>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {isAdmin && invites.length > 0 && (
        <div className="border-t border-border px-5 py-4">
          <p className="mb-2 text-[12px] font-medium tracking-wide text-fg-subtle uppercase">Convites pendentes</p>
          <ul className="space-y-2">
            {invites.map((i) => (
              <li key={i.id} className="flex items-center gap-2 text-[13px]">
                <span className="min-w-0 flex-1 truncate text-fg-muted">
                  {i.email ?? 'Link aberto'} · {ROLE_LABEL[i.role]} · expira {formatDate(i.expires_at)}
                </span>
                <CopyButton text={inviteUrl(window.location.origin, i.token)} />
                <Button size="sm" variant="ghost" onClick={() => void run(() => revokeInvite(i.id))}>
                  Cancelar
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {members && (
        <div className="border-t border-border px-5 py-3">
          <LeaveButton householdId={household.id} onLeft={refreshHouseholds} />
        </div>
      )}
    </Card>
  )
}

function InviteForm({
  householdId,
  onClose,
  onCreated,
}: {
  householdId: string
  onClose: () => void
  onCreated: () => void
}) {
  const [role, setRole] = useState<HouseholdRole>('editor')
  const [email, setEmail] = useState('')
  const [link, setLink] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const token = await createInvite(householdId, role, email)
      setLink(inviteUrl(window.location.origin, token))
      onCreated()
    } catch (err) {
      setError(toMessage(err))
    } finally {
      setLoading(false)
    }
  }

  async function share() {
    if (!link) return
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Convite', text: 'Entre na nossa família no app de compras:', url: link })
      } catch {
        /* usuário cancelou */
      }
    }
  }

  return (
    <div className="mx-5 mb-4 rounded-xl border border-border bg-surface-muted/50 p-4 animate-fade-in">
      {link ? (
        <div className="space-y-3">
          <p className="text-[13px] text-fg-muted">
            Envie este link. Ele vale por 7 dias e só pode ser usado uma vez.
          </p>
          <div className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2">
            <code className="min-w-0 flex-1 truncate text-[12px]">{link}</code>
            <CopyButton text={link} />
          </div>
          <div className="flex justify-end gap-2">
            {'share' in navigator && (
              <Button size="sm" variant="secondary" onClick={() => void share()}>
                Compartilhar
              </Button>
            )}
            <Button size="sm" onClick={onClose}>
              Concluir
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-3">
          {error && <Alert>{error}</Alert>}
          <SelectField
            label="Papel"
            value={role}
            onChange={(e) => setRole(e.target.value as HouseholdRole)}
            hint={ROLE_DESCRIPTION[role]}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </SelectField>
          <TextField
            label="E-mail (opcional)"
            type="email"
            inputMode="email"
            placeholder="Restringe o convite a este e-mail"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button size="sm" type="submit" loading={loading}>
              Gerar link
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      size="sm"
      variant="ghost"
      aria-label="Copiar link"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        } catch {
          window.prompt('Copie o link:', text)
        }
      }}
    >
      {copied ? <Check className="size-4 text-accent-600" /> : <Copy className="size-4" />}
    </Button>
  )
}

function LeaveButton({ householdId, onLeft }: { householdId: string; onLeft: () => Promise<void> }) {
  const { user } = useAuth()
  const [error, setError] = useState<string | null>(null)
  return (
    <div className="space-y-2">
      {error && <Alert>{error}</Alert>}
      <Button
        size="sm"
        variant="danger"
        className="-ml-2"
        onClick={async () => {
          if (!user || !confirm('Sair desta família? Você perderá acesso aos dados dela.')) return
          try {
            await removeMember(householdId, user.id)
            await onLeft()
          } catch (e) {
            setError(toMessage(e))
          }
        }}
      >
        Sair da família
      </Button>
    </div>
  )
}

// -----------------------------------------------------------------------------
const THEMES: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Claro', icon: Sun },
  { value: 'dark', label: 'Escuro', icon: Moon },
  { value: 'system', label: 'Sistema', icon: Monitor },
]

function PreferencesCard() {
  const { theme, setTheme } = useTheme()
  return (
    <Card>
      <CardHeader title="Aparência" />
      <div className="px-5 pb-5">
        <div role="radiogroup" aria-label="Tema" className="grid grid-cols-3 gap-1 rounded-[10px] bg-surface-muted p-1">
          {THEMES.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={theme === value}
              onClick={() => setTheme(value)}
              className={clsx(
                'flex h-8 items-center justify-center gap-1.5 rounded-lg text-[13px] font-medium transition-all',
                theme === value ? 'bg-surface text-fg shadow-card' : 'text-fg-muted hover:text-fg',
              )}
            >
              <Icon className="size-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>
    </Card>
  )
}

function AccountCard() {
  const { user, signOut } = useAuth()
  return (
    <Card>
      <CardHeader title="Conta" description={user?.email} />
      <div className="px-5 pb-4">
        <Button variant="secondary" size="sm" icon={<LogOut className="size-4" />} onClick={() => void signOut()}>
          Sair
        </Button>
        <AppVersion />
      </div>
    </Card>
  )
}

/** Versão instalada + botão para buscar a mais recente (útil no app instalado). */
function AppVersion() {
  const [checking, setChecking] = useState(false)
  async function update() {
    setChecking(true)
    try {
      const reg = await navigator.serviceWorker?.getRegistration()
      await reg?.update()
      if (reg?.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' })
    } catch {
      // segue para o recarregamento
    }
    window.setTimeout(() => window.location.reload(), 800)
  }
  return (
    <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-3 text-[12px] text-fg-muted">
      <span>Versão {__APP_BUILD__}</span>
      <Button variant="ghost" size="sm" icon={<RefreshCw className="size-3.5" />} onClick={() => void update()} disabled={checking}>
        {checking ? 'Atualizando…' : 'Buscar atualização'}
      </Button>
    </div>
  )
}
