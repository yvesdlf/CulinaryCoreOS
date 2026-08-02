import { describe, it, expect } from "vitest";
import type { Recipe } from "@ccos/shared";
import { EMPTY_PREPARATION } from "@ccos/shared";
import { engineerMenu } from "./menu-engineering";

/**
 * Menu engineering.
 *
 * The classification decides what a chef takes off the menu, so the tests are
 * about the two conventions that drive it: contribution in money rather than
 * food cost percentage, and the 70% popularity rule rather than a plain
 * average.
 */

const dish = (name: string, price: string, cog: string): Recipe =>
  ({
    id: name, name, category: "T", status: "ACTUAL", ingredientLines: [],
    portion: { yieldQty: 1, yieldUnit: "por" },
    pricing: {
      menuPrice: price, priceInclTax: "0", totalCost: cog, wasteAmount: "0",
      inflationAmount: "0", totalCog: cog, grossProfit: "0",
      grossProfitPercent: 0, foodCostPercent: 0, currency: "IDR",
    },
    wastePercent: 0, inflationPercent: 0, taxPercent: 21,
    nutritionPerPortion: { fatG: 0, carbsG: 0, proteinG: 0, vitAMg: 0, vitCMg: 0, calciumMg: 0, ironMg: 0, sodiumMg: 0, kcal: 0 },
    allergens: [], preparation: EMPTY_PREPARATION,
    dietaryFlags: { glutenFree: true, dairyFree: true, vegetarian: false, vegan: false, nutsFree: true, soyFree: true, sulfitesFree: true },
    version: 1, createdAt: "", updatedAt: "",
  }) as Recipe;

const find = (m: ReturnType<typeof engineerMenu>, name: string) =>
  m.dishes.find((d) => d.recipe.name === name)!;

describe("classification", () => {
  /*
   * Four dishes, one per quadrant. Total 200 units, so an equal share is 25%
   * and the popularity line sits at 17,5%.
   */
  const menu = engineerMenu([
    { recipe: dish("Sells and pays", "100000", "30000"), unitsSold: 80 },
    { recipe: dish("Sells, thin", "40000", "30000"), unitsSold: 80 },
    { recipe: dish("Pays, ignored", "200000", "60000"), unitsSold: 20 },
    { recipe: dish("Neither", "30000", "22000"), unitsSold: 20 },
  ]);

  it("calls a dish that sells well and pays well a star", () => {
    expect(find(menu, "Sells and pays").classification).toBe("star");
  });

  it("calls a popular thin dish a plowhorse", () => {
    expect(find(menu, "Sells, thin").classification).toBe("plowhorse");
  });

  it("calls a profitable dish nobody orders a puzzle", () => {
    expect(find(menu, "Pays, ignored").classification).toBe("puzzle");
  });

  it("calls a dish that neither sells nor pays a dog", () => {
    expect(find(menu, "Neither").classification).toBe("dog");
  });

  it("counts each quadrant", () => {
    expect(menu.counts).toEqual({ star: 1, plowhorse: 1, puzzle: 1, dog: 1 });
  });
});

describe("profitability is money, not percentage", () => {
  it("prefers the plate that contributes more, even at a worse food cost", () => {
    /*
     * The expensive dish runs at 35% food cost and the cheap one at 20%, but
     * the expensive one puts 130.000 in the till per plate against 40.000.
     * Ranking on percentage would call the wrong one profitable.
     */
    const menu = engineerMenu([
      { recipe: dish("Expensive", "200000", "70000"), unitsSold: 50 },
      { recipe: dish("Cheap", "50000", "10000"), unitsSold: 50 },
    ]);
    expect(find(menu, "Expensive").profitable).toBe(true);
    expect(find(menu, "Cheap").profitable).toBe(false);
    expect(find(menu, "Expensive").foodCostPercent).toBeCloseTo(35, 5);
    expect(find(menu, "Cheap").foodCostPercent).toBeCloseTo(20, 5);
  });

  it("weights the line by units, so the volume seller sets it", () => {
    /*
     * A plain average of the two margins would put the line at 2.480.000 —
     * a number no dish on this menu is near. Weighting by units puts it at
     * 64.840, which is within 8% of what the dish selling 999 plates makes.
     */
    const menu = engineerMenu([
      { recipe: dish("Everyday", "100000", "40000"), unitsSold: 999 },
      { recipe: dish("Once", "5000000", "100000"), unitsSold: 1 },
    ]);
    expect(menu.averageContribution).toBe("64840.00");
    expect(Number(menu.averageContribution)).toBeLessThan(2_480_000);
  });
});

describe("the popularity line", () => {
  it("sits at 70% of an equal share", () => {
    const menu = engineerMenu([
      { recipe: dish("A", "100", "50"), unitsSold: 1 },
      { recipe: dish("B", "100", "50"), unitsSold: 1 },
      { recipe: dish("C", "100", "50"), unitsSold: 1 },
      { recipe: dish("D", "100", "50"), unitsSold: 1 },
    ]);
    // Four dishes: an equal share is 25%, so the line is at 17,5%.
    expect(menu.popularityThresholdPercent).toBeCloseTo(17.5, 5);
  });

  it("does not push half an evenly selling menu below the line", () => {
    // A plain average would call two of these four unpopular by construction.
    const menu = engineerMenu([
      { recipe: dish("A", "100", "50"), unitsSold: 25 },
      { recipe: dish("B", "100", "50"), unitsSold: 25 },
      { recipe: dish("C", "100", "50"), unitsSold: 25 },
      { recipe: dish("D", "100", "50"), unitsSold: 25 },
    ]);
    expect(menu.dishes.every((d) => d.popular)).toBe(true);
    expect(menu.counts.star).toBe(4);
  });
});

describe("edges", () => {
  it("ignores a dish that sold nothing rather than calling it a dog", () => {
    // Not on the menu that month is a different fact from selling badly.
    const menu = engineerMenu([
      { recipe: dish("Sold", "100", "50"), unitsSold: 10 },
      { recipe: dish("Never on", "100", "50"), unitsSold: 0 },
    ]);
    expect(menu.dishes).toHaveLength(1);
    expect(menu.totalUnits).toBe(10);
  });

  it("returns an empty analysis rather than dividing by zero", () => {
    const menu = engineerMenu([]);
    expect(menu.dishes).toEqual([]);
    expect(menu.averageContribution).toBe("0.00");
    expect(menu.totalContribution).toBe("0.00");
  });

  it("handles a dish sold below cost without breaking the arithmetic", () => {
    const menu = engineerMenu([
      { recipe: dish("Loss leader", "20000", "35000"), unitsSold: 100 },
      { recipe: dish("Earner", "100000", "30000"), unitsSold: 100 },
    ]);
    expect(find(menu, "Loss leader").contributionMargin).toBe("-15000.00");
    expect(find(menu, "Loss leader").classification).toBe("plowhorse");
    expect(menu.totalContribution).toBe("5500000.00");
  });

  it("puts the biggest total contribution first", () => {
    const menu = engineerMenu([
      { recipe: dish("Small margin, huge volume", "60000", "40000"), unitsSold: 500 },
      { recipe: dish("Big margin, low volume", "300000", "100000"), unitsSold: 10 },
    ]);
    expect(menu.dishes[0].recipe.name).toBe("Small margin, huge volume");
  });

  it("treats a free dish as zero food cost percent, not infinity", () => {
    const menu = engineerMenu([
      { recipe: dish("Comp", "0", "20000"), unitsSold: 5 },
    ]);
    expect(find(menu, "Comp").foodCostPercent).toBe(0);
  });
});
