import { describe, it, expect } from "vitest";
import {
  unitCode, yymmdd, formatReference, parseReference,
  isLegacyReference, referenceDate, nextReferenceLocal,
  referenceStem, withType, prefixForRequisitionStatus,
} from "./references";

/**
 * Document references.
 *
 * The failure worth guarding is a duplicate, because a unique index turns one
 * into a refused save at the moment somebody is trying to place an order. The
 * rest is legibility: a reference is read aloud down a phone and typed into a
 * supplier's system, so it has to survive both.
 */

describe("unitCode", () => {
  it("takes the first three letters, upper case", () => {
    expect(unitCode("KITCHEN")).toBe("KIT");
    expect(unitCode("Kitchen")).toBe("KIT");
    expect(unitCode("BAR")).toBe("BAR");
    expect(unitCode("FOH")).toBe("FOH");
  });

  it("leaves a short unit short rather than padding it", () => {
    // "IT" padded to three letters is "ITX" or "IT_", and nobody would
    // recognise either as the IT department.
    expect(unitCode("IT")).toBe("IT");
  });

  it("strips punctuation and spaces", () => {
    expect(unitCode("Front of House")).toBe("FRO");
    expect(unitCode("F&B")).toBe("FB");
    expect(unitCode("  hsk  ")).toBe("HSK");
  });

  it("falls back rather than producing an empty segment", () => {
    // An empty unit gives "REQ--260809-001", which parses as nothing and
    // sorts oddly. GEN is wrong but visibly wrong.
    expect(unitCode("")).toBe("GEN");
    expect(unitCode(null)).toBe("GEN");
    expect(unitCode("!!!")).toBe("GEN");
  });
});

describe("yymmdd", () => {
  it("is six digits, zero padded", () => {
    expect(yymmdd(new Date(2026, 7, 9))).toBe("260809");
    expect(yymmdd(new Date(2026, 0, 1))).toBe("260101");
    expect(yymmdd(new Date(2030, 11, 31))).toBe("301231");
  });

  it("uses local time, not UTC", () => {
    // A requisition raised at 8am in Bali belongs to that day, not to the
    // previous one because UTC had not caught up.
    const localMidnightIsh = new Date(2026, 7, 9, 1, 30);
    expect(yymmdd(localMidnightIsh)).toBe("260809");
  });
});

describe("formatReference", () => {
  it("produces the agreed shape", () => {
    expect(formatReference({ type: "REQ", unit: "KIT", yymmdd: "260809", sequence: 2 }))
      .toBe("REQ-KIT-260809-002");
  });

  it("pads the sequence to three digits", () => {
    expect(formatReference({ type: "PO", unit: "BAR", yymmdd: "260809", sequence: 1 }))
      .toBe("PO-BAR-260809-001");
  });

  it("widens past 999 rather than wrapping", () => {
    // Wrapping produces a duplicate, which the unique index refuses at the
    // worst possible moment. An ugly reference is the better failure.
    expect(formatReference({ type: "REQ", unit: "KIT", yymmdd: "260809", sequence: 1000 }))
      .toBe("REQ-KIT-260809-1000");
  });
});

describe("parseReference", () => {
  it("reads back what it wrote", () => {
    const ref = formatReference({ type: "REQ", unit: "KIT", yymmdd: "260809", sequence: 2 });
    expect(parseReference(ref)).toEqual({
      type: "REQ", unit: "KIT", yymmdd: "260809", sequence: 2, split: null,
    });
  });

  it("handles a two-letter unit", () => {
    expect(parseReference("PO-IT-260809-014")).toEqual({
      type: "PO", unit: "IT", yymmdd: "260809", sequence: 14, split: null,
    });
  });

  it("returns null for anything else", () => {
    expect(parseReference("REQ-2026-0001")).toBeNull();
    expect(parseReference("not a reference")).toBeNull();
    expect(parseReference("")).toBeNull();
  });

  it("tolerates lower case and surrounding space", () => {
    // Somebody types a reference into a search box off a printed sheet.
    expect(parseReference("  req-kit-260809-002  ")?.sequence).toBe(2);
  });
});

describe("one document, three names", () => {
  it("keeps the number the request was given, all the way to the order", () => {
    // REQ-KIT-260809-003 -> PR-KIT-260809-003 -> PO-KIT-260809-003.
    // The number is issued once, when the requisition is raised.
    const raised = "REQ-KIT-260809-003";
    expect(referenceStem(raised)).toBe("KIT-260809-003");
    expect(withType(raised, "PR")).toBe("PR-KIT-260809-003");
    expect(withType(withType(raised, "PR")!, "PO")).toBe("PO-KIT-260809-003");
  });

  it("does the same for any unit, at any number", () => {
    expect(withType("PR-BAR-260809-012", "PO")).toBe("PO-BAR-260809-012");
    expect(withType("PR-FOH-260809-047", "PO")).toBe("PO-FOH-260809-047");
  });

  it("gives every stage the same stem", () => {
    const stems = ["REQ-KIT-260809-007", "PR-KIT-260809-007", "PO-KIT-260809-007"]
      .map(referenceStem);
    expect(new Set(stems).size).toBe(1);
  });

  it("names a requisition by its status", () => {
    expect(prefixForRequisitionStatus("DRAFT")).toBe("REQ");
    expect(prefixForRequisitionStatus("SUBMITTED")).toBe("REQ");
    expect(prefixForRequisitionStatus("APPROVED")).toBe("PR");
    expect(prefixForRequisitionStatus("ORDERED")).toBe("PR");
  });

  it("leaves a refused requisition a requisition", () => {
    // It never became a purchase request, so calling it one would misdescribe
    // what happened.
    expect(prefixForRequisitionStatus("REJECTED")).toBe("REQ");
    expect(prefixForRequisitionStatus("CANCELLED")).toBe("REQ");
  });

  it("returns null for a reference with no stem to take", () => {
    expect(referenceStem("REQ-2026-0001")).toBeNull();
    expect(withType("nonsense", "PO")).toBeNull();
  });
});

describe("the number follows the transaction", () => {
  it("carries from request to invoice", () => {
    // One request, one supplier, one order, one delivery, one invoice — all on
    // the number the request was given, until it is paid and archived.
    const stem = referenceStem("REQ-KIT-260809-003")!;
    expect(["PR", "PO", "GRN", "INV"].map((t) => `${t}-${stem}`)).toEqual([
      "PR-KIT-260809-003",
      "PO-KIT-260809-003",
      "GRN-KIT-260809-003",
      "INV-KIT-260809-003",
    ]);
  });

  it("keeps each unit on its own numbers", () => {
    expect(withType("PR-BAR-260809-012", "PO")).toBe("PO-BAR-260809-012");
    expect(withType("PR-FOH-260809-047", "PO")).toBe("PO-FOH-260809-047");
  });

  it("never writes the suffix an earlier scheme used", () => {
    expect(formatReference({
      type: "PO", unit: "KIT", yymmdd: "260809", sequence: 1, split: 2,
    })).toBe("PO-KIT-260809-001");
  });

  it("still reads an order numbered under that scheme", () => {
    const parts = parseReference("PO-KIT-260809-001-3")!;
    expect(parts.sequence).toBe(1);
    expect(parts.split).toBe(3);
  });
});

describe("legacy references", () => {
  it("recognises the scheme this replaced", () => {
    // A venue's existing orders keep these forever. Treating them as
    // malformed would flag the venue's own history as broken.
    expect(isLegacyReference("REQ-2026-0001")).toBe(true);
    expect(isLegacyReference("PO-2026-0847")).toBe(true);
  });

  it("does not mistake a new reference for an old one", () => {
    expect(isLegacyReference("REQ-KIT-260809-001")).toBe(false);
  });
});

describe("referenceDate", () => {
  it("recovers the day a reference was raised", () => {
    const d = referenceDate("REQ-KIT-260809-001")!;
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(7);
    expect(d.getDate()).toBe(9);
  });

  it("rejects an impossible date rather than rolling it over", () => {
    // new Date(2026, 12, 40) silently becomes January 2027. A reference with
    // a nonsense date should read as nonsense.
    expect(referenceDate("REQ-KIT-261340-001")).toBeNull();
    expect(referenceDate("REQ-KIT-260800-001")).toBeNull();
  });

  it("returns null for an unparseable reference", () => {
    expect(referenceDate("REQ-2026-0001")).toBeNull();
  });
});

describe("nextReferenceLocal", () => {
  const day = new Date(2026, 7, 9);

  it("starts at 001 on a fresh day", () => {
    expect(nextReferenceLocal("REQ", "KIT", [], day)).toBe("REQ-KIT-260809-001");
  });

  it("continues from the highest of the same type, unit and day", () => {
    expect(nextReferenceLocal("REQ", "KIT", [
      "REQ-KIT-260809-001", "REQ-KIT-260809-002",
    ], day)).toBe("REQ-KIT-260809-003");
  });

  it("keeps each unit on its own sequence", () => {
    // The bar's third order of the day is BAR-003 regardless of how busy the
    // kitchen has been.
    expect(nextReferenceLocal("REQ", "BAR", [
      "REQ-KIT-260809-001", "REQ-KIT-260809-002", "REQ-KIT-260809-003",
    ], day)).toBe("REQ-BAR-260809-001");
  });

  it("keeps each document type on its own sequence", () => {
    expect(nextReferenceLocal("PO", "KIT", [
      "REQ-KIT-260809-001", "REQ-KIT-260809-002",
    ], day)).toBe("PO-KIT-260809-001");
  });

  it("restarts each day", () => {
    expect(nextReferenceLocal("REQ", "KIT", [
      "REQ-KIT-260808-001", "REQ-KIT-260808-047",
    ], day)).toBe("REQ-KIT-260809-001");
  });

  it("ignores legacy references when counting", () => {
    // Otherwise the old REQ-2026-0847 would be read as sequence 847 and the
    // first new reference of the day would be 848.
    expect(nextReferenceLocal("REQ", "KIT", [
      "REQ-2026-0847", "REQ-2026-0848",
    ], day)).toBe("REQ-KIT-260809-001");
  });

  it("is not fooled by a gap in the sequence", () => {
    // A cancelled document leaves a hole. Reusing its number would give two
    // documents the same reference in a supplier's records.
    expect(nextReferenceLocal("REQ", "KIT", [
      "REQ-KIT-260809-001", "REQ-KIT-260809-005",
    ], day)).toBe("REQ-KIT-260809-006");
  });
});
