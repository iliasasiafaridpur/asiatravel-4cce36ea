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
      agency_ledger: {
        Row: {
          agent_name: string
          created_at: string
          created_by: string | null
          entry_date: string
          id: string
          ledger_id: string
          passenger_name: string | null
          received_amount: number | null
          received_by: string | null
          remarks: string | null
          service_type: string | null
          source_id: string | null
          source_table: string | null
          total_bill: number | null
          updated_at: string
        }
        Insert: {
          agent_name: string
          created_at?: string
          created_by?: string | null
          entry_date?: string
          id?: string
          ledger_id: string
          passenger_name?: string | null
          received_amount?: number | null
          received_by?: string | null
          remarks?: string | null
          service_type?: string | null
          source_id?: string | null
          source_table?: string | null
          total_bill?: number | null
          updated_at?: string
        }
        Update: {
          agent_name?: string
          created_at?: string
          created_by?: string | null
          entry_date?: string
          id?: string
          ledger_id?: string
          passenger_name?: string | null
          received_amount?: number | null
          received_by?: string | null
          remarks?: string | null
          service_type?: string | null
          source_id?: string | null
          source_table?: string | null
          total_bill?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      agents: {
        Row: {
          address: string | null
          agent_code: string
          created_at: string
          id: string
          name: string
          notes: string | null
          phone: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          agent_code: string
          created_at?: string
          id?: string
          name: string
          notes?: string | null
          phone?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          agent_code?: string
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      bmet_cards: {
        Row: {
          agency_sold: string | null
          attested_date: string | null
          bmet_id: string
          cost_price: number | null
          country_name: string | null
          created_at: string
          created_by: string | null
          delivery_date: string | null
          entry_by: string | null
          entry_date: string
          id: string
          mobile: string | null
          notes: string | null
          passenger_name: string
          passport: string | null
          received_amount: number | null
          received_by: string | null
          received_date: string | null
          sold_price: number | null
          status: string
          updated_at: string
          vendor_bought: string | null
          vendor_sent_date: string | null
        }
        Insert: {
          agency_sold?: string | null
          attested_date?: string | null
          bmet_id: string
          cost_price?: number | null
          country_name?: string | null
          created_at?: string
          created_by?: string | null
          delivery_date?: string | null
          entry_by?: string | null
          entry_date?: string
          id?: string
          mobile?: string | null
          notes?: string | null
          passenger_name: string
          passport?: string | null
          received_amount?: number | null
          received_by?: string | null
          received_date?: string | null
          sold_price?: number | null
          status?: string
          updated_at?: string
          vendor_bought?: string | null
          vendor_sent_date?: string | null
        }
        Update: {
          agency_sold?: string | null
          attested_date?: string | null
          bmet_id?: string
          cost_price?: number | null
          country_name?: string | null
          created_at?: string
          created_by?: string | null
          delivery_date?: string | null
          entry_by?: string | null
          entry_date?: string
          id?: string
          mobile?: string | null
          notes?: string | null
          passenger_name?: string
          passport?: string | null
          received_amount?: number | null
          received_by?: string | null
          received_date?: string | null
          sold_price?: number | null
          status?: string
          updated_at?: string
          vendor_bought?: string | null
          vendor_sent_date?: string | null
        }
        Relationships: []
      }
      cash_expenses: {
        Row: {
          amount: number
          category: string
          created_at: string
          created_by: string | null
          entry_date: string
          expense_id: string
          id: string
          purpose: string | null
          remarks: string | null
          spent_by: string | null
          spent_by_name: string | null
          updated_at: string
        }
        Insert: {
          amount?: number
          category?: string
          created_at?: string
          created_by?: string | null
          entry_date?: string
          expense_id: string
          id?: string
          purpose?: string | null
          remarks?: string | null
          spent_by?: string | null
          spent_by_name?: string | null
          updated_at?: string
        }
        Update: {
          amount?: number
          category?: string
          created_at?: string
          created_by?: string | null
          entry_date?: string
          expense_id?: string
          id?: string
          purpose?: string | null
          remarks?: string | null
          spent_by?: string | null
          spent_by_name?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      cash_handovers: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          entry_date: string
          from_name: string | null
          from_user: string | null
          handover_id: string
          id: string
          method: string
          remarks: string | null
          to_name: string
          updated_at: string
        }
        Insert: {
          amount?: number
          created_at?: string
          created_by?: string | null
          entry_date?: string
          from_name?: string | null
          from_user?: string | null
          handover_id: string
          id?: string
          method?: string
          remarks?: string | null
          to_name?: string
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          entry_date?: string
          from_name?: string | null
          from_user?: string | null
          handover_id?: string
          id?: string
          method?: string
          remarks?: string | null
          to_name?: string
          updated_at?: string
        }
        Relationships: []
      }
      kuwait_visas: {
        Row: {
          agency_sold: string | null
          cost_price: number | null
          created_at: string
          created_by: string | null
          delivery_date: string | null
          entry_by: string | null
          entry_date: string
          id: string
          kuwait_id: string
          medical_status: string | null
          mobile: string | null
          notes: string | null
          passenger_name: string
          passport: string | null
          received: number | null
          received_by: string | null
          sold_price: number | null
          sponsor_name: string | null
          status: string
          updated_at: string
          vendor_bought: string | null
          visa_no: string | null
        }
        Insert: {
          agency_sold?: string | null
          cost_price?: number | null
          created_at?: string
          created_by?: string | null
          delivery_date?: string | null
          entry_by?: string | null
          entry_date?: string
          id?: string
          kuwait_id: string
          medical_status?: string | null
          mobile?: string | null
          notes?: string | null
          passenger_name: string
          passport?: string | null
          received?: number | null
          received_by?: string | null
          sold_price?: number | null
          sponsor_name?: string | null
          status?: string
          updated_at?: string
          vendor_bought?: string | null
          visa_no?: string | null
        }
        Update: {
          agency_sold?: string | null
          cost_price?: number | null
          created_at?: string
          created_by?: string | null
          delivery_date?: string | null
          entry_by?: string | null
          entry_date?: string
          id?: string
          kuwait_id?: string
          medical_status?: string | null
          mobile?: string | null
          notes?: string | null
          passenger_name?: string
          passport?: string | null
          received?: number | null
          received_by?: string | null
          sold_price?: number | null
          sponsor_name?: string | null
          status?: string
          updated_at?: string
          vendor_bought?: string | null
          visa_no?: string | null
        }
        Relationships: []
      }
      lookups: {
        Row: {
          created_at: string
          id: string
          kind: string
          value: string
        }
        Insert: {
          created_at?: string
          id?: string
          kind: string
          value: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          value?: string
        }
        Relationships: []
      }
      passengers: {
        Row: {
          created_at: string
          id: string
          notes: string | null
          passenger_id: string
          passenger_name: string
          passport: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          notes?: string | null
          passenger_id: string
          passenger_name: string
          passport: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          notes?: string | null
          passenger_id?: string
          passenger_name?: string
          passport?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      payment_receipts: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          entry_date: string
          id: string
          method: string
          passenger_name: string
          receipt_id: string
          received_by: string
          received_by_name: string | null
          ref_id: string | null
          remarks: string | null
          service_row_id: string | null
          service_table: string | null
          service_type: string
          source: string
          updated_at: string
        }
        Insert: {
          amount?: number
          created_at?: string
          created_by?: string | null
          entry_date?: string
          id?: string
          method?: string
          passenger_name?: string
          receipt_id: string
          received_by: string
          received_by_name?: string | null
          ref_id?: string | null
          remarks?: string | null
          service_row_id?: string | null
          service_table?: string | null
          service_type: string
          source?: string
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          entry_date?: string
          id?: string
          method?: string
          passenger_name?: string
          receipt_id?: string
          received_by?: string
          received_by_name?: string | null
          ref_id?: string | null
          remarks?: string | null
          service_row_id?: string | null
          service_table?: string | null
          service_type?: string
          source?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          full_name: string
          role: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          full_name?: string
          role?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          full_name?: string
          role?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      saudi_visas: {
        Row: {
          agency_sold: string | null
          bmet_finger: boolean | null
          bmet_status: string | null
          bmet_training: boolean | null
          cost_price: number | null
          created_at: string
          created_by: string | null
          delivery_date: string | null
          entry_by: string | null
          entry_date: string
          final_visa_no: string | null
          id: string
          id_no: string | null
          medical_status: string | null
          mobile: string | null
          mofa_no: string | null
          notes: string | null
          passenger_name: string
          passport: string | null
          received_amount: number | null
          received_by: string | null
          received_vendor: number | null
          rl_no: string | null
          saudi_id: string
          sold_price: number | null
          sponsor_name: string | null
          status: string
          tasheer_finger_date: string | null
          update_date: string | null
          updated_at: string
          vendor_bought: string | null
          vendor_sent_date: string | null
          visa_no: string | null
          visa_type: string | null
        }
        Insert: {
          agency_sold?: string | null
          bmet_finger?: boolean | null
          bmet_status?: string | null
          bmet_training?: boolean | null
          cost_price?: number | null
          created_at?: string
          created_by?: string | null
          delivery_date?: string | null
          entry_by?: string | null
          entry_date?: string
          final_visa_no?: string | null
          id?: string
          id_no?: string | null
          medical_status?: string | null
          mobile?: string | null
          mofa_no?: string | null
          notes?: string | null
          passenger_name: string
          passport?: string | null
          received_amount?: number | null
          received_by?: string | null
          received_vendor?: number | null
          rl_no?: string | null
          saudi_id: string
          sold_price?: number | null
          sponsor_name?: string | null
          status?: string
          tasheer_finger_date?: string | null
          update_date?: string | null
          updated_at?: string
          vendor_bought?: string | null
          vendor_sent_date?: string | null
          visa_no?: string | null
          visa_type?: string | null
        }
        Update: {
          agency_sold?: string | null
          bmet_finger?: boolean | null
          bmet_status?: string | null
          bmet_training?: boolean | null
          cost_price?: number | null
          created_at?: string
          created_by?: string | null
          delivery_date?: string | null
          entry_by?: string | null
          entry_date?: string
          final_visa_no?: string | null
          id?: string
          id_no?: string | null
          medical_status?: string | null
          mobile?: string | null
          mofa_no?: string | null
          notes?: string | null
          passenger_name?: string
          passport?: string | null
          received_amount?: number | null
          received_by?: string | null
          received_vendor?: number | null
          rl_no?: string | null
          saudi_id?: string
          sold_price?: number | null
          sponsor_name?: string | null
          status?: string
          tasheer_finger_date?: string | null
          update_date?: string | null
          updated_at?: string
          vendor_bought?: string | null
          vendor_sent_date?: string | null
          visa_no?: string | null
          visa_type?: string | null
        }
        Relationships: []
      }
      tickets: {
        Row: {
          agency_sold: string | null
          airline: string | null
          cost_price: number | null
          created_at: string
          created_by: string | null
          entry_by: string | null
          entry_date: string
          flight_date: string | null
          id: string
          mobile: string | null
          notes: string | null
          passenger_name: string
          passport: string | null
          pnr: string | null
          received: number | null
          received_by: string | null
          sold_price: number | null
          status: string
          ticket_id: string
          updated_at: string
          vendor_bought: string | null
        }
        Insert: {
          agency_sold?: string | null
          airline?: string | null
          cost_price?: number | null
          created_at?: string
          created_by?: string | null
          entry_by?: string | null
          entry_date?: string
          flight_date?: string | null
          id?: string
          mobile?: string | null
          notes?: string | null
          passenger_name: string
          passport?: string | null
          pnr?: string | null
          received?: number | null
          received_by?: string | null
          sold_price?: number | null
          status?: string
          ticket_id: string
          updated_at?: string
          vendor_bought?: string | null
        }
        Update: {
          agency_sold?: string | null
          airline?: string | null
          cost_price?: number | null
          created_at?: string
          created_by?: string | null
          entry_by?: string | null
          entry_date?: string
          flight_date?: string | null
          id?: string
          mobile?: string | null
          notes?: string | null
          passenger_name?: string
          passport?: string | null
          pnr?: string | null
          received?: number | null
          received_by?: string | null
          sold_price?: number | null
          status?: string
          ticket_id?: string
          updated_at?: string
          vendor_bought?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      vendor_ledger: {
        Row: {
          created_at: string
          created_by: string | null
          entry_date: string
          id: string
          ledger_id: string
          paid_amount: number | null
          passenger_name: string | null
          received_by: string | null
          remarks: string | null
          service_type: string | null
          source_id: string | null
          source_table: string | null
          total_payable: number | null
          updated_at: string
          vendor_name: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          entry_date?: string
          id?: string
          ledger_id: string
          paid_amount?: number | null
          passenger_name?: string | null
          received_by?: string | null
          remarks?: string | null
          service_type?: string | null
          source_id?: string | null
          source_table?: string | null
          total_payable?: number | null
          updated_at?: string
          vendor_name: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          entry_date?: string
          id?: string
          ledger_id?: string
          paid_amount?: number | null
          passenger_name?: string | null
          received_by?: string | null
          remarks?: string | null
          service_type?: string | null
          source_id?: string | null
          source_table?: string | null
          total_payable?: number | null
          updated_at?: string
          vendor_name?: string
        }
        Relationships: []
      }
      vendors: {
        Row: {
          address: string | null
          created_at: string
          id: string
          name: string
          notes: string | null
          phone: string | null
          updated_at: string
          vendor_code: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          id?: string
          name: string
          notes?: string | null
          phone?: string | null
          updated_at?: string
          vendor_code: string
        }
        Update: {
          address?: string | null
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
          phone?: string | null
          updated_at?: string
          vendor_code?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_accounts_overview: {
        Args: never
        Returns: {
          current_balance: number
          full_name: string
          total_expenses: number
          total_handed_over: number
          total_received: number
          user_id: string
        }[]
      }
      get_agent_balances: {
        Args: never
        Returns: {
          agent_name: string
          balance_due: number
          total_bill: number
          total_received: number
        }[]
      }
      get_cash_drawer: {
        Args: { _user_id: string }
        Returns: {
          current_balance: number
          full_name: string
          total_expenses: number
          total_handed_over: number
          total_received: number
          total_received_in: number
          total_received_today: number
          user_id: string
        }[]
      }
      get_user_account: {
        Args: { _user_id: string }
        Returns: {
          current_balance: number
          full_name: string
          total_expenses: number
          total_handed_over: number
          total_received: number
          total_received_today: number
          user_id: string
        }[]
      }
      get_vendor_balances: {
        Args: never
        Returns: {
          balance_due: number
          total_paid: number
          total_payable: number
          vendor_name: string
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      next_module_id: {
        Args: { _column: string; _prefix: string; _table: string }
        Returns: string
      }
      next_passenger_id: { Args: never; Returns: string }
      next_simple_id: {
        Args: { _column: string; _prefix: string; _table: string }
        Returns: string
      }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user"
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
      app_role: ["admin", "moderator", "user"],
    },
  },
} as const
