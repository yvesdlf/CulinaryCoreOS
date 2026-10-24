// ---------------------------------------------------------------------------
// The venue's currency, time zone and food-cost target
// ---------------------------------------------------------------------------
// Loaded once at sign-in, beside the access grid, and written into
// `lib/venue.ts` for the formatting and date helpers. A failure keeps the
// defaults: the screens still work, in rupiah, the browser's time zone and a
// 25 % target, which is what they did before this store existed.
// ---------------------------------------------------------------------------

import { create } from "zustand";
import { isSupabaseConfigured } from "@/lib/supabase";
import { DEFAULT_VENUE, setVenue, type VenueSettings } from "@/lib/venue";
import { fetchVenueSettings } from "@/data/repository";

interface VenueState {
  settings: VenueSettings;
  loaded: boolean;
  load: () => Promise<void>;
  clear: () => void;
}

export const useVenueStore = create<VenueState>((set) => ({
  settings: DEFAULT_VENUE,
  loaded: false,

  load: async () => {
    if (!isSupabaseConfigured) {
      set({ loaded: true });
      return;
    }
    try {
      const settings = await fetchVenueSettings(DEFAULT_VENUE);
      setVenue(settings);
      set({ settings, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },

  clear: () => {
    setVenue(DEFAULT_VENUE);
    set({ settings: DEFAULT_VENUE, loaded: false });
  },
}));

/** The target food cost and the tolerance either side of it, in percent. */
export function useFoodCostTarget(): { target: number; tolerance: number } {
  const s = useVenueStore((v) => v.settings);
  return { target: s.targetFoodCostPercent, tolerance: s.foodCostTolerancePercent };
}
