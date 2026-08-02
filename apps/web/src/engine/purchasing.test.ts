import { describe, it, expect } from "vitest";
import {
  requiredRoleFor,
  canApprove,
  canTransition,
  draftOrdersFrom,
  nextReference,
  lineProgress,
  statusFromReceipts,
  type ApprovalPolicy,
  type ApprovableDocument,
  type RequisitionLine,
} from "./purchasing";

/**
 * Purchasing rules.
 *
 * The database enforces segregation of duties and approval authority; these
 * tests cover the copy of those rules the screen uses to explain itself
 * *before* the database refuses. Where the two could drift, the tests are
 * written against the same thresholds the migration seeds.
 */

const POLICIES: ApprovalPolicy[] = [
  { documentType: "REQUISITION", minAmount: "0", requiredRole: "CHEF" },
  { documentType: "REQUISITION", minAmount: "5000000", requiredRole: "ADMIN" },
  { documentType: "REQUISITION", minAmount: "25000000", requiredRole: "OWNER" },
  { documentType: "PURCHASE_ORDER", minAmount: "0", requiredRole: "CHEF" },
];

const doc = (over: Partial<ApprovableDocument> = {}): ApprovableDocument => ({
  status: "SUBMITTED",
  totalAmount: "1000000",
  requestedById: "user-a",
  requestedByEmail: "chef@manuza.test",
  ...over,
});

describe("approval authority", () => {
  it("picks the strictest tier the amount reaches", () => {
    expect(requiredRoleFor("1000000", "REQUISITION", POLICIES)).toBe("CHEF");
    expect(requiredRoleFor("5000000", "REQUISITION", POLICIES)).toBe("ADMIN");
    expect(requiredRoleFor("30000000", "REQUISITION", POLICIES)).toBe("OWNER");
  });

  it("treats a threshold as inclusive", () => {
    // "At or above 5 million needs an admin" must include 5 million exactly.
    expect(requiredRoleFor("4999999", "REQUISITION", POLICIES)).toBe("CHEF");
    expect(requiredRoleFor("5000000", "REQUISITION", POLICIES)).toBe("ADMIN");
  });

  it("keeps document types apart", () => {
    expect(requiredRoleFor("30000000", "PURCHASE_ORDER", POLICIES)).toBe("CHEF");
  });

  it("returns nothing when no policy covers the type", () => {
    expect(requiredRoleFor("100", "REQUISITION", [])).toBeNull();
  });
});

describe("who may approve", () => {
  it("lets a senior enough colleague approve", () => {
    const v = canApprove(
      doc({ totalAmount: "6000000" }),
      { id: "user-b", email: "gm@manuza.test", role: "ADMIN" },
      "REQUISITION",
      POLICIES,
    );
    expect(v.allowed).toBe(true);
    expect(v.requiredRole).toBe("ADMIN");
  });

  it("refuses the person who raised it", () => {
    const v = canApprove(
      doc(),
      { id: "user-a", email: "chef@manuza.test", role: "OWNER" },
      "REQUISITION",
      POLICIES,
    );
    expect(v.allowed).toBe(false);
    expect(v.reason).toMatch(/cannot approve it/);
  });

  it("catches the requester by email when the id is missing", () => {
    // A document raised before the person had an account still counts.
    const v = canApprove(
      doc({ requestedById: null }),
      { id: "user-z", email: "CHEF@manuza.test", role: "OWNER" },
      "REQUISITION",
      POLICIES,
    );
    expect(v.allowed).toBe(false);
    expect(v.reason).toMatch(/cannot approve it/);
  });

  it("says 'you raised this' before 'you lack the role'", () => {
    /*
     * A chef who raised a large request holds neither permission. Telling them
     * about the role sends them to change permissions; telling them they
     * raised it sends them to a colleague, which is the actual fix.
     */
    const v = canApprove(
      doc({ totalAmount: "30000000" }),
      { id: "user-a", email: "chef@manuza.test", role: "CHEF" },
      "REQUISITION",
      POLICIES,
    );
    expect(v.reason).toMatch(/cannot approve it/);
    expect(v.reason).not.toMatch(/role/);
  });

  it("refuses a role below the threshold and names the one needed", () => {
    const v = canApprove(
      doc({ totalAmount: "6000000" }),
      { id: "user-b", email: "sous@manuza.test", role: "CHEF" },
      "REQUISITION",
      POLICIES,
    );
    expect(v.allowed).toBe(false);
    expect(v.reason).toMatch(/needs the ADMIN role/);
  });

  it("refuses anything not awaiting approval", () => {
    const approver = { id: "user-b", email: "gm@manuza.test", role: "OWNER" as const };
    expect(canApprove(doc({ status: "DRAFT" }), approver, "REQUISITION", POLICIES).reason)
      .toMatch(/not been submitted/);
    expect(canApprove(doc({ status: "APPROVED" }), approver, "REQUISITION", POLICIES).reason)
      .toMatch(/already approved/);
  });
});

describe("status transitions", () => {
  it("allows the ordinary path", () => {
    expect(canTransition("DRAFT", "SUBMITTED", "REQUISITION")).toBe(true);
    expect(canTransition("SUBMITTED", "APPROVED", "REQUISITION")).toBe(true);
    expect(canTransition("APPROVED", "ORDERED", "REQUISITION")).toBe(true);
  });

  it("refuses a shortcut past approval", () => {
    expect(canTransition("DRAFT", "APPROVED", "REQUISITION")).toBe(false);
    expect(canTransition("SUBMITTED", "ORDERED", "PURCHASE_ORDER")).toBe(false);
  });

  it("does not reopen a requisition that has been ordered against", () => {
    // The order downstream was raised on the strength of the approval.
    expect(canTransition("ORDERED", "DRAFT", "REQUISITION")).toBe(false);
  });

  it("lets a rejected document be reworked", () => {
    expect(canTransition("REJECTED", "DRAFT", "REQUISITION")).toBe(true);
  });

  it("treats cancelled and closed as final", () => {
    expect(canTransition("CANCELLED", "DRAFT", "REQUISITION")).toBe(false);
    expect(canTransition("CLOSED", "ORDERED", "PURCHASE_ORDER")).toBe(false);
  });
});

describe("splitting a requisition into orders", () => {
  const line = (over: Partial<RequisitionLine>): RequisitionLine => ({
    id: "l1", productId: "p1", description: null, quantity: 2, unit: "KG",
    estimatedUnitPrice: "100000", suggestedSupplierId: null, ...over,
  });

  it("makes one order per supplier", () => {
    const orders = draftOrdersFrom([
      line({ id: "a", suggestedSupplierId: "s1" }),
      line({ id: "b", suggestedSupplierId: "s2" }),
      line({ id: "c", suggestedSupplierId: "s1" }),
    ]);
    expect(orders).toHaveLength(2);
    expect(orders.find((o) => o.supplierId === "s1")!.lines).toHaveLength(2);
  });

  it("totals each order", () => {
    const orders = draftOrdersFrom([
      line({ suggestedSupplierId: "s1", quantity: 3, estimatedUnitPrice: "250000" }),
    ]);
    expect(orders[0].subtotal).toBe("750000.00");
  });

  it("keeps lines with no supplier together, and last", () => {
    // This is the pile someone has to make a decision about, not an order.
    const orders = draftOrdersFrom([
      line({ id: "a", suggestedSupplierId: null }),
      line({ id: "b", suggestedSupplierId: "s1" }),
    ]);
    expect(orders[orders.length - 1].supplierId).toBeNull();
  });

  it("puts the biggest order first", () => {
    const orders = draftOrdersFrom([
      line({ id: "a", suggestedSupplierId: "small", estimatedUnitPrice: "1000" }),
      line({ id: "b", suggestedSupplierId: "big", estimatedUnitPrice: "900000" }),
    ]);
    expect(orders[0].supplierId).toBe("big");
  });
});

describe("references", () => {
  it("starts a year at one", () => {
    expect(nextReference("REQ", [], 2026)).toBe("REQ-2026-0001");
  });

  it("continues from the highest, not the count", () => {
    // Deleting a document must not cause the next one to reuse its number.
    expect(nextReference("REQ", ["REQ-2026-0001", "REQ-2026-0009"], 2026)).toBe(
      "REQ-2026-0010",
    );
  });

  it("ignores other years and other prefixes", () => {
    expect(
      nextReference("PO", ["REQ-2026-0099", "PO-2025-0044"], 2026),
    ).toBe("PO-2026-0001");
  });
});

describe("receiving progress", () => {
  it("reports what is still outstanding", () => {
    expect(lineProgress(10, 4)).toEqual({
      ordered: 10, received: 4, outstanding: 6, over: false,
    });
  });

  it("flags an over-delivery rather than hiding it", () => {
    const p = lineProgress(10, 12);
    expect(p.over).toBe(true);
    expect(p.outstanding).toBe(0);
  });

  it("marks an order received only when every line is complete", () => {
    // "Received" on an order still missing a case of wine is worse than none.
    expect(
      statusFromReceipts(
        [{ quantity: 10, quantityReceived: 10 }, { quantity: 5, quantityReceived: 3 }],
        "ORDERED",
      ),
    ).toBe("PARTIALLY_RECEIVED");
    expect(
      statusFromReceipts(
        [{ quantity: 10, quantityReceived: 10 }, { quantity: 5, quantityReceived: 5 }],
        "ORDERED",
      ),
    ).toBe("RECEIVED");
  });

  it("counts an over-delivery as complete for that line", () => {
    expect(
      statusFromReceipts([{ quantity: 10, quantityReceived: 11 }], "ORDERED"),
    ).toBe("RECEIVED");
  });

  it("leaves a cancelled order alone", () => {
    expect(
      statusFromReceipts([{ quantity: 10, quantityReceived: 10 }], "CANCELLED"),
    ).toBe("CANCELLED");
  });
});
