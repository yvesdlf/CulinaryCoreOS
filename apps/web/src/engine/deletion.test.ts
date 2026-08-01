import { describe, it, expect } from "vitest";
import type { SubRecipe, Recipe, Collection } from "@ccos/shared";
import { EMPTY_PREPARATION } from "@ccos/shared";
import { canDeleteIngredient, canDeleteRecipe } from "./deletion";

/**
 * Deletion guards.
 *
 * A wrong "yes" here destroys data and leaves dishes costing from a row that
 * no longer exists, so every case below is about the guard refusing when it
 * should — especially through nesting, where the harm is invisible from the
 * thing being deleted.
 */

const line = (l: { productId?: string; subRecipeId?: string }) => ({
  id: `l-${l.productId ?? l.subRecipeId}-${Math.random()}`,
  lineNumber: 1,
  productId: l.productId ?? null,
  subRecipeId: l.subRecipeId ?? null,
  nettQty: 1, nettUnit: "kg", refPercent: 0, grossQty: 1, grossUnit: "kg",
  costPerUnit: "1", lineCost: "1",
});

const sub = (id: string, lines: ReturnType<typeof line>[] = []): SubRecipe =>
  ({
    id, name: id, category: "T", status: "ACTUAL", ingredientLines: lines,
    batchYield: { qty: 1, unit: "kg" }, totalCost: "0", costPerUnit: "0",
    wastePercent: 0, inflationPercent: 0, taxPercent: 21,
    nutritionPer100g: { fatG: 0, carbsG: 0, proteinG: 0, vitAMg: 0, vitCMg: 0, calciumMg: 0, ironMg: 0, sodiumMg: 0, kcal: 0 },
    allergens: [], preparation: EMPTY_PREPARATION,
    version: 1, createdAt: "", updatedAt: "",
  }) as SubRecipe;

const recipe = (id: string, lines: ReturnType<typeof line>[] = []): Recipe =>
  ({
    id, name: id, category: "T", status: "ACTUAL", ingredientLines: lines,
    portion: { yieldQty: 1, yieldUnit: "por" },
    pricing: { menuPrice: "1", priceInclTax: "0", totalCost: "0", wasteAmount: "0", inflationAmount: "0", totalCog: "0", grossProfit: "0", grossProfitPercent: 0, foodCostPercent: 0, currency: "IDR" },
    wastePercent: 0, inflationPercent: 0, taxPercent: 21,
    nutritionPerPortion: { fatG: 0, carbsG: 0, proteinG: 0, vitAMg: 0, vitCMg: 0, calciumMg: 0, ironMg: 0, sodiumMg: 0, kcal: 0 },
    allergens: [], preparation: EMPTY_PREPARATION,
    dietaryFlags: { glutenFree: true, dairyFree: true, vegetarian: false, vegan: false, nutsFree: true, soyFree: true, sulfitesFree: true },
    version: 1, createdAt: "", updatedAt: "",
  }) as Recipe;

const collection = (id: string, recipeIds: string[]): Collection => ({
  id, name: id, description: null, recipeIds, createdAt: "", updatedAt: "",
});

describe("ingredients", () => {
  it("allows deleting something nothing uses", () => {
    const v = canDeleteIngredient("orphan", { subRecipes: [], recipes: [] });
    expect(v.canDelete).toBe(true);
    expect(v.reason).toMatch(/Nothing depends on this/);
  });

  it("refuses when a dish uses it directly", () => {
    const v = canDeleteIngredient("flour", {
      subRecipes: [],
      recipes: [recipe("Pizza", [line({ productId: "flour" })])],
    });
    expect(v.canDelete).toBe(false);
    expect(v.blockers.map((b) => b.name)).toEqual(["Pizza"]);
  });

  it("refuses through nesting, where the harm is invisible from the thing deleted", () => {
    // Deleting flour breaks the dough, and the pizza built on the dough — and
    // only the pizza is on a menu.
    const v = canDeleteIngredient("flour", {
      subRecipes: [sub("Dough", [line({ productId: "flour" })])],
      recipes: [recipe("Pizza", [line({ subRecipeId: "Dough" })])],
    });
    expect(v.canDelete).toBe(false);
    expect(v.blockers.map((b) => b.kind).sort()).toEqual(["recipe", "sub-recipe"]);
    expect(v.reason).toMatch(/1 preparation and 1 dish/);
  });

  it("does not count a preparation as blocking itself", () => {
    // Asking about a sub-recipe includes it in the dependency walk; "used by
    // itself" is noise that would make every preparation undeletable.
    const s = sub("Dough", [line({ productId: "flour" })]);
    const v = canDeleteIngredient("Dough", { subRecipes: [s], recipes: [] });
    expect(v.blockers.find((b) => b.id === "Dough")).toBeUndefined();
    expect(v.canDelete).toBe(true);
  });

  it("names its blockers, so the dialog can say what is in the way", () => {
    const v = canDeleteIngredient("flour", {
      subRecipes: [sub("Dough", [line({ productId: "flour" })])],
      recipes: [recipe("Pizza", [line({ subRecipeId: "Dough" })])],
    });
    expect(v.blockers.map((b) => b.name).sort()).toEqual(["Dough", "Pizza"]);
  });

  it("survives a cycle instead of hanging", () => {
    const subRecipes = [
      sub("A", [line({ productId: "x" }), line({ subRecipeId: "B" })]),
      sub("B", [line({ subRecipeId: "A" })]),
    ];
    const started = Date.now();
    const v = canDeleteIngredient("x", { subRecipes, recipes: [] });
    expect(Date.now() - started).toBeLessThan(1000);
    expect(v.canDelete).toBe(false);
  });
});

describe("dishes", () => {
  it("allows deleting a dish in no collection", () => {
    expect(canDeleteRecipe("Pizza", []).canDelete).toBe(true);
  });

  it("refuses while a printed pack contains it", () => {
    // Softer than a costing dependency, but it is still someone's pack.
    const v = canDeleteRecipe("Pizza", [collection("Sunset pack", ["Pizza"])]);
    expect(v.canDelete).toBe(false);
    expect(v.blockers[0].kind).toBe("collection");
    expect(v.reason).toMatch(/1 collection/);
  });

  it("ignores collections that do not contain it", () => {
    expect(
      canDeleteRecipe("Pizza", [collection("Other", ["Pasta"])]).canDelete,
    ).toBe(true);
  });
});
