import { describe, it, expect } from "vitest";
import {
  checkSchedule, shiftHours, shiftVariance, weeklyHours, isoWeekKey,
  MIN_DAILY_REST_HOURS, MAX_WEEKLY_HOURS,
  type Shift, type AttendanceRecord,
} from "./scheduling";

/**
 * Scheduling.
 *
 * The thresholds are the EU Working Time Directive, so the tests are written
 * against its articles rather than against round numbers that felt right.
 */

let n = 0;
const shift = (over: Partial<Shift> = {}): Shift => ({
  id: `s${n++}`, employeeId: "e1", departmentId: "kitchen", jobRoleId: "cdp",
  startsAt: "2026-08-03T09:00:00Z", endsAt: "2026-08-03T17:00:00Z",
  breakMinutes: 30, status: "PUBLISHED", ...over,
});

describe("hours", () => {
  it("subtracts the unpaid break", () => {
    expect(shiftHours(shift())).toBe(7.5);
  });
  it("never goes negative on a malformed shift", () => {
    expect(shiftHours(shift({ breakMinutes: 999 }))).toBe(0);
  });
});

describe("daily rest — Article 3", () => {
  it("warns when there are fewer than 11 hours between shifts", () => {
    const w = checkSchedule([
      shift({ id: "a", startsAt: "2026-08-03T14:00:00Z", endsAt: "2026-08-03T23:00:00Z" }),
      shift({ id: "b", startsAt: "2026-08-04T08:00:00Z", endsAt: "2026-08-04T16:00:00Z" }),
    ]);
    const rest = w.find((x) => x.kind === "SHORT_DAILY_REST");
    expect(rest).toBeTruthy();
    expect(rest!.reference).toBe("2003/88/EC Article 3");
    expect(rest!.message).toMatch(/9\.0 hours/);
  });

  it("accepts exactly the minimum", () => {
    const w = checkSchedule([
      shift({ id: "a", startsAt: "2026-08-03T14:00:00Z", endsAt: "2026-08-03T22:00:00Z" }),
      shift({ id: "b", startsAt: "2026-08-04T09:00:00Z", endsAt: "2026-08-04T17:00:00Z" }),
    ]);
    expect(w.some((x) => x.kind === "SHORT_DAILY_REST")).toBe(false);
    expect(MIN_DAILY_REST_HOURS).toBe(11);
  });

  it("reports an overlap as an overlap, not as short rest", () => {
    // Two shifts at once is a mistake of a different kind.
    const w = checkSchedule([
      shift({ id: "a", startsAt: "2026-08-03T09:00:00Z", endsAt: "2026-08-03T17:00:00Z" }),
      shift({ id: "b", startsAt: "2026-08-03T15:00:00Z", endsAt: "2026-08-03T23:00:00Z" }),
    ]);
    expect(w.some((x) => x.kind === "OVERLAP")).toBe(true);
    expect(w.some((x) => x.kind === "SHORT_DAILY_REST")).toBe(false);
  });

  it("does not compare shifts belonging to different people", () => {
    const w = checkSchedule([
      shift({ id: "a", employeeId: "e1", startsAt: "2026-08-03T14:00:00Z", endsAt: "2026-08-03T23:00:00Z" }),
      shift({ id: "b", employeeId: "e2", startsAt: "2026-08-04T08:00:00Z", endsAt: "2026-08-04T16:00:00Z" }),
    ]);
    expect(w.some((x) => x.kind === "SHORT_DAILY_REST")).toBe(false);
  });
});

describe("breaks — Article 4", () => {
  it("warns on a long shift with no break", () => {
    const w = checkSchedule([shift({ breakMinutes: 0 })]);
    const b = w.find((x) => x.kind === "NO_BREAK");
    expect(b!.reference).toBe("2003/88/EC Article 4");
  });
  it("says nothing about a short shift with no break", () => {
    const w = checkSchedule([
      shift({ breakMinutes: 0, startsAt: "2026-08-03T09:00:00Z", endsAt: "2026-08-03T14:00:00Z" }),
    ]);
    expect(w.some((x) => x.kind === "NO_BREAK")).toBe(false);
  });
});

describe("weekly limits — Articles 5 and 6", () => {
  const day = (d: number, from = 9, to = 20) =>
    shift({
      id: `d${d}`,
      startsAt: `2026-08-0${d}T${String(from).padStart(2, "0")}:00:00Z`,
      endsAt: `2026-08-0${d}T${String(to).padStart(2, "0")}:00:00Z`,
      breakMinutes: 30,
    });

  it("warns above 48 hours in a week", () => {
    // Six days of 10,5 paid hours is 63.
    const w = checkSchedule([day(3), day(4), day(5), day(6), day(7), day(8)]);
    const over = w.find((x) => x.kind === "OVER_WEEKLY_HOURS");
    expect(over).toBeTruthy();
    expect(over!.reference).toBe("2003/88/EC Article 6");
    expect(MAX_WEEKLY_HOURS).toBe(48);
  });

  it("warns when no 24-hour break exists in the week", () => {
    const w = checkSchedule([day(3, 9, 17), day(4, 9, 17), day(5, 9, 17)]);
    expect(w.some((x) => x.kind === "NO_WEEKLY_REST")).toBe(true);
  });

  it("does not chase a week with only a couple of shifts", () => {
    // Two shifts always leave a day free somewhere; flagging them is noise.
    const w = checkSchedule([day(3, 9, 17), day(4, 9, 17)]);
    expect(w.some((x) => x.kind === "NO_WEEKLY_REST")).toBe(false);
  });

  it("keeps weeks apart", () => {
    const w = checkSchedule([day(3), day(4), day(5)]);
    expect(w.some((x) => x.kind === "OVER_WEEKLY_HOURS")).toBe(false);
  });
});

describe("unassigned and cancelled", () => {
  it("flags a published shift with nobody on it", () => {
    const w = checkSchedule([shift({ employeeId: null })]);
    expect(w.some((x) => x.kind === "UNASSIGNED")).toBe(true);
  });
  it("says nothing about an unassigned draft", () => {
    const w = checkSchedule([shift({ employeeId: null, status: "DRAFT" })]);
    expect(w.some((x) => x.kind === "UNASSIGNED")).toBe(false);
  });
  it("ignores cancelled shifts entirely", () => {
    // A cancelled shift is not work, and counting it invents a violation.
    const w = checkSchedule([
      shift({ id: "a", startsAt: "2026-08-03T14:00:00Z", endsAt: "2026-08-03T23:00:00Z", status: "CANCELLED" }),
      shift({ id: "b", startsAt: "2026-08-04T08:00:00Z", endsAt: "2026-08-04T16:00:00Z" }),
    ]);
    expect(w).toEqual([]);
  });
});

describe("scheduled against actual", () => {
  const record = (over: Partial<AttendanceRecord> = {}): AttendanceRecord => ({
    employeeId: "e1", shiftId: "s-x", effectiveIn: "2026-08-03T09:05:00Z",
    effectiveOut: "2026-08-03T17:00:00Z", hours: 7.42, corrected: false, ...over,
  });

  it("reports lateness and the hours difference", () => {
    const s = shift({ id: "s-x" });
    const [v] = shiftVariance([s], [record()]);
    expect(v.state).toBe("worked");
    expect(v.minutesLate).toBe(5);
    expect(v.varianceHours).toBeCloseTo(-0.08, 2);
  });

  it("calls a shift nobody clocked into not worked, rather than zero hours", () => {
    // A no-show and a shift worked for no time are different facts.
    const [v] = shiftVariance([shift({ id: "s-x" })], []);
    expect(v.state).toBe("not-worked");
    expect(v.actualHours).toBeNull();
  });

  it("marks a shift still being worked as in progress", () => {
    const [v] = shiftVariance([shift({ id: "s-x" })], [record({ hours: null, effectiveOut: null })]);
    expect(v.state).toBe("in-progress");
    expect(v.minutesLate).toBe(5);
  });

  it("counts arriving early as negative lateness", () => {
    const [v] = shiftVariance(
      [shift({ id: "s-x" })],
      [record({ effectiveIn: "2026-08-03T08:50:00Z" })],
    );
    expect(v.minutesLate).toBe(-10);
  });
});

describe("weekly hours", () => {
  it("totals per person per week, busiest first", () => {
    const out = weeklyHours([
      shift({ id: "a", employeeId: "e1" }),
      shift({ id: "b", employeeId: "e1", startsAt: "2026-08-04T09:00:00Z", endsAt: "2026-08-04T17:00:00Z" }),
      shift({ id: "c", employeeId: "e2" }),
    ]);
    expect(out[0]).toEqual({ employeeId: "e1", week: "2026-W32", hours: 15 });
    expect(out[1].hours).toBe(7.5);
  });

  it("ignores open shifts, which belong to nobody", () => {
    expect(weeklyHours([shift({ employeeId: null })])).toEqual([]);
  });
});

describe("iso weeks", () => {
  it("starts weeks on Monday", () => {
    expect(isoWeekKey(new Date("2026-08-03T00:00:00Z"))).toBe("2026-W32");
    expect(isoWeekKey(new Date("2026-08-09T00:00:00Z"))).toBe("2026-W32");
    expect(isoWeekKey(new Date("2026-08-10T00:00:00Z"))).toBe("2026-W33");
  });
});
