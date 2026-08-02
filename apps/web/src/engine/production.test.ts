import { describe, it, expect } from "vitest";
import type { Product, SubRecipe, Recipe, IngredientLine } from "@ccos/shared";
import { EMPTY_PREPARATION } from "@ccos/shared";
import { planProduction } from "./production";

/**
 * Production planning.
 *
 * The expensive failures here are quiet ones: a preparation expanded before
 * its total finished accumulating, grams added to kilograms, or a pull list
 * built for the exact need when the kitchen will make whole batches. Each of
 * those produces a plausible-looking sheet that leaves a prep cook short.
 */

let seq = 0;
const line = (over: Partial<IngredientLine> = {}): IngredientLine => ({
  id: `l${seq++}`, lineNumber: 1, productId: null, subRecipeId: null,
  nettQty: 100, nettUnit: "g", refPercent: 0, grossQty: 100, grossUnit: "g",
  costPerUnit: "1", lineCost: "100", ...over,
});

const product = (id: string, price = "10"): Product =>
  ({
    id, name: id, category: "T", supplier: null, supplierId: null, brand: null,
    packing: { packQty: 1, packUnit: "g", unitsPerPack: 1, unitsPerPackUnit: "g", totalQty: 1, totalUnit: "g" },
    cost: { buyingPricePerPack: price, buyingPricePerUnit: price, grossPricePerUnit: price, nettPricePerUnit: price },
    yield_: { grossQty: 1, grossUnit: "g", wasteQty: 0, wasteUnit: "g", nettQty: 1, nettUnit: "g", refPercent: 0, yieldPercent: 100 },
    status: "ACTIVE",
    nutrition: { fatG: 0, carbsG: 0, proteinG: 0, vitAMg: 0, vitCMg: 0, calciumMg: 0, ironMg: 0, sodiumMg: 0, kcal: 0 },
    allergens: [], allergensNeedReview: false, allergenReviewNote: null,
    parLevel: null, reorderPoint: null, stockUnit: null,
    version: 1, createdAt: "", updatedAt: "",
  }) as Product;

const sub = (id: string, lines: IngredientLine[], yieldQty = 1000): SubRecipe =>
  ({
    id, name: id, category: "T", status: "ACTUAL", ingredientLines: lines,
    batchYield: { qty: yieldQty, unit: "g" },
    totalCost: "0", costPerUnit: "0", wastePercent: 0, inflationPercent: 0, taxPercent: 21,
    nutritionPer100g: { fatG: 0, carbsG: 0, proteinG: 0, vitAMg: 0, vitCMg: 0, calciumMg: 0, ironMg: 0, sodiumMg: 0, kcal: 0 },
    allergens: [], preparation: EMPTY_PREPARATION, version: 1, createdAt: "", updatedAt: "",
  }) as SubRecipe;

const recipe = (id: string, lines: IngredientLine[]): Recipe =>
  ({
    id, name: id, category: "T", status: "ACTUAL", ingredientLines: lines,
    portion: { yieldQty: 1, yieldUnit: "por" },
    pricing: { menuPrice: "1000", priceInclTax: "0", totalCost: "0", wasteAmount: "0", inflationAmount: "0", totalCog: "0", grossProfit: "0", grossProfitPercent: 0, foodCostPercent: 0, currency: "IDR" },
    wastePercent: 0, inflationPercent: 0, taxPercent: 21,
    nutritionPerPortion: { fatG: 0, carbsG: 0, proteinG: 0, vitAMg: 0, vitCMg: 0, calciumMg: 0, ironMg: 0, sodiumMg: 0, kcal: 0 },
    allergens: [], preparation: EMPTY_PREPARATION,
    dietaryFlags: { glutenFree: true, dairyFree: true, vegetarian: false, vegan: false, nutsFree: true, soyFree: true, sulfitesFree: true },
    version: 1, createdAt: "", updatedAt: "",
  }) as Recipe;

describe("pulling ingredients", () => {
  it("scales a dish by the number of covers", () => {
    const state = {
      products: [product("flour")],
      subRecipes: [],
      recipes: [recipe("Bread", [line({ productId: "flour", nettQty: 50 })])],
    };
    const plan = planProduction([{ recipeId: "Bread", covers: 40 }], state);
    expect(plan.pull[0].grossQty).toBe(2000);
    expect(plan.pull[0].estimatedCost).toBe("20000.00");
  });

  it("pulls the gross quantity, so trim is bought too", () => {
    const state = {
      products: [product("onion")],
      subRecipes: [],
      recipes: [recipe("Soup", [line({ productId: "onion", nettQty: 80, refPercent: 20 })])],
    };
    const plan = planProduction([{ recipeId: "Soup", covers: 10 }], state);
    // 800 g nett at 20% trim is 1.000 g bought.
    expect(plan.pull[0].grossQty).toBe(1000);
  });

  it("adds up an ingredient used by several dishes", () => {
    const state = {
      products: [product("butter")],
      subRecipes: [],
      recipes: [
        recipe("A", [line({ productId: "butter", nettQty: 10 })]),
        recipe("B", [line({ productId: "butter", nettQty: 5 })]),
      ],
    };
    const plan = planProduction(
      [{ recipeId: "A", covers: 10 }, { recipeId: "B", covers: 20 }],
      state,
    );
    expect(plan.pull).toHaveLength(1);
    expect(plan.pull[0].grossQty).toBe(200);
  });

  it("refuses to add grams to kilograms", () => {
    // Summing these would understate the order by a factor of a thousand, and
    // nobody notices until the delivery arrives.
    const state = {
      products: [product("salt")],
      subRecipes: [],
      recipes: [
        recipe("A", [line({ productId: "salt", nettQty: 500, grossUnit: "g" })]),
        recipe("B", [line({ productId: "salt", nettQty: 2, grossUnit: "kg" })]),
      ],
    };
    const plan = planProduction(
      [{ recipeId: "A", covers: 1 }, { recipeId: "B", covers: 1 }],
      state,
    );
    expect(plan.pull).toHaveLength(0);
    expect(plan.problems[0]).toMatch(/measured in/);
  });

  it("skips dishes with no covers rather than planning zero of them", () => {
    const state = {
      products: [product("flour")],
      subRecipes: [],
      recipes: [recipe("Bread", [line({ productId: "flour" })])],
    };
    expect(planProduction([{ recipeId: "Bread", covers: 0 }], state).pull).toEqual([]);
  });
});

describe("subtracting the shelf", () => {
  const state = {
    products: [product("flour")],
    subRecipes: [],
    recipes: [recipe("Bread", [line({ productId: "flour", nettQty: 100 })])],
  };

  it("reports only what is missing", () => {
    const plan = planProduction(
      [{ recipeId: "Bread", covers: 10 }],
      state,
      new Map([["flour", { onHand: 400 }]]),
    );
    expect(plan.pull[0].grossQty).toBe(1000);
    expect(plan.pull[0].shortfall).toBe(600);
  });

  it("reports no shortfall when the shelf covers it", () => {
    const plan = planProduction(
      [{ recipeId: "Bread", covers: 10 }],
      state,
      new Map([["flour", { onHand: 5000 }]]),
    );
    expect(plan.pull[0].shortfall).toBe(0);
  });

  it("puts what is missing above what is merely needed", () => {
    const two = {
      products: [product("flour"), product("yeast")],
      subRecipes: [],
      recipes: [
        recipe("Bread", [
          line({ productId: "flour", nettQty: 100 }),
          line({ productId: "yeast", nettQty: 5 }),
        ]),
      ],
    };
    const plan = planProduction(
      [{ recipeId: "Bread", covers: 10 }],
      two,
      new Map([["flour", { onHand: 99999 }], ["yeast", { onHand: 0 }]]),
    );
    expect(plan.pull[0].product.name).toBe("yeast");
  });
});

describe("the prep list", () => {
  it("rounds up to whole batches and says both figures", () => {
    // A 1.000 g batch cannot be made 2,4 times.
    const state = {
      products: [product("stock")],
      subRecipes: [sub("Sauce", [line({ productId: "stock", nettQty: 1000 })], 1000)],
      recipes: [recipe("Dish", [line({ subRecipeId: "Sauce", nettQty: 240 })])],
    };
    const plan = planProduction([{ recipeId: "Dish", covers: 10 }], state);
    expect(plan.prep[0].quantityNeeded).toBe(2400);
    expect(plan.prep[0].batches).toBe(3);
    expect(plan.prep[0].quantityMade).toBe(3000);
  });

  it("pulls ingredients for the batches made, not the quantity needed", () => {
    // Pulling 2.400 g when three batches will be made leaves the cook short.
    const state = {
      products: [product("stock")],
      subRecipes: [sub("Sauce", [line({ productId: "stock", nettQty: 1000 })], 1000)],
      recipes: [recipe("Dish", [line({ subRecipeId: "Sauce", nettQty: 240 })])],
    };
    const plan = planProduction([{ recipeId: "Dish", covers: 10 }], state);
    expect(plan.pull[0].grossQty).toBe(3000);
  });

  it("makes the deepest preparation first", () => {
    const state = {
      products: [product("bone")],
      subRecipes: [
        sub("Stock", [line({ productId: "bone", nettQty: 1000 })], 1000),
        sub("Jus", [line({ subRecipeId: "Stock", nettQty: 1000 })], 1000),
      ],
      recipes: [recipe("Dish", [line({ subRecipeId: "Jus", nettQty: 100 })])],
    };
    const plan = planProduction([{ recipeId: "Dish", covers: 10 }], state);
    expect(plan.prep.map((p) => p.subRecipe.name)).toEqual(["Stock", "Jus"]);
  });

  it("totals a preparation across every dish before expanding it", () => {
    /*
     * The ordering trap. "Stock" is used straight by one dish and nested
     * inside "Jus" for another. Expanding it when first seen would use only
     * the first dish's share and pull a fraction of the bones.
     */
    const state = {
      products: [product("bone")],
      subRecipes: [
        sub("Stock", [line({ productId: "bone", nettQty: 1000 })], 1000),
        sub("Jus", [line({ subRecipeId: "Stock", nettQty: 1000 })], 1000),
      ],
      recipes: [
        recipe("Soup", [line({ subRecipeId: "Stock", nettQty: 1000 })]),
        recipe("Steak", [line({ subRecipeId: "Jus", nettQty: 1000 })]),
      ],
    };
    const plan = planProduction(
      [{ recipeId: "Soup", covers: 1 }, { recipeId: "Steak", covers: 1 }],
      state,
    );
    const stock = plan.prep.find((p) => p.subRecipe.name === "Stock")!;
    // 1.000 g straight to the soup, plus 1.000 g through one batch of Jus.
    expect(stock.quantityNeeded).toBe(2000);
    expect(stock.batches).toBe(2);
    expect(plan.pull[0].grossQty).toBe(2000);
  });

  it("names what drove each preparation", () => {
    const state = {
      products: [product("bone")],
      subRecipes: [sub("Stock", [line({ productId: "bone" })], 1000)],
      recipes: [
        recipe("Soup", [line({ subRecipeId: "Stock", nettQty: 100 })]),
        recipe("Steak", [line({ subRecipeId: "Stock", nettQty: 100 })]),
      ],
    };
    const plan = planProduction(
      [{ recipeId: "Soup", covers: 1 }, { recipeId: "Steak", covers: 1 }],
      state,
    );
    expect(plan.prep[0].drivenBy).toEqual(["Soup", "Steak"]);
  });
});

describe("when the data is broken", () => {
  it("reports a preparation with no batch yield instead of dividing by zero", () => {
    const state = {
      products: [product("x")],
      subRecipes: [sub("Broken", [line({ productId: "x" })], 0)],
      recipes: [recipe("Dish", [line({ subRecipeId: "Broken", nettQty: 100 })])],
    };
    const plan = planProduction([{ recipeId: "Dish", covers: 1 }], state);
    expect(plan.problems[0]).toMatch(/no batch yield/);
    expect(plan.prep[0].batches).toBe(0);
  });

  it("reports a missing ingredient rather than dropping it silently", () => {
    const state = {
      products: [],
      subRecipes: [],
      recipes: [recipe("Dish", [line({ productId: "gone" })])],
    };
    expect(planProduction([{ recipeId: "Dish", covers: 1 }], state).problems[0]).toMatch(
      /no longer exists/,
    );
  });

  it("does not hang on a preparation used inside itself", () => {
    const state = {
      products: [product("x")],
      subRecipes: [
        sub("A", [line({ productId: "x" }), line({ subRecipeId: "B" })], 1000),
        sub("B", [line({ subRecipeId: "A" })], 1000),
      ],
      recipes: [recipe("Dish", [line({ subRecipeId: "A", nettQty: 100 })])],
    };
    const started = Date.now();
    const plan = planProduction([{ recipeId: "Dish", covers: 1 }], state);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(plan.problems.some((p) => /used inside itself/.test(p))).toBe(true);
  });

  it("plans nothing from an empty sheet without reporting a problem", () => {
    const plan = planProduction([], { products: [], subRecipes: [], recipes: [] });
    expect(plan.prep).toEqual([]);
    expect(plan.pull).toEqual([]);
    expect(plan.problems).toEqual([]);
    expect(plan.totalCost).toBe("0.00");
  });
});
