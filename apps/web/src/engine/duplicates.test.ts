import { describe, it, expect } from "vitest";
import type { Product } from "@ccos/shared";
import {
  normaliseName,
  findDuplicateProducts,
  findDuplicateSuppliers,
} from "./duplicates";

/**
 * Duplicate detection.
 *
 * A merge cannot be undone, so the cases below are mostly about when NOT to
 * offer one: two prices usually mean two pack sizes, and two units almost
 * always mean two different things. Over-merging destroys a real distinction
 * silently; under-merging just leaves a row on a list.
 */

const product = (
  name: string,
  over: Partial<{ price: string; supplier: string | null; unit: string; brand: string | null }> = {},
): Product =>
  ({
    id: `id-${name}`,
    name,
    category: "Test",
    supplier: over.supplier ?? null,
    brand: over.brand ?? null,
    packing: {
      packQty: 1, packUnit: over.unit ?? "KG", unitsPerPack: 1,
      unitsPerPackUnit: over.unit ?? "KG", totalQty: 1, totalUnit: over.unit ?? "KG",
    },
    cost: {
      buyingPricePerPack: over.price ?? "1000",
      buyingPricePerUnit: over.price ?? "1000",
      grossPricePerUnit: over.price ?? "1000",
      nettPricePerUnit: over.price ?? "1000",
    },
    yield_: { grossQty: 1, grossUnit: "KG", wasteQty: 0, wasteUnit: "KG", nettQty: 1, nettUnit: "KG", refPercent: 0, yieldPercent: 100 },
    status: "ACTIVE",
    nutrition: { fatG: 0, carbsG: 0, proteinG: 0, vitAMg: 0, vitCMg: 0, calciumMg: 0, ironMg: 0, sodiumMg: 0, kcal: 0 },
    allergens: [],
    allergensNeedReview: false,
    allergenReviewNote: null,
    createdAt: "",
    updatedAt: "",
  }) as Product;

describe("normalising names", () => {
  it("folds case, punctuation and spacing", () => {
    expect(normaliseName("  Green  Bean ")).toBe("green bean");
    expect(normaliseName("Tomato (Cherry)")).toBe("tomato cherry");
  });

  it("folds a trailing plural, the commonest difference here", () => {
    expect(normaliseName("Shallots")).toBe(normaliseName("Shallot"));
    expect(normaliseName("Coriander Seeds")).toBe(normaliseName("Coriander Seed"));
  });

  it("does not fold an s in the middle", () => {
    // "seeds mix" and "seed mixes" are not the same product.
    expect(normaliseName("Seeds Mix")).not.toBe(normaliseName("Seed Mixes"));
  });
});

describe("grading a match", () => {
  it("calls same name, price and supplier identical", () => {
    const [g] = findDuplicateProducts([
      product("Shallot", { price: "40000", supplier: "Acme" }),
      product("Shallots", { price: "40000", supplier: "Acme" }),
    ]);
    expect(g.confidence).toBe("identical");
    expect(g.members).toHaveLength(2);
  });

  it("calls same price but different supplier likely", () => {
    const [g] = findDuplicateProducts([
      product("Shallot", { price: "40000", supplier: "Acme" }),
      product("Shallots", { price: "40000", supplier: "Other" }),
    ]);
    expect(g.confidence).toBe("likely");
    expect(g.reason).toMatch(/different supplier/i);
  });

  it("holds back when the prices differ", () => {
    // Carrot at 10.000 and carrots at 40.000 are probably not one row typed
    // twice; merging them would pick a price and lose the other.
    const [g] = findDuplicateProducts([
      product("Carrot", { price: "10000", supplier: "Acme" }),
      product("carrots", { price: "40000", supplier: "Acme" }),
    ]);
    expect(g.confidence).toBe("review");
    expect(g.reason).toMatch(/pack size or grade/i);
  });

  it("holds back when the units differ, whatever the price", () => {
    const [g] = findDuplicateProducts([
      product("Egg", { price: "1500", unit: "EA", supplier: "Acme" }),
      product("Eggs", { price: "1500", unit: "KG", supplier: "Acme" }),
    ]);
    expect(g.confidence).toBe("review");
    expect(g.reason).toMatch(/different units/i);
  });

  it("reports nothing when names do not collide", () => {
    expect(
      findDuplicateProducts([product("Salt"), product("Pepper")]),
    ).toEqual([]);
  });

  it("puts the safe merges first", () => {
    const groups = findDuplicateProducts([
      product("Carrot", { price: "10000" }),
      product("Carrots", { price: "40000" }),
      product("Shallot", { price: "40000", supplier: "A" }),
      product("Shallots", { price: "40000", supplier: "A" }),
    ]);
    expect(groups[0].confidence).toBe("identical");
  });
});

describe("choosing what to keep", () => {
  it("keeps the row recipes already point at", () => {
    const keep = product("Shallot", { price: "40000" });
    const drop = product("Shallots", { price: "40000" });
    const [g] = findDuplicateProducts(
      [drop, keep],
      new Map([[keep.id, 12], [drop.id, 1]]),
    );
    expect(g.suggestedSurvivor.id).toBe(keep.id);
  });

  it("falls back to whichever row knows more", () => {
    const sparse = product("Shallot", { price: "40000" });
    const full = product("Shallots", { price: "40000", supplier: "Acme", brand: "X" });
    const [g] = findDuplicateProducts([sparse, full]);
    expect(g.suggestedSurvivor.id).toBe(full.id);
  });
});

describe("supplier spellings", () => {
  it("groups names differing only in case or spacing", () => {
    const [d] = findDuplicateSuppliers([
      product("a", { supplier: "UD Astungkara Lancar" }),
      product("b", { supplier: "UD Astungkara lancar" }),
      product("c", { supplier: "UD Astungkara Lancar" }),
    ]);
    expect(d.spellings).toHaveLength(2);
    // The spelling on more products is the one to standardise on.
    expect(d.suggestedSurvivor).toBe("UD Astungkara Lancar");
    expect(d.spellings[0].items).toBe(2);
  });

  it("ignores a supplier recorded one way only", () => {
    expect(
      findDuplicateSuppliers([product("a", { supplier: "Acme" })]),
    ).toEqual([]);
  });

  it("ignores products with no supplier", () => {
    expect(findDuplicateSuppliers([product("a"), product("b")])).toEqual([]);
  });
});
