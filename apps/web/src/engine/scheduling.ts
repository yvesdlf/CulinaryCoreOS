// ---------------------------------------------------------------------------
// Scheduling — working time, coverage and variance
// ---------------------------------------------------------------------------
// The rules are the EU Working Time Directive (2003/88/EC), because the
// organisation's jurisdiction is set to the EU. They are real limits with
// article numbers, not invented thresholds:
//
//   Article 3 — at least 11 consecutive hours of rest in each 24.
//   Article 4 — a rest break once a working day exceeds 6 hours.
//   Article 5 — at least 24 uninterrupted hours of rest in each 7 days,
//               in addition to the daily rest.
//   Article 6 — average weekly working time not to exceed 48 hours.
//
// Member states vary these and some allow an individual opt-out from Article
// 6, so every threshold is a named constant rather than a number buried in a
// comparison. A venue that needs different ones changes them in one place.
//
// These are warnings, not refusals. A manager sometimes has to break a rota
// rule and record why; a system that simply refused would be worked around
// with a paper rota, and then nothing is visible at all. The database refuses
// only what is unlawful regardless of intent — rostering somebody uncertified
// or on leave.
// ---------------------------------------------------------------------------

/** 2003/88/EC Article 3. */
export const MIN_DAILY_REST_HOURS = 11;
/** Article 5, in addition to daily rest. */
export const MIN_WEEKLY_REST_HOURS = 24;
/** Article 6, averaged over a reference period. */
export const MAX_WEEKLY_HOURS = 48;
/** Article 4 — a break is due once the day passes this. */
export const BREAK_DUE_AFTER_HOURS = 6;

export interface Shift {
  id: string;
  employeeId: string | null;
  departmentId: string | null;
  jobRoleId: string | null;
  startsAt: string;
  endsAt: string;
  breakMinutes: number;
  status: "DRAFT" | "PUBLISHED" | "CANCELLED";
}

export type WarningKind =
  | "OVERLAP"
  | "SHORT_DAILY_REST"
  | "NO_WEEKLY_REST"
  | "OVER_WEEKLY_HOURS"
  | "NO_BREAK"
  | "UNASSIGNED";

export interface ScheduleWarning {
  kind: WarningKind;
  employeeId: string | null;
  shiftIds: string[];
  message: string;
  /** The article this comes from, so a manager can look it up. */
  reference: string | null;
}

/** Paid hours: the span less the unpaid break. */
export function shiftHours(shift: Shift): number {
  const ms = Date.parse(shift.endsAt) - Date.parse(shift.startsAt);
  return Math.max(0, ms / 3_600_000 - shift.breakMinutes / 60);
}

/** Span in hours, break included — what Article 4 measures. */
function shiftSpanHours(shift: Shift): number {
  return Math.max(0, (Date.parse(shift.endsAt) - Date.parse(shift.startsAt)) / 3_600_000);
}

const counts = (s: Shift) => s.status !== "CANCELLED";

/**
 * Check a rota.
 *
 * Cancelled shifts are ignored throughout; a cancelled shift is not work and
 * counting it would make a manager chase a rest violation that does not exist.
 */
export function checkSchedule(shifts: Shift[]): ScheduleWarning[] {
  const warnings: ScheduleWarning[] = [];
  const live = shifts.filter(counts);

  for (const s of live) {
    if (!s.employeeId && s.status === "PUBLISHED") {
      warnings.push({
        kind: "UNASSIGNED",
        employeeId: null,
        shiftIds: [s.id],
        message: "This shift is published with nobody on it.",
        reference: null,
      });
    }
    if (shiftSpanHours(s) > BREAK_DUE_AFTER_HOURS && s.breakMinutes === 0) {
      warnings.push({
        kind: "NO_BREAK",
        employeeId: s.employeeId,
        shiftIds: [s.id],
        message: `A shift of ${shiftSpanHours(s).toFixed(1)} hours has no break recorded. A break is due once a working day exceeds ${BREAK_DUE_AFTER_HOURS} hours.`,
        reference: "2003/88/EC Article 4",
      });
    }
  }

  // Everything below is per person, so an unassigned shift has no bearing.
  const byEmployee = new Map<string, Shift[]>();
  for (const s of live) {
    if (!s.employeeId) continue;
    byEmployee.set(s.employeeId, [...(byEmployee.get(s.employeeId) ?? []), s]);
  }

  for (const [employeeId, own] of byEmployee) {
    const sorted = [...own].sort(
      (a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt),
    );

    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const next = sorted[i];
      const gapHours =
        (Date.parse(next.startsAt) - Date.parse(prev.endsAt)) / 3_600_000;

      if (gapHours < 0) {
        warnings.push({
          kind: "OVERLAP",
          employeeId,
          shiftIds: [prev.id, next.id],
          message: "Two shifts overlap. Nobody can work both.",
          reference: null,
        });
        continue;
      }
      if (gapHours < MIN_DAILY_REST_HOURS) {
        warnings.push({
          kind: "SHORT_DAILY_REST",
          employeeId,
          shiftIds: [prev.id, next.id],
          message: `Only ${gapHours.toFixed(1)} hours between shifts. At least ${MIN_DAILY_REST_HOURS} consecutive hours of rest are required in each 24.`,
          reference: "2003/88/EC Article 3",
        });
      }
    }

    // Weekly hours and weekly rest, by ISO week.
    const weeks = new Map<string, Shift[]>();
    for (const s of sorted) {
      const key = isoWeekKey(new Date(s.startsAt));
      weeks.set(key, [...(weeks.get(key) ?? []), s]);
    }

    for (const [week, weekShifts] of weeks) {
      const hours = weekShifts.reduce((n, s) => n + shiftHours(s), 0);
      if (hours > MAX_WEEKLY_HOURS) {
        warnings.push({
          kind: "OVER_WEEKLY_HOURS",
          employeeId,
          shiftIds: weekShifts.map((s) => s.id),
          message: `${hours.toFixed(1)} hours rostered in week ${week}. Average weekly working time is limited to ${MAX_WEEKLY_HOURS} hours.`,
          reference: "2003/88/EC Article 6",
        });
      }

      // A 24-hour uninterrupted break somewhere in the week.
      const ordered = [...weekShifts].sort(
        (a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt),
      );
      let longestGap = 0;
      for (let i = 1; i < ordered.length; i++) {
        longestGap = Math.max(
          longestGap,
          (Date.parse(ordered[i].startsAt) - Date.parse(ordered[i - 1].endsAt)) /
            3_600_000,
        );
      }
      // Fewer than three shifts in a week always leaves a day free somewhere;
      // flagging those would be noise.
      if (ordered.length >= 3 && longestGap < MIN_WEEKLY_REST_HOURS) {
        warnings.push({
          kind: "NO_WEEKLY_REST",
          employeeId,
          shiftIds: ordered.map((s) => s.id),
          message: `No ${MIN_WEEKLY_REST_HOURS}-hour break in week ${week}. The longest gap is ${longestGap.toFixed(1)} hours.`,
          reference: "2003/88/EC Article 5",
        });
      }
    }
  }

  return warnings;
}

/** ISO-8601 week, e.g. 2026-W32. Weeks start Monday. */
export function isoWeekKey(date: Date): string {
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  // Thursday decides the year an ISO week belongs to.
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export interface AttendanceRecord {
  employeeId: string;
  shiftId: string | null;
  effectiveIn: string;
  effectiveOut: string | null;
  hours: number | null;
  corrected: boolean;
}

export interface ShiftVariance {
  shift: Shift;
  scheduledHours: number;
  actualHours: number | null;
  /** Actual less scheduled. Negative means short. */
  varianceHours: number | null;
  /** Minutes late, negative if early. Null when nobody clocked in. */
  minutesLate: number | null;
  state: "not-worked" | "in-progress" | "worked";
}

/**
 * Scheduled against actual, per shift.
 *
 * A shift nobody clocked into is reported as not worked rather than as zero
 * hours: a no-show and a shift somebody worked for no time are different
 * facts and only one of them needs chasing.
 */
export function shiftVariance(
  shifts: Shift[],
  attendance: AttendanceRecord[],
): ShiftVariance[] {
  const byShift = new Map<string, AttendanceRecord>();
  for (const a of attendance) {
    if (a.shiftId) byShift.set(a.shiftId, a);
  }

  return shifts
    .filter(counts)
    .map((shift) => {
      const scheduledHours = shiftHours(shift);
      const record = byShift.get(shift.id);
      if (!record) {
        return {
          shift, scheduledHours, actualHours: null,
          varianceHours: null, minutesLate: null,
          state: "not-worked" as const,
        };
      }
      const minutesLate = Math.round(
        (Date.parse(record.effectiveIn) - Date.parse(shift.startsAt)) / 60_000,
      );
      if (record.hours === null) {
        return {
          shift, scheduledHours, actualHours: null, varianceHours: null,
          minutesLate, state: "in-progress" as const,
        };
      }
      return {
        shift, scheduledHours, actualHours: record.hours,
        varianceHours: Number((record.hours - scheduledHours).toFixed(3)),
        minutesLate, state: "worked" as const,
      };
    })
    .sort((a, b) => Date.parse(a.shift.startsAt) - Date.parse(b.shift.startsAt));
}

/** Hours rostered per person in a week, for a labour view. */
export function weeklyHours(
  shifts: Shift[],
): { employeeId: string; week: string; hours: number }[] {
  const totals = new Map<string, number>();
  for (const s of shifts.filter(counts)) {
    if (!s.employeeId) continue;
    const key = `${s.employeeId}|${isoWeekKey(new Date(s.startsAt))}`;
    totals.set(key, (totals.get(key) ?? 0) + shiftHours(s));
  }
  return [...totals.entries()]
    .map(([key, hours]) => {
      const [employeeId, week] = key.split("|");
      return { employeeId, week, hours: Number(hours.toFixed(2)) };
    })
    .sort((a, b) => b.hours - a.hours);
}
