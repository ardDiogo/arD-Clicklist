import { AuthLayout } from '@/components/layout/AuthLayout'

/** Exibida quando o .env não tem as credenciais do Supabase. */
export function SetupRequired() {
  return (
    <AuthLayout
      title="Configuração necessária"
      subtitle="O app ainda não está conectado a um projeto Supabase."
    >
      <ol className="list-decimal space-y-2 pl-5 text-[14px] leading-6 text-fg-muted">
        <li>Crie um projeto em supabase.com e aplique as migrations de <code>supabase/migrations</code>.</li>
        <li>
          Copie <code>.env.example</code> para <code>.env.local</code> e preencha{' '}
          <code>VITE_SUPABASE_URL</code> e <code>VITE_SUPABASE_ANON_KEY</code>.
        </li>
        <li>Reinicie o servidor de desenvolvimento.</li>
      </ol>
    </AuthLayout>
  )
}
