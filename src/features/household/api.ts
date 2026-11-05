import { supabase } from '@/integrations/supabase/client'
import type { HouseholdRole, InviteStatus, Tables } from '@/integrations/supabase/database.types'

export interface Membership {
  role: HouseholdRole
  household: Pick<Tables<'households'>, 'id' | 'name' | 'created_at'>
}

export interface Member {
  userId: string
  role: HouseholdRole
  fullName: string | null
  joinedAt: string
}

export type PendingInvite = Pick<
  Tables<'household_invites'>,
  'id' | 'token' | 'email' | 'role' | 'created_at' | 'expires_at'
>

function unwrap<T>(result: { data: T | null; error: unknown }): T {
  if (result.error) throw result.error
  return result.data as T
}

export async function listMyHouseholds(userId: string): Promise<Membership[]> {
  const rows = unwrap(
    await supabase()
      .from('household_members')
      .select('role, household:households!inner(id, name, created_at)')
      .eq('user_id', userId)
      .order('created_at', { ascending: true }),
  )
  return rows.map((r) => ({ role: r.role, household: r.household }))
}

export async function createHousehold(name: string): Promise<string> {
  return unwrap(await supabase().rpc('create_household', { p_name: name.trim() }))
}

export async function renameHousehold(householdId: string, name: string): Promise<void> {
  unwrap(await supabase().rpc('rename_household', { p_household_id: householdId, p_name: name.trim() }))
}

export async function listMembers(householdId: string): Promise<Member[]> {
  const client = supabase()
  const members = unwrap(
    await client
      .from('household_members')
      .select('user_id, role, created_at')
      .eq('household_id', householdId)
      .order('created_at', { ascending: true }),
  )
  const ids = members.map((m) => m.user_id)
  const profiles = ids.length
    ? unwrap(await client.from('profiles').select('id, full_name').in('id', ids))
    : []
  const nameById = new Map(profiles.map((p) => [p.id, p.full_name]))
  return members.map((m) => ({
    userId: m.user_id,
    role: m.role,
    fullName: nameById.get(m.user_id) ?? null,
    joinedAt: m.created_at,
  }))
}

export async function listPendingInvites(householdId: string): Promise<PendingInvite[]> {
  return unwrap(
    await supabase()
      .from('household_invites')
      .select('id, token, email, role, created_at, expires_at')
      .eq('household_id', householdId)
      .is('accepted_at', null)
      .is('revoked_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false }),
  )
}

export async function createInvite(
  householdId: string,
  role: HouseholdRole,
  email?: string,
): Promise<string> {
  return unwrap(
    await supabase().rpc('create_household_invite', {
      p_household_id: householdId,
      p_role: role,
      p_email: email?.trim() || null,
    }),
  )
}

export async function revokeInvite(inviteId: string): Promise<void> {
  unwrap(await supabase().rpc('revoke_household_invite', { p_invite_id: inviteId }))
}

export async function updateMemberRole(
  householdId: string,
  userId: string,
  role: HouseholdRole,
): Promise<void> {
  unwrap(
    await supabase().rpc('update_member_role', {
      p_household_id: householdId,
      p_user_id: userId,
      p_role: role,
    }),
  )
}

export async function removeMember(householdId: string, userId: string): Promise<void> {
  unwrap(
    await supabase().rpc('remove_household_member', { p_household_id: householdId, p_user_id: userId }),
  )
}

export interface InvitePreview {
  householdName: string
  role: HouseholdRole
  status: InviteStatus
}

export async function getInvitePreview(token: string): Promise<InvitePreview | null> {
  const rows = unwrap(await supabase().rpc('get_invite_preview', { p_token: token }))
  const row = rows[0]
  return row ? { householdName: row.household_name, role: row.role, status: row.status } : null
}

export async function acceptInvite(token: string): Promise<string> {
  return unwrap(await supabase().rpc('accept_household_invite', { p_token: token }))
}
