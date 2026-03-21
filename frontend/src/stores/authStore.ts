import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AuthProvider, User, UserRole } from "@/types/auth";

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

/** Check if current user has a specific role */
export function hasRole(...roles: UserRole[]): boolean {
  const user = useAuthStore.getState().user;
  if (!user) return false;
  return roles.includes(user.role);
}

/** Check if current user is admin */
export function isAdmin(): boolean {
  return hasRole("admin");
}

/**
 * Check if the current user has a specific permission for viewing/navigation.
 * Admins and viewers always pass. Operators check their permissions.
 * Viewers see all pages in read-only mode.
 */
export function hasPermission(permission: string): boolean {
  const user = useAuthStore.getState().user;
  if (!user) return false;
  if (user.role === "admin") return true;
  if (user.role === "viewer") return true;
  return !!user.operator_permissions?.[permission];
}

/**
 * Check if the current user can perform a write/modify action.
 * Admins always pass. Viewers always fail. Operators check their permissions.
 */
export function canPerform(permission: string): boolean {
  const user = useAuthStore.getState().user;
  if (!user) return false;
  if (user.role === "admin") return true;
  if (user.role === "viewer") return false;
  return !!user.operator_permissions?.[permission];
}

/** Check if current user is a viewer (read-only mode). */
export function isViewer(): boolean {
  return hasRole("viewer");
}
