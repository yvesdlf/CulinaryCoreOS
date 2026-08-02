import { describe, it, expect } from "vitest";
import {
  leaveBalance, overlappingLeave, checkEligibility, lapsingCertifications,
  headcount, fullName, isWorking,
  type Employee, type LeaveType, type LeaveRequest, type Certification,
} from "./people";

/**
 * People.
 *
 * The tests concentrate on the three things a venue argues about: how much
 * leave somebody actually has left, whether they are legally allowed on a
 * station today, and who is off at the same time.
 */

const YEAR_START = new Date(Date.UTC(2026, 0, 1));
const YEAR_END = new Date(Date.UTC(2026, 11, 31));
const TODAY = new Date("2026-08-03T09:00:00Z");

const employee = (over: Partial<Employee> = {}): Employee => ({
  id: "e1", employeeNumber: "E-001", firstName: "Ayu", lastName: "Pratama",
  departmentId: "kitchen", jobRoleId: "chef", managerId: null,
  employmentStatus: "ACTIVE", employmentType: "FULL_TIME",
  startedOn: "2020-03-01", contractedHoursPerWeek: 40, ...over,
});

const annual: LeaveType = {
  id: "lt-annual", code: "ANNUAL", name: "Annual leave", paid: true,
  annualEntitlementDays: 20, maxCarryoverDays: 5,
};

const request = (over: Partial<LeaveRequest> = {}): LeaveRequest => ({
  id: "l1", employeeId: "e1", leaveTypeId: "lt-annual",
  startsOn: "2026-03-01", endsOn: "2026-03-05", days: 5,
  status: "APPROVED", ...over,
});

describe("leave balance", () => {
  it("subtracts approved leave as well as leave already taken", () => {
    // A balance counting only the past says a fortnight is free in December
    // when it has already been booked for Christmas.
    const b = leaveBalance(employee(), annual,
      [request({ status: "TAKEN", days: 5 }), request({ id: "l2", status: "APPROVED", days: 8 })],
      YEAR_START, YEAR_END);
    expect(b.taken).toBe(5);
    expect(b.booked).toBe(8);
    expect(b.remaining).toBe(7);
  });

  it("pro-rates a part-time contract", () => {
    const b = leaveBalance(employee({ contractedHoursPerWeek: 20 }), annual, [], YEAR_START, YEAR_END);
    expect(b.entitlement).toBe(10);
  });

  it("pro-rates a mid-year start by whole months", () => {
    // Starting in July leaves six months of the year, so half the entitlement.
    const b = leaveBalance(employee({ startedOn: "2026-07-01" }), annual, [], YEAR_START, YEAR_END);
    expect(b.entitlement).toBe(10);
  });

  it("gives nothing to somebody who has not started", () => {
    const b = leaveBalance(employee({ startedOn: "2027-01-01" }), annual, [], YEAR_START, YEAR_END);
    expect(b.entitlement).toBe(0);
  });

  it("ignores rejected and cancelled requests", () => {
    const b = leaveBalance(employee(), annual,
      [request({ status: "REJECTED", days: 10 }), request({ id: "l2", status: "CANCELLED", days: 5 })],
      YEAR_START, YEAR_END);
    expect(b.remaining).toBe(20);
  });

  it("ignores leave in another year", () => {
    const b = leaveBalance(employee(), annual,
      [request({ startsOn: "2025-03-01", endsOn: "2025-03-05", status: "TAKEN" })],
      YEAR_START, YEAR_END);
    expect(b.taken).toBe(0);
  });

  it("gives no entitlement for a type that has none, like sick leave", () => {
    const sick: LeaveType = { ...annual, id: "lt-sick", code: "SICK", annualEntitlementDays: null };
    expect(leaveBalance(employee(), sick, [], YEAR_START, YEAR_END).entitlement).toBe(0);
  });
});

describe("who else is off", () => {
  const team = [employee(), employee({ id: "e2", firstName: "Budi" }),
                employee({ id: "e3", firstName: "Citra", departmentId: "bar" })];

  it("finds an overlap in the same department", () => {
    const out = overlappingLeave(
      { employeeId: "e1", startsOn: "2026-03-03", endsOn: "2026-03-07" },
      [request({ employeeId: "e2", startsOn: "2026-03-05", endsOn: "2026-03-10" })],
      team, "kitchen");
    expect(out).toHaveLength(1);
    expect(out[0].employeeName).toBe("Budi Pratama");
  });

  it("ignores another department", () => {
    const out = overlappingLeave(
      { employeeId: "e1", startsOn: "2026-03-03", endsOn: "2026-03-07" },
      [request({ employeeId: "e3", startsOn: "2026-03-05", endsOn: "2026-03-10" })],
      team, "kitchen");
    expect(out).toEqual([]);
  });

  it("counts leave that merely touches at the edge", () => {
    const out = overlappingLeave(
      { employeeId: "e1", startsOn: "2026-03-05", endsOn: "2026-03-09" },
      [request({ employeeId: "e2", startsOn: "2026-03-01", endsOn: "2026-03-05" })],
      team, "kitchen");
    expect(out).toHaveLength(1);
  });

  it("ignores requests that are not yet approved", () => {
    const out = overlappingLeave(
      { employeeId: "e1", startsOn: "2026-03-03", endsOn: "2026-03-07" },
      [request({ employeeId: "e2", status: "REQUESTED" })],
      team, "kitchen");
    expect(out).toEqual([]);
  });
});

describe("eligibility to work a station", () => {
  const cert = (over: Partial<Certification> = {}): Certification => ({
    id: "c1", employeeId: "e1", kind: "FOOD_SAFETY_L2", expiresOn: "2027-01-01", ...over,
  });

  it("allows somebody holding a current certificate", () => {
    const v = checkEligibility(employee(), ["FOOD_SAFETY_L2"], [cert()], TODAY);
    expect(v.eligible).toBe(true);
    expect(v.requirements[0].state).toBe("valid");
  });

  it("refuses an expired certificate", () => {
    // 852/2004 Annex II Chapter XII: training is a legal requirement, so this
    // is a reason not to roster somebody, not a note for later.
    const v = checkEligibility(employee(), ["FOOD_SAFETY_L2"],
      [cert({ expiresOn: "2026-06-01" })], TODAY);
    expect(v.eligible).toBe(false);
    expect(v.reason).toMatch(/not current/);
  });

  it("refuses a missing certificate and says which", () => {
    const v = checkEligibility(employee(), ["FOOD_SAFETY_L2", "ALLERGEN"], [cert()], TODAY);
    expect(v.eligible).toBe(false);
    expect(v.reason).toMatch(/ALLERGEN is missing/);
  });

  it("warns before expiry without blocking", () => {
    const v = checkEligibility(employee(), ["FOOD_SAFETY_L2"],
      [cert({ expiresOn: "2026-08-20" })], TODAY);
    expect(v.eligible).toBe(true);
    expect(v.requirements[0].state).toBe("expiring");
  });

  it("treats a certificate with no expiry as valid", () => {
    // Many do not expire; inventing one would ground half a kitchen.
    const v = checkEligibility(employee(), ["FOOD_SAFETY_L2"],
      [cert({ expiresOn: null })], TODAY);
    expect(v.eligible).toBe(true);
  });

  it("takes the most generous of two held certificates", () => {
    const v = checkEligibility(employee(), ["FOOD_SAFETY_L2"],
      [cert({ id: "old", expiresOn: "2025-01-01" }), cert({ id: "new", expiresOn: "2027-01-01" })],
      TODAY);
    expect(v.eligible).toBe(true);
  });

  it("refuses somebody who is not working, whatever they hold", () => {
    const v = checkEligibility(employee({ employmentStatus: "SUSPENDED" }),
      ["FOOD_SAFETY_L2"], [cert()], TODAY);
    expect(v.eligible).toBe(false);
    expect(v.reason).toMatch(/suspended/);
  });
});

describe("lapsing certificates", () => {
  it("lists the most urgent first and leaves out the current ones", () => {
    const out = lapsingCertifications(
      [
        { id: "a", employeeId: "e1", kind: "HACCP", expiresOn: "2026-08-10" },
        { id: "b", employeeId: "e1", kind: "ALLERGEN", expiresOn: "2026-07-01" },
        { id: "c", employeeId: "e1", kind: "FIRST_AID", expiresOn: "2028-01-01" },
      ],
      [employee()], TODAY);
    expect(out.map((r) => r.certification.kind)).toEqual(["ALLERGEN", "HACCP"]);
    expect(out[0].daysLeft).toBeLessThan(0);
  });
});

describe("headcount", () => {
  it("separates who is on the books from who is working", () => {
    const out = headcount([
      employee(),
      employee({ id: "e2", employmentStatus: "PROBATION" }),
      employee({ id: "e3", employmentStatus: "TERMINATED" }),
    ]);
    expect(out.total).toBe(3);
    expect(out.working).toBe(2);
    expect(out.byStatus.TERMINATED).toBe(1);
  });

  it("computes full-time equivalent from contracted hours", () => {
    const out = headcount([
      employee(),
      employee({ id: "e2", contractedHoursPerWeek: 20 }),
      employee({ id: "e3", contractedHoursPerWeek: null }),
    ]);
    expect(out.fte).toBe("2.50");
  });
});

describe("small helpers", () => {
  it("names people", () => {
    expect(fullName(employee())).toBe("Ayu Pratama");
  });
  it("counts probation and notice as working", () => {
    expect(isWorking(employee({ employmentStatus: "PROBATION" }))).toBe(true);
    expect(isWorking(employee({ employmentStatus: "NOTICE" }))).toBe(true);
    expect(isWorking(employee({ employmentStatus: "RESIGNED" }))).toBe(false);
  });
});
