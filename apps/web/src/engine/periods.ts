// ---------------------------------------------------------------------------
// The period a report covers, and the one it is compared against
// ---------------------------------------------------------------------------
// Every report in this system is about a stretch of time, and two of the
// decisions below change every figure on every sheet. They are made here,
// once, rather than in each report.
//
// ── "This time last year" is two different questions ──────────────────────
//
// For a day or a week it means **the same trading days**: a Saturday against
// a Saturday. For a month, a quarter or a year it means **the same season**:
// November against November.
//
// Those two rules disagree, and the disagreement is not small. 364 days back
// from Saturday 7 November 2026 is Saturday 8 November 2025 — the same
// weekday, one day off the date. Shifting the calendar instead gives Friday
// 7 November 2025, so a Saturday's takings would be compared against a
// Friday's and the venue would look like it had collapsed.
//
// The other way round is just as wrong: 364 days back from a whole November
// starts in early November and ends in early December, which compares a month
// of trading against a month that is one third a different month. A restaurant
// in Bali does not trade the same volume in November as in December.
//
// So: **52 weeks for a day or a week, the calendar for anything longer.**
// Each period says which rule it used, because a reader comparing two numbers
// is entitled to know what was held constant.
//
// ── An unfinished period is not comparable to a finished one ──────────────
//
// The trend work (0120) established this and it applies to every report:
// today is not over, this week is not over, and November is not over until it
// is. A period that contains today is marked `complete: false`, and a
// comparison against a complete one of the same name is marked
// `likeForLike: false` with the reason in words. Nothing here refuses to
// produce the comparison — a manager mid-month genuinely wants to know how
// the month is going — it refuses to let it be presented as though the two
// halves were the same shape.
// ---------------------------------------------------------------------------

/** The shapes a report can cover. `YTD` runs from 1 January to the end date. */
export type PeriodKind = "DAY" | "WEEK" | "MONTH" | "QUARTER" | "YEAR" | "YTD";

export interface Period {
  kind: PeriodKind;
  /** Inclusive, ISO `YYYY-MM-DD`, in the venue's own dates. */
  from: string;
  /** Inclusive. */
  to: string;
  /** How the period names itself on a sheet: "November 2026", "Week 45, 2026". */
  label: string;
  /** False when the period contains, or has not yet reached, today. */
  complete: boolean;
  /** Whole days in the period, whether or not anything was recorded in them. */
  days: number;
}

export interface Comparison {
  current: Period;
  previous: Period;
  /** `WEEKDAY` held the trading days constant; `CALENDAR` held the season. */
  basis: "WEEKDAY" | "CALENDAR";
  /**
   * True when the two periods can be read side by side without a caveat.
   * False means they can still be read — with the reason beside them.
   */
  likeForLike: boolean;
  /** Said in words, for the sheet. Empty when `likeForLike`. */
  caveats: string[];
}

// ── Dates, without a timezone anywhere near them ───────────────────────────
//
// Everything here is an ISO date string in the venue's own calendar, never a
// `Date`. `new Date("2026-11-10")` is midnight UTC, which in Bali is already
// the 10th and in Los Angeles is still the 9th — and a report that changes
// which day it covers depending on where it is opened is not a report.

function parse(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m, d };
}

function iso(y: number, m: number, d: number): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** Days in a month, 1-indexed. */
export function daysInMonth(y: number, m: number): number {
  return [31, (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28,
    31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}

/** Days between two ISO dates, counting both ends. */
export function daysInclusive(from: string, to: string): number {
  return Math.round((Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z"))
    / 86_400_000) + 1;
}

export function shiftDays(isoDate: string, days: number): string {
  const t = Date.parse(isoDate + "T00:00:00Z") + days * 86_400_000;
  const d = new Date(t);
  return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** 1 = Monday … 7 = Sunday. ISO, so a week starts on Monday. */
export function weekday(isoDate: string): number {
  const day = new Date(Date.parse(isoDate + "T00:00:00Z")).getUTCDay();
  return day === 0 ? 7 : day;
}

/** The Monday of the week an ISO date falls in. */
export function startOfWeek(isoDate: string): string {
  return shiftDays(isoDate, -(weekday(isoDate) - 1));
}

/**
 * The ISO week number, which is the only week number worth printing.
 *
 * Not "the nth Monday": ISO-8601 puts a week in the year that holds its
 * Thursday, so the first days of January can belong to week 52 of the year
 * before. A sheet headed "Week 1, 2027" covering December would be wrong in a
 * way nobody would question.
 */
export function isoWeek(isoDate: string): { week: number; year: number } {
  const thursday = shiftDays(startOfWeek(isoDate), 3);
  const { y } = parse(thursday);
  const jan1 = iso(y, 1, 1);
  const week = Math.floor(daysInclusive(startOfWeek(jan1), thursday) / 7) + 1;
  return { week, year: y };
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December"];

// ── Building a period ──────────────────────────────────────────────────────

/**
 * The period of `kind` that contains `on`, as the venue counts days.
 *
 * `today` decides completeness and nothing else, so a report of last month
 * reads the same whenever it is opened.
 */
export function periodContaining(kind: PeriodKind, on: string, today: string): Period {
  const { y, m } = parse(on);
  let from: string;
  let to: string;
  let label: string;

  switch (kind) {
    case "DAY":
      from = to = on;
      label = on;
      break;
    case "WEEK": {
      from = startOfWeek(on);
      to = shiftDays(from, 6);
      const { week, year } = isoWeek(on);
      label = `Week ${week}, ${year}`;
      break;
    }
    case "MONTH":
      from = iso(y, m, 1);
      to = iso(y, m, daysInMonth(y, m));
      label = `${MONTHS[m - 1]} ${y}`;
      break;
    case "QUARTER": {
      const q = Math.floor((m - 1) / 3);
      from = iso(y, q * 3 + 1, 1);
      to = iso(y, q * 3 + 3, daysInMonth(y, q * 3 + 3));
      label = `Q${q + 1} ${y}`;
      break;
    }
    case "YEAR":
      from = iso(y, 1, 1);
      to = iso(y, 12, 31);
      label = String(y);
      break;
    case "YTD":
      from = iso(y, 1, 1);
      // To the day asked about, not to 31 December: a year to date that ran
      // to the end of the year would be the year, under a name that promises
      // it is not.
      to = on;
      label = `${y} to ${on}`;
      break;
  }

  return {
    kind, from, to, label,
    // `to >= today` rather than `to === today`: a period chosen in the future
    // is as unfinished as one containing today, and string comparison is
    // exact on ISO dates.
    complete: to < today,
    days: daysInclusive(from, to),
  };
}

/**
 * The same period a year earlier, and whether the two can be read side by
 * side without explanation.
 */
export function sameTimeLastYear(current: Period, today: string): Comparison {
  const weekdayBasis = current.kind === "DAY" || current.kind === "WEEK";
  const caveats: string[] = [];

  let previous: Period;
  if (weekdayBasis) {
    // 52 weeks, so a Saturday is compared with a Saturday.
    const from = shiftDays(current.from, -364);
    previous = {
      kind: current.kind,
      from,
      to: shiftDays(current.to, -364),
      label: current.kind === "DAY"
        ? from
        : `Week ${isoWeek(from).week}, ${isoWeek(from).year}`,
      complete: shiftDays(current.to, -364) < today,
      days: current.days,
    };
  } else {
    const { y } = parse(current.from);
    const lastYear = y - 1;
    if (current.kind === "YTD") {
      const { m, d } = parse(current.to);
      // 29 February has no counterpart in a common year; the 28th is the
      // nearest honest answer and is said out loud rather than silently used.
      const safeDay = Math.min(d, daysInMonth(lastYear, m));
      if (safeDay !== d) {
        caveats.push(`29 February has no counterpart in ${lastYear}; last year's period ends on the 28th.`);
      }
      previous = periodContaining("YTD", iso(lastYear, m, safeDay), today);
    } else {
      const { m } = parse(current.from);
      previous = periodContaining(current.kind, iso(lastYear, m, 1), today);
    }
    if (previous.days !== current.days) {
      caveats.push(
        `${previous.label} has ${previous.days} days against ${current.days}, ` +
        "so the totals are not directly comparable.",
      );
    }
    /*
     * The one nobody expects. A calendar period a year apart starts on a
     * different weekday, so it holds a different number of weekends — and a
     * venue takes most of its money at the weekend. Said for every calendar
     * comparison, because it is always true and always invisible.
     */
    const weekendsNow = countWeekendDays(current.from, current.to);
    const weekendsThen = countWeekendDays(previous.from, previous.to);
    if (weekendsNow !== weekendsThen) {
      caveats.push(
        `${current.label} contains ${weekendsNow} weekend days and ${previous.label} ` +
        `contains ${weekendsThen}.`,
      );
    }
  }

  if (!current.complete) {
    caveats.push(
      `${current.label} is not finished. It is being compared against a whole ` +
      `${describeShape(current.kind)}.`,
    );
  }

  return {
    current,
    previous,
    basis: weekdayBasis ? "WEEKDAY" : "CALENDAR",
    likeForLike: caveats.length === 0,
    caveats,
  };
}

function describeShape(kind: PeriodKind): string {
  return kind === "YTD" ? "year to the same date" : kind.toLowerCase();
}

/** Saturdays and Sundays in an inclusive range. */
export function countWeekendDays(from: string, to: string): number {
  let n = 0;
  for (let day = from; day <= to; day = shiftDays(day, 1)) {
    if (weekday(day) >= 6) n += 1;
  }
  return n;
}

/**
 * The part of an unfinished period that has actually happened.
 *
 * A report that totals a month in progress against a whole month last year is
 * comparing nine days with thirty. Reports use this to offer the honest
 * version — last year clipped to the same number of elapsed days — beside the
 * whole one, rather than instead of it: both are questions somebody asks.
 */
export function clipToElapsed(previous: Period, current: Period, today: string): Period {
  if (current.complete) return previous;
  const elapsed = Math.max(0, daysInclusive(current.from, today) - 1);
  if (elapsed <= 0 || elapsed >= previous.days) return previous;
  const to = shiftDays(previous.from, elapsed - 1);
  return {
    ...previous,
    to,
    label: `${previous.label}, first ${elapsed} ${elapsed === 1 ? "day" : "days"}`,
    days: elapsed,
  };
}
