import { describe, it, expect } from "vitest";
import type { Recipe } from "@ccos/shared";
import { EMPTY_PREPARATION } from "@ccos/shared";
import { parseSalesMix } from "./sales-mix";

/**
 * Sales mix import.
 *
 * The fixtures here mirror the shape of a real POS export, which is not one
 * table but a dozen stacked in a single sheet: a page of financial summaries,
 * then the item list, then a payment breakdown, each separated by a blank row.
 * Several of the summaries also carry a "Name" column beside a "Count" column,
 * and reading one of those instead of the item list is the failure this file
 * mostly exists to prevent.
 */

const dish = (name: string): Recipe =>
  ({
    id: `id-${name}`, name, category: "T", status: "ACTUAL", ingredientLines: [],
    portion: { yieldQty: 1, yieldUnit: "por" },
    pricing: { menuPrice: "100000", priceInclTax: "0", totalCost: "30000", wasteAmount: "0", inflationAmount: "0", totalCog: "30000", grossProfit: "0", grossProfitPercent: 0, foodCostPercent: 0, currency: "IDR" },
    wastePercent: 0, inflationPercent: 0, taxPercent: 21,
    nutritionPerPortion: { fatG: 0, carbsG: 0, proteinG: 0, vitAMg: 0, vitCMg: 0, calciumMg: 0, ironMg: 0, sodiumMg: 0, kcal: 0 },
    allergens: [], preparation: EMPTY_PREPARATION,
    dietaryFlags: { glutenFree: true, dairyFree: true, vegetarian: false, vegan: false, nutsFree: true, soyFree: true, sulfitesFree: true },
    version: 1, createdAt: "", updatedAt: "",
  }) as Recipe;

const catalogue = [dish("Lomo de Res"), dish("Guacamole")];

/** A summary table of the kind that sits above the item list. */
const SUMMARY = [
  ["Business Dates", "4/1/2025 - 4/30/2025"],
  [""],
  ["Run Checks Topic Report"],
  ["Name", "Count", "Amount"],
  ["Checks Begun", "3219", "430651.25"],
  ["Checks Paid", "3219", "429985.25"],
  [""],
];

const ITEMS = [
  ["Name", "Quantity Sold", "Gross Sales", "Sales Less Item Discounts"],
  ["Total", "25955", "482135.01", "377303"],
  ["Food (1)", "4476", "119031.55", "86169.51"],
  ["Carne y Ave", "487", "20568.79", "14122.41"],
  ["Lomo de Res", "295", "13935.19", "9572.17"],
  ["Bibo", "334", "5460.96", "3728.46"],
  ["Guacamole", "334", "5460.96", "3728.46"],
];

const TRAILING = [
  [""],
  ["Run Tender Media Topic Report"],
  ["Tender Type", "Payment Total", "Count"],
  ["Master Cards", "132495.75", "869"],
];

describe("finding the item table", () => {
  it("passes over a summary table that also has a name and a count", () => {
    // Taking the first header-looking row reads cheque counts as a sales mix.
    const result = parseSalesMix([...SUMMARY, ...ITEMS], catalogue);
    expect(result.matchedOn).toEqual({
      name: "Name",
      units: "Quantity Sold",
      net: "Sales Less Item Discounts",
    });
    expect(result.lines.map((l) => l.recipe.name).sort()).toEqual([
      "Guacamole",
      "Lomo de Res",
    ]);
  });

  it("stops at the blank row that ends the table", () => {
    const result = parseSalesMix([...SUMMARY, ...ITEMS, ...TRAILING], catalogue);
    expect(result.skipped.map((s) => s.name)).not.toContain("Master Cards");
    expect(result.problems).toEqual([]);
  });

  it("still works when the item table is the only one in the file", () => {
    expect(parseSalesMix(ITEMS, catalogue).lines).toHaveLength(2);
  });

  it("accepts a file with no net sales column", () => {
    const result = parseSalesMix(
      [["Item", "Units Sold"], ["Lomo de Res", "295"]],
      catalogue,
    );
    expect(result.matchedOn!.net).toBeNull();
    expect(result.lines[0].netSales).toBeNull();
  });

  it("refuses a file whose columns it cannot identify", () => {
    const result = parseSalesMix([["Foo", "Bar"], ["Lomo de Res", "1"]], catalogue);
    expect(result.lines).toEqual([]);
    expect(result.matchedOn).toBeNull();
    expect(result.problems[0].reason).toMatch(/Could not find/);
  });

  it("reports a file with headers and nothing else", () => {
    expect(parseSalesMix([ITEMS[0]], catalogue).problems[0].reason).toMatch(
      /no data rows/,
    );
  });
});

describe("category rows", () => {
  it("does not import a category heading as a dish", () => {
    /*
     * "Carne y Ave" carries the total of the dishes beneath it. Importing it
     * would count those sales twice. It is filtered out by simply not being
     * the name of anything this kitchen cooks.
     */
    const result = parseSalesMix([...SUMMARY, ...ITEMS], catalogue);
    const skipped = result.skipped.map((s) => s.name);
    expect(skipped).toContain("Carne y Ave");
    expect(skipped).toContain("Food (1)");
    expect(skipped).toContain("Total");
  });

  it("lists what it skipped, biggest first, so a missed dish is visible", () => {
    // This list is the only check that a real dish was not silently dropped.
    const result = parseSalesMix([...SUMMARY, ...ITEMS], catalogue);
    expect(result.skipped[0]).toEqual({ name: "Total", unitsSold: 25955 });
  });
});

describe("matching", () => {
  it("matches regardless of case and stray whitespace", () => {
    const result = parseSalesMix(
      [["Name", "Quantity Sold"], ["  lomo  de res ", "10"]],
      catalogue,
    );
    expect(result.lines).toHaveLength(1);
  });

  it("refuses an ambiguous name rather than picking one", () => {
    const twins = [dish("Ceviche"), { ...dish("Ceviche"), id: "other" }];
    const result = parseSalesMix(
      [["Name", "Quantity Sold"], ["Ceviche", "10"]],
      twins,
    );
    expect(result.lines).toEqual([]);
    expect(result.problems[0].reason).toMatch(/share this name/);
  });

  it("reports a dish listed twice rather than adding the two", () => {
    // A POS can list one item under two revenue centres. Which is meant is
    // the operator's call, not a guess.
    const result = parseSalesMix(
      [["Name", "Quantity Sold"], ["Guacamole", "100"], ["Guacamole", "50"]],
      catalogue,
    );
    expect(result.lines).toHaveLength(1);
    expect(result.problems[0].reason).toMatch(/more than once in the file/);
  });
});

describe("reading quantities", () => {
  it("reports an unreadable quantity rather than treating it as zero", () => {
    const result = parseSalesMix(
      [["Name", "Quantity Sold"], ["Lomo de Res", "many"]],
      catalogue,
    );
    expect(result.lines).toEqual([]);
    expect(result.problems[0].reason).toMatch(/Could not read/);
  });

  it("rejects a negative quantity", () => {
    // A refunds column, or the wrong column entirely. Either way not a mix.
    const result = parseSalesMix(
      [["Name", "Quantity Sold"], ["Lomo de Res", "-4"]],
      catalogue,
    );
    expect(result.problems[0].reason).toMatch(/negative/);
  });

  it("keeps a dish that sold none, which is a fact about the month", () => {
    const result = parseSalesMix(
      [["Name", "Quantity Sold"], ["Lomo de Res", "0"]],
      catalogue,
    );
    expect(result.lines[0].unitsSold).toBe(0);
  });

  it("puts the best seller first", () => {
    const result = parseSalesMix(
      [["Name", "Quantity Sold"], ["Lomo de Res", "10"], ["Guacamole", "99"]],
      catalogue,
    );
    expect(result.lines[0].recipe.name).toBe("Guacamole");
  });

  it("numbers problem lines the way the spreadsheet does", () => {
    const result = parseSalesMix([...SUMMARY, ...ITEMS.slice(0, 1), ["Lomo de Res", "x"]], catalogue);
    expect(result.problems[0].line).toBe(9);
  });
});
