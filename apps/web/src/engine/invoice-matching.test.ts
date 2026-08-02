import { describe, it, expect } from "vitest";
import {
  matchInvoice,
  exceptionValue,
  checkBudget,
  DEFAULT_TOLERANCES,
  type OrderLine,
  type InvoiceLine,
  type BudgetPosition,
} from "./invoice-matching";

/**
 * Three-way matching and budget control.
 *
 * The tests are mostly about what must NOT be flagged. An invoice held for a
 * five-rupiah rounding difference teaches people to click past warnings, and
 * once they do that the expensive exceptions go through with the rest.
 */

const order = (over: Partial<OrderLine> = {}): OrderLine => ({
  id: "pol-1",
  description: "Guanciale",
  quantity: 10,
  unitPrice: "590000",
  quantityReceived: 10,
  ...over,
});

const line = (over: Partial<InvoiceLine> = {}): InvoiceLine => ({
  lineNumber: 1,
  purchaseOrderLineId: "pol-1",
  description: "Guanciale",
  quantity: 10,
  unitPrice: "590000",
  lineTotal: "5900000",
  ...over,
});

const base = {
  invoiceNumber: "INV-100",
  supplierId: "s1",
  existingInvoiceNumbers: [] as string[],
  tolerances: DEFAULT_TOLERANCES,
};

describe("an invoice that agrees", () => {
  it("raises nothing", () => {
    expect(
      matchInvoice({
        ...base,
        orderLines: [order()],
        invoiceLines: [line()],
        invoiceTotal: "5900000",
      }),
    ).toEqual([]);
  });

  it("accepts a price difference inside the absolute allowance", () => {
    // 4.000 on a 590.000 line is rounding, not a dispute.
    const out = matchInvoice({
      ...base,
      orderLines: [order()],
      invoiceLines: [line({ unitPrice: "594000", lineTotal: "5940000" })],
      invoiceTotal: "5940000",
    });
    expect(out).toEqual([]);
  });

  it("accepts a small percentage difference on a large line", () => {
    const out = matchInvoice({
      ...base,
      orderLines: [order({ unitPrice: "10000000" })],
      invoiceLines: [
        line({ unitPrice: "10100000", lineTotal: "101000000" }),
      ],
      invoiceTotal: "101000000",
    });
    expect(out).toEqual([]);
  });

  it("does not flag an invoice for less than was ordered", () => {
    // A short delivery is normal; warning about it trains people to ignore
    // the warnings that matter.
    const out = matchInvoice({
      ...base,
      orderLines: [order({ quantity: 10, quantityReceived: 6 })],
      invoiceLines: [line({ quantity: 6, lineTotal: "3540000" })],
      invoiceTotal: "3540000",
    });
    expect(out).toEqual([]);
  });
});

describe("overcharges", () => {
  it("flags a price above the order beyond tolerance", () => {
    const out = matchInvoice({
      ...base,
      orderLines: [order()],
      invoiceLines: [line({ unitPrice: "700000", lineTotal: "7000000" })],
      invoiceTotal: "7000000",
    });
    const e = out.find((x) => x.kind === "PRICE_ABOVE_ORDER")!;
    expect(e).toBeDefined();
    expect(e.variance).toBe("1100000.00");
  });

  it("flags more invoiced than ordered", () => {
    const out = matchInvoice({
      ...base,
      orderLines: [order()],
      invoiceLines: [line({ quantity: 15, lineTotal: "8850000" })],
      invoiceTotal: "8850000",
    });
    expect(out.some((x) => x.kind === "QUANTITY_ABOVE_ORDER")).toBe(true);
  });

  it("flags more invoiced than was received", () => {
    // The third leg: an invoice for goods nobody confirmed arrived.
    const out = matchInvoice({
      ...base,
      orderLines: [order({ quantity: 20, quantityReceived: 8 })],
      invoiceLines: [line({ quantity: 20, lineTotal: "11800000" })],
      invoiceTotal: "11800000",
    });
    const e = out.find((x) => x.kind === "QUANTITY_ABOVE_RECEIVED")!;
    expect(e.variance).toBe("7080000.00");
  });

  it("flags an invoice where nothing has been received at all", () => {
    const out = matchInvoice({
      ...base,
      orderLines: [order({ quantityReceived: 0 })],
      invoiceLines: [line()],
      invoiceTotal: "5900000",
    });
    expect(out.some((x) => x.kind === "NOT_RECEIVED")).toBe(true);
  });

  it("flags a line that is not on the order", () => {
    const out = matchInvoice({
      ...base,
      orderLines: [order()],
      invoiceLines: [
        line({ lineNumber: 2, purchaseOrderLineId: "other", description: "Delivery fee" }),
      ],
      invoiceTotal: "5900000",
    });
    expect(out.some((x) => x.kind === "LINE_NOT_ON_ORDER")).toBe(true);
  });
});

describe("the expensive mistakes", () => {
  it("catches a duplicate invoice number for the same supplier", () => {
    const out = matchInvoice({
      ...base,
      invoiceNumber: "inv-100",
      existingInvoiceNumbers: ["INV-100"],
      orderLines: [order()],
      invoiceLines: [line()],
      invoiceTotal: "5900000",
    });
    expect(out[0].kind).toBe("DUPLICATE_INVOICE");
  });

  it("refuses to match an invoice with no order", () => {
    const out = matchInvoice({
      ...base,
      orderLines: null,
      invoiceLines: [line()],
      invoiceTotal: "5900000",
    });
    expect(out.some((x) => x.kind === "NO_ORDER")).toBe(true);
  });

  it("catches a header that disagrees with its own lines", () => {
    // Somebody edited one and not the other.
    const out = matchInvoice({
      ...base,
      orderLines: [order()],
      invoiceLines: [line()],
      invoiceTotal: "9900000",
    });
    expect(out.some((x) => x.kind === "TOTAL_MISMATCH")).toBe(true);
  });

  it("totals the money at risk", () => {
    const out = matchInvoice({
      ...base,
      orderLines: [order()],
      invoiceLines: [line({ unitPrice: "700000", lineTotal: "7000000" })],
      invoiceTotal: "7000000",
    });
    expect(Number(exceptionValue(out))).toBeGreaterThan(0);
  });
});

describe("budget control", () => {
  const budget = (over: Partial<BudgetPosition> = {}): BudgetPosition => ({
    budgetId: "b1",
    costCentreId: "cc1",
    name: "FY2026 Kitchen",
    amount: "1000000",
    committed: "200000",
    actual: "300000",
    hardStop: false,
    ...over,
  });

  it("subtracts both committed and invoiced spend", () => {
    // Money promised on an approved order is gone even though no invoice has
    // arrived; counting only invoices overstates what is left.
    const v = checkBudget(budget(), "100000");
    expect(v.remaining).toBe("500000.00");
    expect(v.remainingAfter).toBe("400000.00");
  });

  it("stays quiet well inside the budget", () => {
    expect(checkBudget(budget(), "100000").state).toBe("ok");
    expect(checkBudget(budget(), "100000").message).toBeNull();
  });

  it("warns as the budget runs down", () => {
    const v = checkBudget(budget(), "400000");
    expect(v.state).toBe("warning");
    expect(v.message).toMatch(/90% of FY2026 Kitchen/);
  });

  it("reports an overspend but allows it on a soft budget", () => {
    const v = checkBudget(budget(), "600000");
    expect(v.state).toBe("over");
    expect(v.blocked).toBe(false);
    expect(v.message).toMatch(/can be approved/);
  });

  it("blocks an overspend on a hard budget", () => {
    const v = checkBudget(budget({ hardStop: true }), "600000");
    expect(v.blocked).toBe(true);
    expect(v.message).toMatch(/cannot be approved/);
  });

  it("says so when no budget exists rather than pretending it passed", () => {
    const v = checkBudget(null, "100000");
    expect(v.blocked).toBe(false);
    expect(v.message).toMatch(/No budget is set/);
  });
});
