/**
 * Auth types for the frontend
 */

export type AuthProvider = "supabase" | "local";

export type UserRole = "admin" | "operator" | "viewer";

export interface OperatorPermissions {
  dispatch_commands?: boolean;
  manage_agents?: boolean;
  run_playbooks?: boolean;
  manage_playbooks?: boolean;
  manage_yara_rules?: boolean;
  manage_investigations?: boolean;
  upload_artifacts?: boolean;
  query_data?: boolean;
  export_data?: boolean;
  view_settings?: boolean;
  manage_settings?: boolean;
  manage_users?: boolean;
  [key: string]: boolean | undefined;
}

export interface User {
  id: number;
  username: string;
  email: string;
  role: UserRole;
  operator_permissions: OperatorPermissions;
  created_at?: string;
  last_login?: string;
}

export interface AuthResponse {
  token: string | null;
  user: User;
  message?: string;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface RegisterRequest {
  username: string;
  email: string;
  password: string;
}
