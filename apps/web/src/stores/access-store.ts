// ---------------------------------------------------------------------------
// What the signed-in person may reach
// ---------------------------------------------------------------------------
// Held in a store rather than fetched per screen because almost every page
// asks the question, and asking it eleven times on one navigation is eleven
// round trips for an answer that does not change between them.
//
// This is presentation only. The section grant is enforced by triggers on the
// tables each section owns, so a stale value here loses a user a button, not a
// venue its data. Nothing in this file is a security control, and no screen
// should be written as though it were.
// ---------------------------------------------------------------------------

import { create } from "zustand";
import { isSupabaseConfigured } from "@/lib/supabase";
import { fetchMySectionAccess, type AccessLevel } from "@/data/repository";

interface AccessState {
  levels: Record<string, AccessLevel>;
  loaded: boolean;
  load: () => Promise<void>;
  clear: () => void;
}

export const useAccessStore = create<AccessState>((set) => ({
  levels: {},
  loaded: false,

  load: async () => {
    if (!isSupabaseConfigured) {
      set({ levels: {}, loaded: true });
      return;
    }
    try {
      set({ levels: await fetchMySectionAccess(), loaded: true });
    } catch {
      // A failure here must not blank the application. The screens fall back
      // to offering the action and letting the database refuse it, which is
      // the same outcome as before this store existed.
      set({ loaded: true });
    }
  },

  clear: () => set({ levels: {}, loaded: false }),
}));

/**
 * The level this user holds for a section.
 *
 * Without a database there is no tenancy to enforce and the app runs on the
 * mock catalogue, so everything is editable — the same convention the rest of
 * the app uses for mock mode.
 */
export function useSectionLevel(section: string): AccessLevel {
  const levels = useAccessStore((s) => s.levels);
  const loaded = useAccessStore((s) => s.loaded);
  if (!isSupabaseConfigured) return "WRITE";
  // Before the answer arrives, assume the action is available. Disabling a
  // button for a moment and then enabling it reads as a bug; the database is
  // the thing that says no.
  if (!loaded) return "WRITE";
  return levels[section] ?? "NONE";
}

export function useCanWriteSection(section: string): boolean {
  return useSectionLevel(section) === "WRITE";
}

export function useCanReadSection(section: string): boolean {
  return useSectionLevel(section) !== "NONE";
}
