import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import {
  convertQuantity,
  convertUnit,
  normaliseUnit,
  unresolvedMessage,
  type ProductConversion,
} from "./unit-conversion";

/** 1 bunch of coriander, weighed. The case the brief is actually about. */
const BUNCH: ProductConversion = { fromUnit: "bunch", toUnit: "g", factor: "80" };
const EGG: ProductConversion = { fromUnit: "egg", toUnit: "g", factor: "55" };

const factor = (r: ReturnType<typeof convertUnit>) =>
  r.ok ? r.factor.toString() : `unresolved:${r.from}->${r.to}`;

describe("normaliseUnit", () => {
  it("folds the spellings the workbooks and price lists actually use", () => {
    expect(["Gr", "GRAMS", " g ", "gramme"].map(normaliseUnit)).toEqual(["g", "g", "g", "g"]);
    expect(["Litre", "LTR", "l"].map(normaliseUnit)).toEqual(["l", "l", "l"]);
  });

  it("leaves a unit it does not know alone rather than rejecting it", () => {
    // "bunch" is a perfectly good unit. It just has no general conversion.
    expect(normaliseUnit("Bunch")).toBe("bunch");
  });

  it("treats a missing unit as missing, not as a unit called empty", () => {
    expect(normaliseUnit(null)).toBe("");
    expect(normaliseUnit("   ")).toBe("");
  });
});

describe("convertUnit — the same unit", () => {
  it("does no arithmetic at all", () => {
    const r = convertUnit("kg", "kg");
    expect(r.ok && r.via).toBe("identical");
    expect(factor(r)).toBe("1");
  });

  it("matches across spellings", () => {
    expect(convertUnit("Gr", "grams").ok).toBe(true);
  });
});

describe("convertUnit — physics", () => {
  it("converts mass", () => {
    expect(factor(convertUnit("kg", "g"))).toBe("1000");
    expect(factor(convertUnit("g", "kg"))).toBe("0.001");
    expect(factor(convertUnit("mg", "g"))).toBe("0.001");
  });

  it("converts volume", () => {
    expect(factor(convertUnit("l", "ml"))).toBe("1000");
    expect(factor(convertUnit("cl", "ml"))).toBe("10");
  });

  it("marks it as the global route, not the product's", () => {
    const r = convertUnit("kg", "g", { conversions: [BUNCH] });
    expect(r.ok && r.via).toBe("global");
  });

  /*
   * The defect this whole file exists for. Before it, a 0.2 kg line against a
   * product priced per gram was costed as 0.2 — a thousandth of the truth,
   * with nothing said.
   */
  it("is the thousand-fold error that costing used to make silently", () => {
    const r = convertQuantity("0.2", "kg", "g");
    expect(r.ok && r.quantity?.toString()).toBe("200");
  });

  it("refuses to cross mass and volume without a density", () => {
    expect(convertUnit("l", "kg").ok).toBe(false);
  });
});

describe("convertUnit — this product's own", () => {
  it("converts a bunch, which no amount of general knowledge can do", () => {
    const r = convertUnit("bunch", "g", { conversions: [BUNCH, EGG] });
    expect(r.ok && r.via).toBe("product");
    expect(factor(r)).toBe("80");
  });

  it("works in the direction nobody wrote down", () => {
    // Making somebody record both rows is how the second disagrees with the first.
    expect(factor(convertUnit("g", "bunch", { conversions: [BUNCH] }))).toBe("0.0125");
  });

  it("reaches a unit the row does not name, through the global table", () => {
    // 1 bunch = 80 g, and the line is in kg. Not supported on purpose: the
    // product row says grams and chaining two routes is a second rule that
    // nobody asked for. It is an admitted gap, not a wrong answer.
    expect(convertUnit("bunch", "kg", { conversions: [BUNCH] }).ok).toBe(false);
  });

  it("ignores a row that cannot be a factor", () => {
    const junk: ProductConversion[] = [
      { fromUnit: "bunch", toUnit: "g", factor: "0" },
      { fromUnit: "bunch", toUnit: "g", factor: "-5" },
    ];
    expect(convertUnit("bunch", "g", { conversions: junk }).ok).toBe(false);
  });

  it("does not let a venue redefine the kilogram", () => {
    // Global is tried first precisely so a typo here cannot rewrite physics.
    const wrong: ProductConversion[] = [{ fromUnit: "kg", toUnit: "g", factor: "100" }];
    expect(factor(convertUnit("kg", "g", { conversions: wrong }))).toBe("1000");
  });
});

describe("convertUnit — density", () => {
  // Honey: 1 ml weighs about 1.42 g.
  const honey = { densityGPerMl: "1.42" };

  it("crosses volume to mass", () => {
    expect(factor(convertUnit("ml", "g", honey))).toBe("1.42");
    expect(factor(convertUnit("l", "g", honey))).toBe("1420");
  });

  it("crosses mass to volume", () => {
    expect(factor(convertUnit("g", "ml", honey))).toBe(new Decimal(1).dividedBy("1.42").toString());
  });

  it("goes through the base units, so kg to l needs no second rule", () => {
    expect(factor(convertUnit("kg", "l", honey))).toBe(
      new Decimal(1000).dividedBy("1.42").dividedBy(1000).toString(),
    );
  });

  it("is only consulted after the product's own measurements", () => {
    const measured: ProductConversion[] = [{ fromUnit: "ml", toUnit: "g", factor: "1.5" }];
    const r = convertUnit("ml", "g", { ...honey, conversions: measured });
    expect(r.ok && r.via).toBe("product");
    expect(factor(r)).toBe("1.5");
  });

  it("ignores a density that is not a positive number", () => {
    expect(convertUnit("ml", "g", { densityGPerMl: "0" }).ok).toBe(false);
    expect(convertUnit("ml", "g", { densityGPerMl: null }).ok).toBe(false);
  });
});

describe("convertUnit — saying so", () => {
  it("refuses rather than guessing, and names both units", () => {
    const r = convertUnit("bunch", "piece");
    expect(r).toEqual({ ok: false, reason: "unresolved", from: "bunch", to: "piece" });
  });

  /*
   * A blank unit meeting a blank unit must not come out as a factor of 1.
   * "No unit recorded" is not "the same unit", and treating it as one is the
   * same mistake as a count sheet treating a blank as a zero.
   */
  it("does not let two missing units agree with each other", () => {
    expect(convertUnit(null, null).ok).toBe(false);
    expect(convertUnit("", "g").ok).toBe(false);
  });

  it("gives the screen something a person can act on", () => {
    expect(unresolvedMessage({ from: "bunch", to: "g" }))
      .toBe("No way to convert bunch to g. Record a conversion for this product.");
    expect(unresolvedMessage({ from: "", to: "g" })).toContain("(no unit)");
  });

  it("returns no quantity when it cannot convert, rather than zero", () => {
    const r = convertQuantity("5", "bunch", "piece");
    expect(r.ok).toBe(false);
    expect("quantity" in r && r.quantity).toBeFalsy();
  });
});

describe("convertQuantity", () => {
  it("multiplies in decimal, not in binary floating point", () => {
    // 0.1 * 3 is 0.30000000000000004 as a float. A stock report showing that
    // reads as broken — AGENTS.md section 3.
    expect(convertQuantity("0.0001", "kg", "g").quantity?.toString()).toBe("0.1");
    expect(convertQuantity("3", "bunch", "g", { conversions: [BUNCH] }).quantity?.toString())
      .toBe("240");
  });
});
