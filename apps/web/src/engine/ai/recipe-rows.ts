// ---------------------------------------------------------------------------
// From what the model read to what the importer already understands
// ---------------------------------------------------------------------------
// The AI half of recipe import is a bridge, not a second importer, and that
// is the whole design.
//
// `recipeParseRequest` and `parseRecipeResponse` turn prose — a recipe card,
// a paste from a website, a photograph — into a `ParsedRecipe`. This turns
// that into the rows `planRecipeImport` has taken since the sheet importer
// was written. Everything downstream is then shared: the column matching, the
// cost arithmetic, the duplicate-dish detection, and above all the rule that
// an ingredient the catalogue does not have is *reported, not invented*.
//
// Writing a parallel path would have meant writing that rule twice, and the
// second copy is the one that forgets. A silently created product arrives
// with no price, costs the dish nothing, and makes the dish look cheap rather
// than look wrong — which is the failure the sheet importer exists to avoid
// and the one an AI importer is most likely to reintroduce, because a model
// will happily name an ingredient nobody stocks.
//
// Two things this does not do, deliberately:
//
//   It does not drop a line the model could not put a quantity on. A recipe
//   that says "a splash of vinegar" becomes a line with no quantity, which
//   the importer reports as a problem — and a problem on screen is how
//   somebody learns to go and read the original. Dropping it would make the
//   dish import cleanly and cost less than it does.
//
//   It does not invent a unit. A quantity with no unit is sent as a quantity
//   with no unit; the importer refuses to cost it rather than guessing
//   grams, which is the guess that is wrong by a thousand when it is wrong.
// ---------------------------------------------------------------------------

import type { ParsedRecipe } from "./tasks";

/** The header the sheet importer matches on. Kept here so the bridge is one file. */
const HEADER = ["Recipe", "Category", "Ingredient", "Quantity", "Unit"];

/**
 * A parsed recipe as import rows.
 *
 * The shape is a sheet because that is what `planRecipeImport` reads, and
 * going through the same door means the preview somebody approves is
 * produced by the same code as the commit.
 */
export function parsedRecipeToRows(recipe: ParsedRecipe): string[][] {
  const rows: string[][] = [HEADER];

  for (const line of recipe.lines) {
    rows.push([
      recipe.name,
      recipe.category ?? "",
      line.ingredient,
      // Empty rather than "0". A quantity of zero is a statement that the
      // dish uses none of something; a blank is the absence of a figure, and
      // the importer tells them apart.
      line.quantity === null ? "" : String(line.quantity),
      line.unit ?? "",
    ]);
  }

  return rows;
}

/**
 * What the model could not read, as problems a person can act on.
 *
 * The model is asked to put anything it could not parse into `notes` rather
 * than omitting it, and those notes are worth as much as the lines: "the
 * quantity for the stock was illegible" is the sentence that stops somebody
 * approving a dish that is short an ingredient.
 *
 * Returned separately from the importer's own problems because they have
 * different authority. The importer's problems are facts about the
 * catalogue — this ingredient does not exist. These are the model's own
 * admissions, and a screen should not present the two as equally reliable.
 */
export function extractionConcerns(recipe: ParsedRecipe): string[] {
  const concerns = [...recipe.notes];

  const noQuantity = recipe.lines.filter((l) => l.quantity === null);
  for (const l of noQuantity) {
    concerns.push(`No quantity was given for ${l.ingredient}.`);
  }

  const noUnit = recipe.lines.filter((l) => l.quantity !== null && !l.unit);
  for (const l of noUnit) {
    concerns.push(`No unit was given for ${l.ingredient}.`);
  }

  if (recipe.lines.length === 0) {
    concerns.push("No ingredients were found in this text at all.");
  }

  return concerns;
}
