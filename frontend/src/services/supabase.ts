/**
 * Supabase client initialization.
 *
 * Only used when the backend reports AUTH_PROVIDER=supabase.
 * Import this lazily — the client is only created when needed.
 */
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type { Session } from "@supabase/supabase-js";

let _client: SupabaseClient | null = null;

/** Build (or reuse) the Supabase client from env vars injected at build time. */
export function getSupabaseClient(): SupabaseClient | null {
  if (_client) return _client;

  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

  if (!url || !key) return null;

  _client = createClient(url, key, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
    },
  });
  return _client;
}

// Re-export types used elsewhere
export type { Session as SupabaseSession };
