import { Home, Link2Off, LogOut } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router'
import { AuthLayout } from '@/components/layout/AuthLayout'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/Field'
import { Alert } from '@/components/ui/feedback'
import { FullPageSpinner } from '@/components/ui/Spinner'
import { useAuth } from '@/features/auth/AuthProvider'
import { toMessage } from '@/lib/errors'
import { acceptInvite, createHousehold, getInvitePreview, type InvitePreview } from './api'
import { useHousehold } from './HouseholdProvider'
import { ROLE_LABEL } from './roles'

/** Primeiro acesso: o usuário ainda não pertence a nenhuma família. */
export function CreateHouseholdPage() {
  const { user, signOut } = useAuth()
  const { memberships, refresh, select } = useHousehold()
  const navigate = useNavigate()
  const firstName = (user?.user_metadata?.full_name as string | undefined)?.split(' ')[0]
  const [name, setName] = useState(firstName ? `Casa de ${firstName}` : '')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const id = await createHousehold(name)
      await refresh()
      select(id)
      navigate('/', { replace: true })
    } catch (err) {
      setError(toMessage(err))
      setLoading(false)
    }
  }

  return (
    <AuthLayout
      title={memberships.length ? 'Nova família' : 'Crie sua família'}
      subtitle="Tudo — produtos, estoque e listas — fica compartilhado com quem você convidar. Recebeu um convite? Abra o link que te enviaram."
      footer={
        memberships.length ? (
          <button type="button" onClick={() => navigate(-1)} className="hover:text-fg">
            Cancelar
          </button>
        ) : (
          <button type="button" onClick={() => void signOut()} className="inline-flex items-center gap-1.5 hover:text-fg">
            <LogOut className="size-3.5" /> Sair
          </button>
        )
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {error && <Alert>{error}</Alert>}
        <TextField
          label="Nome da família"
          placeholder="Ex.: Casa da Família Araújo"
          maxLength={80}
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Button type="submit" block loading={loading} disabled={!name.trim()} icon={<Home className="size-4" />}>
          Criar família
        </Button>
      </form>
    </AuthLayout>
  )
}

const STATUS_MESSAGE: Record<InvitePreview['status'], string> = {
  valid: '',
  expired: 'Este convite expirou. Peça um novo link a quem te convidou.',
  revoked: 'Este convite foi cancelado.',
  accepted: 'Este convite já foi utilizado.',
}

export function AcceptInvitePage() {
  const { token = '' } = useParams()
  const { refresh, select, memberships } = useHousehold()
  const navigate = useNavigate()
  const [preview, setPreview] = useState<InvitePreview | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let active = true
    getInvitePreview(token)
      .then((p) => active && setPreview(p))
      .catch((e) => {
        if (!active) return
        setPreview(null)
        setError(toMessage(e))
      })
    return () => {
      active = false
    }
  }, [token])

  async function onAccept() {
    setError(null)
    setLoading(true)
    try {
      const householdId = await acceptInvite(token)
      await refresh()
      select(householdId)
      navigate('/', { replace: true })
    } catch (e) {
      setError(toMessage(e))
      setLoading(false)
    }
  }

  if (!token) return <Navigate to="/" replace />
  if (preview === undefined) return <FullPageSpinner />

  if (!preview || preview.status !== 'valid') {
    return (
      <AuthLayout
        title="Convite indisponível"
        subtitle={preview ? STATUS_MESSAGE[preview.status] : (error ?? 'Não encontramos este convite.')}
      >
        <div className="space-y-3">
          <div className="grid size-12 place-items-center rounded-xl bg-surface-muted text-fg-muted">
            <Link2Off className="size-6" strokeWidth={1.75} />
          </div>
          <Button variant="secondary" block onClick={() => navigate('/', { replace: true })}>
            {memberships.length ? 'Ir para o início' : 'Criar minha própria família'}
          </Button>
        </div>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      title={`Entrar em “${preview.householdName}”`}
      subtitle={
        <>
          Seu acesso será de <span className="font-medium text-fg">{ROLE_LABEL[preview.role].toLowerCase()}</span>.
          Ao aceitar, você passa a compartilhar os mesmos produtos, estoques e listas.
        </>
      }
    >
      <div className="space-y-3">
        {error && <Alert>{error}</Alert>}
        <Button block loading={loading} onClick={onAccept}>
          Aceitar convite
        </Button>
        <Button variant="ghost" block onClick={() => navigate('/', { replace: true })}>
          Agora não
        </Button>
      </div>
    </AuthLayout>
  )
}
