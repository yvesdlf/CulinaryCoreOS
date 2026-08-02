import { describe, it, expect } from "vitest";
import type { Product } from "@ccos/shared";
import { planPriceImport } from "./price-import";

/**
 * Supplier price import.
 *
 * This is the one feature that can rewrite a thousand prices from a file
 * somebody else wrote, so every case here is about refusing to guess: an
 * unmatched name, an ambiguous name, an unreadable figure. Skipping any of
 * them quietly would produce an import that reports success and leaves the
 * catalogue half-updated, which is worse than failing.
 */

const product = (name: string, price: string): Product =>
  ({
    id: `id-${name}`,
    name,
    category: "Test",
    supplier: null,
    supplierId: null,
    brand: null,
    packing: { packQty: 1, packUnit: "kg", unitsPerPack: 1, unitsPerPackUnit: "kg", totalQty: 1, totalUnit: "kg" },
    cost: {
      buyingPricePerPack: price, buyingPricePerUnit: price,
      grossPricePerUnit: price, nettPricePerUnit: price,
    },
    yield_: { grossQty: 1, grossUnit: "kg", wasteQty: 0, wasteUnit: "kg", nettQty: 1, nettUnit: "kg", refPercent: 0, yieldPercent: 100 },
    status: "ACTIVE",
    nutrition: { fatG: 0, carbsG: 0, proteinG: 0, vitAMg: 0, vitCMg: 0, calciumMg: 0, ironMg: 0, sodiumMg: 0, kcal: 0 },
    allergens: [],
    allergensNeedReview: false,
    parLevel: null,
    reorderPoint: null,
    stockUnit: null,
    version: 1,
    allergenReviewNote: null,
    createdAt: "",
    updatedAt: "",
  }) as Product;

const catalogue = [product("Guanciale", "590000"), product("Salt", "5000")];

describe("matching", () => {
  it("plans a price change for a matched product", () => {
    const plan = planPriceImport(
      [["Name", "Unit cost"], ["Guanciale", "650000"]],
      catalogue,
    );
    expect(plan.problems).toEqual([]);
    expect(plan.changes).toHaveLength(1);
    expect(plan.changes[0].newPrice).toBe("650000.00000");
    expect(plan.changes[0].percentChange).toBeCloseTo(10.169, 2);
  });

  it("matches regardless of case and stray whitespace", () => {
    const plan = planPriceImport(
      [["name", "price"], ["  guanciale ", "600000"]],
      catalogue,
    );
    expect(plan.changes).toHaveLength(1);
  });

  it("counts a product already at that price as unchanged, not as a change", () => {
    const plan = planPriceImport([["Name", "Cost"], ["Salt", "5000"]], catalogue);
    expect(plan.changes).toHaveLength(0);
    expect(plan.unchanged).toBe(1);
  });

  it("reports an unknown name instead of creating a product", () => {
    const plan = planPriceImport(
      [["Name", "Cost"], ["Guancialle", "600000"]],
      catalogue,
    );
    expect(plan.changes).toHaveLength(0);
    expect(plan.problems[0].line).toBe(2);
    expect(plan.problems[0].reason).toMatch(/No product with this name/);
  });

  it("refuses an ambiguous name rather than picking one", () => {
    // Updating a price the user cannot predict is worse than not updating.
    const dupes = [product("Carrot", "10000"), { ...product("Carrot", "25000"), id: "other" }];
    const plan = planPriceImport([["Name", "Cost"], ["Carrot", "30000"]], dupes);
    expect(plan.changes).toHaveLength(0);
    expect(plan.problems[0].reason).toMatch(/share this name/);
  });

  it("reports a product listed twice in one file", () => {
    const plan = planPriceImport(
      [["Name", "Cost"], ["Salt", "6000"], ["Salt", "7000"]],
      catalogue,
    );
    expect(plan.changes).toHaveLength(1);
    expect(plan.problems[0].reason).toMatch(/more than once in the file/);
  });
});

describe("reading prices", () => {
  it("reads a price Excel rewrote in the venue's locale", () => {
    const plan = planPriceImport(
      [["Name", "Cost"], ["Guanciale", "650.000"]],
      catalogue,
    );
    expect(plan.changes[0].newPrice).toBe("650000.00000");
  });

  it("reports an unreadable price rather than treating it as zero", () => {
    // A blank or junk cell wiping a product's cost is the expensive failure.
    const plan = planPriceImport(
      [["Name", "Cost"], ["Guanciale", "call supplier"], ["Salt", ""]],
      catalogue,
    );
    expect(plan.changes).toHaveLength(0);
    expect(plan.problems).toHaveLength(2);
    expect(plan.problems[0].reason).toMatch(/Could not read/);
    expect(plan.problems[1].reason).toMatch(/No price given/);
  });

  it("rejects a negative price", () => {
    const plan = planPriceImport([["Name", "Cost"], ["Salt", "-100"]], catalogue);
    expect(plan.problems[0].reason).toMatch(/negative/);
  });

  it("allows a price of zero, which is a price", () => {
    const plan = planPriceImport([["Name", "Cost"], ["Salt", "0"]], catalogue);
    expect(plan.problems).toEqual([]);
    expect(plan.changes[0].newPrice).toBe("0.00000");
  });
});

describe("nutrition", () => {
  it("carries nutrition columns when the file has them", () => {
    const plan = planPriceImport(
      [
        ["Name", "Unit cost", "Kcal", "Fat g", "Protein g"],
        ["Guanciale", "590000", "655", "69", "9"],
      ],
      catalogue,
    );
    expect(plan.changes[0].nutrition).toEqual({ kcal: 655, fatG: 69, proteinG: 9 });
  });

  it("treats new nutrition as a change even at an unchanged price", () => {
    // Otherwise a nutrition-only file would report "everything already
    // current" and apply nothing.
    const plan = planPriceImport(
      [["Name", "Unit cost", "Kcal"], ["Salt", "5000", "0"]],
      catalogue,
    );
    expect(plan.unchanged).toBe(0);
    expect(plan.changes).toHaveLength(1);
  });

  it("omits nutrition entirely when the file carries none", () => {
    const plan = planPriceImport(
      [["Name", "Unit cost"], ["Guanciale", "650000"]],
      catalogue,
    );
    expect(plan.changes[0].nutrition).toBeUndefined();
  });

  it("ignores an unreadable nutrient rather than writing zero", () => {
    const plan = planPriceImport(
      [["Name", "Unit cost", "Kcal", "Fat g"], ["Guanciale", "650000", "n/a", "69"]],
      catalogue,
    );
    expect(plan.changes[0].nutrition).toEqual({ fatG: 69 });
  });
});

describe("file shape", () => {
  it("refuses a file whose columns it cannot identify", () => {
    const plan = planPriceImport([["Foo", "Bar"], ["Guanciale", "1"]], catalogue);
    expect(plan.changes).toHaveLength(0);
    expect(plan.matchedOn).toBeNull();
    expect(plan.problems[0].reason).toMatch(/Could not find/);
  });

  it("finds the columns wherever they sit", () => {
    const plan = planPriceImport(
      [["Supplier", "Product", "Pack", "Unit cost"], ["Acme", "Salt", "1kg", "6000"]],
      catalogue,
    );
    expect(plan.matchedOn).toEqual({ name: "Product", price: "Unit cost" });
    expect(plan.changes).toHaveLength(1);
  });

  it("ignores blank padding rows without reporting them", () => {
    const plan = planPriceImport(
      [["Name", "Cost"], ["Salt", "6000"], ["", ""], ["", ""]],
      catalogue,
    );
    expect(plan.problems).toEqual([]);
    expect(plan.changes).toHaveLength(1);
  });

  it("reports an empty file rather than succeeding at nothing", () => {
    // Headers and nothing else usually means the wrong file, or an export of
    // a filter that matched nothing. Reporting zero changes without saying
    // why reads as "everything is already up to date".
    expect(planPriceImport([["Name", "Cost"]], catalogue).problems[0].reason).toMatch(
      /no data rows/,
    );
    expect(planPriceImport([], catalogue).problems[0].reason).toMatch(/no data rows/);
  });

  it("puts the biggest move first, where a misread separator will be seen", () => {
    const plan = planPriceImport(
      [["Name", "Cost"], ["Salt", "5500"], ["Guanciale", "59"]],
      catalogue,
    );
    expect(plan.changes[0].product.name).toBe("Guanciale");
  });

  it("numbers problem lines the way Excel does", () => {
    const plan = planPriceImport(
      [["Name", "Cost"], ["Salt", "6000"], ["Nope", "1"]],
      catalogue,
    );
    expect(plan.problems[0].line).toBe(3);
  });
});
