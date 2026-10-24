// ---------------------------------------------------------------------------
// Today, held still for as long as a screen is open
// ---------------------------------------------------------------------------
// `new Date()` in a component's render body is impure: React may render twice
// for one commit — it does so deliberately in StrictMode — and the two renders
// can disagree. A date comparison makes that nearly impossible to observe,
// which is exactly why it survives review: the badge is right every time
// anybody looks at it, and the rule it breaks is the one that lets React
// render freely.
//
// `react-hooks/purity` is an error in this project's eslint config and does not
// catch this shape, so it was found by reading rather than by the gate. Five
// sites, of which one mattered: the late/not-late badge on outstanding training
// in `development-tabs.tsx`.
//
// **What "today" means here is a decision, not a detail.** This is the day the
// screen was opened, and it does not move while somebody is looking at it. A
// clock read during render would instead change the answer on any re-render,
// so a training badge would flip from on-time to late halfway through an
// unrelated click at one minute past midnight — with no reload and nothing on
// screen to explain it. A screen that is wrong consistently until it is
// reloaded is easier to trust than one that is right at unpredictable moments.
//
// Not used for anything that must be correct to the minute. There is nothing
// of that kind on these screens; attendance reads its times from the database.
// ---------------------------------------------------------------------------

import { useMemo } from "react";
import { venue } from "./venue";

/*
 * "Today" is the venue's, not Greenwich's. `toISOString()` gives the UTC date,
 * which for a venue in Bali turned over at eight in the morning: a fridge
 * check done at seven was filed under yesterday. The database reads the same
 * day since 0082, so a screen and the view behind it agree.
 */

/** The calendar date of an instant, where the venue is: `YYYY-MM-DD`. */
export function venueDate(instant: Date | string | number): string {
  // en-CA formats as YYYY-MM-DD; the locale is chosen for that shape only.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: venue().timezone,
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(instant));
}

/** Today at the venue, as `YYYY-MM-DD`. */
export function venueToday(): string {
  return venueDate(new Date());
}

/**
 * A calendar date plus whole days. Pure date arithmetic — no instant, no time
 * zone — done at UTC noon so no daylight-saving change can move it a day.
 */
export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days, 12)).toISOString().slice(0, 10);
}

/** Today at the venue as `YYYY-MM-DD`, stable for the life of the component. */
export function useToday(): string {
  return useMemo(() => venueToday(), []);
}

/** Now as a `Date`, stable for the life of the component. */
export function useNow(): Date {
  return useMemo(() => new Date(), []);
}
