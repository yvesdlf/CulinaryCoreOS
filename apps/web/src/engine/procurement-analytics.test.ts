import { describe, it, expect } from "vitest";
import {
  spendBySupplier, invoiceAgeing, matchRate, approvalCycleTime, deliveryPerformance,
  type OrderSummary, type InvoiceSummary,
} from "./procurement-analytics";

const order = (over: Partial<OrderSummary> = {}): OrderSummary => ({
  id: "o1", reference: "PO-1", supplierId: "s1", supplierName: "Acme",
  costCentreId: "cc1", status: "ORDERED", orderedOn: "2026-01-05",
  expectedOn: "2026-01-10", totalAmount: "1000000", ...over,
});

const invoice = (over: Partial<InvoiceSummary> = {}): InvoiceSummary => ({
  id: "i1", supplierId: "s1", supplierName: "Acme", invoiceDate: "2026-01-05",
  dueDate: "2026-02-04", totalAmount: "1000000", status: "MATCHING",
  exceptionCount: 0, ...over,
});

describe("spend by supplier", () => {
  it("groups and shares out the total", () => {
    const out = spendBySupplier([
      order({ supplierId: "a", supplierName: "A", totalAmount: "750000" }),
      order({ supplierId: "b", supplierName: "B", totalAmount: "250000" }),
    ]);
    expect(out[0].supplierName).toBe("A");
    expect(out[0].sharePercent).toBeCloseTo(75, 5);
  });

  it("ignores drafts and cancellations", () => {
    // Money that was never committed is not spend.
    const out = spendBySupplier([
      order({ totalAmount: "100" }),
      order({ status: "DRAFT", totalAmount: "999999" }),
      order({ status: "CANCELLED", totalAmount: "999999" }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].committed).toBe("100.00");
  });

  it("returns nothing rather than dividing by zero", () => {
    expect(spendBySupplier([])).toEqual([]);
  });
});

describe("invoice ageing", () => {
  const today = new Date("2026-03-01T00:00:00Z");

  it("buckets by how late, not by an average", () => {
    const out = invoiceAgeing([
      invoice({ dueDate: "2026-04-01" }),
      invoice({ dueDate: "2026-02-20" }),
      invoice({ dueDate: "2026-01-10" }),
      invoice({ dueDate: "2025-11-01" }),
    ], today);
    expect(out.map((b) => b.count)).toEqual([1, 1, 1, 1]);
  });

  it("leaves out what is already paid", () => {
    const out = invoiceAgeing([invoice({ status: "PAID", dueDate: "2025-01-01" })], today);
    expect(out.every((b) => b.count === 0)).toBe(true);
  });

  it("treats an invoice with no due date as not yet due", () => {
    const out = invoiceAgeing([invoice({ dueDate: null })], today);
    expect(out[0].count).toBe(1);
  });
});

describe("match rate", () => {
  it("reports what went through untouched and what is held", () => {
    const r = matchRate([invoice(), invoice({ exceptionCount: 2 }), invoice()]);
    expect(r.clean).toBe(2);
    expect(r.held).toBe(1);
    expect(r.straightThroughPercent).toBeCloseTo(66.67, 1);
    expect(r.valueHeld).toBe("1000000.00");
  });

  it("is zero rather than NaN with no invoices", () => {
    expect(matchRate([]).straightThroughPercent).toBe(0);
  });
});

describe("approval cycle time", () => {
  it("uses the median so one holiday does not distort it", () => {
    const out = approvalCycleTime([
      { submittedAt: "2026-01-01T00:00:00Z", approvedAt: "2026-01-02T00:00:00Z" },
      { submittedAt: "2026-01-01T00:00:00Z", approvedAt: "2026-01-02T00:00:00Z" },
      { submittedAt: "2026-01-01T00:00:00Z", approvedAt: "2026-01-15T00:00:00Z" },
    ]);
    expect(out.medianDays).toBe(1);
    expect(out.count).toBe(3);
  });

  it("ignores anything not yet approved", () => {
    expect(approvalCycleTime([{ submittedAt: "2026-01-01T00:00:00Z", approvedAt: null }]).medianDays)
      .toBeNull();
  });
});

describe("delivery performance", () => {
  it("scores only orders that had an expected date", () => {
    // Scoring undated orders would flatter the number.
    const out = deliveryPerformance([
      { ...order({ supplierName: "A" }), receivedOn: "2026-01-09" },
      { ...order({ supplierName: "A", expectedOn: null }), receivedOn: "2026-01-30" },
    ]);
    expect(out[0].ordersScored).toBe(1);
    expect(out[0].onTimePercent).toBe(100);
  });

  it("counts a delivery on the expected day as on time", () => {
    const out = deliveryPerformance([
      { ...order(), receivedOn: "2026-01-10" },
    ]);
    expect(out[0].onTime).toBe(1);
  });

  it("puts the worst performer first", () => {
    const out = deliveryPerformance([
      { ...order({ supplierName: "Good" }), receivedOn: "2026-01-09" },
      { ...order({ supplierName: "Late" }), receivedOn: "2026-01-20" },
    ]);
    expect(out[0].supplierName).toBe("Late");
  });
});
