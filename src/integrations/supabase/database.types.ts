/**
 * Tipos do banco no formato gerado pelo Supabase.
 * Escrito à mão para a Fase 1; quando o projeto Supabase existir, regenere com:
 *   npx supabase gen types typescript --project-id <id> > src/integrations/supabase/database.types.ts
 */
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type HouseholdRole = 'admin' | 'editor' | 'viewer'
export type MeasureUnit = 'un' | 'g' | 'kg' | 'ml' | 'l'
export type StockMovementType = 'purchase' | 'consumption' | 'inventory_adjustment' | 'correction' | 'transfer'
export type StockMovementSource = 'manual' | 'purchase' | 'inventory_scan' | 'system'
export type StockStatus = 'untracked' | 'out' | 'low' | 'ok'
export type ShoppingListStatus = 'open' | 'completed' | 'cancelled'
export type ShoppingItemOrigin = 'manual' | 'stock' | 'suggestion'
export type PurchaseStatus = 'draft' | 'confirmed' | 'discarded'
export type PurchaseSource = 'nfce_qrcode' | 'xml' | 'photo' | 'manual'
export type InventoryScanStatus = 'draft' | 'confirmed' | 'discarded'
export type InventoryItemOrigin = 'detected' | 'expected'
export type InventoryItemStatus = 'pending' | 'confirmed' | 'ignored'

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
      categories: {
        Row: {
          id: string
          household_id: string | null
          name: string
          icon: string | null
          sort_order: number
          created_at: string
          updated_at: string
          archived_at: string | null
        }
        Insert: { household_id: string; name: string; icon?: string | null; sort_order?: number }
        Update: { name?: string; icon?: string | null; sort_order?: number; archived_at?: string | null }
        Relationships: []
      }
      brands: {
        Row: { id: string; household_id: string | null; name: string; created_at: string; updated_at: string }
        Insert: { household_id: string; name: string }
        Update: { name?: string }
        Relationships: []
      }
      products: {
        Row: {
          id: string
          household_id: string | null
          name: string
          brand_id: string | null
          category_id: string | null
          barcode: string | null
          presentation: string | null
          package_size: number | null
          unit: MeasureUnit
          description: string | null
          image_path: string | null
          created_by: string | null
          created_at: string
          updated_at: string
          deleted_at: string | null
        }
        Insert: never
        Update: never
        Relationships: []
      }
      locations: {
        Row: {
          id: string
          household_id: string
          name: string
          sort_order: number
          created_at: string
          updated_at: string
          archived_at: string | null
        }
        Insert: { household_id: string; name: string; sort_order?: number }
        Update: { name?: string; sort_order?: number }
        Relationships: []
      }
      household_products: {
        Row: {
          id: string
          household_id: string
          product_id: string
          location_id: string | null
          ideal_qty: number
          current_qty: number
          notes: string | null
          last_movement_at: string | null
          created_by: string | null
          created_at: string
          updated_at: string
          archived_at: string | null
        }
        Insert: never
        Update: { ideal_qty?: number; notes?: string | null }
        Relationships: []
      }
      stock_movements: {
        Row: {
          id: string
          household_id: string
          household_product_id: string
          type: StockMovementType
          source: StockMovementSource
          source_id: string | null
          quantity_delta: number
          quantity_before: number
          quantity_after: number
          from_location_id: string | null
          to_location_id: string | null
          note: string | null
          idempotency_key: string | null
          created_by: string | null
          created_at: string
        }
        Insert: never
        Update: never
        Relationships: []
      }
      shopping_lists: {
        Row: {
          id: string
          household_id: string
          name: string
          status: ShoppingListStatus
          stock_applied_at: string | null
          created_by: string | null
          completed_by: string | null
          created_at: string
          updated_at: string
          completed_at: string | null
        }
        Insert: never
        Update: never
        Relationships: []
      }
      shopping_list_items: {
        Row: {
          id: string
          list_id: string
          household_id: string
          household_product_id: string | null
          custom_name: string | null
          quantity: number
          origin: ShoppingItemOrigin
          manually_edited: boolean
          estimated_unit_price: number | null
          notes: string | null
          checked_at: string | null
          checked_by: string | null
          removed_at: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: never
        Update: never
        Relationships: []
      }
      purchases: {
        Row: {
          id: string
          household_id: string
          status: PurchaseStatus
          source: PurchaseSource
          store_name: string | null
          store_cnpj: string | null
          purchased_at: string | null
          access_key: string | null
          file_sha256: string | null
          source_url: string | null
          total_amount: number | null
          discount_amount: number | null
          raw_extraction: Json
          notes: string | null
          created_by: string | null
          confirmed_by: string | null
          confirmed_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: never
        Update: never
        Relationships: []
      }
      purchase_files: {
        Row: {
          id: string
          household_id: string
          purchase_id: string | null
          storage_path: string
          mime_type: string
          size_bytes: number
          sha256: string
          created_by: string | null
          created_at: string
        }
        Insert: never
        Update: never
        Relationships: []
      }
      purchase_items: {
        Row: {
          id: string
          purchase_id: string
          household_id: string
          line_number: number
          description: string
          ean: string | null
          quantity: number
          unit: string | null
          unit_price: number | null
          discount: number
          total_price: number
          household_product_id: string | null
          match_source: 'alias_ean' | 'barcode' | 'alias_description' | 'user' | null
          received: boolean
          ignored: boolean
          stock_quantity: number
          unit_cost: number | null
          hint: string | null
          created_at: string
          updated_at: string
        }
        Insert: never
        Update: never
        Relationships: []
      }
      inventory_scans: {
        Row: {
          id: string
          household_id: string
          location_id: string | null
          status: InventoryScanStatus
          model: string | null
          analyzed_at: string | null
          notes: string | null
          created_by: string | null
          confirmed_by: string | null
          confirmed_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: never
        Update: never
        Relationships: []
      }
      inventory_scan_files: {
        Row: {
          id: string
          scan_id: string
          household_id: string
          position: number
          storage_path: string
          mime_type: string
          size_bytes: number
          sha256: string
          created_by: string | null
          created_at: string
        }
        Insert: never
        Update: never
        Relationships: []
      }
      inventory_scan_items: {
        Row: {
          id: string
          scan_id: string
          household_id: string
          origin: InventoryItemOrigin
          household_product_id: string | null
          detected_name: string | null
          detected_brand: string | null
          detected_details: string | null
          estimated_quantity: number | null
          confidence: number | null
          partially_hidden: boolean
          photo_positions: number[]
          system_quantity: number | null
          confirmed_quantity: number | null
          status: InventoryItemStatus
          created_at: string
          updated_at: string
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
    Views: {
      household_stock: {
        Row: {
          id: string
          household_id: string
          product_id: string
          product_name: string
          presentation: string | null
          package_size: number | null
          unit: MeasureUnit
          barcode: string | null
          brand_id: string | null
          brand_name: string | null
          category_id: string | null
          category_name: string | null
          category_sort: number | null
          location_id: string | null
          location_name: string | null
          location_sort: number | null
          ideal_qty: number
          current_qty: number
          to_buy_qty: number
          status: StockStatus
          notes: string | null
          last_movement_at: string | null
          created_at: string
          updated_at: string
        }
        Relationships: []
      }
      product_price_history: {
        Row: {
          id: string
          household_id: string
          household_product_id: string
          purchase_id: string
          store_name: string | null
          store_cnpj: string | null
          purchased_at: string
          description: string
          quantity: number
          unit: string | null
          unit_price: number | null
          discount: number
          total_price: number
          stock_quantity: number
          unit_cost: number
        }
        Relationships: []
      }
      household_product_prices: {
        Row: {
          household_product_id: string
          household_id: string
          purchases: number
          last_price: number
          last_store: string | null
          last_purchased_at: string
          avg_price: number
          min_price: number
          max_price: number
          previous_price: number | null
        }
        Relationships: []
      }
      shopping_list_items_view: {
        Row: {
          id: string
          list_id: string
          household_id: string
          household_product_id: string | null
          name: string
          presentation: string | null
          package_size: number | null
          unit: MeasureUnit | null
          brand_name: string | null
          category_id: string | null
          category_name: string
          category_sort: number
          location_name: string | null
          ideal_qty: number | null
          current_qty: number | null
          quantity: number
          origin: ShoppingItemOrigin
          manually_edited: boolean
          estimated_unit_price: number | null
          estimated_total: number | null
          notes: string | null
          checked_at: string | null
          checked_by: string | null
          created_at: string
          updated_at: string
        }
        Relationships: []
      }
    }
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
      create_tracked_product: {
        Args: TrackedProductArgs & {
          p_household_id: string
          p_location_id?: string | null
          p_current_qty?: number
        }
        Returns: string
      }
      update_tracked_product: {
        Args: TrackedProductArgs & { p_household_product_id: string }
        Returns: undefined
      }
      record_stock_movement: {
        Args: {
          p_household_product_id: string
          p_type: StockMovementType
          p_quantity: number
          p_note?: string | null
          p_idempotency_key?: string | null
        }
        Returns: string
      }
      transfer_household_product: {
        Args: { p_household_product_id: string; p_to_location_id: string; p_note?: string | null }
        Returns: string
      }
      archive_household_product: { Args: { p_household_product_id: string }; Returns: undefined }
      archive_location: { Args: { p_location_id: string }; Returns: undefined }
      get_or_create_open_list: { Args: { p_household_id: string }; Returns: string | null }
      generate_shopping_list: {
        Args: { p_household_id: string }
        Returns: { list_id: string; added: number; updated: number; removed: number }[]
      }
      add_product_to_list: {
        Args: { p_list_id: string; p_household_product_id: string; p_quantity?: number }
        Returns: string
      }
      add_custom_item_to_list: {
        Args: { p_list_id: string; p_name: string; p_quantity?: number }
        Returns: string
      }
      update_list_item: {
        Args: { p_item_id: string; p_quantity: number; p_estimated_unit_price?: number | null; p_notes?: string | null }
        Returns: undefined
      }
      set_list_item_checked: { Args: { p_item_id: string; p_checked: boolean }; Returns: undefined }
      remove_list_item: { Args: { p_item_id: string }; Returns: undefined }
      complete_shopping_list: {
        Args: { p_list_id: string; p_apply_to_stock?: boolean }
        Returns: { applied_items: number }[]
      }
      register_purchase_file: {
        Args: { p_household_id: string; p_storage_path: string; p_mime_type: string; p_size_bytes: number; p_sha256: string }
        Returns: string
      }
      create_purchase_draft: {
        Args: { p_household_id: string; p_source: PurchaseSource; p_data: Json; p_file_id?: string | null }
        Returns: string
      }
      update_purchase_item: {
        Args: {
          p_item_id: string
          p_household_product_id: string | null
          p_received: boolean
          p_ignored: boolean
          p_stock_quantity: number
        }
        Returns: undefined
      }
      update_purchase_header: {
        Args: { p_purchase_id: string; p_store_name: string | null; p_purchased_at: string | null }
        Returns: undefined
      }
      confirm_purchase: { Args: { p_purchase_id: string }; Returns: { applied_items: number }[] }
      discard_purchase: { Args: { p_purchase_id: string }; Returns: undefined }
      create_inventory_scan: { Args: { p_household_id: string; p_location_id?: string | null }; Returns: string }
      register_inventory_photo: {
        Args: { p_scan_id: string; p_position: number; p_storage_path: string; p_mime_type: string; p_size_bytes: number; p_sha256: string }
        Returns: string
      }
      save_inventory_detections: { Args: { p_scan_id: string; p_detections: Json; p_model?: string | null }; Returns: number }
      update_inventory_item: {
        Args: {
          p_item_id: string
          p_household_product_id: string | null
          p_confirmed_quantity: number | null
          p_status: InventoryItemStatus
        }
        Returns: undefined
      }
      confirm_inventory_scan: { Args: { p_scan_id: string }; Returns: { adjusted_items: number }[] }
      discard_inventory_scan: { Args: { p_scan_id: string }; Returns: undefined }
      remove_household_member: {
        Args: { p_household_id: string; p_user_id: string }
        Returns: undefined
      }
    }
    Enums: {
      household_role: HouseholdRole
      measure_unit: MeasureUnit
      stock_movement_type: StockMovementType
      stock_movement_source: StockMovementSource
      shopping_list_status: ShoppingListStatus
      shopping_item_origin: ShoppingItemOrigin
      purchase_status: PurchaseStatus
      purchase_source: PurchaseSource
      inventory_scan_status: InventoryScanStatus
      inventory_item_origin: InventoryItemOrigin
      inventory_item_status: InventoryItemStatus
    }
    CompositeTypes: { [_ in never]: never }
  }
}

type TrackedProductArgs = {
  p_name: string
  p_brand_name?: string | null
  p_category_id?: string | null
  p_presentation?: string | null
  p_package_size?: number | null
  p_unit?: MeasureUnit
  p_barcode?: string | null
  p_ideal_qty?: number
  p_notes?: string | null
}

export type InviteStatus = 'valid' | 'expired' | 'revoked' | 'accepted'

type PublicTables = Database['public']['Tables']
export type Tables<T extends keyof PublicTables> = PublicTables[T]['Row']
export type Views<T extends keyof Database['public']['Views']> = Database['public']['Views'][T]['Row']
