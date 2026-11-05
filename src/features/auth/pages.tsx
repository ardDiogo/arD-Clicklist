import { MailCheck } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router'
import { AuthLayout } from '@/components/layout/AuthLayout'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/Field'
import { Alert } from '@/components/ui/feedback'
import { supabase } from '@/integrations/supabase/client'
import { toMessage } from '@/lib/errors'
import { useAuth } from './AuthProvider'
import { safeNext, withNext } from './redirect'

const MIN_PASSWORD = 8

const linkClass = 'font-medium text-fg underline-offset-4 hover:underline'

// -----------------------------------------------------------------------------
// Login
// -----------------------------------------------------------------------------
export function LoginPage() {
  const { session } = useAuth()
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'))
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  if (session) return <Navigate to={next} replace />

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const { error } = await supabase().auth.signInWithPassword({ email: email.trim(), password })
    setLoading(false)
    if (error) setError(toMessage(error))
  }

  return (
    <AuthLayout
      title="Entrar"
      subtitle="Acesse o estoque e as listas da sua casa."
      footer={
        <>
          Ainda não tem conta?{' '}
          <Link to={withNext('/cadastro', params.get('next'))} className={linkClass}>
            Criar conta
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {error && <Alert>{error}</Alert>}
        <TextField
          label="E-mail"
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <TextField
          label="Senha"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          trailing={
            <Link to="/recuperar-senha" className="text-[13px] text-fg-muted hover:text-fg">
              Esqueceu?
            </Link>
          }
        />
        <Button type="submit" block loading={loading} disabled={!email || !password}>
          Entrar
        </Button>
      </form>
    </AuthLayout>
  )
}

// -----------------------------------------------------------------------------
// Cadastro
// -----------------------------------------------------------------------------
export function SignupPage() {
  const { session } = useAuth()
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'))
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [sentTo, setSentTo] = useState<string | null>(null)

  if (session) return <Navigate to={next} replace />

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (password.length < MIN_PASSWORD) {
      setError(`A senha precisa ter pelo menos ${MIN_PASSWORD} caracteres.`)
      return
    }
    setLoading(true)
    const { data, error } = await supabase().auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: { full_name: name.trim() },
        emailRedirectTo: `${window.location.origin}${next}`,
      },
    })
    setLoading(false)
    if (error) return setError(toMessage(error))
    // Com confirmação de e-mail ativa, não há sessão até o usuário clicar no link.
    if (!data.session) setSentTo(email.trim())
  }

  if (sentTo) {
    return (
      <AuthLayout
        title="Confirme seu e-mail"
        subtitle={
          <>
            Enviamos um link para <span className="font-medium text-fg">{sentTo}</span>. Abra-o neste
            aparelho para ativar sua conta.
          </>
        }
        footer={
          <Link to={withNext('/entrar', params.get('next'))} className={linkClass}>
            Voltar para o login
          </Link>
        }
      >
        <div className="grid size-12 place-items-center rounded-xl bg-accent-50 text-accent-600 dark:bg-accent-700/20">
          <MailCheck className="size-6" strokeWidth={1.75} />
        </div>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      title="Criar conta"
      subtitle="Leva menos de um minuto. Depois você cria ou entra na sua família."
      footer={
        <>
          Já tem conta?{' '}
          <Link to={withNext('/entrar', params.get('next'))} className={linkClass}>
            Entrar
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {error && <Alert>{error}</Alert>}
        <TextField
          label="Seu nome"
          autoComplete="name"
          required
          maxLength={120}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <TextField
          label="E-mail"
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <TextField
          label="Senha"
          type="password"
          autoComplete="new-password"
          required
          hint={`Mínimo de ${MIN_PASSWORD} caracteres.`}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Button type="submit" block loading={loading} disabled={!name.trim() || !email || !password}>
          Criar conta
        </Button>
      </form>
    </AuthLayout>
  )
}

// -----------------------------------------------------------------------------
// Recuperação de senha
// -----------------------------------------------------------------------------
export function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const { error } = await supabase().auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/redefinir-senha`,
    })
    setLoading(false)
    if (error) return setError(toMessage(error))
    setSent(true)
  }

  return (
    <AuthLayout
      title="Recuperar senha"
      subtitle="Informe seu e-mail e enviaremos um link para criar uma nova senha."
      footer={
        <Link to="/entrar" className={linkClass}>
          Voltar para o login
        </Link>
      }
    >
      {sent ? (
        <Alert tone="success">
          Se existir uma conta para <strong>{email.trim()}</strong>, você receberá o link em instantes.
        </Alert>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          {error && <Alert>{error}</Alert>}
          <TextField
            label="E-mail"
            type="email"
            autoComplete="email"
            inputMode="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Button type="submit" block loading={loading} disabled={!email}>
            Enviar link
          </Button>
        </form>
      )}
    </AuthLayout>
  )
}

export function ResetPasswordPage() {
  const { session, loading: authLoading } = useAuth()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (!done) return
    const t = setTimeout(() => navigate('/', { replace: true }), 1500)
    return () => clearTimeout(t)
  }, [done, navigate])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (password.length < MIN_PASSWORD) {
      return setError(`A senha precisa ter pelo menos ${MIN_PASSWORD} caracteres.`)
    }
    if (password !== confirm) return setError('As senhas não conferem.')
    setLoading(true)
    const { error } = await supabase().auth.updateUser({ password })
    setLoading(false)
    if (error) return setError(toMessage(error))
    setDone(true)
  }

  // O link do e-mail cria uma sessão temporária de recuperação.
  if (!authLoading && !session) {
    return (
      <AuthLayout
        title="Link inválido ou expirado"
        subtitle="Solicite um novo link de recuperação para continuar."
        footer={
          <Link to="/recuperar-senha" className={linkClass}>
            Solicitar novo link
          </Link>
        }
      >
        {null}
      </AuthLayout>
    )
  }

  return (
    <AuthLayout title="Nova senha" subtitle="Escolha uma senha nova para sua conta.">
      {done ? (
        <Alert tone="success">Senha alterada. Redirecionando…</Alert>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          {error && <Alert>{error}</Alert>}
          <TextField
            label="Nova senha"
            type="password"
            autoComplete="new-password"
            hint={`Mínimo de ${MIN_PASSWORD} caracteres.`}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <TextField
            label="Confirmar senha"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
          <Button type="submit" block loading={loading} disabled={!password || !confirm}>
            Salvar senha
          </Button>
        </form>
      )}
    </AuthLayout>
  )
}
