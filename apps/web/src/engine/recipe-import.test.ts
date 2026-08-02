import { describe, it, expect } from "vitest";
import type { Product, SubRecipe, Recipe } from "@ccos/shared";
import { EMPTY_PREPARATION } from "@ccos/shared";
import { planRecipeImport } from "./recipe-import";

/**
 * Recipe import.
 *
 * This builds dishes out of a file somebody else wrote, so the cases are about
 * refusing to invent: an ingredient the catalogue lacks is reported, never
 * created. A silently created product arrives with no price, costs the dish
 * nothing, and makes it look cheap rather than look wrong.
 */

const product = (name: string, price = "1000"): Product =>
  ({
    id: `p-${name}`, name, category: "T", supplier: null, supplierId: null, brand: null,
    packing: { packQty: 1, packUnit: "KG", unitsPerPack: 1, unitsPerPackUnit: "KG", totalQty: 1, totalUnit: "KG" },
    cost: { buyingPricePerPack: price, buyingPricePerUnit: price, grossPricePerUnit: price, nettPricePerUnit: price },
    yield_: { grossQty: 1, grossUnit: "KG", wasteQty: 0, wasteUnit: "KG", nettQty: 1, nettUnit: "KG", refPercent: 0, yieldPercent: 100 },
    status: "ACTIVE",
    nutrition: { fatG: 0, carbsG: 0, proteinG: 0, vitAMg: 0, vitCMg: 0, calciumMg: 0, ironMg: 0, sodiumMg: 0, kcal: 0 },
    allergens: [],
    preparation: EMPTY_PREPARATION, allergensNeedReview: false, version: 1, allergenReviewNote: null,
    parLevel: null, reorderPoint: null, stockUnit: null,
    createdAt: "", updatedAt: "",
  }) as Product;

const sub = (name: string, costPerUnit = "500"): SubRecipe =>
  ({
    id: `s-${name}`, name, category: "T", status: "ACTUAL", ingredientLines: [],
    batchYield: { qty: 1, unit: "KG" }, totalCost: "0", costPerUnit,
    wastePercent: 0, inflationPercent: 0, taxPercent: 21,
    nutritionPer100g: { fatG: 0, carbsG: 0, proteinG: 0, vitAMg: 0, vitCMg: 0, calciumMg: 0, ironMg: 0, sodiumMg: 0, kcal: 0 },
    allergens: [],
    preparation: EMPTY_PREPARATION, version: 1, createdAt: "", updatedAt: "",
  }) as SubRecipe;

const recipe = (name: string): Recipe =>
  ({
    id: `r-${name}`, name, category: "Mains", status: "ACTUAL", ingredientLines: [],
    portion: { yieldQty: 1, yieldUnit: "por" },
    pricing: { menuPrice: "50000", priceInclTax: "0", totalCost: "0", wasteAmount: "0", inflationAmount: "0", totalCog: "0", grossProfit: "0", grossProfitPercent: 0, foodCostPercent: 0, currency: "IDR" },
    wastePercent: 0, inflationPercent: 4, taxPercent: 21,
    nutritionPerPortion: { fatG: 0, carbsG: 0, proteinG: 0, vitAMg: 0, vitCMg: 0, calciumMg: 0, ironMg: 0, sodiumMg: 0, kcal: 0 },
    allergens: [],
    preparation: EMPTY_PREPARATION, dietaryFlags: { glutenFree: true, dairyFree: true, vegetarian: false, vegan: false, nutsFree: true, soyFree: true, sulfitesFree: true },
    version: 1, createdAt: "", updatedAt: "",
  }) as Recipe;

const catalogue = {
  products: [product("Beef", "200000"), product("Salt", "5000")],
  subRecipes: [sub("Jus", "80000")],
  recipes: [recipe("Steak")],
};

const H = ["Recipe", "Ingredient", "Quantity", "Unit"];

describe("building dishes", () => {
  it("groups rows by dish", () => {
    const plan = planRecipeImport(
      [H, ["Steak Frites", "Beef", "0.2", "KG"], ["Steak Frites", "Salt", "0.01", "KG"]],
      catalogue,
    );
    expect(plan.problems).toEqual([]);
    expect(plan.recipes).toHaveLength(1);
    expect(plan.recipes[0].lines).toHaveLength(2);
  });

  it("costs a line with the shipped engine", () => {
    const plan = planRecipeImport([H, ["D", "Beef", "0.2", "KG"]], catalogue);
    expect(plan.recipes[0].lines[0].lineCost).toBe("40000.00");
    expect(plan.recipes[0].totalCost).toBe("40000.00");
  });

  it("prefers a preparation over a product of the same name", () => {
    // "Sourdough" in a dish means the bread we make, not the starter we buy.
    const both = {
      ...catalogue,
      products: [...catalogue.products, product("Jus", "1")],
    };
    const plan = planRecipeImport([H, ["D", "Jus", "1", "KG"]], both);
    expect(plan.recipes[0].lines[0].subRecipeId).toBe("s-Jus");
    expect(plan.recipes[0].lines[0].productId).toBeNull();
  });

  it("recognises a dish that already exists, so a re-import updates it", () => {
    const plan = planRecipeImport([H, ["Steak", "Beef", "0.2", "KG"]], catalogue);
    expect(plan.recipes[0].existingId).toBe("r-Steak");
  });

  it("carries the existing menu price when the file omits one", () => {
    const plan = planRecipeImport([H, ["Steak", "Beef", "0.2", "KG"]], catalogue);
    expect(plan.recipes[0].menuPrice).toBe(50000);
  });
});

describe("refusing to invent", () => {
  it("reports an ingredient the catalogue does not have", () => {
    const plan = planRecipeImport(
      [H, ["D", "Beef", "0.2", "KG"], ["D", "Truffle", "0.01", "KG"]],
      catalogue,
    );
    expect(plan.recipes[0].lines).toHaveLength(1);
    expect(plan.problems[0].reason).toMatch(/not in the catalogue/);
    expect(plan.problems[0].line).toBe(3);
  });

  it("reports an unreadable quantity rather than treating it as zero", () => {
    const plan = planRecipeImport([H, ["D", "Beef", "some", "KG"]], catalogue);
    expect(plan.problems[0].reason).toMatch(/Could not read a quantity/);
  });

  it("skips a dish whose every line failed", () => {
    // An empty recipe costs nothing, which reads as a cheap dish.
    const plan = planRecipeImport([H, ["D", "Truffle", "1", "KG"]], catalogue);
    expect(plan.recipes).toHaveLength(0);
    expect(plan.problems.some((p) => /No ingredient on this dish/.test(p.reason))).toBe(true);
  });

  it("refuses a file whose columns it cannot identify", () => {
    const plan = planRecipeImport([["A", "B"], ["x", "y"]], catalogue);
    expect(plan.recipes).toEqual([]);
    expect(plan.columns).toBeNull();
  });

  it("ignores blank padding rows", () => {
    const plan = planRecipeImport(
      [H, ["D", "Beef", "1", "KG"], ["", "", "", ""]],
      catalogue,
    );
    expect(plan.problems).toEqual([]);
  });

  it("carries a trim percentage the file states", () => {
    // The venue's workbooks state ref% per line; discarding a 5% trim would
    // undercost every line that has one.
    const plan = planRecipeImport(
      [[...H, "Ref %"], ["D", "Beef", "0.2", "KG", "20"]],
      catalogue,
    );
    const line = plan.recipes[0].lines[0];
    expect(line.refPercent).toBe(20);
    // 0,2 nett at 20% trim is 0,25 gross, at 200.000 = 50.000.
    expect(line.grossQty).toBeCloseTo(0.25, 5);
    expect(line.lineCost).toBe("50000.00");
  });

  it("treats an absent trim column as zero rather than guessing", () => {
    const plan = planRecipeImport([H, ["D", "Beef", "0.2", "KG"]], catalogue);
    expect(plan.recipes[0].lines[0].refPercent).toBe(0);
  });

  it("reads a quantity written in the venue's locale", () => {
    const plan = planRecipeImport([H, ["D", "Beef", "0,2", "KG"]], catalogue);
    expect(plan.recipes[0].lines[0].qty).toBe(0.2);
  });
});
