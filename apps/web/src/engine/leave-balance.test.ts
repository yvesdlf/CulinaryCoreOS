import { describe, it, expect } from "vitest";
import {
  leaveBalances, headlineBalance,
  type LeaveTypeLike, type LeaveRequestLike,
} from "./leave-balance";

/**
 * Leave balances.
 *
 * The figure people argue about. A wrong one is discovered in December, when
 * it cannot be fixed — so the cases here are the ones that quietly give days
 * back: a rejected request, a request from last year, and an allowance that
 * does not exist.
 */

const annual: LeaveTypeLike = {
  id: "t-annual", code: "ANNUAL", name: "Annual leave",
  paid: true, annualEntitlementDays: 20, maxCarryoverDays: 5,
};
const sick: LeaveTypeLike = {
  id: "t-sick", code: "SICK", name: "Sick leave",
  paid: true, annualEntitlementDays: null,
};
const types = [annual, sick];

const YEAR_START = new Date(2026, 0, 1);
const YEAR_END = new Date(2026, 11, 31);

const req = (
  leaveTypeId: string, days: number, status: string, startsOn = "2026-06-01",
): LeaveRequestLike => ({ leaveTypeId, days, status, startsOn });

function balanceFor(code: string, requests: LeaveRequestLike[]) {
  return leaveBalances(types, requests, YEAR_START, YEAR_END)
    .find((b) => b.type.code === code)!;
}

describe("leave balances", () => {
  it("subtracts what was taken", () => {
    const b = balanceFor("ANNUAL", [req("t-annual", 5, "APPROVED")]);
    expect(b.taken).toBe(5);
    expect(b.remaining).toBe(15);
  });

  it("counts a request still waiting against the balance", () => {
    // Somebody with 20 days who has asked for 15 has 5 to plan with, not 20.
    // Showing 20 invites them to book a holiday they cannot take.
    const b = balanceFor("ANNUAL", [req("t-annual", 15, "REQUESTED")]);
    expect(b.pending).toBe(15);
    expect(b.remaining).toBe(5);
  });

  it("gives nothing back for a rejected or cancelled request", () => {
    // Filtering on "not taken" instead of "approved or pending" silently
    // returns everybody's refused days.
    const b = balanceFor("ANNUAL", [
      req("t-annual", 5, "APPROVED"),
      req("t-annual", 10, "REJECTED"),
      req("t-annual", 3, "CANCELLED"),
    ]);
    expect(b.taken).toBe(5);
    expect(b.pending).toBe(0);
    expect(b.remaining).toBe(15);
  });

  it("ignores leave from another year", () => {
    const b = balanceFor("ANNUAL", [
      req("t-annual", 8, "APPROVED", "2025-06-01"),
      req("t-annual", 2, "APPROVED", "2026-06-01"),
    ]);
    expect(b.taken).toBe(2);
    expect(b.remaining).toBe(18);
  });

  it("reports days used, not days left, where there is no allowance", () => {
    // "Sick days remaining" reads as an allowance to spend.
    const b = balanceFor("SICK", [req("t-sick", 3, "APPROVED")]);
    expect(b.entitlement).toBeNull();
    expect(b.remaining).toBeNull();
    expect(b.taken).toBe(3);
  });

  it("shows an overrun rather than clamping at zero", () => {
    // Hiding it is how it reaches payroll unnoticed.
    const b = balanceFor("ANNUAL", [req("t-annual", 23, "APPROVED")]);
    expect(b.remaining).toBe(-3);
  });

  it("keeps half days and drops the floating-point tail", () => {
    const b = balanceFor("ANNUAL", [
      req("t-annual", 0.5, "APPROVED"),
      req("t-annual", 0.2, "APPROVED"),
      req("t-annual", 0.1, "APPROVED"),
    ]);
    expect(b.taken).toBe(0.8);
    expect(b.remaining).toBe(19.2);
  });

  it("does not let one type's leave touch another's", () => {
    const all = leaveBalances(types, [
      req("t-annual", 4, "APPROVED"),
      req("t-sick", 9, "APPROVED"),
    ], YEAR_START, YEAR_END);
    expect(all.find((b) => b.type.code === "ANNUAL")!.remaining).toBe(16);
    expect(all.find((b) => b.type.code === "SICK")!.taken).toBe(9);
  });

  it("returns a row per type even with no requests at all", () => {
    const all = leaveBalances(types, [], YEAR_START, YEAR_END);
    expect(all).toHaveLength(2);
    expect(all[0].remaining).toBe(20);
  });
});

describe("headlineBalance", () => {
  it("picks annual leave, because that is what people count", () => {
    const all = leaveBalances(types, [], YEAR_START, YEAR_END);
    expect(headlineBalance(all)!.type.code).toBe("ANNUAL");
  });

  it("falls back to the largest allowance where there is no ANNUAL", () => {
    const odd: LeaveTypeLike[] = [
      { id: "a", code: "VAC", name: "Vacation", paid: true, annualEntitlementDays: 25 },
      { id: "b", code: "PERS", name: "Personal", paid: true, annualEntitlementDays: 3 },
    ];
    const all = leaveBalances(odd, [], YEAR_START, YEAR_END);
    expect(headlineBalance(all)!.type.code).toBe("VAC");
  });

  it("returns null where nothing has an allowance", () => {
    const all = leaveBalances([sick], [], YEAR_START, YEAR_END);
    expect(headlineBalance(all)).toBeNull();
  });
});
