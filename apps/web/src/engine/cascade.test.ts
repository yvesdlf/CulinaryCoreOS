import { describe, it, expect } from "vitest";
import type { Product, SubRecipe, Recipe, IngredientLine } from "@ccos/shared";
import { getDependents, cascadeFrom } from "./cascade";

/**
 * Unit tests for the dependency cascade.
 *
 * Cycle safety and topological ordering were previously only ever checked by
 * hand in a browser console. They are exactly the properties that break
 * silently and catastrophically — a cycle hangs the tab, a bad order costs a
 * dish from a stale sub-recipe — so they belong here.
 */

let seq = 0;
const line = (over: Partial<IngredientLine> = {}): IngredientLine => ({
  id: `l${seq++}`,
  lineNumber: 1,
  productId: null,
  subRecipeId: null,
  nettQty: 100,
  nettUnit: "g",
  refPercent: 0,
  grossQty: 100,
  grossUnit: "g",
  costPerUnit: "1",
  lineCost: "100",
  ...over,
});

const product = (id: string, gross: string): Product => ({
  id,
  category: "Test",
  supplier: null,
  name: id,
  brand: null,
  packing: { packQty: 1, packUnit: "kg", unitsPerPack: 1000, unitsPerPackUnit: "g", totalQty: 1000, totalUnit: "g" },
  cost: { buyingPricePerPack: gross, buyingPricePerUnit: gross, grossPricePerUnit: gross, nettPricePerUnit: gross },
  yield_: { grossQty: 1000, grossUnit: "g", wasteQty: 0, wasteUnit: "g", nettQty: 1000, nettUnit: "g", refPercent: 0, yieldPercent: 100 },
  status: "ACTIVE",
  nutrition: { fatG: 0, carbsG: 0, proteinG: 0, vitAMg: 0, vitCMg: 0, calciumMg: 0, ironMg: 0, sodiumMg: 0, kcal: 0 },
  allergens: [],
  createdAt: "",
  updatedAt: "",
});

const sub = (id: string, lines: IngredientLine[], yieldQty = 1000): SubRecipe => ({
  id,
  name: id,
  category: "Test",
  status: "ACTUAL",
  ingredientLines: lines,
  batchYield: { qty: yieldQty, unit: "g" },
  totalCost: "0",
  costPerUnit: "0",
  wastePercent: 0,
  inflationPercent: 0,
  taxPercent: 21,
  nutritionPer100g: { fatG: 0, carbsG: 0, proteinG: 0, vitAMg: 0, vitCMg: 0, calciumMg: 0, ironMg: 0, sodiumMg: 0, kcal: 0 },
  allergens: [],
  version: 1,
  createdAt: "",
  updatedAt: "",
});

const recipe = (id: string, lines: IngredientLine[], menuPrice = "1000"): Recipe => ({
  id,
  name: id,
  category: "Test",
  status: "ACTUAL",
  ingredientLines: lines,
  portion: { yieldQty: 1, yieldUnit: "por" },
  pricing: {
    menuPrice, priceInclTax: "0", totalCost: "0", wasteAmount: "0",
    inflationAmount: "0", totalCog: "0", grossProfit: "0",
    grossProfitPercent: 0, foodCostPercent: 0, currency: "IDR",
  },
  wastePercent: 0,
  inflationPercent: 4,
  taxPercent: 21,
  nutritionPerPortion: { fatG: 0, carbsG: 0, proteinG: 0, vitAMg: 0, vitCMg: 0, calciumMg: 0, ironMg: 0, sodiumMg: 0, kcal: 0 },
  allergens: [],
  dietaryFlags: { glutenFree: true, dairyFree: true, vegetarian: false, vegan: false, nutsFree: true, soyFree: true, sulfitesFree: true },
  version: 1,
  createdAt: "",
  updatedAt: "",
});

describe("dependency graph", () => {
  it("finds transitive dependents to unlimited depth", () => {
    // flour -> D1 -> D2 -> D3, and a recipe on the deepest one.
    const subRecipes = [
      sub("D1", [line({ productId: "flour" })]),
      sub("D2", [line({ subRecipeId: "D1" })]),
      sub("D3", [line({ subRecipeId: "D2" })]),
    ];
    const recipes = [recipe("R", [line({ subRecipeId: "D3" })])];

    const dep = getDependents("flour", { subRecipes, recipes });
    expect(dep.subRecipeIds.sort()).toEqual(["D1", "D2", "D3"]);
    expect(dep.recipeIds).toEqual(["R"]);
  });

  it("excludes entities that do not use the changed product", () => {
    const subRecipes = [
      sub("uses", [line({ productId: "flour" })]),
      sub("other", [line({ productId: "salt" })]),
    ];
    const dep = getDependents("flour", { subRecipes, recipes: [] });
    expect(dep.subRecipeIds).toEqual(["uses"]);
  });

  it("terminates on a mutual reference instead of looping forever", () => {
    // Nothing stops a user creating this, so the walk must survive it.
    const subRecipes = [
      sub("A", [line({ productId: "flour" }), line({ subRecipeId: "B" })]),
      sub("B", [line({ subRecipeId: "A" })]),
    ];
    const dep = getDependents("flour", { subRecipes, recipes: [] });
    expect(dep.subRecipeIds.sort()).toEqual(["A", "B"]);
  });

  it("survives a self-reference", () => {
    const subRecipes = [
      sub("S", [line({ productId: "flour" }), line({ subRecipeId: "S" })]),
    ];
    expect(getDependents("flour", { subRecipes, recipes: [] }).subRecipeIds).toEqual(["S"]);
  });
});

describe("cascade re-costing", () => {
  it("re-costs a nested sub-recipe before the recipe that consumes it", () => {
    // If ordering were wrong, R would cost from D2's stale cost per unit.
    const products = [product("flour", "10")];
    const subRecipes = [
      sub("D1", [line({ productId: "flour", nettQty: 100 })], 100),
      sub("D2", [line({ subRecipeId: "D1", nettQty: 100 })], 100),
    ];
    const recipes = [recipe("R", [line({ subRecipeId: "D2", nettQty: 100 })])];

    const out = cascadeFrom("flour", { products, subRecipes, recipes });
    const d1 = out.subRecipes.find((s) => s.id === "D1")!;
    const d2 = out.subRecipes.find((s) => s.id === "D2")!;
    const r = out.recipes.find((x) => x.id === "R")!;

    // 100 g at 10/g = 1000 over a 100 g batch = 10 per unit, all the way up.
    expect(d1.costPerUnit).toBe("10.00000");
    expect(d2.costPerUnit).toBe("10.00000");
    expect(r.pricing.totalCost).toBe("1000.00");
  });

  it("uses the gross price, so trim is not charged twice", () => {
    const products = [
      { ...product("beef", "645"), cost: { buyingPricePerPack: "645", buyingPricePerUnit: "645", grossPricePerUnit: "645", nettPricePerUnit: "806.25" } },
    ];
    const recipes = [recipe("R", [line({ productId: "beef", nettQty: 220, refPercent: 20 })])];
    const out = cascadeFrom("beef", { products, subRecipes: [], recipes });
    // 275 g gross x 645 = 177.375. The nett rate would have given 221.718.
    expect(out.recipes[0].pricing.totalCost).toBe("177375.00");
  });

  it("applies each recipe's own buffers rather than a global constant", () => {
    const products = [product("p", "1")];
    const recipes = [
      { ...recipe("plain", [line({ productId: "p", nettQty: 1000 })]), wastePercent: 0, inflationPercent: 0 },
      { ...recipe("buffered", [line({ productId: "p", nettQty: 1000 })]), wastePercent: 10, inflationPercent: 8 },
    ];
    const out = cascadeFrom("p", { products, subRecipes: [], recipes });
    expect(out.recipes.find((r) => r.id === "plain")!.pricing.totalCog).toBe("1000.00");
    expect(out.recipes.find((r) => r.id === "buffered")!.pricing.totalCog).toBe("1180.00");
  });

  it("leaves untouched entities identical by reference", () => {
    // React relies on this to skip re-rendering everything on a price change.
    const products = [product("flour", "10"), product("salt", "1")];
    const subRecipes = [sub("uses", [line({ productId: "flour" })])];
    const recipes = [recipe("unrelated", [line({ productId: "salt" })])];

    const out = cascadeFrom("flour", { products, subRecipes, recipes });
    expect(out.recipes[0]).toBe(recipes[0]);
  });

  it("does not hang when re-costing through a cycle", () => {
    const products = [product("flour", "10")];
    const subRecipes = [
      sub("A", [line({ productId: "flour" }), line({ subRecipeId: "B" })]),
      sub("B", [line({ subRecipeId: "A" })]),
    ];
    const started = Date.now();
    const out = cascadeFrom("flour", { products, subRecipes, recipes: [] });
    expect(Date.now() - started).toBeLessThan(1000);
    expect(out.subRecipes).toHaveLength(2);
  });
});
