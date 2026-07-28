// ---------------------------------------------------------------------------
// Supabase client
// ---------------------------------------------------------------------------
// Credentials come from Vite env vars (see .env.example). When they are absent
// the app falls back to the in-memory mock catalogue, so `pnpm dev` still works
// on a fresh checkout with no database — `isSupabaseConfigured` is the switch.
//
// Only the anon/publishable key belongs here. It is exposed to the browser by
// design and is safe to ship; the service-role key never goes in client code.
// ---------------------------------------------------------------------------

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isSupabaseConfigured = Boolean(url && anonKey);

/**
 * The client, or null when unconfigured. Callers should branch on
 * `isSupabaseConfigured` rather than assuming this is non-null.
 */
export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url!, anonKey!, {
      auth: {
        // RLS scopes every row to the caller's organization, so the session
        // token is what makes data visible at all — it has to survive a
        // reload or the user is signed out on every refresh.
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

/** Narrowing helper so repositories can fail loudly instead of on a null deref. */
export function requireSupabase(): SupabaseClient {
  if (!supabase) {
    throw new Error(
      "Supabase is not configured. Set VITE_SUPABASE_URL and " +
        "VITE_SUPABASE_ANON_KEY in apps/web/.env.local — see .env.example.",
    );
  }
  return supabase;
}
