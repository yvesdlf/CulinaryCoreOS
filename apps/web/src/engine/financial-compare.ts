// ---------------------------------------------------------------------------
// The three ranges a financial comparison sets side by side
// ---------------------------------------------------------------------------
// A dashboard comparison answers "how is this period doing" by showing three
// columns: this period, the period before it, and the same period a year ago.
// Working out those three ranges is date arithmetic, and the one subtle part
// — what "the same period last year" means — already lives in the period
// engine (`sameTimeLastYear`: 52 weeks for a day or week, the same calendar
// month for a month). This builds the trio from that, so the rule is not
// re-derived, and leaves the figures to the database.
// ---------------------------------------------------------------------------

import {
  type Period,
  sameTimeLastYear,
  clipToElapsed,
} from "@/engine/periods";
import {
  resolvePeriod,
  type PeriodChoice,
} from "@/components/reports/period-picker";
import { shiftDays, daysInclusive } from "@/engine/periods";

export interface FinancialRanges {
  current: Period;
  previous: Period;
  yearAgo: Period;
  /** The year-ago comparison's caveats, when it is not quite like-for-like. */
  yearAgoCaveats: string[];
  /** True when the year-ago period lines up cleanly with the current one. */
  yearAgoLikeForLike: boolean;
}

/**
 * The period immediately before this one.
 *
 * For a preset that is the same kind one step back. For a custom range, or
 * year-to-date — where "one step back" has no natural meaning — it is the same
 * number of days ending the day before the current range begins, which is the
 * honest generic answer.
 */
function previousPeriod(choice: PeriodChoice, current: Period, today: string): Period {
  if (choice.mode === "PRESET" && choice.kind !== "YTD") {
    return resolvePeriod({ ...choice, offset: choice.offset - 1 }, today);
  }
  const span = daysInclusive(current.from, current.to);
  const to = shiftDays(current.from, -1);
  const from = shiftDays(to, -(span - 1));
  return {
    kind: current.kind,
    from,
    to,
    label: `${from} to ${to}`,
    complete: to < today,
    days: span,
  };
}

export function financialRanges(choice: PeriodChoice, today: string): FinancialRanges {
  const current = resolvePeriod(choice, today);
  /*
   * Both comparison columns are clipped to how far the current period has
   * run. `sameTimeLastYear` already does this for the year-ago period; doing
   * it to the previous period too keeps the two columns honest with each
   * other — a month that is eighteen days old is compared against the first
   * eighteen days of the month before, not against a whole finished month,
   * which would read as a collapse that is really just the calendar.
   */
  const previous = clipToElapsed(previousPeriod(choice, current, today), current, today);
  const yoy = sameTimeLastYear(current, today);
  return {
    current,
    previous,
    yearAgo: yoy.previous,
    yearAgoCaveats: yoy.caveats,
    yearAgoLikeForLike: yoy.likeForLike,
  };
}

/**
 * Change from a prior figure to a current one, as a percentage.
 *
 * Null when there is nothing to compare against — a zero prior is not a
 * 100% rise, it is a period that had no figure, and a dashboard that printed
 * "+∞%" or "+100%" against it would be inventing a trend. The caller shows a
 * dash instead.
 */
export function variancePct(current: number, prior: number): number | null {
  if (prior === 0) return null;
  return Math.round(((current - prior) / prior) * 1000) / 10;
}
