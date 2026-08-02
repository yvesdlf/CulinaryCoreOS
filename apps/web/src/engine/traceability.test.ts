import { describe, it, expect } from "vitest";
import {
  assessLot,
  lotsNeedingAttention,
  assessCertificate,
  traceBack,
  type StockLot,
} from "./traceability";

/**
 * Date marking and lot status.
 *
 * Nearly every test here is about one distinction: use-by is a safety limit
 * and best-before is a quality one. Treating them alike is wrong in both
 * directions — it either serves food that is legally unsafe, or throws away
 * food that is legally fine.
 */

const TODAY = new Date("2026-08-02T09:00:00Z");

const lot = (over: Partial<StockLot> = {}): StockLot => ({
  id: "lot-1",
  productId: "p1",
  lotCode: "L2026-0412",
  supplierId: "s1",
  supplierName: "Fisheries Seafood",
  deliveryReference: "DN-8891",
  receivedOn: "2026-07-28",
  expiresOn: null,
  expiryKind: null,
  receiptTemperatureC: 3.5,
  status: "OK",
  statusReason: null,
  ...over,
});

describe("use-by is a safety limit", () => {
  it("refuses a lot past its use-by date", () => {
    // 1169/2011 Annex X with 178/2002 Article 14: past use-by is deemed
    // unsafe. There is no judgement call here.
    const a = assessLot(lot({ expiresOn: "2026-08-01", expiryKind: "USE_BY" }), TODAY);
    expect(a.dateMark).toBe("unsafe");
    expect(a.usable).toBe(false);
    expect(a.reason).toMatch(/must not be used/);
  });

  it("allows a lot on its use-by date, which is the last day of use", () => {
    const a = assessLot(lot({ expiresOn: "2026-08-02", expiryKind: "USE_BY" }), TODAY);
    expect(a.daysLeft).toBe(0);
    expect(a.usable).toBe(true);
    expect(a.dateMark).toBe("expiring");
  });

  it("warns before it is reached", () => {
    const a = assessLot(lot({ expiresOn: "2026-08-06", expiryKind: "USE_BY" }), TODAY);
    expect(a.dateMark).toBe("expiring");
    expect(a.daysLeft).toBe(4);
    expect(a.usable).toBe(true);
  });
});

describe("best-before is a quality limit", () => {
  it("allows a lot past its best-before date and says so", () => {
    // Binning this is waste, not caution.
    const a = assessLot(
      lot({ expiresOn: "2026-07-01", expiryKind: "BEST_BEFORE" }),
      TODAY,
    );
    expect(a.dateMark).toBe("past-best");
    expect(a.usable).toBe(true);
    expect(a.reason).toMatch(/[Ss]till legal to use/);
  });

  it("does not call it unsafe, whatever the date", () => {
    const a = assessLot(
      lot({ expiresOn: "2020-01-01", expiryKind: "BEST_BEFORE" }),
      TODAY,
    );
    expect(a.dateMark).not.toBe("unsafe");
    expect(a.usable).toBe(true);
  });
});

describe("a date with no kind", () => {
  it("is not assumed to be either one", () => {
    // Guessing use-by throws away good food; guessing best-before serves
    // unsafe food. Neither is acceptable, so it asks.
    const a = assessLot(lot({ expiresOn: "2026-07-01", expiryKind: null }), TODAY);
    expect(a.dateMark).toBe("unknown-kind");
    expect(a.reason).toMatch(/Check the packaging/);
  });
});

describe("blocked and recalled lots", () => {
  it("refuses a recalled lot", () => {
    const a = assessLot(
      lot({ status: "RECALLED", statusReason: "Supplier notice 2026/14" }),
      TODAY,
    );
    expect(a.usable).toBe(false);
    expect(a.reason).toMatch(/Recalled: Supplier notice 2026\/14/);
    expect(a.reason).toMatch(/quarantine and return/);
  });

  it("refuses a recalled lot that is still well within date", () => {
    // A recall outranks a date, and the date must not soften the message.
    const a = assessLot(
      lot({ status: "RECALLED", expiresOn: "2027-01-01", expiryKind: "USE_BY" }),
      TODAY,
    );
    expect(a.usable).toBe(false);
    expect(a.reason).toMatch(/Recalled/);
  });

  it("refuses a lot on hold and says it can be released", () => {
    const a = assessLot(lot({ status: "BLOCKED", statusReason: "Temperature on arrival" }), TODAY);
    expect(a.usable).toBe(false);
    expect(a.reason).toMatch(/until released/);
  });
});

describe("what needs attention", () => {
  const today = TODAY;

  it("puts unusable lots above everything, then the most urgent date", () => {
    const list = lotsNeedingAttention(
      [
        lot({ id: "fine", expiresOn: "2027-01-01", expiryKind: "USE_BY" }),
        lot({ id: "soon", expiresOn: "2026-08-05", expiryKind: "USE_BY" }),
        lot({ id: "stale", expiresOn: "2026-07-01", expiryKind: "BEST_BEFORE" }),
        lot({ id: "recalled", status: "RECALLED" }),
        lot({ id: "unsafe", expiresOn: "2026-07-31", expiryKind: "USE_BY" }),
      ],
      today,
    );
    expect(list.map((a) => a.lot.id)).toEqual([
      "recalled",
      "unsafe",
      "soon",
      "stale",
    ]);
  });

  it("leaves out lots that are fine", () => {
    const list = lotsNeedingAttention(
      [lot({ expiresOn: "2027-01-01", expiryKind: "USE_BY" }), lot({ id: "d" })],
      today,
    );
    expect(list).toEqual([]);
  });

  it("keeps an undated lot out of the list unless it is blocked", () => {
    // Dry goods have no date. Listing them all would bury the real ones.
    expect(lotsNeedingAttention([lot()], today)).toEqual([]);
    expect(
      lotsNeedingAttention([lot({ status: "BLOCKED" })], today),
    ).toHaveLength(1);
  });

  it("honours a longer warning window", () => {
    const soon = lot({ expiresOn: "2026-08-20", expiryKind: "USE_BY" });
    expect(lotsNeedingAttention([soon], today)).toEqual([]);
    expect(lotsNeedingAttention([soon], today, 30)).toHaveLength(1);
  });
});

describe("supplier certificates", () => {
  it("reports an expired certificate", () => {
    const c = assessCertificate(
      { kind: "HACCP", reference: "H-1", expiresOn: "2026-06-01" },
      TODAY,
    );
    expect(c.state).toBe("expired");
    expect(c.daysLeft).toBeLessThan(0);
  });

  it("warns a month ahead", () => {
    expect(
      assessCertificate({ kind: "BRC", reference: null, expiresOn: "2026-08-20" }, TODAY)
        .state,
    ).toBe("expiring");
  });

  it("says nothing about a certificate with no expiry", () => {
    expect(
      assessCertificate({ kind: "ORGANIC", reference: null, expiresOn: null }, TODAY)
        .state,
    ).toBe("none");
  });
});

describe("one step back", () => {
  it("answers what an inspector asks", () => {
    const steps = traceBack(lot({ expiresOn: "2026-08-10", expiryKind: "USE_BY" }));
    const byLabel = Object.fromEntries(steps.map((s) => [s.label, s.detail]));
    expect(byLabel.Supplier).toBe("Fisheries Seafood");
    expect(byLabel["Lot code"]).toBe("L2026-0412");
    expect(byLabel["Delivery reference"]).toBe("DN-8891");
    expect(byLabel["Date mark"]).toBe("Use by 2026-08-10");
    expect(byLabel["Temperature on receipt"]).toBe("3.5 °C");
  });

  it("names a missing supplier as missing, not as blank", () => {
    // A gap in a traceability record is the finding, so it has to read as one.
    const steps = traceBack(lot({ supplierName: null, deliveryReference: null }));
    const byLabel = Object.fromEntries(steps.map((s) => [s.label, s.detail]));
    expect(byLabel.Supplier).toMatch(/required for traceability/);
    expect(byLabel["Delivery reference"]).toBe("Not recorded");
  });

  it("records a temperature of zero rather than calling it missing", () => {
    // 0 °C is a reading. Treating it as absent loses cold-chain evidence.
    const steps = traceBack(lot({ receiptTemperatureC: 0 }));
    expect(steps.find((s) => s.label === "Temperature on receipt")!.detail).toBe("0 °C");
  });
});
