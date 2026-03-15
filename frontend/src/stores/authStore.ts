import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AuthProvider, User } from "@/types/auth";

interface AuthState {
  token: string | null;
  user: User | null;
  isAuthenticated: boolean;
  authProvider: AuthProvider | null;
  setAuth: (token: string, user: User) => void;
  setAuthProvider: (provider: AuthProvider) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      isAuthenticated: false,
      authProvider: null,
      setAuth: (token, user) =>
        set({ token, user, isAuthenticated: true }),
      setAuthProvider: (provider) =>
        set({ authProvider: provider }),
      logout: () =>
        set({ token: null, user: null, isAuthenticated: false }),
    }),
    {
      name: "uac-auth",
    }
  )
);

// Helper to get auth header
export function getAuthHeader(): Record<string, string> {
  const token = useAuthStore.getState().token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}
