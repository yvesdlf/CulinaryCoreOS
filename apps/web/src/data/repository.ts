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

// ── Products ────────────────────────────────────────────────────────────────

export async function fetchProducts(): Promise<Product[]> {
  const { data, error } = await requireSupabase()
    .from("products")
    .select("*")
    .order("name");
  if (error) fail("fetchProducts", error);
  return (data ?? []).map(productFromRow);
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
  const { data, error } = await requireSupabase()
    .from("sub_recipes")
    .select(SUB_RECIPE_SELECT)
    .order("name");
  if (error) fail("fetchSubRecipes", error);
  return (data ?? []).map(subRecipeFromRow);
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
): Promise<SubRecipe> {
  const { error } = await requireSupabase()
    .from("sub_recipes")
    .update(subRecipeToRow(changes))
    .eq("id", id);
  if (error) fail("updateSubRecipe", error);
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
  const { data, error } = await requireSupabase()
    .from("recipes")
    .select(RECIPE_SELECT)
    .order("name");
  if (error) fail("fetchRecipes", error);
  return (data ?? []).map(recipeFromRow);
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
): Promise<Recipe> {
  const { error } = await requireSupabase()
    .from("recipes")
    .update(recipeToRow(changes))
    .eq("id", id);
  if (error) fail("updateRecipe", error);
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

/** Persist cascade results — only the entities the cascade actually touched. */
export async function persistCascade(
  subRecipes: SubRecipe[],
  recipes: Recipe[],
): Promise<void> {
  await Promise.all([
    ...subRecipes.map((s) =>
      updateSubRecipe(s.id, {
        totalCost: s.totalCost,
        costPerUnit: s.costPerUnit,
        ingredientLines: s.ingredientLines,
      }),
    ),
    ...recipes.map((r) =>
      updateRecipe(r.id, {
        pricing: r.pricing,
        ingredientLines: r.ingredientLines,
      }),
    ),
  ]);
}
