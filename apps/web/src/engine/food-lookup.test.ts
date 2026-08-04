import { describe, it, expect } from "vitest";
import {
  findFoodMatches, suggestForProduct, REFERENCE_FOODS,
} from "./food-lookup";

/**
 * Food lookup.
 *
 * The failures worth guarding are the ones that would put a wrong number or a
 * wrong allergen on a product without anybody noticing: a weak match accepted
 * as an answer, an allergen offered as verified, and a free-from claim
 * manufactured out of a name.
 */

describe("findFoodMatches", () => {
  it("finds the food inside a kitchen's own naming", () => {
    const [top] = findFoodMatches("Heirloom Tomato Island Organic");
    expect(top.food.name).toBe("Tomato");
  });

  it("matches Indonesian names, which is what the catalogue is full of", () => {
    expect(findFoodMatches("Bawang Putih")[0].food.name).toBe("Garlic");
    expect(findFoodMatches("Telur Ayam Kampung")[0].food.name).toBe("Egg, hen");
    expect(findFoodMatches("Minyak Zaitun")[0].food.name).toBe("Olive oil");
  });

  it("scores an exact name above a name that merely contains it", () => {
    const exact = findFoodMatches("Tomato")[0];
    // "Tomato Cherry" is itself an alias, so it is also exact. Ketchup is the
    // real partial: a product that contains the word without being the food.
    const partial = findFoodMatches("Tomato Ketchup Bottle")[0];
    expect(exact.food.name).toBe("Tomato");
    expect(exact.score).toBe(1);
    expect(exact.score).toBeGreaterThan(partial.score);
  });

  it("ignores packaging and grading words", () => {
    // Without stop words, "Fresh Organic Large" would dominate the tokens.
    const [top] = findFoodMatches("Fresh Organic Large Avocado 1 kg");
    expect(top.food.name).toBe("Avocado");
    expect(top.score).toBeGreaterThan(0.5);
  });

  it("returns nothing for a name with no food in it", () => {
    expect(findFoodMatches("Blue Roll 2ply")).toEqual([]);
    expect(findFoodMatches("")).toEqual([]);
    expect(findFoodMatches("   ")).toEqual([]);
  });

  it("explains itself by naming what it matched on", () => {
    const [top] = findFoodMatches("Kecap Asin");
    expect(top.food.name).toBe("Soy sauce");
    expect(top.matchedOn).toBe("kecap asin");
  });
});

describe("suggestForProduct", () => {
  it("offers the composition and the allergens together", () => {
    const s = suggestForProduct("Unsalted Butter");
    expect(s).not.toBeNull();
    expect(s!.source).toBe("Butter");
    expect(s!.nutrition.kcal).toBe(717);
    expect(s!.allergens).toEqual(["EU14_MILK"]);
  });

  it("always marks an allergen suggestion as needing review", () => {
    // The dangerous failure is a confident allergen list, not a missing one.
    // Every suggestion is a prompt to read a label.
    for (const name of ["Butter", "Prawn", "Soy Sauce", "Almond Flour"]) {
      const s = suggestForProduct(name);
      expect(s!.needsReview).toBe(true);
    }
  });

  it("refuses a weak match rather than shrugging one through", () => {
    // "Salted Caramel Sauce" must not come back as Salt, which would record
    // 38 g of sodium per 100 g against a dessert sauce.
    const s = suggestForProduct("Salted Caramel Sauce");
    expect(s === null || s.source !== "Salt").toBe(true);
  });

  it("returns null rather than a low-confidence guess", () => {
    expect(suggestForProduct("Blue Roll 2ply")).toBeNull();
    expect(suggestForProduct("Chafing Fuel Gel")).toBeNull();
  });

  it("carries trim loss where the food has one", () => {
    expect(suggestForProduct("Pineapple")!.refPercent).toBe(48);
    // And null rather than 0 where it does not, so "unknown" and "no waste"
    // stay distinguishable.
    expect(suggestForProduct("Caster Sugar")!.refPercent).toBeNull();
  });

  it("suggests soy sauce as both soy and gluten", () => {
    // Brewed soy sauce is wheat-based, which is the classic allergen that gets
    // missed because the name does not say so.
    const s = suggestForProduct("Soy Sauce");
    expect(s!.allergens).toContain("EU14_SOYBEANS");
    expect(s!.allergens).toContain("EU14_GLUTEN_CEREALS");
  });

  it("gives a copy, so accepting one product cannot mutate the table", () => {
    const a = suggestForProduct("Butter")!;
    a.allergens.push("EU14_PEANUTS");
    a.nutrition.kcal = 1;
    const b = suggestForProduct("Butter")!;
    expect(b.allergens).toEqual(["EU14_MILK"]);
    expect(b.nutrition.kcal).toBe(717);
  });
});

describe("the reference table itself", () => {
  it("uses allergen ids the registry actually defines", () => {
    // A typo here would silently drop an allergen from every product that
    // takes its suggestion.
    const known = new Set([
      "EU14_CELERY", "EU14_GLUTEN_CEREALS", "EU14_CRUSTACEANS", "EU14_EGGS",
      "EU14_FISH", "EU14_LUPIN", "EU14_MILK", "EU14_MOLLUSCS", "EU14_MUSTARD",
      "EU14_PEANUTS", "EU14_SESAME", "EU14_SOYBEANS", "EU14_SULPHITES",
      "EU14_TREE_NUTS",
    ]);
    for (const food of REFERENCE_FOODS) {
      for (const a of food.allergens) {
        expect(known.has(a), `${food.name} declares unknown allergen ${a}`).toBe(true);
      }
    }
  });

  it("declares milk on every dairy entry", () => {
    for (const food of REFERENCE_FOODS.filter((f) => f.group === "Dairy")) {
      expect(food.allergens, food.name).toContain("EU14_MILK");
    }
  });

  it("has no duplicate canonical names", () => {
    const names = REFERENCE_FOODS.map((f) => f.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
  });

  it("keeps every energy figure consistent with its macronutrients", () => {
    // 4 kcal a gram for protein and carbohydrate, 9 for fat. A figure far off
    // that is a transcription error, and this catches the digit-drop that
    // would otherwise sit in the table unnoticed. Alcoholic entries are
    // excluded because ethanol carries energy the macros do not account for.
    for (const f of REFERENCE_FOODS.filter((x) => !x.alcoholic)) {
      const { kcal, proteinG, fatG, carbsG } = f.nutrition;
      const derived = proteinG * 4 + carbsG * 4 + fatG * 9;
      if (kcal === 0 && derived === 0) continue;
      // Generous: fibre, polyols and alcohol all break the simple sum.
      expect(Math.abs(derived - kcal), `${f.name}: ${derived} vs ${kcal}`)
        .toBeLessThan(Math.max(60, kcal * 0.35));
    }
  });
});
