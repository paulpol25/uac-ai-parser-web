/**
 * Auth types for the frontend
 */

export type AuthProvider = "supabase" | "local";

export interface User {
  id: number;
  username: string;
  email: string;
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
