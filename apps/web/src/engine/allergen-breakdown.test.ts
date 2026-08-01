import { describe, it, expect } from "vitest";
import type { Product, SubRecipe } from "@ccos/shared";
import { EMPTY_PREPARATION } from "@ccos/shared";
import { allergenBreakdown } from "./allergen-breakdown";

/**
 * Per-recipe attribution.
 *
 * A dish-level list says the plate is unsafe. This has to say which component
 * to change, so the cases are about the allergen being credited to the right
 * line — especially when it arrives through a preparation.
 */

const product = (id: string, allergens: string[], review = false): Product =>
  ({
    id, name: id, category: "T", supplier: null, brand: null,
    packing: { packQty: 1, packUnit: "KG", unitsPerPack: 1, unitsPerPackUnit: "KG", totalQty: 1, totalUnit: "KG" },
    cost: { buyingPricePerPack: "1", buyingPricePerUnit: "1", grossPricePerUnit: "1", nettPricePerUnit: "1" },
    yield_: { grossQty: 1, grossUnit: "KG", wasteQty: 0, wasteUnit: "KG", nettQty: 1, nettUnit: "KG", refPercent: 0, yieldPercent: 100 },
    status: "ACTIVE",
    nutrition: { fatG: 0, carbsG: 0, proteinG: 0, vitAMg: 0, vitCMg: 0, calciumMg: 0, ironMg: 0, sodiumMg: 0, kcal: 0 },
    allergens,
    preparation: EMPTY_PREPARATION, allergensNeedReview: review, allergenReviewNote: null,
    createdAt: "", updatedAt: "",
  }) as Product;

const sub = (id: string, allergens: string[], inner: { productId?: string; subRecipeId?: string }[]): SubRecipe =>
  ({
    id, name: id, category: "T", status: "ACTUAL",
    ingredientLines: inner.map((l, i) => ({
      id: `${id}-${i}`, lineNumber: i + 1,
      productId: l.productId ?? null, subRecipeId: l.subRecipeId ?? null,
      nettQty: 1, nettUnit: "KG", refPercent: 0, grossQty: 1, grossUnit: "KG",
      costPerUnit: "1", lineCost: "1",
    })),
    batchYield: { qty: 1, unit: "KG" }, totalCost: "0", costPerUnit: "0",
    wastePercent: 0, inflationPercent: 0, taxPercent: 21,
    nutritionPer100g: { fatG: 0, carbsG: 0, proteinG: 0, vitAMg: 0, vitCMg: 0, calciumMg: 0, ironMg: 0, sodiumMg: 0, kcal: 0 },
    allergens,
    preparation: EMPTY_PREPARATION, version: 1, createdAt: "", updatedAt: "",
  }) as SubRecipe;

const line = (l: { productId?: string; subRecipeId?: string }) => ({
  productId: l.productId ?? null,
  subRecipeId: l.subRecipeId ?? null,
});

describe("attribution", () => {
  const products = [
    product("flour", ["EU14_GLUTEN_CEREALS"]),
    product("butter", ["dairy"]),
    product("salt", []),
  ];
  const subRecipes = [sub("Roux", ["EU14_GLUTEN_CEREALS", "EU14_MILK"], [{ productId: "flour" }, { productId: "butter" }])];

  it("credits an allergen to the ingredient that carries it", () => {
    const out = allergenBreakdown([line({ productId: "flour" })], { products, subRecipes });
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("flour");
    expect(out[0].allergens).toEqual(["EU14_GLUTEN_CEREALS"]);
  });

  it("names what inside a preparation brings it", () => {
    // "The gluten is in the roux, and the roux's flour is why."
    const out = allergenBreakdown([line({ subRecipeId: "Roux" })], { products, subRecipes });
    expect(out[0].kind).toBe("sub-recipe");
    expect(out[0].via.map((v) => v.name)).toEqual(["flour", "butter"]);
  });

  it("canonicalises, so an alias does not read as a separate allergen", () => {
    const out = allergenBreakdown([line({ productId: "butter" })], { products, subRecipes });
    expect(out[0].allergens).toEqual(["EU14_MILK"]);
  });

  it("omits lines that carry nothing, so the ones that matter stay visible", () => {
    const out = allergenBreakdown(
      [line({ productId: "salt" }), line({ productId: "flour" })],
      { products, subRecipes },
    );
    expect(out).toHaveLength(1);
  });

  it("keeps an unverified ingredient even with no allergens declared", () => {
    // Nothing declared and nobody checked is exactly what must not vanish.
    const withReview = [...products, product("paste", [], true)];
    const out = allergenBreakdown([line({ productId: "paste" })], {
      products: withReview,
      subRecipes,
    });
    expect(out).toHaveLength(1);
    expect(out[0].needsReview).toBe(true);
  });

  it("ignores a reference it cannot resolve rather than throwing", () => {
    expect(
      allergenBreakdown([line({ productId: "gone" }), line({ subRecipeId: "gone" })], {
        products,
        subRecipes,
      }),
    ).toEqual([]);
  });
});
