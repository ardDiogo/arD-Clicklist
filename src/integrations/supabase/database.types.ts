/**
 * Tipos do banco no formato gerado pelo Supabase.
 * Escrito à mão para a Fase 1; quando o projeto Supabase existir, regenere com:
 *   npx supabase gen types typescript --project-id <id> > src/integrations/supabase/database.types.ts
 */
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type HouseholdRole = 'admin' | 'editor' | 'viewer'

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: { id: string; full_name: string | null; created_at: string; updated_at: string }
        Insert: never
        Update: { full_name?: string | null }
        Relationships: []
      }
      households: {
        Row: {
          id: string
          name: string
          created_by: string | null
          created_at: string
          updated_at: string
          deleted_at: string | null
        }
        Insert: never
        Update: never
        Relationships: []
      }
      household_members: {
        Row: {
          household_id: string
          user_id: string
          role: HouseholdRole
          created_at: string
          updated_at: string
        }
        Insert: never
        Update: never
        Relationships: [
          {
            foreignKeyName: 'household_members_household_id_fkey'
            columns: ['household_id']
            isOneToOne: false
            referencedRelation: 'households'
            referencedColumns: ['id']
          },
        ]
      }
      household_invites: {
        Row: {
          id: string
          household_id: string
          token: string
          email: string | null
          role: HouseholdRole
          created_by: string | null
          created_at: string
          expires_at: string
          accepted_by: string | null
          accepted_at: string | null
          revoked_at: string | null
        }
        Insert: never
        Update: never
        Relationships: []
      }
      audit_log: {
        Row: {
          id: number
          household_id: string | null
          actor_id: string | null
          action: string
          entity: string
          entity_id: string | null
          data: Json
          created_at: string
        }
        Insert: never
        Update: never
        Relationships: []
      }
    }
    Views: { [_ in never]: never }
    Functions: {
      create_household: { Args: { p_name: string }; Returns: string }
      rename_household: { Args: { p_household_id: string; p_name: string }; Returns: undefined }
      create_household_invite: {
        Args: { p_household_id: string; p_role?: HouseholdRole; p_email?: string | null }
        Returns: string
      }
      revoke_household_invite: { Args: { p_invite_id: string }; Returns: undefined }
      get_invite_preview: {
        Args: { p_token: string }
        Returns: { household_name: string; role: HouseholdRole; status: InviteStatus }[]
      }
      accept_household_invite: { Args: { p_token: string }; Returns: string }
      update_member_role: {
        Args: { p_household_id: string; p_user_id: string; p_role: HouseholdRole }
        Returns: undefined
      }
      remove_household_member: {
        Args: { p_household_id: string; p_user_id: string }
        Returns: undefined
      }
    }
    Enums: { household_role: HouseholdRole }
    CompositeTypes: { [_ in never]: never }
  }
}

export type InviteStatus = 'valid' | 'expired' | 'revoked' | 'accepted'

type PublicTables = Database['public']['Tables']
export type Tables<T extends keyof PublicTables> = PublicTables[T]['Row']
