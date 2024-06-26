export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      app_data: {
        Row: {
          access_token: string;
          expire_date: number;
          id: number;
          last_event_id: number;
        };
        Insert: {
          access_token: string;
          expire_date: number;
          id: number;
          last_event_id: number;
        };
        Update: {
          access_token?: string;
          expire_date?: number;
          id?: number;
          last_event_id?: number;
        };
        Relationships: [];
      };
      beatmapsets: {
        Row: {
          artist: string;
          beatmaps: Json;
          id: number;
          mapper: string;
          mapper_id: number;
          probability: number | null;
          queue_date: number | null;
          rank_date: number;
          rank_date_early: number | null;
          title: string;
          unresolved: boolean;
        };
        Insert: {
          artist: string;
          beatmaps: Json;
          id: number;
          mapper: string;
          mapper_id: number;
          probability?: number | null;
          queue_date?: number | null;
          rank_date: number;
          rank_date_early?: number | null;
          title: string;
          unresolved?: boolean;
        };
        Update: {
          artist?: string;
          beatmaps?: Json;
          id?: number;
          mapper?: string;
          mapper_id?: number;
          probability?: number | null;
          queue_date?: number | null;
          rank_date?: number;
          rank_date_early?: number | null;
          title?: string;
          unresolved?: boolean;
        };
        Relationships: [];
      };
      updates: {
        Row: {
          deleted_maps: number[];
          id: number;
          timestamp: number;
          updated_maps: number[];
        };
        Insert: {
          deleted_maps: number[];
          id: number;
          timestamp: number;
          updated_maps: number[];
        };
        Update: {
          deleted_maps?: number[];
          id?: number;
          timestamp?: number;
          updated_maps?: number[];
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type PublicSchema = Database[Extract<keyof Database, "public">];

export type Tables<
  PublicTableNameOrOptions extends
    | keyof (PublicSchema["Tables"] & PublicSchema["Views"])
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof (
      & Database[PublicTableNameOrOptions["schema"]]["Tables"]
      & Database[PublicTableNameOrOptions["schema"]]["Views"]
    )
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database } ? (
    & Database[PublicTableNameOrOptions["schema"]]["Tables"]
    & Database[PublicTableNameOrOptions["schema"]]["Views"]
  )[TableName] extends {
    Row: infer R;
  } ? R
  : never
  : PublicTableNameOrOptions extends keyof (
    & PublicSchema["Tables"]
    & PublicSchema["Views"]
  ) ? (
      & PublicSchema["Tables"]
      & PublicSchema["Views"]
    )[PublicTableNameOrOptions] extends {
      Row: infer R;
    } ? R
    : never
  : never;

export type TablesInsert<
  PublicTableNameOrOptions extends
    | keyof PublicSchema["Tables"]
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? Database[PublicTableNameOrOptions["schema"]]["Tables"][TableName] extends {
    Insert: infer I;
  } ? I
  : never
  : PublicTableNameOrOptions extends keyof PublicSchema["Tables"]
    ? PublicSchema["Tables"][PublicTableNameOrOptions] extends {
      Insert: infer I;
    } ? I
    : never
  : never;

export type TablesUpdate<
  PublicTableNameOrOptions extends
    | keyof PublicSchema["Tables"]
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? Database[PublicTableNameOrOptions["schema"]]["Tables"][TableName] extends {
    Update: infer U;
  } ? U
  : never
  : PublicTableNameOrOptions extends keyof PublicSchema["Tables"]
    ? PublicSchema["Tables"][PublicTableNameOrOptions] extends {
      Update: infer U;
    } ? U
    : never
  : never;

export type Enums<
  PublicEnumNameOrOptions extends
    | keyof PublicSchema["Enums"]
    | { schema: keyof Database },
  EnumName extends PublicEnumNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = PublicEnumNameOrOptions extends { schema: keyof Database }
  ? Database[PublicEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : PublicEnumNameOrOptions extends keyof PublicSchema["Enums"]
    ? PublicSchema["Enums"][PublicEnumNameOrOptions]
  : never;
