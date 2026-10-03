// ---------------------------------------------------------------------------
// What the kitchen sells, and what goes into it
// ---------------------------------------------------------------------------
// Products, preparations, dishes and the collections they are grouped into,
// plus the bulk and merge operations that act on all of them at once.
//
// Split out of `repository.ts` in stage 1.4, which was 5.260 lines and 9% of
// the front end. Nothing here changed in the move: `repository.ts` re-exports
// all of it, so every caller imports exactly what it imported before.
// ---------------------------------------------------------------------------

import { requireSupabase } from "@/lib/supabase";
import { fail, fetchAllPages, ConflictError } from "./_shared";
import { lineToRow, productFromRow, productToRow, recipeFromRow, recipeToRow, subRecipeFromRow, subRecipeToRow } from "./mappers";
import type { Collection, Product, Recipe, SubRecipe } from "@ccos/shared";

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

// ── Who sells a product ─────────────────────────────────────────────────────

export interface ProductSupplierOption {
  id: string;
  productId: string;
  supplierId: string;
  supplierName: string;
  supplierSku: string | null;
  packQty: number | null;
  packUnit: string | null;
  packPrice: number | null;
  /** Derived by the database, which is what makes it comparable. */
  pricePerUnit: number | null;
  priceUpdatedOn: string | null;
  leadTimeDays: number | null;
  minimumOrderQty: number | null;
  isPreferred: boolean;
  active: boolean;
  note: string | null;
  /** 1 is the cheapest per unit. */
  priceRank: number;
  supplierCount: number;
}

function optionFromRow(r: any): ProductSupplierOption {
  return {
    id: r.id, productId: r.product_id, supplierId: r.supplier_id,
    supplierName: r.supplier_name, supplierSku: r.supplier_sku ?? null,
    packQty: r.pack_qty === null ? null : Number(r.pack_qty),
    packUnit: r.pack_unit ?? null,
    packPrice: r.pack_price === null ? null : Number(r.pack_price),
    pricePerUnit: r.price_per_unit === null ? null : Number(r.price_per_unit),
    priceUpdatedOn: r.price_updated_on ?? null,
    leadTimeDays: r.lead_time_days === null ? null : Number(r.lead_time_days),
    minimumOrderQty: r.minimum_order_qty === null ? null : Number(r.minimum_order_qty),
    isPreferred: Boolean(r.is_preferred), active: Boolean(r.active),
    note: r.note ?? null,
    priceRank: Number(r.price_rank ?? 1),
    supplierCount: Number(r.supplier_count ?? 0),
  };
}

export async function fetchProductSuppliers(
  productId: string,
): Promise<ProductSupplierOption[]> {
  const { data, error } = await requireSupabase()
    .from("product_supplier_options")
    .select("*")
    .eq("product_id", productId)
    .order("price_rank");
  if (error) fail("fetchProductSuppliers", error);
  return (data ?? []).map(optionFromRow);
}

/** Every link in the venue, for the purchasing filter to widen itself with. */
export async function fetchAllProductSuppliers(): Promise<
  { productId: string; supplierId: string; isPreferred: boolean }[]
> {
  const rows = await fetchAllPages<any>(
    (from, to) =>
      requireSupabase()
        .from("product_suppliers")
        .select("product_id, supplier_id, is_preferred")
        .eq("active", true)
        .range(from, to),
    "fetchAllProductSuppliers",
  );
  return rows.map((r) => ({
    productId: r.product_id, supplierId: r.supplier_id,
    isPreferred: Boolean(r.is_preferred),
  }));
}

export async function saveProductSupplier(input: {
  id?: string;
  productId: string;
  supplierId: string;
  supplierSku: string | null;
  packQty: number | null;
  packUnit: string | null;
  packPrice: number | null;
  leadTimeDays: number | null;
  minimumOrderQty: number | null;
  note: string | null;
}): Promise<void> {
  const db = requireSupabase();
  const row = {
    product_id: input.productId,
    supplier_id: input.supplierId,
    supplier_sku: input.supplierSku,
    pack_qty: input.packQty,
    pack_unit: input.packUnit,
    pack_price: input.packPrice,
    lead_time_days: input.leadTimeDays,
    minimum_order_qty: input.minimumOrderQty,
    note: input.note,
  };
  // price_per_unit is deliberately not sent — the database derives it, so two
  // clients cannot disagree about which supplier is cheaper.
  const { error } = input.id
    ? await db.from("product_suppliers").update(row).eq("id", input.id)
    : await db.from("product_suppliers").insert(row);
  if (error) fail("saveProductSupplier", error);
}

/**
 * Choose where the order goes.
 *
 * Only sets the one; the database un-prefers the previous supplier itself, so
 * there is no window in which a product has two or none.
 */
export async function setPreferredSupplier(linkId: string): Promise<void> {
  const { error } = await requireSupabase()
    .from("product_suppliers").update({ is_preferred: true }).eq("id", linkId);
  if (error) fail("setPreferredSupplier", error);
}

export async function removeProductSupplier(linkId: string): Promise<void> {
  const { error } = await requireSupabase()
    .from("product_suppliers").delete().eq("id", linkId);
  if (error) fail("removeProductSupplier", error);
}
