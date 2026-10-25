import { describe, it, expect } from "vitest";
import { parsedRecipeToRows, extractionConcerns } from "./recipe-rows";
import { planRecipeImport } from "../recipe-import";
import type { ParsedRecipe } from "./tasks";

/**
 * The bridge from an AI extraction to the sheet importer.
 *
 * The case that matters is the last one: an ingredient the model named and
 * the catalogue does not stock has to come out as a *problem*, not as a new
 * product. A model will happily write "saffron threads" for a kitchen that
 * has never bought saffron, and a silently created product arrives with no
 * price, costs the dish nothing, and makes the dish look cheap rather than
 * look wrong.
 */
const recipe = (over: Partial<ParsedRecipe> = {}): ParsedRecipe => ({
  name: "Tomato Soup",
  category: "Starters",
  yieldQty: 4,
  yieldUnit: "portion",
  lines: [
    { ingredient: "Tomato", quantity: 500, unit: "g" },
    { ingredient: "Cream", quantity: 100, unit: "ml" },
  ],
  method: [],
  notes: [],
  ...over,
});

describe("parsedRecipeToRows", () => {
  it("produces the header the sheet importer matches on", () => {
    const rows = parsedRecipeToRows(recipe());
    expect(rows[0]).toEqual(["Recipe", "Category", "Ingredient", "Quantity", "Unit"]);
  });

  it("repeats the dish name down the rows, as a sheet does", () => {
    const rows = parsedRecipeToRows(recipe());
    expect(rows.slice(1).map((r) => r[0])).toEqual(["Tomato Soup", "Tomato Soup"]);
  });

  it("leaves a missing quantity blank rather than writing zero", () => {
    // Zero says the dish uses none of something. A blank is the absence of a
    // figure, and the importer tells them apart.
    const rows = parsedRecipeToRows(
      recipe({ lines: [{ ingredient: "Vinegar", quantity: null, unit: null }] }),
    );
    expect(rows[1][3]).toBe("");
    expect(rows[1][4]).toBe("");
  });
});

describe("extractionConcerns", () => {
  it("carries the model's own notes through", () => {
    const c = extractionConcerns(recipe({ notes: ["The third line was illegible."] }));
    expect(c).toContain("The third line was illegible.");
  });

  it("names a line with no quantity", () => {
    const c = extractionConcerns(
      recipe({ lines: [{ ingredient: "Vinegar", quantity: null, unit: null }] }),
    );
    expect(c).toContain("No quantity was given for Vinegar.");
  });

  it("names a quantity with no unit, which is the guess that is wrong by a thousand", () => {
    const c = extractionConcerns(
      recipe({ lines: [{ ingredient: "Salt", quantity: 5, unit: null }] }),
    );
    expect(c).toContain("No unit was given for Salt.");
  });

  it("says so when nothing was found, rather than returning an empty recipe quietly", () => {
    expect(extractionConcerns(recipe({ lines: [] })))
      .toContain("No ingredients were found in this text at all.");
  });
});

describe("through the importer", () => {
  // The shape the importer reads: cost and packing are nested, which is
  // exactly the kind of thing a second, parallel importer would get subtly
  // wrong and this one cannot, because it is the same code.
  const tomato = {
    id: "p1",
    name: "Tomato",
    cost: { grossPricePerUnit: "4" },
    packing: { totalUnit: "g" },
  } as never;

  it("resolves an ingredient the catalogue has", () => {
    const plan = planRecipeImport(parsedRecipeToRows(recipe()), {
      products: [tomato], subRecipes: [], recipes: [],
    });
    const line = plan.recipes[0]?.lines.find((l) => l.ingredient === "Tomato");
    expect(line?.productId).toBe("p1");
  });

  it("reports an ingredient the catalogue does not have, and never invents it", () => {
    // The whole reason this goes through the sheet importer rather than
    // writing a second path: a model names ingredients a kitchen does not
    // stock, and a silently created product costs the dish nothing.
    const plan = planRecipeImport(parsedRecipeToRows(recipe()), {
      products: [tomato], subRecipes: [], recipes: [],
    });

    // Stronger than "the line has no product": there is no line. The
    // importer drops an unresolved ingredient and records why, so the dish
    // cannot be committed carrying a free ingredient nobody noticed.
    expect(plan.recipes[0]?.lines.map((l) => l.ingredient)).toEqual(["Tomato"]);
    expect(plan.problems.some((p) => p.reason.toLowerCase().includes("cream")))
      .toBe(true);
    expect(plan.problems.some((p) => p.reason.includes("not in the catalogue")))
      .toBe(true);
  });
});
