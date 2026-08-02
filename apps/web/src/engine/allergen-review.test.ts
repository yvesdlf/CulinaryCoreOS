import { describe, it, expect } from "vitest";
import type { Product, SubRecipe } from "@ccos/shared";
import { EMPTY_PREPARATION } from "@ccos/shared";
import { findUnverifiedAllergens } from "./allergen-review";

/**
 * Unverified allergen sources.
 *
 * The property that matters is reach: a dish three levels above an unchecked
 * jar of tom yum paste is still the thing on the plate. Everything below tests
 * that the warning gets there, and that it does not get lost or duplicated on
 * the way.
 */

const product = (id: string, review = false, note: string | null = null): Product =>
  ({
    id,
    name: id,
    category: "Test",
    supplier: null,
    brand: null,
    packing: { packQty: 1, packUnit: "kg", unitsPerPack: 1, unitsPerPackUnit: "kg", totalQty: 1, totalUnit: "kg" },
    cost: { buyingPricePerPack: "1", buyingPricePerUnit: "1", grossPricePerUnit: "1", nettPricePerUnit: "1" },
    yield_: { grossQty: 1, grossUnit: "kg", wasteQty: 0, wasteUnit: "kg", nettQty: 1, nettUnit: "kg", refPercent: 0, yieldPercent: 100 },
    status: "ACTIVE",
    nutrition: { fatG: 0, carbsG: 0, proteinG: 0, vitAMg: 0, vitCMg: 0, calciumMg: 0, ironMg: 0, sodiumMg: 0, kcal: 0 },
    allergens: [],
    allergensNeedReview: review,
    version: 1,
    allergenReviewNote: note,
    createdAt: "",
    updatedAt: "",
  }) as Product;

const sub = (id: string, lines: { productId?: string; subRecipeId?: string }[]): SubRecipe =>
  ({
    id,
    name: id,
    category: "Test",
    status: "ACTUAL",
    ingredientLines: lines.map((l, i) => ({
      id: `${id}-${i}`,
      lineNumber: i + 1,
      productId: l.productId ?? null,
      subRecipeId: l.subRecipeId ?? null,
      nettQty: 1, nettUnit: "kg", refPercent: 0, grossQty: 1, grossUnit: "kg",
      costPerUnit: "1", lineCost: "1",
    })),
    batchYield: { qty: 1, unit: "kg" },
    totalCost: "0", costPerUnit: "0",
    wastePercent: 0, inflationPercent: 0, taxPercent: 21,
    nutritionPer100g: { fatG: 0, carbsG: 0, proteinG: 0, vitAMg: 0, vitCMg: 0, calciumMg: 0, ironMg: 0, sodiumMg: 0, kcal: 0 },
    allergens: [],
    preparation: EMPTY_PREPARATION,
    version: 1, createdAt: "", updatedAt: "",
  }) as SubRecipe;

const line = (l: { productId?: string; subRecipeId?: string }) => ({
  productId: l.productId ?? null,
  subRecipeId: l.subRecipeId ?? null,
});

describe("finding unverified ingredients", () => {
  it("finds one used directly", () => {
    const out = findUnverifiedAllergens([line({ productId: "tom-yum" })], {
      products: [product("tom-yum", true, "check for shrimp paste")],
      subRecipes: [],
    });
    expect(out).toHaveLength(1);
    expect(out[0].note).toBe("check for shrimp paste");
    expect(out[0].via).toEqual([]);
  });

  it("reaches through nested preparations and says how", () => {
    // The plate reaching an allergic guest is the dish, not the sauce.
    const products = [product("kimchi", true), product("salt")];
    const subRecipes = [
      sub("Kimchi Mayo", [{ productId: "kimchi" }]),
      sub("Burger Sauce", [{ subRecipeId: "Kimchi Mayo" }, { productId: "salt" }]),
    ];
    const out = findUnverifiedAllergens([line({ subRecipeId: "Burger Sauce" })], {
      products,
      subRecipes,
    });
    expect(out).toHaveLength(1);
    expect(out[0].productName).toBe("kimchi");
    expect(out[0].via).toEqual(["Burger Sauce", "Kimchi Mayo"]);
  });

  it("says nothing when everything has been checked", () => {
    const out = findUnverifiedAllergens([line({ productId: "salt" })], {
      products: [product("salt")],
      subRecipes: [],
    });
    expect(out).toEqual([]);
  });

  it("reports a shared ingredient once, not once per path", () => {
    const products = [product("paste", true)];
    const subRecipes = [
      sub("A", [{ productId: "paste" }]),
      sub("B", [{ productId: "paste" }]),
    ];
    const out = findUnverifiedAllergens(
      [line({ subRecipeId: "A" }), line({ subRecipeId: "B" }), line({ productId: "paste" })],
      { products, subRecipes },
    );
    expect(out).toHaveLength(1);
  });

  it("terminates on a cycle instead of hanging the tab", () => {
    const products = [product("paste", true)];
    const subRecipes = [
      sub("A", [{ subRecipeId: "B" }, { productId: "paste" }]),
      sub("B", [{ subRecipeId: "A" }]),
    ];
    const started = Date.now();
    const out = findUnverifiedAllergens([line({ subRecipeId: "A" })], {
      products,
      subRecipes,
    });
    expect(Date.now() - started).toBeLessThan(1000);
    expect(out).toHaveLength(1);
  });

  it("ignores a reference it cannot resolve rather than throwing", () => {
    const out = findUnverifiedAllergens(
      [line({ productId: "deleted" }), line({ subRecipeId: "gone" })],
      { products: [], subRecipes: [] },
    );
    expect(out).toEqual([]);
  });

  it("is stable in order, so the same dish reads the same way twice", () => {
    const products = [product("zebra", true), product("apple", true)];
    const lines = [line({ productId: "zebra" }), line({ productId: "apple" })];
    const out = findUnverifiedAllergens(lines, { products, subRecipes: [] });
    expect(out.map((r) => r.productName)).toEqual(["apple", "zebra"]);
  });
});
