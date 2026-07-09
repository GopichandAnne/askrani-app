export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      agent_config: {
        Row: {
          created_at: string
          id: string
          key: Database["public"]["Enums"]["agent_config_key"]
          store_id: string
          updated_at: string
          updated_by: string | null
          value: string | null
          version: number
        }
        Insert: {
          created_at?: string
          id?: string
          key: Database["public"]["Enums"]["agent_config_key"]
          store_id: string
          updated_at?: string
          updated_by?: string | null
          value?: string | null
          version?: number
        }
        Update: {
          created_at?: string
          id?: string
          key?: Database["public"]["Enums"]["agent_config_key"]
          store_id?: string
          updated_at?: string
          updated_by?: string | null
          value?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "agent_config_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_config_history: {
        Row: {
          config_id: string | null
          created_at: string
          id: string
          key: Database["public"]["Enums"]["agent_config_key"]
          store_id: string
          updated_by: string | null
          value: string | null
          version: number
        }
        Insert: {
          config_id?: string | null
          created_at?: string
          id?: string
          key: Database["public"]["Enums"]["agent_config_key"]
          store_id: string
          updated_by?: string | null
          value?: string | null
          version: number
        }
        Update: {
          config_id?: string | null
          created_at?: string
          id?: string
          key?: Database["public"]["Enums"]["agent_config_key"]
          store_id?: string
          updated_by?: string | null
          value?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "agent_config_history_config_id_fkey"
            columns: ["config_id"]
            isOneToOne: false
            referencedRelation: "agent_config"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_config_history_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      carts: {
        Row: {
          created_at: string
          currency: string | null
          customer_name: string | null
          id: string
          items: Json
          session_id: string
          store_slug: string
          subtotal: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          currency?: string | null
          customer_name?: string | null
          id?: string
          items?: Json
          session_id: string
          store_slug: string
          subtotal?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          currency?: string | null
          customer_name?: string | null
          id?: string
          items?: Json
          session_id?: string
          store_slug?: string
          subtotal?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "carts_store_slug_fkey"
            columns: ["store_slug"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["slug"]
          },
        ]
      }
      conversations: {
        Row: {
          analytics_json: string | null
          assistant_response: string | null
          conversation_id: string
          created_at: string
          device_type: Database["public"]["Enums"]["device_type"] | null
          id: string
          response_time_ms: number | null
          session_id: string | null
          store_slug: string
          synced_to_master: boolean
          timestamp: string | null
          updated_at: string
          user_message: string | null
        }
        Insert: {
          analytics_json?: string | null
          assistant_response?: string | null
          conversation_id: string
          created_at?: string
          device_type?: Database["public"]["Enums"]["device_type"] | null
          id?: string
          response_time_ms?: number | null
          session_id?: string | null
          store_slug: string
          synced_to_master?: boolean
          timestamp?: string | null
          updated_at?: string
          user_message?: string | null
        }
        Update: {
          analytics_json?: string | null
          assistant_response?: string | null
          conversation_id?: string
          created_at?: string
          device_type?: Database["public"]["Enums"]["device_type"] | null
          id?: string
          response_time_ms?: number | null
          session_id?: string | null
          store_slug?: string
          synced_to_master?: boolean
          timestamp?: string | null
          updated_at?: string
          user_message?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conversations_store_slug_fkey"
            columns: ["store_slug"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["slug"]
          },
        ]
      }
      knowledge_index: {
        Row: {
          chunk_index: number
          chunk_text: string
          created_at: string
          embedded_at: string | null
          embedding: string | null
          embedding_stale: boolean
          id: string
          kind: string
          source_mime: string | null
          source_path: string | null
          source_ref: string | null
          store_id: string
          token_count: number | null
          updated_at: string
        }
        Insert: {
          chunk_index?: number
          chunk_text: string
          created_at?: string
          embedded_at?: string | null
          embedding?: string | null
          embedding_stale?: boolean
          id?: string
          kind: string
          source_mime?: string | null
          source_path?: string | null
          source_ref?: string | null
          store_id: string
          token_count?: number | null
          updated_at?: string
        }
        Update: {
          chunk_index?: number
          chunk_text?: string
          created_at?: string
          embedded_at?: string | null
          embedding?: string | null
          embedding_stale?: boolean
          id?: string
          kind?: string
          source_mime?: string | null
          source_path?: string | null
          source_ref?: string | null
          store_id?: string
          token_count?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_index_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      order_counters: {
        Row: {
          seq: number
          store_slug: string
          year: number
        }
        Insert: {
          seq?: number
          store_slug: string
          year: number
        }
        Update: {
          seq?: number
          store_slug?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_counters_store_slug_fkey"
            columns: ["store_slug"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["slug"]
          },
        ]
      }
      orders: {
        Row: {
          created_at: string
          currency: string | null
          customer_name: string | null
          customer_phone: string | null
          fulfillment: Database["public"]["Enums"]["fulfillment_type"] | null
          id: string
          items_json: Json
          notes: string | null
          order_id: string
          order_mode: Database["public"]["Enums"]["order_mode"]
          session_id: string | null
          source_channel: string | null
          status: Database["public"]["Enums"]["order_status"]
          store_slug: string
          subtotal: number | null
          tax: number | null
          timestamp: string | null
          total: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          currency?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          fulfillment?: Database["public"]["Enums"]["fulfillment_type"] | null
          id?: string
          items_json?: Json
          notes?: string | null
          order_id: string
          order_mode?: Database["public"]["Enums"]["order_mode"]
          session_id?: string | null
          source_channel?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          store_slug: string
          subtotal?: number | null
          tax?: number | null
          timestamp?: string | null
          total?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          currency?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          fulfillment?: Database["public"]["Enums"]["fulfillment_type"] | null
          id?: string
          items_json?: Json
          notes?: string | null
          order_id?: string
          order_mode?: Database["public"]["Enums"]["order_mode"]
          session_id?: string | null
          source_channel?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          store_slug?: string
          subtotal?: number | null
          tax?: number | null
          timestamp?: string | null
          total?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_store_slug_fkey"
            columns: ["store_slug"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["slug"]
          },
        ]
      }
      platform_admins: {
        Row: {
          created_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          user_id?: string
        }
        Relationships: []
      }
      products: {
        Row: {
          brand: string | null
          category: string | null
          created_at: string
          created_by: string | null
          currency: string
          embedded_at: string | null
          embedding: string | null
          embedding_stale: boolean
          id: string
          in_stock: boolean
          name: string
          price: number | null
          size: string | null
          sku: string | null
          store_id: string
          unit: string | null
          updated_at: string
          verified: boolean
        }
        Insert: {
          brand?: string | null
          category?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          embedded_at?: string | null
          embedding?: string | null
          embedding_stale?: boolean
          id?: string
          in_stock?: boolean
          name: string
          price?: number | null
          size?: string | null
          sku?: string | null
          store_id: string
          unit?: string | null
          updated_at?: string
          verified?: boolean
        }
        Update: {
          brand?: string | null
          category?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          embedded_at?: string | null
          embedding?: string | null
          embedding_stale?: boolean
          id?: string
          in_stock?: boolean
          name?: string
          price?: number | null
          size?: string | null
          sku?: string | null
          store_id?: string
          unit?: string | null
          updated_at?: string
          verified?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "products_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_qa: {
        Row: {
          active: boolean
          answer: string | null
          category: string | null
          created_at: string
          created_by: string | null
          id: string
          last_used: string | null
          question: string
          source_session: string | null
          store_id: string
          times_used: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          answer?: string | null
          category?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          last_used?: string | null
          question: string
          source_session?: string | null
          store_id: string
          times_used?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          answer?: string | null
          category?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          last_used?: string | null
          question?: string
          source_session?: string | null
          store_id?: string
          times_used?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_qa_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      staff: {
        Row: {
          created_at: string
          id: string
          name: string | null
          role: Database["public"]["Enums"]["staff_role"]
          status: Database["public"]["Enums"]["staff_status"]
          store_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name?: string | null
          role?: Database["public"]["Enums"]["staff_role"]
          status?: Database["public"]["Enums"]["staff_status"]
          store_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string | null
          role?: Database["public"]["Enums"]["staff_role"]
          status?: Database["public"]["Enums"]["staff_status"]
          store_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      store_responders: {
        Row: {
          active: boolean
          created_at: string
          id: string
          name: string | null
          notify_escalations: boolean
          notify_orders: boolean
          phone: string
          role: Database["public"]["Enums"]["staff_role"]
          store_slug: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          name?: string | null
          notify_escalations?: boolean
          notify_orders?: boolean
          phone: string
          role?: Database["public"]["Enums"]["staff_role"]
          store_slug: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          name?: string | null
          notify_escalations?: boolean
          notify_orders?: boolean
          phone?: string
          role?: Database["public"]["Enums"]["staff_role"]
          store_slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "store_responders_store_slug_fkey"
            columns: ["store_slug"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["slug"]
          },
        ]
      }
      store_secrets: {
        Row: {
          created_at: string
          store_id: string
          updated_at: string
          whatsapp_access_token: string | null
          whatsapp_verify_token: string | null
        }
        Insert: {
          created_at?: string
          store_id: string
          updated_at?: string
          whatsapp_access_token?: string | null
          whatsapp_verify_token?: string | null
        }
        Update: {
          created_at?: string
          store_id?: string
          updated_at?: string
          whatsapp_access_token?: string | null
          whatsapp_verify_token?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "store_secrets_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: true
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      store_tokens: {
        Row: {
          active: boolean
          created_at: string
          expires_at: string | null
          id: string
          label: string | null
          store_id: string
          token: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          expires_at?: string | null
          id?: string
          label?: string | null
          store_id: string
          token: string
        }
        Update: {
          active?: boolean
          created_at?: string
          expires_at?: string | null
          id?: string
          label?: string | null
          store_id?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "store_tokens_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      stores: {
        Row: {
          active: boolean
          analytics_sheet_id: string | null
          business_modes: string | null
          business_type: string | null
          created_at: string
          current_cache_expires_at: string | null
          current_cache_name: string | null
          details_folder_id: string | null
          id: string
          location_folder_id: string | null
          pricing_file_id: string | null
          pricing_folder_id: string | null
          product_source: string | null
          prompt_file_id: string | null
          session_minutes: number
          slug: string
          store_display_name: string | null
          store_folder_id: string | null
          updated_at: string
          web_chat_paused: boolean
          whatsapp_display_number: string | null
          whatsapp_phone_number_id: string | null
          whatsapp_redirect_enabled: boolean
          whatsapp_status: string | null
          whatsapp_waba_id: string | null
        }
        Insert: {
          active?: boolean
          analytics_sheet_id?: string | null
          business_modes?: string | null
          business_type?: string | null
          created_at?: string
          current_cache_expires_at?: string | null
          current_cache_name?: string | null
          details_folder_id?: string | null
          id?: string
          location_folder_id?: string | null
          pricing_file_id?: string | null
          pricing_folder_id?: string | null
          product_source?: string | null
          prompt_file_id?: string | null
          session_minutes?: number
          slug: string
          store_display_name?: string | null
          store_folder_id?: string | null
          updated_at?: string
          web_chat_paused?: boolean
          whatsapp_display_number?: string | null
          whatsapp_phone_number_id?: string | null
          whatsapp_redirect_enabled?: boolean
          whatsapp_status?: string | null
          whatsapp_waba_id?: string | null
        }
        Update: {
          active?: boolean
          analytics_sheet_id?: string | null
          business_modes?: string | null
          business_type?: string | null
          created_at?: string
          current_cache_expires_at?: string | null
          current_cache_name?: string | null
          details_folder_id?: string | null
          id?: string
          location_folder_id?: string | null
          pricing_file_id?: string | null
          pricing_folder_id?: string | null
          product_source?: string | null
          prompt_file_id?: string | null
          session_minutes?: number
          slug?: string
          store_display_name?: string | null
          store_folder_id?: string | null
          updated_at?: string
          web_chat_paused?: boolean
          whatsapp_display_number?: string | null
          whatsapp_phone_number_id?: string | null
          whatsapp_redirect_enabled?: boolean
          whatsapp_status?: string | null
          whatsapp_waba_id?: string | null
        }
        Relationships: []
      }
      thread_messages: {
        Row: {
          created_at: string
          customer_phone: string | null
          direction: Database["public"]["Enums"]["message_direction"] | null
          event_payload_json: Json | null
          event_type: string | null
          id: string
          kind: Database["public"]["Enums"]["message_kind"]
          media_url: string | null
          message_id: string
          related_order_id: string | null
          sender: string | null
          store_slug: string
          text: string | null
          thread_id: string
          wamid: string | null
        }
        Insert: {
          created_at?: string
          customer_phone?: string | null
          direction?: Database["public"]["Enums"]["message_direction"] | null
          event_payload_json?: Json | null
          event_type?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["message_kind"]
          media_url?: string | null
          message_id: string
          related_order_id?: string | null
          sender?: string | null
          store_slug: string
          text?: string | null
          thread_id: string
          wamid?: string | null
        }
        Update: {
          created_at?: string
          customer_phone?: string | null
          direction?: Database["public"]["Enums"]["message_direction"] | null
          event_payload_json?: Json | null
          event_type?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["message_kind"]
          media_url?: string | null
          message_id?: string
          related_order_id?: string | null
          sender?: string | null
          store_slug?: string
          text?: string | null
          thread_id?: string
          wamid?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "thread_messages_store_slug_fkey"
            columns: ["store_slug"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["slug"]
          },
          {
            foreignKeyName: "thread_messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "threads"
            referencedColumns: ["thread_id"]
          },
        ]
      }
      threads: {
        Row: {
          activated_at: string | null
          activated_by: string | null
          created_at: string
          customer_name: string | null
          customer_phone: string | null
          id: string
          last_message_at: string | null
          message_count: number
          resolved_at: string | null
          resolved_by: string | null
          routing_state: Database["public"]["Enums"]["routing_state"]
          store_slug: string
          thread_id: string
          updated_at: string
        }
        Insert: {
          activated_at?: string | null
          activated_by?: string | null
          created_at?: string
          customer_name?: string | null
          customer_phone?: string | null
          id?: string
          last_message_at?: string | null
          message_count?: number
          resolved_at?: string | null
          resolved_by?: string | null
          routing_state?: Database["public"]["Enums"]["routing_state"]
          store_slug: string
          thread_id: string
          updated_at?: string
        }
        Update: {
          activated_at?: string | null
          activated_by?: string | null
          created_at?: string
          customer_name?: string | null
          customer_phone?: string | null
          id?: string
          last_message_at?: string | null
          message_count?: number
          resolved_at?: string | null
          resolved_by?: string | null
          routing_state?: Database["public"]["Enums"]["routing_state"]
          store_slug?: string
          thread_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "threads_store_slug_fkey"
            columns: ["store_slug"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["slug"]
          },
        ]
      }
      tickets: {
        Row: {
          answer: string | null
          answered_at: string | null
          answered_by: string | null
          created_at: string
          customer_name: string | null
          customer_phone: string | null
          id: string
          question: string | null
          saved_to_kb: boolean
          session_id: string | null
          status: Database["public"]["Enums"]["ticket_status"]
          store_slug: string
          ticket_id: string
          updated_at: string
        }
        Insert: {
          answer?: string | null
          answered_at?: string | null
          answered_by?: string | null
          created_at?: string
          customer_name?: string | null
          customer_phone?: string | null
          id?: string
          question?: string | null
          saved_to_kb?: boolean
          session_id?: string | null
          status?: Database["public"]["Enums"]["ticket_status"]
          store_slug: string
          ticket_id: string
          updated_at?: string
        }
        Update: {
          answer?: string | null
          answered_at?: string | null
          answered_by?: string | null
          created_at?: string
          customer_name?: string | null
          customer_phone?: string | null
          id?: string
          question?: string | null
          saved_to_kb?: boolean
          session_id?: string | null
          status?: Database["public"]["Enums"]["ticket_status"]
          store_slug?: string
          ticket_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tickets_store_slug_fkey"
            columns: ["store_slug"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["slug"]
          },
        ]
      }
      waitlist: {
        Row: {
          business_name: string
          business_type: string | null
          city: string | null
          comments: string | null
          created_at: string
          email: string
          full_name: string
          hear_about: string | null
          id: string
          phone: string | null
          source: string
          state: string | null
        }
        Insert: {
          business_name: string
          business_type?: string | null
          city?: string | null
          comments?: string | null
          created_at?: string
          email: string
          full_name: string
          hear_about?: string | null
          id?: string
          phone?: string | null
          source?: string
          state?: string | null
        }
        Update: {
          business_name?: string
          business_type?: string | null
          city?: string | null
          comments?: string | null
          created_at?: string
          email?: string
          full_name?: string
          hear_about?: string | null
          id?: string
          phone?: string | null
          source?: string
          state?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_public_store: { Args: { p_slug: string }; Returns: Json }
      is_platform_admin: { Args: never; Returns: boolean }
      next_order_seq: {
        Args: { p_store_slug: string; p_year: number }
        Returns: number
      }
      search_knowledge: {
        Args: {
          p_limit?: number
          p_query_embedding: string
          p_store_id: string
        }
        Returns: {
          chunk_text: string
          distance: number
          kind: string
          source_ref: string
        }[]
      }
      search_products: {
        Args: {
          p_limit?: number
          p_pool?: number
          p_query: string
          p_query_embedding: string
          p_rrf_k?: number
          p_store_id: string
        }
        Returns: {
          brand: string
          category: string
          currency: string
          id: string
          in_stock: boolean
          name: string
          price: number
          score: number
          size: string
          sku: string
          unit: string
        }[]
      }
      user_is_owner: { Args: { p_store_id: string }; Returns: boolean }
      user_store_ids: { Args: never; Returns: string[] }
      user_store_slugs: { Args: never; Returns: string[] }
      validate_store_token: {
        Args: { p_slug: string; p_token: string }
        Returns: Json
      }
    }
    Enums: {
      agent_config_key:
        | "personality"
        | "off_topic_handling"
        | "language_handling"
        | "engage_info"
        | "store_prompt"
        | "suggestion_chips"
        | "tax_rate"
        | "history_turns"
        | "order_prompt"
        | "orders_enabled"
        | "store_layout"
        | "timezone"
        | "store_hours"
        | "catalog_enabled"
        | "promotions"
        | "followup_enabled"
        | "followup_minutes"
      device_type: "whatsapp" | "web"
      fulfillment_type: "pickup" | "delivery"
      message_direction: "inbound" | "outbound" | "system"
      message_kind: "message" | "event"
      order_mode: "standard" | "request"
      order_status:
        | "placed"
        | "submitted"
        | "pending_approval"
        | "proposed"
        | "confirmed"
        | "rejected"
        | "cancelled"
      routing_state: "idle" | "active_owner_handling"
      staff_role: "owner" | "staff"
      staff_status: "active" | "inactive"
      ticket_status: "created" | "sent_to_owner" | "answered" | "timed_out"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      agent_config_key: [
        "personality",
        "off_topic_handling",
        "language_handling",
        "engage_info",
        "store_prompt",
        "suggestion_chips",
        "tax_rate",
        "history_turns",
        "order_prompt",
        "orders_enabled",
        "store_layout",
        "timezone",
        "store_hours",
        "catalog_enabled",
        "promotions",
        "followup_enabled",
        "followup_minutes",
      ],
      device_type: ["whatsapp", "web"],
      fulfillment_type: ["pickup", "delivery"],
      message_direction: ["inbound", "outbound", "system"],
      message_kind: ["message", "event"],
      order_mode: ["standard", "request"],
      order_status: [
        "placed",
        "submitted",
        "pending_approval",
        "proposed",
        "confirmed",
        "rejected",
        "cancelled",
      ],
      routing_state: ["idle", "active_owner_handling"],
      staff_role: ["owner", "staff"],
      staff_status: ["active", "inactive"],
      ticket_status: ["created", "sent_to_owner", "answered", "timed_out"],
    },
  },
} as const
