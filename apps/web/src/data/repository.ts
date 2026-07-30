// ---------------------------------------------------------------------------
// Supabase data access
// ---------------------------------------------------------------------------
// Every query lives here so the stores stay unaware of Postgres. Ingredient
// lines are written by delete-then-insert rather than by diffing: a recipe has
// a handful of lines, order is significant, and a diff would have to reconcile
// reordering, which is not worth the complexity at this size.
// ---------------------------------------------------------------------------

import type { Product, SubRecipe, Recipe } from "@ccos/shared";
import { requireSupabase } from "@/lib/supabase";
import {
  productFromRow,
  productToRow,
  subRecipeFromRow,
  subRecipeToRow,
  recipeFromRow,
  recipeToRow,
  lineToRow,
} from "./mappers";

/** Surface Postgres errors with the operation that caused them. */
function fail(op: string, error: { message: string } | null): never {
  throw new Error(`${op} failed: ${error?.message ?? "unknown error"}`);
}

/**
 * Raised when a row changed underneath the editor.
 *
 * Distinguishable from a generic failure so the UI can offer to reload rather
 * than just reporting an error.
 */
export class ConflictError extends Error {
  constructor(entity: string) {
    super(
      `This ${entity} was changed by someone else since you opened it. ` +
        `Reload to get the latest version before saving again.`,
    );
    this.name = "ConflictError";
  }
}


/**
 * PostgREST caps a response at 1.000 rows by default and returns that silently
 * — no error, no flag. The Manuza catalogue has 1.106 ingredients, so a plain
 * select dropped 106 of them: recipe lines referencing those products rendered
 * as "Unknown Product" and costed nothing.
 *
 * Every list read therefore pages until a short page proves the end.
 */
const PAGE = 1000;

async function fetchAllPages<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  op: string,
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) fail(op, error);
    const page = data ?? [];
    all.push(...page);
    if (page.length < PAGE) return all;
  }
}

// ── Products ────────────────────────────────────────────────────────────────

export async function fetchProducts(): Promise<Product[]> {
  const rows = await fetchAllPages<any>(
    (from, to) =>
      requireSupabase().from("products").select("*").order("name").range(from, to),
    "fetchProducts",
  );
  return rows.map(productFromRow);
}

export async function insertProduct(
  product: Omit<Product, "id" | "createdAt" | "updatedAt">,
): Promise<Product> {
  const { data, error } = await requireSupabase()
    .from("products")
    .insert(productToRow(product))
    .select("*")
    .single();
  if (error) fail("insertProduct", error);
  return productFromRow(data);
}

export async function updateProduct(
  id: string,
  changes: Partial<Product>,
): Promise<Product> {
  const { data, error } = await requireSupabase()
    .from("products")
    .update(productToRow(changes))
    .eq("id", id)
    .select("*")
    .single();
  if (error) fail("updateProduct", error);
  return productFromRow(data);
}

export async function deleteProduct(id: string): Promise<void> {
  const { error } = await requireSupabase()
    .from("products")
    .delete()
    .eq("id", id);
  if (error) fail("deleteProduct", error);
}

// ── Sub-recipes ─────────────────────────────────────────────────────────────

// `sub_recipe_lines` points at `sub_recipes` twice — `sub_recipe_id` for the
// owning recipe and `child_sub_recipe_id` for a nested one. PostgREST refuses
// an ambiguous embed ("more than one relationship was found"), so name the
// column to disambiguate: we want the lines this sub-recipe owns.
const SUB_RECIPE_SELECT = "*, sub_recipe_lines!sub_recipe_id(*)";

export async function fetchSubRecipes(): Promise<SubRecipe[]> {
  const rows = await fetchAllPages<any>(
    (from, to) =>
      requireSupabase()
        .from("sub_recipes")
        .select(SUB_RECIPE_SELECT)
        .order("name")
        .range(from, to),
    "fetchSubRecipes",
  );
  return rows.map(subRecipeFromRow);
}

async function replaceSubRecipeLines(
  subRecipeId: string,
  sub: Pick<SubRecipe, "ingredientLines">,
): Promise<void> {
  const db = requireSupabase();
  const { error: delError } = await db
    .from("sub_recipe_lines")
    .delete()
    .eq("sub_recipe_id", subRecipeId);
  if (delError) fail("replaceSubRecipeLines(delete)", delError);

  if (sub.ingredientLines.length === 0) return;
  const rows = sub.ingredientLines.map((line, i) =>
    lineToRow(
      { ...line, lineNumber: i + 1 },
      "sub_recipe_id",
      subRecipeId,
      "child_sub_recipe_id",
    ),
  );
  const { error } = await db.from("sub_recipe_lines").insert(rows);
  if (error) fail("replaceSubRecipeLines(insert)", error);
}

export async function insertSubRecipe(
  sub: Omit<SubRecipe, "id" | "createdAt" | "updatedAt">,
): Promise<SubRecipe> {
  const { data, error } = await requireSupabase()
    .from("sub_recipes")
    .insert(subRecipeToRow(sub))
    .select("*")
    .single();
  if (error) fail("insertSubRecipe", error);
  await replaceSubRecipeLines(data.id, sub);
  return fetchSubRecipe(data.id);
}

export async function fetchSubRecipe(id: string): Promise<SubRecipe> {
  const { data, error } = await requireSupabase()
    .from("sub_recipes")
    .select(SUB_RECIPE_SELECT)
    .eq("id", id)
    .single();
  if (error) fail("fetchSubRecipe", error);
  return subRecipeFromRow(data);
}

export async function updateSubRecipe(
  id: string,
  changes: Partial<SubRecipe>,
  /**
   * Version the editor loaded. Matching on it means a save only lands if
   * nobody else has written since — otherwise two chefs silently overwrite
   * each other, and the loser never finds out.
   */
  expectedVersion?: number,
): Promise<SubRecipe> {
  let query = requireSupabase()
    .from("sub_recipes")
    .update(subRecipeToRow(changes))
    .eq("id", id);
  if (expectedVersion !== undefined) {
    query = query.eq("version", expectedVersion);
  }
  const { data, error } = await query.select("id");
  if (error) fail("updateSubRecipe", error);
  // Zero rows with a version predicate means the row moved on, not that it
  // vanished — RLS would have raised instead.
  if (expectedVersion !== undefined && (data ?? []).length === 0) {
    throw new ConflictError("sub recipe");
  }
  if (changes.ingredientLines) {
    await replaceSubRecipeLines(id, {
      ingredientLines: changes.ingredientLines,
    });
  }
  return fetchSubRecipe(id);
}

export async function deleteSubRecipe(id: string): Promise<void> {
  const { error } = await requireSupabase()
    .from("sub_recipes")
    .delete()
    .eq("id", id);
  if (error) fail("deleteSubRecipe", error);
}

// ── Recipes ─────────────────────────────────────────────────────────────────

// Only one of recipe_lines' foreign keys points at `recipes`, so this is not
// ambiguous today — named explicitly to stay correct if another is ever added.
const RECIPE_SELECT = "*, recipe_lines!recipe_id(*)";

export async function fetchRecipes(): Promise<Recipe[]> {
  const rows = await fetchAllPages<any>(
    (from, to) =>
      requireSupabase()
        .from("recipes")
        .select(RECIPE_SELECT)
        .order("name")
        .range(from, to),
    "fetchRecipes",
  );
  return rows.map(recipeFromRow);
}

export async function fetchRecipe(id: string): Promise<Recipe> {
  const { data, error } = await requireSupabase()
    .from("recipes")
    .select(RECIPE_SELECT)
    .eq("id", id)
    .single();
  if (error) fail("fetchRecipe", error);
  return recipeFromRow(data);
}

async function replaceRecipeLines(
  recipeId: string,
  recipe: Pick<Recipe, "ingredientLines">,
): Promise<void> {
  const db = requireSupabase();
  const { error: delError } = await db
    .from("recipe_lines")
    .delete()
    .eq("recipe_id", recipeId);
  if (delError) fail("replaceRecipeLines(delete)", delError);

  if (recipe.ingredientLines.length === 0) return;
  const rows = recipe.ingredientLines.map((line, i) =>
    lineToRow(
      { ...line, lineNumber: i + 1 },
      "recipe_id",
      recipeId,
      "sub_recipe_id",
    ),
  );
  const { error } = await db.from("recipe_lines").insert(rows);
  if (error) fail("replaceRecipeLines(insert)", error);
}

export async function insertRecipe(
  recipe: Omit<Recipe, "id" | "createdAt" | "updatedAt">,
): Promise<Recipe> {
  const { data, error } = await requireSupabase()
    .from("recipes")
    .insert(recipeToRow(recipe))
    .select("*")
    .single();
  if (error) fail("insertRecipe", error);
  await replaceRecipeLines(data.id, recipe);
  return fetchRecipe(data.id);
}

export async function updateRecipe(
  id: string,
  changes: Partial<Recipe>,
  /** See updateSubRecipe — same lost-update protection. */
  expectedVersion?: number,
): Promise<Recipe> {
  let query = requireSupabase()
    .from("recipes")
    .update(recipeToRow(changes))
    .eq("id", id);
  if (expectedVersion !== undefined) {
    query = query.eq("version", expectedVersion);
  }
  const { data, error } = await query.select("id");
  if (error) fail("updateRecipe", error);
  if (expectedVersion !== undefined && (data ?? []).length === 0) {
    throw new ConflictError("recipe");
  }
  if (changes.ingredientLines) {
    await replaceRecipeLines(id, { ingredientLines: changes.ingredientLines });
  }
  return fetchRecipe(id);
}

export async function deleteRecipe(id: string): Promise<void> {
  const { error } = await requireSupabase()
    .from("recipes")
    .delete()
    .eq("id", id);
  if (error) fail("deleteRecipe", error);
}

// ── Bulk ────────────────────────────────────────────────────────────────────

/** One round trip per table, used to hydrate the stores at startup. */
export async function fetchAll(): Promise<{
  products: Product[];
  subRecipes: SubRecipe[];
  recipes: Recipe[];
}> {
  const [products, subRecipes, recipes] = await Promise.all([
    fetchProducts(),
    fetchSubRecipes(),
    fetchRecipes(),
  ]);
  return { products, subRecipes, recipes };
}

/** Ingredient lines in the shape `apply_cascade` expects. */
function linesToJson(lines: Recipe["ingredientLines"]) {
  return lines.map((line, i) => ({
    line_number: i + 1,
    product_id: line.productId,
    sub_recipe_id: line.subRecipeId,
    nett_qty: line.nettQty,
    nett_unit: line.nettUnit,
    ref_percent: line.refPercent,
    gross_qty: line.grossQty,
    gross_unit: line.grossUnit,
    cost_per_unit: line.costPerUnit,
    line_cost: line.lineCost,
  }));
}

/**
 * Persist cascade results in one transaction.
 *
 * This was a fan-out of independent requests — one per affected entity, each
 * rewriting its lines separately. A failure part-way left the database
 * half-updated while the UI showed the finished result. The RPC makes the
 * whole cascade atomic.
 */
export async function persistCascade(
  subRecipes: SubRecipe[],
  recipes: Recipe[],
): Promise<void> {
  if (subRecipes.length === 0 && recipes.length === 0) return;

  const { error } = await requireSupabase().rpc("apply_cascade", {
    p_sub_recipes: subRecipes.map((s) => ({
      id: s.id,
      total_cost: s.totalCost,
      cost_per_unit: s.costPerUnit,
      lines: linesToJson(s.ingredientLines),
    })),
    p_recipes: recipes.map((r) => ({
      id: r.id,
      price_excl_vat: r.pricing.priceExclVat,
      total_cost: r.pricing.totalCost,
      total_cost_with_margin: r.pricing.totalCostWithSecurityMargin,
      gross_contribution_margin: r.pricing.grossContributionMargin,
      food_cost_percent: r.pricing.foodCostPercent,
      lines: linesToJson(r.ingredientLines),
    })),
  });
  if (error) fail("persistCascade", error);
}
