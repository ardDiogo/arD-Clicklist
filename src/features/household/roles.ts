import type { HouseholdRole } from '@/integrations/supabase/database.types'

export const ROLE_LABEL: Record<HouseholdRole, string> = {
  admin: 'Administrador',
  editor: 'Editor',
  viewer: 'Leitor',
}

export const ROLE_DESCRIPTION: Record<HouseholdRole, string> = {
  admin: 'Edita tudo e gerencia membros e convites.',
  editor: 'Edita listas, estoque, produtos e compras.',
  viewer: 'Apenas visualiza.',
}

/**
 * Espelho no front-end das regras do banco — serve só para esconder/mostrar
 * ações. A autorização real é feita pelo RLS e pelas funções SQL.
 */
export const can = {
  manageMembers: (role: HouseholdRole | null | undefined) => role === 'admin',
  edit: (role: HouseholdRole | null | undefined) => role === 'admin' || role === 'editor',
}

export function inviteUrl(origin: string, token: string): string {
  return `${origin.replace(/\/$/, '')}/convite/${encodeURIComponent(token)}`
}
