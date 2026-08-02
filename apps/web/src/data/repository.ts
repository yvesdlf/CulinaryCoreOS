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
  /** The delivery this came from. Required for a receipt; null otherwise. */
  lotId?: string | null;
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
      lot_id: m.lotId ?? null,
      actor_id: auth.user?.id ?? null,
      actor_email: auth.user?.email ?? null,
    })),
  );
  if (error) fail("recordMovements", error);
}

// ── Sales periods ───────────────────────────────────────────────────────────

export interface SalesPeriod {
  id: string;
  name: string;
  startsOn: string;
  endsOn: string;
  source: string;
  sourceFile: string | null;
  createdAt: string;
}

export async function fetchSalesPeriods(): Promise<SalesPeriod[]> {
  const { data, error } = await requireSupabase()
    .from("sales_periods")
    .select("*")
    .order("starts_on", { ascending: false });
  if (error) fail("fetchSalesPeriods", error);
  return (data ?? []).map((r: any) => ({
    id: r.id,
    name: r.name,
    startsOn: r.starts_on,
    endsOn: r.ends_on,
    source: r.source,
    sourceFile: r.source_file ?? null,
    createdAt: r.created_at,
  }));
}

export async function fetchSalesLines(
  periodId: string,
): Promise<{ recipeId: string; unitsSold: number; netSales: number | null }[]> {
  const rows = await fetchAllPages<any>(
    (from, to) =>
      requireSupabase()
        .from("sales_lines")
        .select("*")
        .eq("period_id", periodId)
        .range(from, to),
    "fetchSalesLines",
  );
  return rows.map((r) => ({
    recipeId: r.recipe_id,
    unitsSold: Number(r.units_sold),
    netSales: r.net_sales === null ? null : Number(r.net_sales),
  }));
}

/**
 * Save an imported period.
 *
 * The period row is written first because the lines take their organization
 * from it. If the lines fail the period is removed again rather than left as
 * an empty month that reads as "nothing sold".
 */
export async function saveSalesPeriod(
  period: {
    name: string;
    startsOn: string;
    endsOn: string;
    source?: string;
    sourceFile?: string | null;
  },
  lines: { recipeId: string; unitsSold: number; netSales: number | null }[],
): Promise<SalesPeriod> {
  const db = requireSupabase();
  const { data: auth } = await db.auth.getUser();

  const { data, error } = await db
    .from("sales_periods")
    .insert({
      name: period.name,
      starts_on: period.startsOn,
      ends_on: period.endsOn,
      source: period.source ?? "IMPORT",
      source_file: period.sourceFile ?? null,
      actor_id: auth.user?.id ?? null,
      actor_email: auth.user?.email ?? null,
    })
    .select("*")
    .single();
  if (error) fail("saveSalesPeriod", error);

  if (lines.length > 0) {
    const { error: lineError } = await db.from("sales_lines").insert(
      lines.map((l) => ({
        period_id: data.id,
        recipe_id: l.recipeId,
        units_sold: l.unitsSold,
        net_sales: l.netSales,
      })),
    );
    if (lineError) {
      await db.from("sales_periods").delete().eq("id", data.id);
      fail("saveSalesPeriod(lines)", lineError);
    }
  }

  return {
    id: data.id,
    name: data.name,
    startsOn: data.starts_on,
    endsOn: data.ends_on,
    source: data.source,
    sourceFile: data.source_file ?? null,
    createdAt: data.created_at,
  };
}

export async function deleteSalesPeriod(id: string): Promise<void> {
  const { error } = await requireSupabase()
    .from("sales_periods")
    .delete()
    .eq("id", id);
  if (error) fail("deleteSalesPeriod", error);
}

// ── Suppliers ───────────────────────────────────────────────────────────────

import type { StockLot } from "@/engine/traceability";

export interface Supplier {
  id: string;
  name: string;
  legalName: string | null;
  vatNumber: string | null;
  approvalNumber: string | null;
  countryCode: string | null;
  address: string | null;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  paymentTermsDays: number | null;
  leadTimeDays: number | null;
  minimumOrderValue: string | null;
  status: "ACTIVE" | "BLOCKED" | "ARCHIVED";
  notes: string | null;
}

function supplierFromRow(r: any): Supplier {
  return {
    id: r.id,
    name: r.name,
    legalName: r.legal_name ?? null,
    vatNumber: r.vat_number ?? null,
    approvalNumber: r.approval_number ?? null,
    countryCode: r.country_code ?? null,
    address: r.address ?? null,
    contactName: r.contact_name ?? null,
    email: r.email ?? null,
    phone: r.phone ?? null,
    paymentTermsDays: r.payment_terms_days ?? null,
    leadTimeDays: r.lead_time_days ?? null,
    minimumOrderValue: r.minimum_order_value === null || r.minimum_order_value === undefined
      ? null
      : String(r.minimum_order_value),
    status: r.status,
    notes: r.notes ?? null,
  };
}

export async function fetchSuppliers(): Promise<Supplier[]> {
  const rows = await fetchAllPages<any>(
    (from, to) =>
      requireSupabase().from("suppliers").select("*").order("name").range(from, to),
    "fetchSuppliers",
  );
  return rows.map(supplierFromRow);
}

export async function upsertSupplier(
  supplier: Partial<Supplier> & { name: string },
): Promise<Supplier> {
  const row = {
    name: supplier.name,
    legal_name: supplier.legalName ?? null,
    vat_number: supplier.vatNumber ?? null,
    approval_number: supplier.approvalNumber ?? null,
    country_code: supplier.countryCode ?? null,
    address: supplier.address ?? null,
    contact_name: supplier.contactName ?? null,
    email: supplier.email ?? null,
    phone: supplier.phone ?? null,
    payment_terms_days: supplier.paymentTermsDays ?? null,
    lead_time_days: supplier.leadTimeDays ?? null,
    minimum_order_value: supplier.minimumOrderValue ?? null,
    status: supplier.status ?? "ACTIVE",
    notes: supplier.notes ?? null,
  };
  const db = requireSupabase();
  const { data, error } = supplier.id
    ? await db.from("suppliers").update(row).eq("id", supplier.id).select("*").single()
    : await db.from("suppliers").insert(row).select("*").single();
  if (error) fail("upsertSupplier", error);
  return supplierFromRow(data);
}

export interface SupplierCertificate {
  id: string;
  supplierId: string;
  kind: string;
  reference: string | null;
  issuedOn: string | null;
  expiresOn: string | null;
}

export async function fetchSupplierCertificates(): Promise<SupplierCertificate[]> {
  const { data, error } = await requireSupabase()
    .from("supplier_certificates")
    .select("*")
    .order("expires_on");
  if (error) fail("fetchSupplierCertificates", error);
  return (data ?? []).map((r: any) => ({
    id: r.id,
    supplierId: r.supplier_id,
    kind: r.kind,
    reference: r.reference ?? null,
    issuedOn: r.issued_on ?? null,
    expiresOn: r.expires_on ?? null,
  }));
}

// ── Stock lots ──────────────────────────────────────────────────────────────

function lotFromRow(r: any): StockLot {
  return {
    id: r.id,
    productId: r.product_id,
    lotCode: r.lot_code,
    supplierId: r.supplier_id ?? null,
    supplierName: r.suppliers?.name ?? null,
    deliveryReference: r.delivery_reference ?? null,
    receivedOn: r.received_on,
    expiresOn: r.expires_on ?? null,
    expiryKind: r.expiry_kind ?? null,
    receiptTemperatureC:
      r.receipt_temperature_c === null || r.receipt_temperature_c === undefined
        ? null
        : Number(r.receipt_temperature_c),
    status: r.status,
    statusReason: r.status_reason ?? null,
  };
}

export async function fetchStockLots(): Promise<StockLot[]> {
  const rows = await fetchAllPages<any>(
    (from, to) =>
      requireSupabase()
        .from("stock_lots")
        .select("*, suppliers(name)")
        .order("received_on", { ascending: false })
        .range(from, to),
    "fetchStockLots",
  );
  return rows.map(lotFromRow);
}

export interface NewLot {
  productId: string;
  lotCode: string;
  supplierId: string | null;
  deliveryReference: string | null;
  receivedOn: string;
  expiresOn: string | null;
  expiryKind: "USE_BY" | "BEST_BEFORE" | null;
  receiptTemperatureC: number | null;
}

export async function createLot(lot: NewLot): Promise<StockLot> {
  const { data, error } = await requireSupabase()
    .from("stock_lots")
    .insert({
      product_id: lot.productId,
      lot_code: lot.lotCode,
      supplier_id: lot.supplierId,
      delivery_reference: lot.deliveryReference,
      received_on: lot.receivedOn,
      expires_on: lot.expiresOn,
      expiry_kind: lot.expiryKind,
      receipt_temperature_c: lot.receiptTemperatureC,
    })
    .select("*, suppliers(name)")
    .single();
  if (error) fail("createLot", error);
  return lotFromRow(data);
}

/**
 * Block, recall, withdraw or release a lot.
 *
 * The database refuses to consume anything not OK, so this is the whole of a
 * withdrawal as far as the system is concerned — it does not depend on any
 * screen honouring it.
 */
export async function setLotStatus(
  id: string,
  status: StockLot["status"],
  reason: string | null,
): Promise<void> {
  const db = requireSupabase();
  const { data: auth } = await db.auth.getUser();
  const { error } = await db
    .from("stock_lots")
    .update({
      status,
      status_reason: reason,
      status_changed_at: new Date().toISOString(),
      status_changed_by: auth.user?.email ?? null,
    })
    .eq("id", id);
  if (error) fail("setLotStatus", error);
}

// ── Purchasing ──────────────────────────────────────────────────────────────

import type {
  PurchaseStatus,
  ApprovalPolicy,
  OrgRole,
} from "@/engine/purchasing";

export interface CostCentre {
  id: string;
  code: string;
  name: string;
}

export async function fetchCostCentres(): Promise<CostCentre[]> {
  const { data, error } = await requireSupabase()
    .from("cost_centres")
    .select("*")
    .eq("active", true)
    .order("name");
  if (error) fail("fetchCostCentres", error);
  return (data ?? []).map((r: any) => ({ id: r.id, code: r.code, name: r.name }));
}

export async function fetchApprovalPolicies(): Promise<ApprovalPolicy[]> {
  const { data, error } = await requireSupabase()
    .from("approval_policies")
    .select("*")
    .order("min_amount");
  if (error) fail("fetchApprovalPolicies", error);
  return (data ?? []).map((r: any) => ({
    documentType: r.document_type,
    minAmount: String(r.min_amount),
    requiredRole: r.required_role as OrgRole,
  }));
}

export interface RequisitionLineRow {
  id: string;
  productId: string | null;
  description: string | null;
  quantity: number;
  unit: string;
  estimatedUnitPrice: string;
  lineTotal: string;
  suggestedSupplierId: string | null;
  lineNumber: number;
}

export interface Requisition {
  id: string;
  reference: string;
  costCentreId: string | null;
  neededBy: string | null;
  justification: string | null;
  status: PurchaseStatus;
  totalAmount: string;
  requestedById: string | null;
  requestedByEmail: string | null;
  submittedAt: string | null;
  createdAt: string;
  lines: RequisitionLineRow[];
}

function requisitionFromRow(r: any): Requisition {
  return {
    id: r.id,
    reference: r.reference,
    costCentreId: r.cost_centre_id ?? null,
    neededBy: r.needed_by ?? null,
    justification: r.justification ?? null,
    status: r.status,
    totalAmount: String(r.total_amount ?? 0),
    requestedById: r.requested_by ?? null,
    requestedByEmail: r.requested_by_email ?? null,
    submittedAt: r.submitted_at ?? null,
    createdAt: r.created_at,
    lines: (r.requisition_lines ?? [])
      .map((l: any) => ({
        id: l.id,
        productId: l.product_id ?? null,
        description: l.description ?? null,
        quantity: Number(l.quantity),
        unit: l.unit,
        estimatedUnitPrice: String(l.estimated_unit_price ?? 0),
        lineTotal: String(l.line_total ?? 0),
        suggestedSupplierId: l.suggested_supplier_id ?? null,
        lineNumber: l.line_number ?? 1,
      }))
      .sort((a: RequisitionLineRow, b: RequisitionLineRow) => a.lineNumber - b.lineNumber),
  };
}

export async function fetchRequisitions(): Promise<Requisition[]> {
  const rows = await fetchAllPages<any>(
    (from, to) =>
      requireSupabase()
        .from("requisitions")
        .select("*, requisition_lines(*)")
        .order("created_at", { ascending: false })
        .range(from, to),
    "fetchRequisitions",
  );
  return rows.map(requisitionFromRow);
}

export async function createRequisition(input: {
  reference: string;
  costCentreId: string | null;
  neededBy: string | null;
  justification: string | null;
  lines: Omit<RequisitionLineRow, "id" | "lineTotal">[];
}): Promise<Requisition> {
  const db = requireSupabase();
  const { data: auth } = await db.auth.getUser();
  const { data, error } = await db
    .from("requisitions")
    .insert({
      reference: input.reference,
      cost_centre_id: input.costCentreId,
      needed_by: input.neededBy,
      justification: input.justification,
      status: "DRAFT",
      requested_by: auth.user?.id ?? null,
      requested_by_email: auth.user?.email ?? null,
    })
    .select("*")
    .single();
  if (error) fail("createRequisition", error);

  if (input.lines.length > 0) {
    const { error: lineError } = await db.from("requisition_lines").insert(
      input.lines.map((l, i) => ({
        requisition_id: data.id,
        product_id: l.productId,
        description: l.description,
        quantity: l.quantity,
        unit: l.unit,
        estimated_unit_price: l.estimatedUnitPrice,
        // The database keeps the header total; the line total is ours.
        line_total: Number(l.estimatedUnitPrice) * l.quantity,
        suggested_supplier_id: l.suggestedSupplierId,
        line_number: i + 1,
      })),
    );
    if (lineError) {
      await db.from("requisitions").delete().eq("id", data.id);
      fail("createRequisition(lines)", lineError);
    }
  }
  return fetchRequisition(data.id);
}

export async function fetchRequisition(id: string): Promise<Requisition> {
  const { data, error } = await requireSupabase()
    .from("requisitions")
    .select("*, requisition_lines(*)")
    .eq("id", id)
    .single();
  if (error) fail("fetchRequisition", error);
  return requisitionFromRow(data);
}

export async function setRequisitionStatus(
  id: string,
  status: PurchaseStatus,
): Promise<void> {
  const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
  if (status === "SUBMITTED") patch.submitted_at = new Date().toISOString();
  const { error } = await requireSupabase().from("requisitions").update(patch).eq("id", id);
  if (error) fail("setRequisitionStatus", error);
}

export interface ApprovalEvent {
  id: string;
  documentType: string;
  documentId: string;
  action: "SUBMITTED" | "APPROVED" | "REJECTED" | "CANCELLED" | "REOPENED";
  actorEmail: string | null;
  actorRole: OrgRole | null;
  amount: string | null;
  comment: string | null;
  occurredAt: string;
}

export async function fetchApprovalEvents(
  documentId?: string,
): Promise<ApprovalEvent[]> {
  let q = requireSupabase()
    .from("approval_events")
    .select("*")
    .order("occurred_at", { ascending: false })
    .limit(500);
  if (documentId) q = q.eq("document_id", documentId);
  const { data, error } = await q;
  if (error) fail("fetchApprovalEvents", error);
  return (data ?? []).map((r: any) => ({
    id: r.id,
    documentType: r.document_type,
    documentId: r.document_id,
    action: r.action,
    actorEmail: r.actor_email ?? null,
    actorRole: r.actor_role ?? null,
    amount: r.amount === null || r.amount === undefined ? null : String(r.amount),
    comment: r.comment ?? null,
    occurredAt: r.occurred_at,
  }));
}

/**
 * Record a decision.
 *
 * The database refuses a self-approval or an approval above the actor's
 * authority, so a rejection here is the policy speaking, not a bug — the
 * message is worth showing verbatim.
 */
export async function recordApproval(
  documentType: "REQUISITION" | "PURCHASE_ORDER",
  documentId: string,
  action: ApprovalEvent["action"],
  comment: string | null,
): Promise<void> {
  const db = requireSupabase();
  const { data: auth } = await db.auth.getUser();
  const { error } = await db.from("approval_events").insert({
    document_type: documentType,
    document_id: documentId,
    action,
    actor_id: auth.user?.id ?? null,
    actor_email: auth.user?.email ?? null,
    comment,
  });
  if (error) fail("recordApproval", error);
}

export interface PurchaseOrderLineRow {
  id: string;
  productId: string | null;
  description: string | null;
  quantity: number;
  unit: string;
  unitPrice: string;
  taxPercent: number;
  lineTotal: string;
  quantityReceived: number;
  lineNumber: number;
}

export interface PurchaseOrder {
  id: string;
  reference: string;
  supplierId: string;
  supplierName: string | null;
  requisitionId: string | null;
  costCentreId: string | null;
  status: PurchaseStatus;
  orderedOn: string | null;
  expectedOn: string | null;
  subtotal: string;
  taxAmount: string;
  totalAmount: string;
  createdById: string | null;
  createdByEmail: string | null;
  notes: string | null;
  lines: PurchaseOrderLineRow[];
}

function purchaseOrderFromRow(r: any): PurchaseOrder {
  return {
    id: r.id,
    reference: r.reference,
    supplierId: r.supplier_id,
    supplierName: r.suppliers?.name ?? null,
    requisitionId: r.requisition_id ?? null,
    costCentreId: r.cost_centre_id ?? null,
    status: r.status,
    orderedOn: r.ordered_on ?? null,
    expectedOn: r.expected_on ?? null,
    subtotal: String(r.subtotal ?? 0),
    taxAmount: String(r.tax_amount ?? 0),
    totalAmount: String(r.total_amount ?? 0),
    createdById: r.created_by ?? null,
    createdByEmail: r.created_by_email ?? null,
    notes: r.notes ?? null,
    lines: (r.purchase_order_lines ?? [])
      .map((l: any) => ({
        id: l.id,
        productId: l.product_id ?? null,
        description: l.description ?? null,
        quantity: Number(l.quantity),
        unit: l.unit,
        unitPrice: String(l.unit_price ?? 0),
        taxPercent: Number(l.tax_percent ?? 0),
        lineTotal: String(l.line_total ?? 0),
        quantityReceived: Number(l.quantity_received ?? 0),
        lineNumber: l.line_number ?? 1,
      }))
      .sort((a: PurchaseOrderLineRow, b: PurchaseOrderLineRow) => a.lineNumber - b.lineNumber),
  };
}

export async function fetchPurchaseOrders(): Promise<PurchaseOrder[]> {
  const rows = await fetchAllPages<any>(
    (from, to) =>
      requireSupabase()
        .from("purchase_orders")
        .select("*, suppliers(name), purchase_order_lines(*)")
        .order("created_at", { ascending: false })
        .range(from, to),
    "fetchPurchaseOrders",
  );
  return rows.map(purchaseOrderFromRow);
}

export async function createPurchaseOrder(input: {
  reference: string;
  supplierId: string;
  requisitionId: string | null;
  costCentreId: string | null;
  expectedOn: string | null;
  taxPercent: number;
  lines: {
    productId: string | null;
    description: string | null;
    quantity: number;
    unit: string;
    unitPrice: string;
  }[];
}): Promise<void> {
  const db = requireSupabase();
  const { data: auth } = await db.auth.getUser();
  const { data, error } = await db
    .from("purchase_orders")
    .insert({
      reference: input.reference,
      supplier_id: input.supplierId,
      requisition_id: input.requisitionId,
      cost_centre_id: input.costCentreId,
      expected_on: input.expectedOn,
      status: "DRAFT",
      created_by: auth.user?.id ?? null,
      created_by_email: auth.user?.email ?? null,
    })
    .select("*")
    .single();
  if (error) fail("createPurchaseOrder", error);

  const { error: lineError } = await db.from("purchase_order_lines").insert(
    input.lines.map((l, i) => ({
      purchase_order_id: data.id,
      product_id: l.productId,
      description: l.description,
      quantity: l.quantity,
      unit: l.unit,
      unit_price: l.unitPrice,
      tax_percent: input.taxPercent,
      line_total: Number(l.unitPrice) * l.quantity,
      line_number: i + 1,
    })),
  );
  if (lineError) {
    await db.from("purchase_orders").delete().eq("id", data.id);
    fail("createPurchaseOrder(lines)", lineError);
  }
}

export async function setPurchaseOrderStatus(
  id: string,
  status: PurchaseStatus,
): Promise<void> {
  const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
  if (status === "ORDERED") patch.ordered_on = new Date().toISOString().slice(0, 10);
  const { error } = await requireSupabase().from("purchase_orders").update(patch).eq("id", id);
  if (error) fail("setPurchaseOrderStatus", error);
}

/** The signed-in user's role in the current organisation. */
export async function fetchMyRole(): Promise<OrgRole | null> {
  const db = requireSupabase();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) return null;
  const { data, error } = await db
    .from("organization_members")
    .select("role")
    .eq("user_id", auth.user.id)
    .limit(1)
    .maybeSingle();
  if (error) fail("fetchMyRole", error);
  return (data?.role as OrgRole) ?? null;
}

// ── Receiving, invoices, budgets ────────────────────────────────────────────

import type { MatchException, Tolerances, BudgetPosition } from "@/engine/invoice-matching";

export interface GoodsReceiptLineInput {
  purchaseOrderLineId: string | null;
  productId: string | null;
  quantityReceived: number;
  unit: string;
  quantityRejected: number;
  rejectionReason: string | null;
  conditionNote: string | null;
  /** Delivery details, when the line creates a traceable lot. */
  lot: NewLot | null;
}

/**
 * Book in a delivery.
 *
 * One act creates the receipt, the lots, and the stock movements. Splitting
 * them would let a delivery exist with no stock behind it, or stock with no
 * delivery — and the second of those is what Article 18 forbids.
 */
export async function recordGoodsReceipt(input: {
  reference: string;
  purchaseOrderId: string | null;
  supplierId: string | null;
  deliveryNote: string | null;
  vehicleTemperatureC: number | null;
  lines: GoodsReceiptLineInput[];
}): Promise<void> {
  const db = requireSupabase();
  const { data: auth } = await db.auth.getUser();

  const { data, error } = await db
    .from("goods_receipts")
    .insert({
      reference: input.reference,
      purchase_order_id: input.purchaseOrderId,
      supplier_id: input.supplierId,
      delivery_note: input.deliveryNote,
      vehicle_temperature_c: input.vehicleTemperatureC,
      received_by: auth.user?.id ?? null,
      received_by_email: auth.user?.email ?? null,
    })
    .select("*")
    .single();
  if (error) fail("recordGoodsReceipt", error);

  const movements: NewMovement[] = [];
  const lineRows: Record<string, unknown>[] = [];

  for (const [i, l] of input.lines.entries()) {
    let lotId: string | null = null;
    if (l.lot) {
      const lot = await createLot(l.lot);
      lotId = lot.id;
    }
    lineRows.push({
      goods_receipt_id: data.id,
      purchase_order_line_id: l.purchaseOrderLineId,
      product_id: l.productId,
      quantity_received: l.quantityReceived,
      unit: l.unit,
      lot_id: lotId,
      quantity_rejected: l.quantityRejected,
      rejection_reason: l.rejectionReason,
      condition_note: l.conditionNote,
      line_number: i + 1,
    });
    // Only what was accepted becomes stock. Rejected goods went back on the van.
    const accepted = l.quantityReceived - l.quantityRejected;
    if (l.productId && accepted > 0) {
      movements.push({
        productId: l.productId,
        kind: "RECEIPT",
        quantity: accepted,
        unit: l.unit,
        unitCost: l.lot ? null : null,
        reason: null,
        note: `Receipt ${input.reference}`,
        lotId,
      });
    }
  }

  const { error: lineError } = await db.from("goods_receipt_lines").insert(lineRows);
  if (lineError) {
    await db.from("goods_receipts").delete().eq("id", data.id);
    fail("recordGoodsReceipt(lines)", lineError);
  }
  if (movements.length > 0) await recordMovements(movements);
}

export interface GoodsReceiptRow {
  id: string;
  reference: string;
  purchaseOrderId: string | null;
  receivedOn: string;
  deliveryNote: string | null;
  receivedByEmail: string | null;
  lineCount: number;
  rejectedCount: number;
}

export async function fetchGoodsReceipts(): Promise<GoodsReceiptRow[]> {
  const { data, error } = await requireSupabase()
    .from("goods_receipts")
    .select("*, goods_receipt_lines(quantity_rejected)")
    .order("received_on", { ascending: false })
    .limit(500);
  if (error) fail("fetchGoodsReceipts", error);
  return (data ?? []).map((r: any) => ({
    id: r.id,
    reference: r.reference,
    purchaseOrderId: r.purchase_order_id ?? null,
    receivedOn: r.received_on,
    deliveryNote: r.delivery_note ?? null,
    receivedByEmail: r.received_by_email ?? null,
    lineCount: (r.goods_receipt_lines ?? []).length,
    rejectedCount: (r.goods_receipt_lines ?? []).filter(
      (l: any) => Number(l.quantity_rejected) > 0,
    ).length,
  }));
}

export interface SupplierInvoice {
  id: string;
  invoiceNumber: string;
  supplierId: string;
  supplierName: string | null;
  purchaseOrderId: string | null;
  invoiceDate: string;
  dueDate: string | null;
  subtotal: string;
  taxAmount: string;
  totalAmount: string;
  status: string;
  exceptions: MatchException[];
}

export async function fetchSupplierInvoices(): Promise<SupplierInvoice[]> {
  const { data, error } = await requireSupabase()
    .from("supplier_invoices")
    .select("*, suppliers(name)")
    .order("invoice_date", { ascending: false })
    .limit(500);
  if (error) fail("fetchSupplierInvoices", error);
  return (data ?? []).map((r: any) => ({
    id: r.id,
    invoiceNumber: r.invoice_number,
    supplierId: r.supplier_id,
    supplierName: r.suppliers?.name ?? null,
    purchaseOrderId: r.purchase_order_id ?? null,
    invoiceDate: r.invoice_date,
    dueDate: r.due_date ?? null,
    subtotal: String(r.subtotal ?? 0),
    taxAmount: String(r.tax_amount ?? 0),
    totalAmount: String(r.total_amount ?? 0),
    status: r.status,
    exceptions: (r.exceptions ?? []) as MatchException[],
  }));
}

export async function createSupplierInvoice(input: {
  invoiceNumber: string;
  supplierId: string;
  purchaseOrderId: string | null;
  invoiceDate: string;
  dueDate: string | null;
  paymentTermsDays: number | null;
  status: string;
  exceptions: MatchException[];
  lines: {
    purchaseOrderLineId: string | null;
    productId: string | null;
    description: string | null;
    quantity: number;
    unit: string;
    unitPrice: string;
    taxPercent: number;
  }[];
}): Promise<void> {
  const db = requireSupabase();
  const { data: auth } = await db.auth.getUser();
  const { data, error } = await db
    .from("supplier_invoices")
    .insert({
      invoice_number: input.invoiceNumber,
      supplier_id: input.supplierId,
      purchase_order_id: input.purchaseOrderId,
      invoice_date: input.invoiceDate,
      due_date: input.dueDate,
      payment_terms_days: input.paymentTermsDays,
      status: input.status,
      exceptions: input.exceptions,
      entered_by: auth.user?.id ?? null,
      entered_by_email: auth.user?.email ?? null,
    })
    .select("*")
    .single();
  if (error) fail("createSupplierInvoice", error);

  const { error: lineError } = await db.from("supplier_invoice_lines").insert(
    input.lines.map((l, i) => ({
      invoice_id: data.id,
      purchase_order_line_id: l.purchaseOrderLineId,
      product_id: l.productId,
      description: l.description,
      quantity: l.quantity,
      unit: l.unit,
      unit_price: l.unitPrice,
      tax_percent: l.taxPercent,
      line_total: Number(l.unitPrice) * l.quantity,
      line_number: i + 1,
    })),
  );
  if (lineError) {
    await db.from("supplier_invoices").delete().eq("id", data.id);
    fail("createSupplierInvoice(lines)", lineError);
  }
}

export async function setInvoiceStatus(
  id: string,
  status: string,
  exceptions?: MatchException[],
): Promise<void> {
  const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
  if (exceptions) patch.exceptions = exceptions;
  const { error } = await requireSupabase()
    .from("supplier_invoices")
    .update(patch)
    .eq("id", id);
  if (error) fail("setInvoiceStatus", error);
}

export async function fetchTolerances(): Promise<Tolerances | null> {
  const { data, error } = await requireSupabase()
    .from("matching_tolerances")
    .select("*")
    .limit(1)
    .maybeSingle();
  if (error) fail("fetchTolerances", error);
  if (!data) return null;
  return {
    pricePercent: Number(data.price_percent),
    priceAbsolute: String(data.price_absolute),
    quantityPercent: Number(data.quantity_percent),
    quantityAbsolute: Number(data.quantity_absolute),
  };
}

export async function fetchBudgetPositions(): Promise<BudgetPosition[]> {
  const { data, error } = await requireSupabase()
    .from("budget_positions")
    .select("*")
    .order("name");
  if (error) fail("fetchBudgetPositions", error);
  return (data ?? []).map((r: any) => ({
    budgetId: r.budget_id,
    costCentreId: r.cost_centre_id,
    name: r.name,
    amount: String(r.amount ?? 0),
    committed: String(r.committed ?? 0),
    actual: String(r.actual ?? 0),
    hardStop: Boolean(r.hard_stop),
  }));
}
