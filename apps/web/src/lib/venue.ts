// ---------------------------------------------------------------------------
// The venue's own settings, for code that is not a component
// ---------------------------------------------------------------------------
// Currency, time zone and the food-cost target were constants: rupiah, UTC and
// 25 %. The database has held a target and tolerance per venue since 0045 and
// a currency since the start, and nothing on a screen read them. Formatting
// and date helpers are plain functions called from everywhere, including
// outside React, so the values live here; `venue-store.ts` loads them at
// sign-in and writes them in.
//
// Until then — and with no database at all — the defaults below apply. The
// time zone falls back to the browser's, which on a venue's own tablet is the
// right answer, rather than to UTC, which is right nowhere in particular.
// ---------------------------------------------------------------------------

import {
  DEFAULT_CURRENCY,
  TARGET_FOOD_COST_PERCENT,
  FOOD_COST_VARIANCE_PERCENT,
} from "./constants";

export interface VenueSettings {
  currency: string;
  timezone: string;
  targetFoodCostPercent: number;
  foodCostTolerancePercent: number;
}

function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export const DEFAULT_VENUE: VenueSettings = {
  currency: DEFAULT_CURRENCY,
  timezone: browserTimezone(),
  targetFoodCostPercent: TARGET_FOOD_COST_PERCENT,
  foodCostTolerancePercent: FOOD_COST_VARIANCE_PERCENT,
};

let current: VenueSettings = DEFAULT_VENUE;

export function venue(): VenueSettings {
  return current;
}

export function setVenue(next: VenueSettings): void {
  current = next;
}
