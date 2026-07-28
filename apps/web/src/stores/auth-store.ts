// ---------------------------------------------------------------------------
// Authentication and organization context
// ---------------------------------------------------------------------------
// RLS scopes every row to the caller's organization, so without a session the
// app can read nothing at all. This store owns the session and the memberships
// it grants, and re-hydrates the data stores whenever the identity changes.
//
// When Supabase is unconfigured the app runs on the mock catalogue and this
// store reports a synthetic "signed in" state, so the sign-in wall never
// blocks a database-free checkout.
// ---------------------------------------------------------------------------

import { create } from "zustand";
import type { Session } from "@supabase/supabase-js";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { hydrateFromSupabase } from "@/stores/persistence";

export type OrgRole = "OWNER" | "ADMIN" | "CHEF" | "VIEWER";

export interface Organization {
  id: string;
  name: string;
  slug: string;
  role: OrgRole;
}

interface AuthState {
  session: Session | null;
  organizations: Organization[];
  /** Rows are written into this organization; see auth_default_org_id(). */
  activeOrg: Organization | null;
  loading: boolean;
  error: string | null;

  initialize: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, orgName?: string) => Promise<void>;
  signOut: () => Promise<void>;
}

/** VIEWER is read-only — the same rule the RLS policies enforce server-side. */
export function canWrite(role: OrgRole | undefined): boolean {
  return role === "OWNER" || role === "ADMIN" || role === "CHEF";
}

async function loadOrganizations(): Promise<Organization[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("organization_members")
    .select("role, created_at, organizations(id, name, slug)")
    .order("created_at");
  if (error) throw new Error(error.message);

  return (data ?? [])
    .filter((row: any) => row.organizations)
    .map((row: any) => ({
      id: row.organizations.id,
      name: row.organizations.name,
      slug: row.organizations.slug,
      role: row.role as OrgRole,
    }));
}

export const useAuthStore = create<AuthState>((set, get) => ({
  session: null,
  organizations: [],
  activeOrg: null,
  loading: true,
  error: null,

  initialize: async () => {
    if (!isSupabaseConfigured) {
      // No database: the mock catalogue is already loaded, so present the app
      // as usable rather than showing a sign-in wall with nothing behind it.
      set({ loading: false });
      return;
    }

    const { data } = await supabase!.auth.getSession();
    await applySession(data.session, set);

    supabase!.auth.onAuthStateChange((_event, session) => {
      // Fires on sign-in, sign-out and token refresh. Re-running the load
      // keeps memberships correct if the identity changed.
      void applySession(session, set);
    });
  },

  signIn: async (email, password) => {
    set({ loading: true, error: null });
    const { error } = await supabase!.auth.signInWithPassword({ email, password });
    if (error) {
      set({ loading: false, error: error.message });
      throw new Error(error.message);
    }
    // onAuthStateChange finishes the work.
  },

  signUp: async (email, password, orgName) => {
    set({ loading: true, error: null });
    const { error } = await supabase!.auth.signUp({
      email,
      password,
      // Read by the handle_new_user() trigger when naming the organization.
      options: { data: orgName ? { organization_name: orgName } : {} },
    });
    if (error) {
      set({ loading: false, error: error.message });
      throw new Error(error.message);
    }
  },

  signOut: async () => {
    await supabase!.auth.signOut();
    set({ session: null, organizations: [], activeOrg: null, error: null });
  },
}));

/** Shared by initialize() and the auth listener. */
async function applySession(
  session: Session | null,
  set: (partial: Partial<AuthState>) => void,
): Promise<void> {
  if (!session) {
    set({ session: null, organizations: [], activeOrg: null, loading: false });
    return;
  }
  try {
    const organizations = await loadOrganizations();
    set({
      session,
      organizations,
      activeOrg: organizations[0] ?? null,
      loading: false,
      error: null,
    });
    // Only now can RLS return rows, so this is the right moment to load data.
    await hydrateFromSupabase();
  } catch (err) {
    set({
      session,
      loading: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** True when the app should render its normal UI rather than the sign-in page. */
export function useIsAuthenticated(): boolean {
  const session = useAuthStore((s) => s.session);
  return !isSupabaseConfigured || Boolean(session);
}
