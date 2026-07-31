import { describe, it, expect } from "vitest";
import { deriveAllergens, deriveDietaryFlags } from "./nutrition-engine";
import { resolveAllergens, allergenNames } from "@/lib/allergens";

/**
 * Allergen inheritance and the free-from claims derived from it.
 *
 * These are the only calculations in the app whose failure mode is medical
 * rather than financial, so the cases below are all about what happens when
 * something is missing, unrecognised, or spelled differently — not the happy
 * path.
 */

const line = (over: { productId?: string; subRecipeId?: string }) => ({
  productId: over.productId ?? null,
  subRecipeId: over.subRecipeId ?? null,
  nettQty: 100,
});

const sources = (
  products: Record<string, string[]>,
  subs: Record<string, string[]> = {},
) => ({
  getProduct: (id: string) =>
    products[id] ? { allergens: products[id] } : undefined,
  getSubRecipe: (id: string) => (subs[id] ? { allergens: subs[id] } : undefined),
});

describe("inheritance", () => {
  it("unions products and sub-recipes", () => {
    const out = deriveAllergens(
      [line({ productId: "flour" }), line({ subRecipeId: "aioli" })],
      sources({ flour: ["EU14_GLUTEN_CEREALS"] }, { aioli: ["EU14_EGGS"] }),
    );
    expect(out).toEqual(["EU14_GLUTEN_CEREALS", "EU14_EGGS"]);
  });

  it("collapses aliases onto one canonical id", () => {
    // Mock data says "dairy", the imported catalogue says EU14_MILK. Showing
    // the same allergen twice reads as two different warnings.
    const out = deriveAllergens(
      [line({ productId: "butter" }), line({ productId: "cream" })],
      sources({ butter: ["dairy"], cream: ["EU14_MILK"] }),
    );
    expect(out).toEqual(["EU14_MILK"]);
  });

  it("keeps a value it cannot map instead of dropping it", () => {
    const out = deriveAllergens(
      [line({ productId: "x" })],
      sources({ x: ["EU14_FISH", "carmine"] }),
    );
    expect(out).toContain("carmine");
  });

  it("is stable in registry order, not insertion order", () => {
    const a = deriveAllergens(
      [line({ productId: "1" }), line({ productId: "2" })],
      sources({ 1: ["EU14_MILK"], 2: ["EU14_CELERY"] }),
    );
    const b = deriveAllergens(
      [line({ productId: "2" }), line({ productId: "1" })],
      sources({ 1: ["EU14_MILK"], 2: ["EU14_CELERY"] }),
    );
    expect(a).toEqual(b);
    expect(a).toEqual(["EU14_CELERY", "EU14_MILK"]);
  });

  it("yields nothing for an ingredient it cannot resolve at all", () => {
    expect(deriveAllergens([line({ productId: "gone" })], sources({}))).toEqual([]);
  });
});

describe("free-from claims", () => {
  it("reads canonical ids, not the alias spellings", () => {
    // Regression: this tested for the literal strings "gluten" and "dairy".
    // Nothing stores those, so all 115 imported dishes claimed to be both
    // gluten-free and dairy-free regardless of what was in them.
    const f = deriveDietaryFlags(["EU14_GLUTEN_CEREALS", "EU14_MILK"]);
    expect(f.glutenFree).toBe(false);
    expect(f.dairyFree).toBe(false);
  });

  it("still honours the alias spellings", () => {
    expect(deriveDietaryFlags(["gluten"]).glutenFree).toBe(false);
    expect(deriveDietaryFlags(["dairy"]).dairyFree).toBe(false);
  });

  it("treats peanuts and tree nuts as both defeating a nut-free claim", () => {
    expect(deriveDietaryFlags(["EU14_PEANUTS"]).nutsFree).toBe(false);
    expect(deriveDietaryFlags(["EU14_TREE_NUTS"]).nutsFree).toBe(false);
  });

  it("asserts every claim on an empty list", () => {
    const f = deriveDietaryFlags([]);
    expect(f).toEqual({
      glutenFree: true, dairyFree: true, nutsFree: true,
      soyFree: true, sulfitesFree: true,
    });
  });

  it("fails every claim closed on an unrecognised declaration", () => {
    // "Free from" asserts an absence. An allergen we cannot identify is
    // exactly the case where absence has not been established, so claiming
    // anything here would be a guess presented as a fact.
    const f = deriveDietaryFlags(["something we do not recognise"]);
    expect(Object.values(f).every((v) => v === false)).toBe(true);
  });

  it("does not let an unrelated allergen defeat a claim", () => {
    expect(deriveDietaryFlags(["EU14_FISH"]).glutenFree).toBe(true);
  });
});

describe("presentation", () => {
  it("never lets a code stand in for the legal name", () => {
    // Appendix G: a code or icon is a compact aid, never a replacement.
    const [milk] = resolveAllergens(["EU14_MILK"]);
    expect(milk.known && milk.definition.code).toBe("MLK");
    expect(milk.known && milk.definition.name).toBe("Milk");
    expect(allergenNames(["EU14_MILK", "carmine"])).toEqual(["Milk", "carmine"]);
  });

  it("distinguishes peanuts from tree nuts despite the shared glyph", () => {
    const [pnt] = resolveAllergens(["EU14_PEANUTS"]);
    const [nut] = resolveAllergens(["EU14_TREE_NUTS"]);
    expect(pnt.known && pnt.definition.code).toBe("PNT");
    expect(nut.known && nut.definition.code).toBe("NUT");
  });
});
