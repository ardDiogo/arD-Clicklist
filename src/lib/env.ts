/**
 * Configuração pública do Supabase.
 *
 * A URL e a chave "publishable" SÃO PÚBLICAS por design: vão para o navegador
 * de qualquer forma e o acesso aos dados é protegido pelo RLS no banco.
 * Por isso há valores padrão aqui, e variáveis VITE_* (Vercel/.env) podem
 * sobrescrevê-los, por exemplo para um projeto de testes.
 *
 * NUNCA coloque a chave secret/service_role ou chaves de IA no front-end.
 */
const DEFAULT_SUPABASE_URL = 'https://ffobtptwztsykwlflnme.supabase.co'
const DEFAULT_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_eOhDEYlgkaMZj8VscjB-Wg_UFYLQs6F'

export const env = {
  supabaseUrl: (import.meta.env.VITE_SUPABASE_URL || DEFAULT_SUPABASE_URL) as string,
  supabaseAnonKey: (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    import.meta.env.VITE_SUPABASE_ANON_KEY ||
    DEFAULT_SUPABASE_PUBLISHABLE_KEY) as string,
}

export const isSupabaseConfigured = Boolean(env.supabaseUrl && env.supabaseAnonKey)
