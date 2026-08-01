// ---------------------------------------------------------------------------
// Recipe import
// ---------------------------------------------------------------------------
// A recipe arrives as a list of ingredients and quantities, one row each, with
// the dish name repeated down the sheet — which is how anyone writes one in
// Excel and how the venue's own workbooks are laid out. This turns that into
// dishes with resolved ingredient lines, so the app can cost and format them.
//
// It resolves references rather than creating them. An ingredient the
// catalogue does not have is reported, not invented: a silently created
// product would arrive with no price, cost the dish nothing, and make the
// dish look cheap rather than look wrong.
//
// Pure, so the preview and the commit cannot disagree about what will happen.
// ---------------------------------------------------------------------------

import type { Product, SubRecipe, Recipe } from "@ccos/shared";
import { parseNumber } from "@/lib/csv";
import { calculateLineCost, toDecimal } from "./cost-engine";

export interface ImportedLine {
  ingredient: string;
  qty: number;
  unit: string;
  productId: string | null;
  subRecipeId: string | null;
  costPerUnit: string;
  lineCost: string;
}

export interface ImportedRecipe {
  name: string;
  category: string | null;
  menuPrice: number | null;
  lines: ImportedLine[];
  /** Set when a dish of this name already exists. */
  existingId: string | null;
  totalCost: string;
}

export interface RecipeImportProblem {
  line: number;
  recipe: string;
  reason: string;
}

export interface RecipeImportPlan {
  recipes: ImportedRecipe[];
  problems: RecipeImportProblem[];
  columns: Record<string, string> | null;
}

const key = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Locate the columns by header name.
 *
 * Matched loosely because the file will have been through Excel and possibly
 * someone else's template, but the two that carry meaning — the dish and the
 * ingredient — must both be present or the import refuses. Guessing at column
 * positions would build dishes out of whatever happened to be in column B.
 */
function findColumns(header: string[]) {
  const norm = header.map(key);
  const find = (...names: string[]) =>
    norm.findIndex((h) => names.some((n) => h === n || h.includes(n)));

  const recipe = find("recipe", "dish", "menu item");
  const ingredient = find("ingredient", "component", "item");
  return {
    recipe,
    ingredient,
    qty: find("quantity", "qty", "amount"),
    unit: find("unit", "uom"),
    category: find("category", "section"),
    price: find("menu price", "selling price", "price"),
  };
}

/**
 * Read a recipe sheet into dishes.
 *
 * `existing` lets a re-import update rather than duplicate: importing the same
 * file twice should leave one dish, not two.
 */
export function planRecipeImport(
  rows: string[][],
  catalogue: { products: Product[]; subRecipes: SubRecipe[]; recipes: Recipe[] },
): RecipeImportPlan {
  const problems: RecipeImportProblem[] = [];

  if (rows.length < 2) {
    return {
      recipes: [],
      problems: [{ line: 1, recipe: "", reason: "The file has no data rows." }],
      columns: null,
    };
  }

  const header = rows[0];
  const cols = findColumns(header);
  if (cols.recipe === -1 || cols.ingredient === -1) {
    return {
      recipes: [],
      problems: [
        {
          line: 1,
          recipe: "",
          reason:
            'Could not find a dish column and an ingredient column. Expected headers like "Recipe" and "Ingredient".',
        },
      ],
      columns: null,
    };
  }

  const productByName = new Map(catalogue.products.map((p) => [key(p.name), p]));
  const subByName = new Map(catalogue.subRecipes.map((s) => [key(s.name), s]));
  const recipeByName = new Map(catalogue.recipes.map((r) => [key(r.name), r]));

  const byRecipe = new Map<string, ImportedRecipe>();

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const line = i + 1;
    const at = (idx: number) => (idx === -1 ? "" : (row[idx] ?? "").trim());

    const recipeName = at(cols.recipe);
    const ingredientName = at(cols.ingredient);

    // Excel padding, not a mistake worth reporting.
    if (!recipeName && !ingredientName) continue;

    if (!recipeName) {
      problems.push({ line, recipe: "", reason: "No dish name on this row." });
      continue;
    }

    let dish = byRecipe.get(key(recipeName));
    if (!dish) {
      const existing = recipeByName.get(key(recipeName));
      dish = {
        name: recipeName,
        category: at(cols.category) || existing?.category || null,
        menuPrice:
          parseNumber(at(cols.price)) ??
          (existing ? Number(existing.pricing.menuPrice) : null),
        lines: [],
        existingId: existing?.id ?? null,
        totalCost: "0",
      };
      byRecipe.set(key(recipeName), dish);
    }

    if (!ingredientName) {
      problems.push({ line, recipe: recipeName, reason: "No ingredient on this row." });
      continue;
    }

    const qty = parseNumber(at(cols.qty));
    if (qty === null) {
      problems.push({
        line,
        recipe: recipeName,
        reason: `Could not read a quantity for "${ingredientName}".`,
      });
      continue;
    }

    // Preparations first: a sub-recipe and a product can share a name, and the
    // preparation is the more specific reading — "Sourdough" in a dish means
    // the bread we make, not the starter we buy.
    const subMatch = subByName.get(key(ingredientName));
    const productMatch = productByName.get(key(ingredientName));

    if (!subMatch && !productMatch) {
      problems.push({
        line,
        recipe: recipeName,
        reason: `"${ingredientName}" is not in the catalogue. Add it first, or correct the spelling.`,
      });
      continue;
    }

    const costPerUnit = subMatch
      ? subMatch.costPerUnit
      : productMatch!.cost.grossPricePerUnit;
    const unit =
      at(cols.unit) ||
      (subMatch ? subMatch.batchYield.unit : productMatch!.packing.totalUnit);

    // The shipped engine, so an imported line costs exactly as a typed one
    // would. Trim is zero here: a sheet gives nett quantities, and a ref% the
    // file did not state is not one to invent.
    const { lineCost } = calculateLineCost(qty, 0, costPerUnit);

    dish.lines.push({
      ingredient: ingredientName,
      qty,
      unit,
      productId: subMatch ? null : productMatch!.id,
      subRecipeId: subMatch ? subMatch.id : null,
      costPerUnit: toDecimal(costPerUnit).toFixed(5),
      lineCost: lineCost.toFixed(2),
    });
  }

  const recipes = [...byRecipe.values()]
    .map((r) => ({
      ...r,
      totalCost: r.lines
        .reduce((acc, l) => acc.plus(toDecimal(l.lineCost)), toDecimal(0))
        .toFixed(2),
    }))
    // A dish whose every line failed would import as an empty recipe costing
    // nothing, which looks like a cheap dish rather than a failed import.
    .filter((r) => {
      if (r.lines.length > 0) return true;
      problems.push({
        line: 0,
        recipe: r.name,
        reason: "No ingredient on this dish could be resolved, so it is skipped.",
      });
      return false;
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    recipes,
    problems,
    columns: {
      dish: header[cols.recipe],
      ingredient: header[cols.ingredient],
      ...(cols.qty !== -1 ? { quantity: header[cols.qty] } : {}),
      ...(cols.price !== -1 ? { price: header[cols.price] } : {}),
    },
  };
}
