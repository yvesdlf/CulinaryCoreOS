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

// Guarded because this module is also pulled into Node maintenance scripts,
// where `import.meta.env` does not exist at all and a plain read throws at
// import time — before the script can supply its own client.
const env = (import.meta.env ?? {}) as Record<string, string | undefined>;
const url = env.VITE_SUPABASE_URL;
const anonKey = env.VITE_SUPABASE_ANON_KEY;

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

/**
 * Client override for Node scripts and tests.
 *
 * `supabase` above is built from `import.meta.env`, which does not exist
 * outside Vite, so a maintenance script has no way to supply its own
 * credentials. This is the only seam; it is deliberately not exported from an
 * index and nothing in the browser bundle calls it.
 */
let override: SupabaseClient | null = null;

export function setSupabaseClient(client: SupabaseClient): void {
  override = client;
}

/** Narrowing helper so repositories can fail loudly instead of on a null deref. */
export function requireSupabase(): SupabaseClient {
  const client = override ?? supabase;
  if (!client) {
    throw new Error(
      "Supabase is not configured. Set VITE_SUPABASE_URL and " +
        "VITE_SUPABASE_ANON_KEY in apps/web/.env.local — see .env.example.",
    );
  }
  return client;
}
