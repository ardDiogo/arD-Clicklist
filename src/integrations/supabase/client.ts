import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { env, isSupabaseConfigured } from '@/lib/env'
import type { Database } from './database.types'

export type AppSupabaseClient = SupabaseClient<Database>

let client: AppSupabaseClient | null = null

/**
 * Cliente único do Supabase. Lança erro se as variáveis não estiverem
 * configuradas — a UI verifica `isSupabaseConfigured` antes e mostra a tela de setup.
 */
export function supabase(): AppSupabaseClient {
  if (!isSupabaseConfigured) {
    throw new Error('Supabase não configurado: defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY.')
  }
  client ??= createClient<Database>(env.supabaseUrl!, env.supabaseAnonKey!, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  })
  return client
}
