import { describe, it, expect } from "vitest";
import {
  planDue, comparePlanUrgency, assetVerdict, manningVerdict,
  compareWorkOrders, isOpen,
  type PlanLike, type AssetHealthLike, type ManningLike, type WorkOrderLike,
} from "./maintenance";

/**
 * Maintenance judgements.
 *
 * Each case here is a position somebody could take differently, and the ones
 * that matter are where the comfortable answer is wrong: a brand-new venue
 * that has done nothing yet, an asset nobody costed, and a technician who is
 * not in today.
 */

const TODAY = new Date(2026, 8, 19); // 19 September 2026

const plan = (over: Partial<PlanLike> = {}): PlanLike => ({
  code: "PM-1", title: "Quarterly service", intervalDays: 90,
  estimatedMinutes: 240, statutory: false, lastCompletedOn: "2026-06-01",
  ...over,
});

describe("when a plan is due", () => {
  it("counts from the last completion", () => {
    const d = planDue(plan({ lastCompletedOn: "2026-06-01" }), TODAY);
    expect(d.dueOn).toBe("2026-08-30");
    expect(d.daysOverdue).toBe(20);
    expect(d.state).toBe("overdue");
  });

  it("makes a plan that has never been done due today, not overdue", () => {
    // A new venue that has just entered its assets is not months behind on
    // equipment it bought last week. A screen that opens red on day one is a
    // screen nobody reads on day two.
    const d = planDue(plan({ lastCompletedOn: null }), TODAY);
    expect(d.dueOn).toBe("2026-09-19");
    expect(d.daysOverdue).toBe(0);
    expect(d.state).toBe("due");
  });

  it("warns proportionally to the interval, not a fixed week", () => {
    // A weekly check warns a day ahead. An annual inspection warns five weeks
    // ahead, which is the notice needed to book a contractor.
    const weekly = planDue(
      plan({ intervalDays: 7, lastCompletedOn: "2026-09-13" }), TODAY);
    expect(weekly.state).toBe("soon");

    const annual = planDue(
      plan({ intervalDays: 365, lastCompletedOn: "2025-10-15" }), TODAY);
    expect(annual.state).toBe("soon");

    const annualFar = planDue(
      plan({ intervalDays: 365, lastCompletedOn: "2026-01-15" }), TODAY);
    expect(annualFar.state).toBe("ok");
  });

  it("calls a late statutory inspection a breach", () => {
    const d = planDue(plan({ statutory: true, lastCompletedOn: "2026-01-01" }), TODAY);
    expect(d.statutoryBreach).toBe(true);
  });

  it("does not call an on-time statutory inspection a breach", () => {
    const d = planDue(plan({ statutory: true, lastCompletedOn: "2026-09-01" }), TODAY);
    expect(d.statutoryBreach).toBe(false);
  });
});

describe("what to show first", () => {
  it("puts a statutory breach above a job that is later", () => {
    // GAS is six days late; OIL is a year and a half late. The legal finding
    // still outranks the bigger number.
    const statutory = plan({ code: "GAS", statutory: true, lastCompletedOn: "2026-06-15" });
    const veryLate = plan({ code: "OIL", statutory: false, lastCompletedOn: "2025-01-01" });
    expect(planDue(statutory, TODAY).daysOverdue).toBe(6);
    expect(planDue(veryLate, TODAY).daysOverdue).toBeGreaterThan(500);
    expect([veryLate, statutory].sort((a, b) => comparePlanUrgency(a, b, TODAY))[0].code)
      .toBe("GAS");
  });

  it("breaks a tie on the shorter interval", () => {
    // Two days late on a daily check has been missed twice; on an annual, once.
    const daily = plan({ code: "DAY", intervalDays: 1, lastCompletedOn: "2026-09-16" });
    const annual = plan({ code: "YEAR", intervalDays: 365, lastCompletedOn: "2025-09-17" });
    // Both two days overdue.
    expect(planDue(daily, TODAY).daysOverdue).toBe(2);
    expect(planDue(annual, TODAY).daysOverdue).toBe(2);
    expect([annual, daily].sort((a, b) => comparePlanUrgency(a, b, TODAY))[0].code)
      .toBe("DAY");
  });
});

describe("repair or replace", () => {
  const asset = (over: Partial<AssetHealthLike> = {}): AssetHealthLike => ({
    code: "CH-01", jobsYear: 1, jobsOpen: 0, downtimeMinutesYear: 60,
    partsCostYear: 1_000_000, purchaseCost: 100_000_000, criticality: "ROUTINE",
    ...over,
  });

  it("says replace when a year of repairs reaches a third of the purchase price", () => {
    const v = assetVerdict(asset({ partsCostYear: 34_000_000 }));
    expect(v.grade).toBe("replace");
    expect(v.reason).toContain("34%");
  });

  it("refuses to grade an asset nobody costed as healthy", () => {
    // An asset with no purchase cost is not thereby cheap to run. Grading it
    // green hides exactly the equipment most likely to be old.
    const v = assetVerdict(asset({ purchaseCost: null }));
    expect(v.grade).toBe("unknown");
    expect(v.spendRatio).toBeNull();
  });

  it("watches a critical asset sooner than a routine one at the same spend", () => {
    const spend = { partsCostYear: 15_000_000, purchaseCost: 100_000_000 };
    expect(assetVerdict(asset({ ...spend, criticality: "CRITICAL" })).grade).toBe("watch");
    expect(assetVerdict(asset({ ...spend, criticality: "ROUTINE" })).grade).toBe("healthy");
  });

  it("watches an asset that fails often even when each fix is cheap", () => {
    // Six visits at nothing each is a different problem from one expensive
    // one, and the spend ratio alone cannot see it.
    const v = assetVerdict(asset({ jobsYear: 6, partsCostYear: 100_000 }));
    expect(v.grade).toBe("watch");
    expect(v.reason).toContain("6 faults");
  });
});

describe("manning", () => {
  const person = (over: Partial<ManningLike> = {}): ManningLike => ({
    name: "Wayan", shiftsToday: 1, jobsOpen: 2, jobsLate: 0,
    minutesAssigned: 200, ...over,
  });

  it("calls somebody who is not rostered off, not idle", () => {
    // Not in is not spare capacity. Counting it as available is how a plan
    // that looks fine collapses at seven in the morning.
    const v = manningVerdict(person({ shiftsToday: 0, minutesAssigned: 0 }));
    expect(v.state).toBe("off");
    expect(v.load).toBeNull();
  });

  it("still reports open jobs for somebody who is off", () => {
    const v = manningVerdict(person({ shiftsToday: 0, jobsOpen: 3 }));
    expect(v.note).toContain("3 open job");
  });

  it("calls a day over capacity over", () => {
    const v = manningVerdict(person({ minutesAssigned: 500 }), 420);
    expect(v.state).toBe("over");
    expect(v.note).toContain("500 minutes on a 420 minute day");
  });

  it("counts a double shift as double capacity", () => {
    const v = manningVerdict(person({ shiftsToday: 2, minutesAssigned: 500 }), 420);
    expect(v.state).toBe("ok");
  });
});

describe("the order to work in", () => {
  const wo = (over: Partial<WorkOrderLike> = {}): WorkOrderLike => ({
    reference: "WO-1", priority: "NORMAL", status: "OPEN",
    dueBy: "2026-09-25", raisedAt: "2026-09-18T08:00:00Z", ...over,
  });

  it("puts an emergency above everything", () => {
    const list = [wo({ reference: "A", priority: "LOW", dueBy: "2026-01-01" }),
                  wo({ reference: "B", priority: "EMERGENCY" })];
    expect(list.sort((a, b) => compareWorkOrders(a, b, TODAY))[0].reference).toBe("B");
  });

  it("puts the older job first at the same priority and lateness", () => {
    // Otherwise a busy week quietly buries everything raised on Monday.
    const list = [wo({ reference: "NEW", raisedAt: "2026-09-18T08:00:00Z" }),
                  wo({ reference: "OLD", raisedAt: "2026-09-01T08:00:00Z" })];
    expect(list.sort((a, b) => compareWorkOrders(a, b, TODAY))[0].reference).toBe("OLD");
  });

  it("puts a job with a due date above one with none", () => {
    const list = [wo({ reference: "NODATE", dueBy: null }),
                  wo({ reference: "DATED", dueBy: "2026-09-01" })];
    expect(list.sort((a, b) => compareWorkOrders(a, b, TODAY))[0].reference).toBe("DATED");
  });
});

describe("open", () => {
  it("counts everything nobody has finished with", () => {
    expect(isOpen("OPEN")).toBe(true);
    expect(isOpen("ON_HOLD")).toBe(true);
    // Completed is not finished. Somebody still has to sign it off.
    expect(isOpen("COMPLETED")).toBe(true);
    expect(isOpen("VERIFIED")).toBe(false);
    expect(isOpen("CANCELLED")).toBe(false);
  });
});
