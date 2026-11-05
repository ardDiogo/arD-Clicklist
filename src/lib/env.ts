/**
 * Variáveis públicas do front-end. Somente a URL e a chave "anon/publishable"
 * do Supabase podem ficar aqui — elas são protegidas pelo RLS.
 * NUNCA coloque a service_role ou chaves de IA em variáveis VITE_*.
 */
export const env = {
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL as string | undefined,
  // Aceita o nome novo do painel do Supabase ("publishable") e o antigo ("anon").
  supabaseAnonKey: (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    import.meta.env.VITE_SUPABASE_ANON_KEY) as string | undefined,
}

export const isSupabaseConfigured = Boolean(env.supabaseUrl && env.supabaseAnonKey)
