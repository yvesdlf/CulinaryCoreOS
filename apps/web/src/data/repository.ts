// ---------------------------------------------------------------------------
// Supabase data access
// ---------------------------------------------------------------------------
// Every query lives here so the stores stay unaware of Postgres. Ingredient
// lines are written by delete-then-insert rather than by diffing: a recipe has
// a handful of lines, order is significant, and a diff would have to reconcile
// reordering, which is not worth the complexity at this size.
// ---------------------------------------------------------------------------

import type { Product, SubRecipe, Recipe, Collection } from "@ccos/shared";
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
  /** Version the editor loaded; a mismatch means somebody else wrote first. */
  expectedVersion?: number,
): Promise<Product> {
  let query = requireSupabase()
    .from("products")
    .update(productToRow(changes))
    .eq("id", id);
  if (expectedVersion !== undefined) {
    query = query.eq("version", expectedVersion);
  }
  const { data, error } = await query.select("*");
  if (error) fail("updateProduct", error);
  // Zero rows with a version predicate means the row moved on. RLS would have
  // raised rather than returned nothing.
  if (expectedVersion !== undefined && (data ?? []).length === 0) {
    throw new ConflictError("product");
  }
  return productFromRow((data ?? [])[0]);
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
 *
 * The recipe payload sends the current pricing fields. It used to send
 * priceExclVat / totalCostWithSecurityMargin / grossContributionMargin, which
 * became optional when the model moved to menuPrice / totalCog — so they were
 * always undefined and every cascade wrote NULL over three columns while
 * reporting success. Optional fields make that class of mistake typecheck
 * cleanly, which is why the values below are read from required ones.
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
      allergens: s.allergens,
      lines: linesToJson(s.ingredientLines),
    })),
    p_recipes: recipes.map((r) => ({
      id: r.id,
      menu_price: r.pricing.menuPrice,
      price_incl_tax: r.pricing.priceInclTax,
      total_cost: r.pricing.totalCost,
      waste_amount: r.pricing.wasteAmount,
      inflation_amount: r.pricing.inflationAmount,
      total_cog: r.pricing.totalCog,
      gross_profit: r.pricing.grossProfit,
      gross_profit_percent: r.pricing.grossProfitPercent,
      food_cost_percent: r.pricing.foodCostPercent,
      // Inherited, never authored — written with the cost it travels beside.
      allergens: r.allergens,
      gluten_free: r.dietaryFlags.glutenFree,
      dairy_free: r.dietaryFlags.dairyFree,
      nuts_free: r.dietaryFlags.nutsFree,
      soy_free: r.dietaryFlags.soyFree,
      sulfites_free: r.dietaryFlags.sulfitesFree,
      lines: linesToJson(r.ingredientLines),
    })),
  });
  if (error) fail("persistCascade", error);
}

// ── Merging duplicates ──────────────────────────────────────────────────────

/**
 * Repoint every ingredient line from the losing products onto the survivor,
 * then remove them.
 *
 * One RPC because it must be one transaction: a merge that moved half the
 * lines and then failed would leave dishes costing from a row that no longer
 * exists, and the UI would show the finished result either way.
 */
export async function mergeProducts(
  survivorId: string,
  loserIds: string[],
): Promise<{ recipeLines: number; subRecipeLines: number; removed: number }> {
  const { data, error } = await requireSupabase().rpc("merge_products", {
    p_survivor: survivorId,
    p_losers: loserIds,
  });
  if (error) fail("mergeProducts", error);
  const row = Array.isArray(data) ? data[0] : data;
  return {
    recipeLines: row?.recipe_lines_moved ?? 0,
    subRecipeLines: row?.sub_recipe_lines_moved ?? 0,
    removed: row?.products_removed ?? 0,
  };
}

/** Rewrite alternative spellings of a supplier onto one name. */
export async function mergeSupplierNames(
  survivor: string,
  losers: string[],
): Promise<number> {
  const { data, error } = await requireSupabase().rpc("merge_supplier_names", {
    p_survivor: survivor,
    p_losers: losers,
  });
  if (error) fail("mergeSupplierNames", error);
  return typeof data === "number" ? data : 0;
}

// ── Collections ─────────────────────────────────────────────────────────────

const COLLECTION_SELECT = "*, collection_recipes(recipe_id, position)";

function collectionFromRow(row: any): Collection {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    // Sorted here rather than relying on the embed's order: a collection is
    // read in the order the section works, and PostgREST does not promise one.
    recipeIds: (row.collection_recipes ?? [])
      .slice()
      .sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0))
      .map((r: any) => r.recipe_id),
    createdAt: row.created_at ?? "",
    updatedAt: row.updated_at ?? "",
  };
}

export async function fetchCollections(): Promise<Collection[]> {
  const { data, error } = await requireSupabase()
    .from("collections")
    .select(COLLECTION_SELECT)
    .order("name");
  if (error) fail("fetchCollections", error);
  return (data ?? []).map(collectionFromRow);
}

export async function insertCollection(
  name: string,
  description: string | null,
): Promise<Collection> {
  const { data, error } = await requireSupabase()
    .from("collections")
    .insert({ name, description })
    .select(COLLECTION_SELECT)
    .single();
  if (error) fail("insertCollection", error);
  return collectionFromRow(data);
}

export async function deleteCollection(id: string): Promise<void> {
  const { error } = await requireSupabase().from("collections").delete().eq("id", id);
  if (error) fail("deleteCollection", error);
}

/**
 * Replace a collection's membership wholesale.
 *
 * Delete-then-insert rather than diffing, for the same reason ingredient lines
 * are written that way: order is significant and a collection holds a handful
 * of dishes, so reconciling a reorder would be more code than it is worth.
 */
export async function setCollectionRecipes(
  collectionId: string,
  recipeIds: string[],
): Promise<void> {
  const db = requireSupabase();
  const { error: delError } = await db
    .from("collection_recipes")
    .delete()
    .eq("collection_id", collectionId);
  if (delError) fail("setCollectionRecipes(delete)", delError);

  if (recipeIds.length === 0) return;
  const { error } = await db.from("collection_recipes").insert(
    recipeIds.map((recipe_id, position) => ({
      collection_id: collectionId,
      recipe_id,
      position,
    })),
  );
  if (error) fail("setCollectionRecipes(insert)", error);
}

// ── Status audit ────────────────────────────────────────────────────────────

export interface StatusEvent {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  actorEmail: string | null;
  note: string | null;
  createdAt: string;
}

/**
 * Record a status transition. SRS RCP-FUNC-006 AC6.
 *
 * The actor is captured here rather than read from a trigger, because the
 * question this table answers is "who did this" and the database only knows
 * the role the request arrived under.
 */
export async function logStatusChange(
  recipeId: string,
  fromStatus: string | null,
  toStatus: string,
  note?: string,
): Promise<void> {
  const db = requireSupabase();
  const { data: auth } = await db.auth.getUser();
  const { error } = await db.from("recipe_status_events").insert({
    recipe_id: recipeId,
    from_status: fromStatus,
    to_status: toStatus,
    actor_id: auth.user?.id ?? null,
    actor_email: auth.user?.email ?? null,
    note: note ?? null,
  });
  if (error) fail("logStatusChange", error);
}

export async function fetchStatusHistory(recipeId: string): Promise<StatusEvent[]> {
  const { data, error } = await requireSupabase()
    .from("recipe_status_events")
    .select("*")
    .eq("recipe_id", recipeId)
    .order("created_at", { ascending: false });
  if (error) fail("fetchStatusHistory", error);
  return (data ?? []).map((r: any) => ({
    id: r.id,
    fromStatus: r.from_status ?? null,
    toStatus: r.to_status,
    actorEmail: r.actor_email ?? null,
    note: r.note ?? null,
    createdAt: r.created_at ?? "",
  }));
}

// ── Inventory ───────────────────────────────────────────────────────────────

import type { StockMovement, MovementKind } from "@/engine/inventory";

/** Current level per product, summed by the database rather than the browser. */
export async function fetchStockLevels(): Promise<
  Map<string, { onHand: number; lastMovementAt: string | null }>
> {
  const rows = await fetchAllPages<any>(
    (from, to) =>
      requireSupabase().from("product_stock").select("*").range(from, to),
    "fetchStockLevels",
  );
  return new Map(
    rows.map((r) => [
      r.product_id,
      { onHand: Number(r.on_hand ?? 0), lastMovementAt: r.last_movement_at ?? null },
    ]),
  );
}

export async function fetchMovements(productId?: string): Promise<StockMovement[]> {
  let q = requireSupabase()
    .from("stock_movements")
    .select("*")
    .order("occurred_at", { ascending: false })
    .limit(500);
  if (productId) q = q.eq("product_id", productId);
  const { data, error } = await q;
  if (error) fail("fetchMovements", error);
  return (data ?? []).map((r: any) => ({
    id: r.id,
    productId: r.product_id,
    kind: r.kind,
    quantity: Number(r.quantity),
    unit: r.unit ?? "",
    unitCost: r.unit_cost === null || r.unit_cost === undefined ? null : String(r.unit_cost),
    reason: r.reason ?? null,
    note: r.note ?? null,
    occurredAt: r.occurred_at ?? "",
    actorEmail: r.actor_email ?? null,
  }));
}

export interface NewMovement {
  productId: string;
  kind: MovementKind;
  /** Signed. The caller decides direction; the ledger records what it is told. */
  quantity: number;
  unit: string;
  unitCost: string | null;
  reason?: string | null;
  note?: string | null;
}

/**
 * Record movements.
 *
 * Inserted in one call so a count sheet lands whole: half a count applied is
 * worse than none, because the books then disagree with both the shelf and
 * the sheet somebody signed.
 */
export async function recordMovements(movements: NewMovement[]): Promise<void> {
  if (movements.length === 0) return;
  const db = requireSupabase();
  const { data: auth } = await db.auth.getUser();
  const { error } = await db.from("stock_movements").insert(
    movements.map((m) => ({
      product_id: m.productId,
      kind: m.kind,
      quantity: m.quantity,
      unit: m.unit,
      unit_cost: m.unitCost,
      reason: m.reason ?? null,
      note: m.note ?? null,
      actor_id: auth.user?.id ?? null,
      actor_email: auth.user?.email ?? null,
    })),
  );
  if (error) fail("recordMovements", error);
}
