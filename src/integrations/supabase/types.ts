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
      accounts: {
        Row: {
          account_code: string
          allow_negative: boolean
          created_at: string
          current_balance: number
          id: string
          is_active: boolean
          name: string
          notes: string | null
          opening_balance: number
          sort_order: number
          type: string
          updated_at: string
        }
        Insert: {
          account_code: string
          allow_negative?: boolean
          created_at?: string
          current_balance?: number
          id?: string
          is_active?: boolean
          name: string
          notes?: string | null
          opening_balance?: number
          sort_order?: number
          type?: string
          updated_at?: string
        }
        Update: {
          account_code?: string
          allow_negative?: boolean
          created_at?: string
          current_balance?: number
          id?: string
          is_active?: boolean
          name?: string
          notes?: string | null
          opening_balance?: number
          sort_order?: number
          type?: string
          updated_at?: string
        }
        Relationships: []
      }
      agency_ledger: {
        Row: {
          advance_applied: number
          agent_name: string
          country_route: string | null
          created_at: string
          created_by: string | null
          discount_amount: number
          entry_date: string
          id: string
          ledger_id: string
          mobile: string | null
          passenger_name: string | null
          passport: string | null
          payment_date: string | null
          payment_method: string
          profit: number | null
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
          advance_applied?: number
          agent_name: string
          country_route?: string | null
          created_at?: string
          created_by?: string | null
          discount_amount?: number
          entry_date?: string
          id?: string
          ledger_id: string
          mobile?: string | null
          passenger_name?: string | null
          passport?: string | null
          payment_date?: string | null
          payment_method?: string
          profit?: number | null
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
          advance_applied?: number
          agent_name?: string
          country_route?: string | null
          created_at?: string
          created_by?: string | null
          discount_amount?: number
          entry_date?: string
          id?: string
          ledger_id?: string
          mobile?: string | null
          passenger_name?: string | null
          passport?: string | null
          payment_date?: string | null
          payment_method?: string
          profit?: number | null
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
          full_name: string | null
          id: string
          name: string
          notes: string | null
          phone: string | null
          phone_labels: string | null
          serial_no: number | null
          settle_mode: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          agent_code: string
          created_at?: string
          full_name?: string | null
          id?: string
          name: string
          notes?: string | null
          phone?: string | null
          phone_labels?: string | null
          serial_no?: number | null
          settle_mode?: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          agent_code?: string
          created_at?: string
          full_name?: string | null
          id?: string
          name?: string
          notes?: string | null
          phone?: string | null
          phone_labels?: string | null
          serial_no?: number | null
          settle_mode?: string
          updated_at?: string
        }
        Relationships: []
      }
      bmet_cards: {
        Row: {
          agency_sold: string | null
          attested_date: string | null
          bmet_id: string
          call_status: string | null
          called_by: string | null
          cancel_date: string | null
          cancel_reason: string | null
          cancelled: boolean
          cost_price: number | null
          country_name: string | null
          created_at: string
          created_by: string | null
          delivery_date: string | null
          discount_amount: number
          entry_by: string | null
          entry_date: string
          id: string
          last_call_date: string | null
          mobile: string | null
          notes: string | null
          passenger_name: string
          passport: string | null
          payment_date: string | null
          payment_method: string | null
          received_amount: number | null
          received_by: string | null
          received_date: string | null
          sold_price: number | null
          status: string
          status_by: string | null
          updated_at: string
          vendor_bought: string | null
          vendor_sent_date: string | null
          without_passport: boolean
        }
        Insert: {
          agency_sold?: string | null
          attested_date?: string | null
          bmet_id: string
          call_status?: string | null
          called_by?: string | null
          cancel_date?: string | null
          cancel_reason?: string | null
          cancelled?: boolean
          cost_price?: number | null
          country_name?: string | null
          created_at?: string
          created_by?: string | null
          delivery_date?: string | null
          discount_amount?: number
          entry_by?: string | null
          entry_date?: string
          id?: string
          last_call_date?: string | null
          mobile?: string | null
          notes?: string | null
          passenger_name: string
          passport?: string | null
          payment_date?: string | null
          payment_method?: string | null
          received_amount?: number | null
          received_by?: string | null
          received_date?: string | null
          sold_price?: number | null
          status?: string
          status_by?: string | null
          updated_at?: string
          vendor_bought?: string | null
          vendor_sent_date?: string | null
          without_passport?: boolean
        }
        Update: {
          agency_sold?: string | null
          attested_date?: string | null
          bmet_id?: string
          call_status?: string | null
          called_by?: string | null
          cancel_date?: string | null
          cancel_reason?: string | null
          cancelled?: boolean
          cost_price?: number | null
          country_name?: string | null
          created_at?: string
          created_by?: string | null
          delivery_date?: string | null
          discount_amount?: number
          entry_by?: string | null
          entry_date?: string
          id?: string
          last_call_date?: string | null
          mobile?: string | null
          notes?: string | null
          passenger_name?: string
          passport?: string | null
          payment_date?: string | null
          payment_method?: string | null
          received_amount?: number | null
          received_by?: string | null
          received_date?: string | null
          sold_price?: number | null
          status?: string
          status_by?: string | null
          updated_at?: string
          vendor_bought?: string | null
          vendor_sent_date?: string | null
          without_passport?: boolean
        }
        Relationships: []
      }
      cash_expenses: {
        Row: {
          account_id: string | null
          amount: number
          category: string
          created_at: string
          created_by: string | null
          entry_date: string
          expense_id: string
          handover_id: string | null
          id: string
          linked_source_id: string | null
          linked_source_table: string | null
          purpose: string | null
          remarks: string | null
          spent_by: string | null
          spent_by_name: string | null
          updated_at: string
        }
        Insert: {
          account_id?: string | null
          amount?: number
          category?: string
          created_at?: string
          created_by?: string | null
          entry_date?: string
          expense_id: string
          handover_id?: string | null
          id?: string
          linked_source_id?: string | null
          linked_source_table?: string | null
          purpose?: string | null
          remarks?: string | null
          spent_by?: string | null
          spent_by_name?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string | null
          amount?: number
          category?: string
          created_at?: string
          created_by?: string | null
          entry_date?: string
          expense_id?: string
          handover_id?: string | null
          id?: string
          linked_source_id?: string | null
          linked_source_table?: string | null
          purpose?: string | null
          remarks?: string | null
          spent_by?: string | null
          spent_by_name?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_expenses_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_handovers: {
        Row: {
          accept_token: string | null
          account_id: string | null
          amount: number
          approved_at: string | null
          approved_by: string | null
          closing_date: string | null
          confirmed_amount: number | null
          created_at: string
          created_by: string | null
          entry_date: string
          from_name: string | null
          from_user: string | null
          handover_id: string
          id: string
          method: string
          remarks: string | null
          status: string
          submitted_amount: number | null
          to_name: string
          updated_at: string
        }
        Insert: {
          accept_token?: string | null
          account_id?: string | null
          amount?: number
          approved_at?: string | null
          approved_by?: string | null
          closing_date?: string | null
          confirmed_amount?: number | null
          created_at?: string
          created_by?: string | null
          entry_date?: string
          from_name?: string | null
          from_user?: string | null
          handover_id: string
          id?: string
          method?: string
          remarks?: string | null
          status?: string
          submitted_amount?: number | null
          to_name?: string
          updated_at?: string
        }
        Update: {
          accept_token?: string | null
          account_id?: string | null
          amount?: number
          approved_at?: string | null
          approved_by?: string | null
          closing_date?: string | null
          confirmed_amount?: number | null
          created_at?: string
          created_by?: string | null
          entry_date?: string
          from_name?: string | null
          from_user?: string | null
          handover_id?: string
          id?: string
          method?: string
          remarks?: string | null
          status?: string
          submitted_amount?: number | null
          to_name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_handovers_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_cash_closings: {
        Row: {
          account_id: string
          actual_closing: number
          closed_at: string
          closed_by: string | null
          closing_date: string
          created_at: string
          discrepancy: number | null
          expected_closing: number
          id: string
          is_locked: boolean
          notes: string | null
          opening_balance: number
          total_paid: number
          total_received: number
          updated_at: string
        }
        Insert: {
          account_id: string
          actual_closing?: number
          closed_at?: string
          closed_by?: string | null
          closing_date: string
          created_at?: string
          discrepancy?: number | null
          expected_closing?: number
          id?: string
          is_locked?: boolean
          notes?: string | null
          opening_balance?: number
          total_paid?: number
          total_received?: number
          updated_at?: string
        }
        Update: {
          account_id?: string
          actual_closing?: number
          closed_at?: string
          closed_by?: string | null
          closing_date?: string
          created_at?: string
          discrepancy?: number | null
          expected_closing?: number
          id?: string
          is_locked?: boolean
          notes?: string | null
          opening_balance?: number
          total_paid?: number
          total_received?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_cash_closings_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      day_locks: {
        Row: {
          created_at: string
          handover_id: string | null
          id: string
          locked_date: string
          user_id: string
        }
        Insert: {
          created_at?: string
          handover_id?: string | null
          id?: string
          locked_date: string
          user_id: string
        }
        Update: {
          created_at?: string
          handover_id?: string | null
          id?: string
          locked_date?: string
          user_id?: string
        }
        Relationships: []
      }
      extra_services: {
        Row: {
          agency_sold: string | null
          created_at: string
          created_by: string | null
          discount_amount: number
          entry_date: string
          id: string
          mobile: string | null
          notes: string | null
          passenger_name: string | null
          passport: string | null
          payment_date: string | null
          payment_method: string | null
          received_amount: number
          received_by: string | null
          service_name: string
          service_price: number
          source_id: string
          source_table: string
          updated_at: string
          vendor_cost: number
          vendor_name: string | null
        }
        Insert: {
          agency_sold?: string | null
          created_at?: string
          created_by?: string | null
          discount_amount?: number
          entry_date?: string
          id?: string
          mobile?: string | null
          notes?: string | null
          passenger_name?: string | null
          passport?: string | null
          payment_date?: string | null
          payment_method?: string | null
          received_amount?: number
          received_by?: string | null
          service_name: string
          service_price?: number
          source_id: string
          source_table: string
          updated_at?: string
          vendor_cost?: number
          vendor_name?: string | null
        }
        Update: {
          agency_sold?: string | null
          created_at?: string
          created_by?: string | null
          discount_amount?: number
          entry_date?: string
          id?: string
          mobile?: string | null
          notes?: string | null
          passenger_name?: string | null
          passport?: string | null
          payment_date?: string | null
          payment_method?: string | null
          received_amount?: number
          received_by?: string | null
          service_name?: string
          service_price?: number
          source_id?: string
          source_table?: string
          updated_at?: string
          vendor_cost?: number
          vendor_name?: string | null
        }
        Relationships: []
      }
      fund_transfers: {
        Row: {
          amount: number
          category: string
          created_at: string
          created_by: string | null
          entry_date: string
          from_account_id: string
          id: string
          remarks: string | null
          to_account_id: string
          transfer_id: string
          updated_at: string
        }
        Insert: {
          amount: number
          category?: string
          created_at?: string
          created_by?: string | null
          entry_date?: string
          from_account_id: string
          id?: string
          remarks?: string | null
          to_account_id: string
          transfer_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          category?: string
          created_at?: string
          created_by?: string | null
          entry_date?: string
          from_account_id?: string
          id?: string
          remarks?: string | null
          to_account_id?: string
          transfer_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fund_transfers_from_account_id_fkey"
            columns: ["from_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fund_transfers_to_account_id_fkey"
            columns: ["to_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      kuwait_visas: {
        Row: {
          agency_sold: string | null
          cancel_date: string | null
          cancel_reason: string | null
          cancelled: boolean
          cost_price: number | null
          created_at: string
          created_by: string | null
          delivery_date: string | null
          discount_amount: number
          entry_by: string | null
          entry_date: string
          id: string
          kuwait_id: string
          medical_status: string | null
          mobile: string | null
          notes: string | null
          passenger_name: string
          passport: string | null
          payment_date: string | null
          payment_method: string | null
          received: number | null
          received_by: string | null
          received_date: string | null
          sold_price: number | null
          sponsor_name: string | null
          status: string
          status_by: string | null
          updated_at: string
          vendor_bought: string | null
          vendor_sent_date: string | null
          visa_no: string | null
        }
        Insert: {
          agency_sold?: string | null
          cancel_date?: string | null
          cancel_reason?: string | null
          cancelled?: boolean
          cost_price?: number | null
          created_at?: string
          created_by?: string | null
          delivery_date?: string | null
          discount_amount?: number
          entry_by?: string | null
          entry_date?: string
          id?: string
          kuwait_id: string
          medical_status?: string | null
          mobile?: string | null
          notes?: string | null
          passenger_name: string
          passport?: string | null
          payment_date?: string | null
          payment_method?: string | null
          received?: number | null
          received_by?: string | null
          received_date?: string | null
          sold_price?: number | null
          sponsor_name?: string | null
          status?: string
          status_by?: string | null
          updated_at?: string
          vendor_bought?: string | null
          vendor_sent_date?: string | null
          visa_no?: string | null
        }
        Update: {
          agency_sold?: string | null
          cancel_date?: string | null
          cancel_reason?: string | null
          cancelled?: boolean
          cost_price?: number | null
          created_at?: string
          created_by?: string | null
          delivery_date?: string | null
          discount_amount?: number
          entry_by?: string | null
          entry_date?: string
          id?: string
          kuwait_id?: string
          medical_status?: string | null
          mobile?: string | null
          notes?: string | null
          passenger_name?: string
          passport?: string | null
          payment_date?: string | null
          payment_method?: string | null
          received?: number | null
          received_by?: string | null
          received_date?: string | null
          sold_price?: number | null
          sponsor_name?: string | null
          status?: string
          status_by?: string | null
          updated_at?: string
          vendor_bought?: string | null
          vendor_sent_date?: string | null
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
      mobile_colors: {
        Row: {
          color: string
          mobile: string
          updated_at: string
        }
        Insert: {
          color?: string
          mobile: string
          updated_at?: string
        }
        Update: {
          color?: string
          mobile?: string
          updated_at?: string
        }
        Relationships: []
      }
      others: {
        Row: {
          agency_sold: string | null
          airline: string | null
          cost_price: number | null
          country_route: string | null
          created_at: string
          created_by: string | null
          delivery_date: string | null
          discount_amount: number
          entry_by: string | null
          entry_date: string
          flight_date: string | null
          id: string
          mobile: string | null
          notes: string | null
          other_id: string
          passenger_name: string
          passport: string | null
          payment_date: string | null
          payment_method: string | null
          received_amount: number | null
          received_by: string | null
          service_name: string | null
          sold_price: number | null
          status: string
          status_by: string | null
          trip_road: string | null
          updated_at: string
          vendor_bought: string | null
        }
        Insert: {
          agency_sold?: string | null
          airline?: string | null
          cost_price?: number | null
          country_route?: string | null
          created_at?: string
          created_by?: string | null
          delivery_date?: string | null
          discount_amount?: number
          entry_by?: string | null
          entry_date?: string
          flight_date?: string | null
          id?: string
          mobile?: string | null
          notes?: string | null
          other_id: string
          passenger_name: string
          passport?: string | null
          payment_date?: string | null
          payment_method?: string | null
          received_amount?: number | null
          received_by?: string | null
          service_name?: string | null
          sold_price?: number | null
          status?: string
          status_by?: string | null
          trip_road?: string | null
          updated_at?: string
          vendor_bought?: string | null
        }
        Update: {
          agency_sold?: string | null
          airline?: string | null
          cost_price?: number | null
          country_route?: string | null
          created_at?: string
          created_by?: string | null
          delivery_date?: string | null
          discount_amount?: number
          entry_by?: string | null
          entry_date?: string
          flight_date?: string | null
          id?: string
          mobile?: string | null
          notes?: string | null
          other_id?: string
          passenger_name?: string
          passport?: string | null
          payment_date?: string | null
          payment_method?: string | null
          received_amount?: number | null
          received_by?: string | null
          service_name?: string | null
          sold_price?: number | null
          status?: string
          status_by?: string | null
          trip_road?: string | null
          updated_at?: string
          vendor_bought?: string | null
        }
        Relationships: []
      }
      passengers: {
        Row: {
          created_at: string
          created_by: string | null
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
          created_by?: string | null
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
          created_by?: string | null
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
          account_id: string | null
          amount: number
          approval_status: string
          approved_at: string | null
          approved_by: string | null
          created_at: string
          created_by: string | null
          entry_date: string
          handover_id: string | null
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
          account_id?: string | null
          amount?: number
          approval_status?: string
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          entry_date?: string
          handover_id?: string | null
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
          account_id?: string | null
          amount?: number
          approval_status?: string
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          entry_date?: string
          handover_id?: string | null
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
        Relationships: [
          {
            foreignKeyName: "payment_receipts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          designation: string | null
          full_name: string
          is_active: boolean
          mobile: string | null
          must_reset_password: boolean
          notify_email: string | null
          role: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          designation?: string | null
          full_name?: string
          is_active?: boolean
          mobile?: string | null
          must_reset_password?: boolean
          notify_email?: string | null
          role?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          designation?: string | null
          full_name?: string
          is_active?: boolean
          mobile?: string | null
          must_reset_password?: boolean
          notify_email?: string | null
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
          cancel_date: string | null
          cancel_reason: string | null
          cancelled: boolean
          cost_price: number | null
          created_at: string
          created_by: string | null
          delivery_date: string | null
          discount_amount: number
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
          payment_date: string | null
          payment_method: string | null
          received_amount: number | null
          received_by: string | null
          received_date: string | null
          received_vendor: number | null
          rl_no: string | null
          saudi_id: string
          sold_price: number | null
          sponsor_name: string | null
          status: string
          status_by: string | null
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
          cancel_date?: string | null
          cancel_reason?: string | null
          cancelled?: boolean
          cost_price?: number | null
          created_at?: string
          created_by?: string | null
          delivery_date?: string | null
          discount_amount?: number
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
          payment_date?: string | null
          payment_method?: string | null
          received_amount?: number | null
          received_by?: string | null
          received_date?: string | null
          received_vendor?: number | null
          rl_no?: string | null
          saudi_id: string
          sold_price?: number | null
          sponsor_name?: string | null
          status?: string
          status_by?: string | null
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
          cancel_date?: string | null
          cancel_reason?: string | null
          cancelled?: boolean
          cost_price?: number | null
          created_at?: string
          created_by?: string | null
          delivery_date?: string | null
          discount_amount?: number
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
          payment_date?: string | null
          payment_method?: string | null
          received_amount?: number | null
          received_by?: string | null
          received_date?: string | null
          received_vendor?: number | null
          rl_no?: string | null
          saudi_id?: string
          sold_price?: number | null
          sponsor_name?: string | null
          status?: string
          status_by?: string | null
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
          cancel_date: string | null
          cancel_reason: string | null
          cancelled: boolean
          cost_price: number | null
          created_at: string
          created_by: string | null
          discount_amount: number
          entry_by: string | null
          entry_date: string
          flight_date: string | null
          id: string
          mobile: string | null
          notes: string | null
          office_refund_fee: number
          passenger_name: string
          passenger_refund: number
          passenger_refund_mode: string
          passport: string | null
          payment_date: string | null
          payment_method: string | null
          pnr: string | null
          received: number | null
          received_by: string | null
          sold_price: number | null
          status: string
          status_by: string | null
          ticket_id: string
          trip_road: string | null
          updated_at: string
          vendor_bought: string | null
          vendor_refund: number
          vendor_refund_fee: number
        }
        Insert: {
          agency_sold?: string | null
          airline?: string | null
          cancel_date?: string | null
          cancel_reason?: string | null
          cancelled?: boolean
          cost_price?: number | null
          created_at?: string
          created_by?: string | null
          discount_amount?: number
          entry_by?: string | null
          entry_date?: string
          flight_date?: string | null
          id?: string
          mobile?: string | null
          notes?: string | null
          office_refund_fee?: number
          passenger_name: string
          passenger_refund?: number
          passenger_refund_mode?: string
          passport?: string | null
          payment_date?: string | null
          payment_method?: string | null
          pnr?: string | null
          received?: number | null
          received_by?: string | null
          sold_price?: number | null
          status?: string
          status_by?: string | null
          ticket_id: string
          trip_road?: string | null
          updated_at?: string
          vendor_bought?: string | null
          vendor_refund?: number
          vendor_refund_fee?: number
        }
        Update: {
          agency_sold?: string | null
          airline?: string | null
          cancel_date?: string | null
          cancel_reason?: string | null
          cancelled?: boolean
          cost_price?: number | null
          created_at?: string
          created_by?: string | null
          discount_amount?: number
          entry_by?: string | null
          entry_date?: string
          flight_date?: string | null
          id?: string
          mobile?: string | null
          notes?: string | null
          office_refund_fee?: number
          passenger_name?: string
          passenger_refund?: number
          passenger_refund_mode?: string
          passport?: string | null
          payment_date?: string | null
          payment_method?: string | null
          pnr?: string | null
          received?: number | null
          received_by?: string | null
          sold_price?: number | null
          status?: string
          status_by?: string | null
          ticket_id?: string
          trip_road?: string | null
          updated_at?: string
          vendor_bought?: string | null
          vendor_refund?: number
          vendor_refund_fee?: number
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
          advance_applied: number
          alloc_detail: Json | null
          country_route: string | null
          created_at: string
          created_by: string | null
          entry_date: string
          id: string
          ledger_id: string
          mobile: string | null
          paid_amount: number | null
          passenger_name: string | null
          passport: string | null
          payment_date: string | null
          payment_method: string
          profit: number | null
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
          advance_applied?: number
          alloc_detail?: Json | null
          country_route?: string | null
          created_at?: string
          created_by?: string | null
          entry_date?: string
          id?: string
          ledger_id: string
          mobile?: string | null
          paid_amount?: number | null
          passenger_name?: string | null
          passport?: string | null
          payment_date?: string | null
          payment_method?: string
          profit?: number | null
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
          advance_applied?: number
          alloc_detail?: Json | null
          country_route?: string | null
          created_at?: string
          created_by?: string | null
          entry_date?: string
          id?: string
          ledger_id?: string
          mobile?: string | null
          paid_amount?: number | null
          passenger_name?: string | null
          passport?: string | null
          payment_date?: string | null
          payment_method?: string
          profit?: number | null
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
          full_name: string | null
          id: string
          name: string
          notes: string | null
          phone: string | null
          phone_labels: string | null
          serial_no: number | null
          settle_mode: string
          updated_at: string
          vendor_code: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          name: string
          notes?: string | null
          phone?: string | null
          phone_labels?: string | null
          serial_no?: number | null
          settle_mode?: string
          updated_at?: string
          vendor_code: string
        }
        Update: {
          address?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          name?: string
          notes?: string | null
          phone?: string | null
          phone_labels?: string | null
          serial_no?: number | null
          settle_mode?: string
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
      approve_handover: {
        Args: { _confirmed_amount: number; _handover_id: string }
        Returns: undefined
      }
      approve_handover_by_token: { Args: { _token: string }; Returns: Json }
      cancel_handover: { Args: { _handover_id: string }; Returns: undefined }
      delete_agent_payment: {
        Args: {
          _amount?: number
          _ledger_row_id?: string
          _receipt_id?: string
        }
        Returns: undefined
      }
      delete_payment_receipt_and_revert: {
        Args: { _receipt_id: string }
        Returns: Json
      }
      delete_vendor_ledger_by_source: {
        Args: { _source_id: string; _source_table: string }
        Returns: undefined
      }
      get_accounts_overview: {
        Args: never
        Returns: {
          current_balance: number
          full_name: string
          role: string
          total_expenses: number
          total_handed_over: number
          total_pending: number
          total_received: number
          user_id: string
        }[]
      }
      get_agent_balances: {
        Args: never
        Returns: {
          advance_balance: number
          agent_name: string
          balance_due: number
          total_bill: number
          total_received: number
        }[]
      }
      get_agent_wallet: {
        Args: { _agent_name: string }
        Returns: {
          advance_balance: number
          current_due: number
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
          role: string
          total_expenses: number
          total_handed_over: number
          total_pending: number
          total_received: number
          total_received_today: number
          user_id: string
        }[]
      }
      get_vendor_balances: {
        Args: never
        Returns: {
          advance_balance: number
          balance_due: number
          total_paid: number
          total_payable: number
          vendor_name: string
        }[]
      }
      get_vendor_wallet: {
        Args: { _vendor_name: string }
        Returns: {
          advance_balance: number
          payable_due: number
        }[]
      }
      handover_code_initials: { Args: { _name: string }; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_md: { Args: { _uid: string }; Returns: boolean }
      is_total_agent_status_receipt: {
        Args: {
          _method: string
          _service_row_id: string
          _service_table: string
          _source: string
        }
        Returns: boolean
      }
      next_module_id: {
        Args: {
          _column: string
          _entry_date?: string
          _prefix: string
          _table: string
        }
        Returns: string
      }
      next_passenger_id: { Args: never; Returns: string }
      next_simple_id: {
        Args: { _column: string; _prefix: string; _table: string }
        Returns: string
      }
      next_yearly_id: {
        Args: {
          _column: string
          _entry_date?: string
          _prefix: string
          _table: string
        }
        Returns: string
      }
      recalc_account_balance: {
        Args: { _account_id: string }
        Returns: undefined
      }
      recalculate_agent_advance: {
        Args: { _agent_name: string }
        Returns: undefined
      }
      recalculate_vendor_advance: {
        Args: { _vendor_name: string }
        Returns: undefined
      }
      recompute_handover_amount: { Args: { h_id: string }; Returns: undefined }
      reject_handover: {
        Args: { _handover_id: string; _reason?: string }
        Returns: undefined
      }
      rename_party: {
        Args: { p_kind: string; p_new_name: string; p_old_name: string }
        Returns: undefined
      }
      revert_service_receipts: {
        Args: { _service_row_id: string; _service_table: string }
        Returns: undefined
      }
      submit_handover: {
        Args: {
          _closing_date?: string
          _remarks?: string
          _submitted_amount: number
        }
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
