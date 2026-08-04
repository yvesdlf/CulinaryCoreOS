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
import type { HaccpField, ImportedHaccpForm } from "@/engine/haccp-import";
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

/**
 * The signed-in user's role in the organisation they write into.
 *
 * Scoped to that organisation rather than taking whichever membership comes
 * back first. A user can belong to more than one — the venue they were
 * invited to, and a personal one created when they signed up — and picking
 * arbitrarily would report a role from the wrong place.
 */
export async function fetchMyRole(): Promise<OrgRole | null> {
  const db = requireSupabase();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) return null;
  const { data: orgId, error: orgError } = await db.rpc("auth_default_org_id");
  if (orgError) fail("fetchMyRole(org)", orgError);
  if (!orgId) return null;
  const { data, error } = await db
    .from("organization_members")
    .select("role")
    .eq("user_id", auth.user.id)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (error) fail("fetchMyRole", error);
  return (data?.role as OrgRole) ?? null;
}

// ── Membership ──────────────────────────────────────────────────────────────

export interface OrgPerson {
  userId: string;
  email: string | null;
  role: OrgRole;
  joinedAt: string;
}

export interface Invitation {
  id: string;
  email: string;
  role: OrgRole;
  invitedByEmail: string | null;
  createdAt: string;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
}

export async function fetchOrgPeople(): Promise<OrgPerson[]> {
  const { data, error } = await requireSupabase()
    .from("organization_people")
    .select("*")
    .order("role");
  if (error) fail("fetchOrgPeople", error);
  return (data ?? []).map((r: any) => ({
    userId: r.user_id, email: r.email ?? null,
    role: r.role as OrgRole, joinedAt: r.created_at,
  }));
}

export async function fetchInvitations(): Promise<Invitation[]> {
  const { data, error } = await requireSupabase()
    .from("organization_invitations")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) fail("fetchInvitations", error);
  return (data ?? []).map((r: any) => ({
    id: r.id, email: r.email, role: r.role as OrgRole,
    invitedByEmail: r.invited_by_email ?? null,
    createdAt: r.created_at, expiresAt: r.expires_at,
    acceptedAt: r.accepted_at ?? null, revokedAt: r.revoked_at ?? null,
  }));
}

/**
 * Invite somebody.
 *
 * The database refuses an admin inviting an owner, so a rejection here is the
 * policy speaking and its message is worth showing as written.
 */
export async function inviteToOrg(email: string, role: OrgRole): Promise<void> {
  const db = requireSupabase();
  const { data: auth } = await db.auth.getUser();
  const { data: orgId, error: orgError } = await db.rpc("auth_default_org_id");
  if (orgError) fail("inviteToOrg(org)", orgError);
  const { error } = await db.from("organization_invitations").insert({
    organization_id: orgId,
    email: email.trim().toLowerCase(),
    role,
    invited_by: auth.user?.id ?? null,
    invited_by_email: auth.user?.email ?? null,
  });
  if (error) fail("inviteToOrg", error);
}

export async function revokeInvitation(id: string): Promise<void> {
  const { error } = await requireSupabase()
    .from("organization_invitations")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id);
  if (error) fail("revokeInvitation", error);
}

/** Invitations addressed to the signed-in user that are still open. */
export async function fetchMyInvitations(): Promise<
  (Invitation & { organizationName: string | null })[]
> {
  const db = requireSupabase();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user?.email) return [];
  const { data, error } = await db
    .from("organization_invitations")
    .select("*, organizations(name)")
    .is("accepted_at", null)
    .is("revoked_at", null);
  if (error) fail("fetchMyInvitations", error);
  return (data ?? [])
    .filter((r: any) => r.email?.toLowerCase() === auth.user!.email!.toLowerCase())
    .map((r: any) => ({
      id: r.id, email: r.email, role: r.role as OrgRole,
      invitedByEmail: r.invited_by_email ?? null,
      createdAt: r.created_at, expiresAt: r.expires_at,
      acceptedAt: null, revokedAt: null,
      organizationName: r.organizations?.name ?? null,
    }));
}

export async function acceptInvitation(id: string): Promise<void> {
  const { error } = await requireSupabase().rpc("accept_invitation", {
    invitation_id: id,
  });
  if (error) fail("acceptInvitation", error);
}

/** Change somebody's role. Guarded by trigger — see migration 0024. */
export async function setMemberRole(userId: string, role: OrgRole): Promise<void> {
  const db = requireSupabase();
  const { data: orgId, error: orgError } = await db.rpc("auth_default_org_id");
  if (orgError) fail("setMemberRole(org)", orgError);
  const { error } = await db
    .from("organization_members")
    .update({ role })
    .eq("user_id", userId)
    .eq("organization_id", orgId);
  if (error) fail("setMemberRole", error);
}

export async function removeMember(userId: string): Promise<void> {
  const db = requireSupabase();
  const { data: orgId, error: orgError } = await db.rpc("auth_default_org_id");
  if (orgError) fail("removeMember(org)", orgError);
  const { error } = await db
    .from("organization_members")
    .delete()
    .eq("user_id", userId)
    .eq("organization_id", orgId);
  if (error) fail("removeMember", error);
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

// ── People ──────────────────────────────────────────────────────────────────

import type {
  Employee, Certification, LeaveRequest, LeaveType,
} from "@/engine/people";

export interface Department { id: string; code: string; name: string }
export interface JobRole {
  id: string; title: string; departmentId: string | null;
  level: number; requiredCertifications: string[];
}

export async function fetchDepartments(): Promise<Department[]> {
  const { data, error } = await requireSupabase()
    .from("departments").select("*").order("name");
  if (error) fail("fetchDepartments", error);
  return (data ?? []).map((r: any) => ({ id: r.id, code: r.code, name: r.name }));
}

export async function fetchJobRoles(): Promise<JobRole[]> {
  const { data, error } = await requireSupabase()
    .from("job_roles").select("*").order("title");
  if (error) fail("fetchJobRoles", error);
  return (data ?? []).map((r: any) => ({
    id: r.id, title: r.title, departmentId: r.department_id ?? null,
    level: r.level ?? 1, requiredCertifications: r.required_certifications ?? [],
  }));
}

export async function fetchEmployees(): Promise<Employee[]> {
  const rows = await fetchAllPages<any>(
    (from, to) =>
      requireSupabase().from("employees").select("*").order("last_name").range(from, to),
    "fetchEmployees",
  );
  return rows.map((r) => ({
    id: r.id,
    employeeNumber: r.employee_number,
    firstName: r.first_name,
    lastName: r.last_name,
    departmentId: r.department_id ?? null,
    jobRoleId: r.job_role_id ?? null,
    managerId: r.manager_id ?? null,
    employmentStatus: r.employment_status,
    employmentType: r.employment_type,
    startedOn: r.started_on ?? null,
    contractedHoursPerWeek:
      r.contracted_hours_per_week === null || r.contracted_hours_per_week === undefined
        ? null
        : Number(r.contracted_hours_per_week),
  }));
}

export async function upsertEmployee(input: {
  id?: string;
  employeeNumber: string;
  firstName: string;
  lastName: string;
  workEmail: string | null;
  departmentId: string | null;
  jobRoleId: string | null;
  managerId: string | null;
  employmentStatus: string;
  employmentType: string;
  startedOn: string | null;
  contractedHoursPerWeek: number | null;
}): Promise<void> {
  const row = {
    employee_number: input.employeeNumber,
    first_name: input.firstName,
    last_name: input.lastName,
    work_email: input.workEmail,
    department_id: input.departmentId,
    job_role_id: input.jobRoleId,
    manager_id: input.managerId,
    employment_status: input.employmentStatus,
    employment_type: input.employmentType,
    started_on: input.startedOn,
    contracted_hours_per_week: input.contractedHoursPerWeek,
    updated_at: new Date().toISOString(),
  };
  const db = requireSupabase();
  const { error } = input.id
    ? await db.from("employees").update(row).eq("id", input.id)
    : await db.from("employees").insert(row);
  if (error) fail("upsertEmployee", error);
}

export async function fetchCertifications(): Promise<Certification[]> {
  const { data, error } = await requireSupabase()
    .from("employee_certifications").select("*").order("expires_on");
  if (error) fail("fetchCertifications", error);
  return (data ?? []).map((r: any) => ({
    id: r.id, employeeId: r.employee_id, kind: r.kind,
    expiresOn: r.expires_on ?? null,
  }));
}

export async function addCertification(input: {
  employeeId: string; kind: string; reference: string | null;
  issuedOn: string | null; expiresOn: string | null;
}): Promise<void> {
  const { error } = await requireSupabase().from("employee_certifications").insert({
    employee_id: input.employeeId, kind: input.kind, reference: input.reference,
    issued_on: input.issuedOn, expires_on: input.expiresOn,
  });
  if (error) fail("addCertification", error);
}

export async function fetchLeaveTypes(): Promise<LeaveType[]> {
  const { data, error } = await requireSupabase()
    .from("leave_types").select("*").order("name");
  if (error) fail("fetchLeaveTypes", error);
  return (data ?? []).map((r: any) => ({
    id: r.id, code: r.code, name: r.name, paid: r.paid,
    annualEntitlementDays:
      r.annual_entitlement_days === null ? null : Number(r.annual_entitlement_days),
    maxCarryoverDays:
      r.max_carryover_days === null ? null : Number(r.max_carryover_days),
  }));
}

export async function fetchLeaveRequests(): Promise<LeaveRequest[]> {
  const { data, error } = await requireSupabase()
    .from("leave_requests").select("*").order("starts_on", { ascending: false }).limit(1000);
  if (error) fail("fetchLeaveRequests", error);
  return (data ?? []).map((r: any) => ({
    id: r.id, employeeId: r.employee_id, leaveTypeId: r.leave_type_id,
    startsOn: r.starts_on, endsOn: r.ends_on, days: Number(r.days), status: r.status,
  }));
}

/**
 * Apply for leave, optionally with a photograph of a sick note.
 *
 * The request is written first and the note attached to it, because until the
 * request exists the note has nothing to belong to. The note goes to a private
 * bucket: it is health data about a named person, and the storage policy
 * limits it to them and to whoever administers People.
 */
export async function requestLeave(input: {
  employeeId: string; leaveTypeId: string;
  startsOn: string; endsOn: string; days: number; note: string | null;
  orgId?: string;
  sickNote?: File | null;
}): Promise<void> {
  const db = requireSupabase();
  const { data: auth } = await db.auth.getUser();
  const { data, error } = await db.from("leave_requests").insert({
    employee_id: input.employeeId, leave_type_id: input.leaveTypeId,
    starts_on: input.startsOn, ends_on: input.endsOn, days: input.days,
    note: input.note, status: "REQUESTED",
    ...(input.orgId ? { org_id: input.orgId } : {}),
    requested_by: auth.user?.id ?? null,
    requested_by_email: auth.user?.email ?? null,
  }).select("id").single();
  if (error) fail("requestLeave", error);

  if (input.sickNote && input.orgId) {
    // org/employee/filename — the storage policy reads both from the path, so
    // nobody can file a note against a colleague.
    const path = `${input.orgId}/${input.employeeId}/${Date.now()}-${input.sickNote.name}`;
    const { error: upErr } = await db.storage
      .from("sick-notes").upload(path, input.sickNote, { upsert: false });
    if (upErr) fail("requestLeave (sick note)", upErr);

    const { error: attErr } = await db.from("leave_attachments").insert({
      org_id: input.orgId,
      leave_request_id: (data as any).id,
      file_path: path,
      file_name: input.sickNote.name,
      content_type: input.sickNote.type,
      uploaded_by_email: auth.user?.email ?? null,
    });
    if (attErr) fail("requestLeave (attachment)", attErr);
  }
}

/**
 * Decide a leave request.
 *
 * The database refuses a decision by the person who asked, so a rejection
 * here is the policy speaking and its message is worth showing verbatim.
 */
export async function decideLeave(
  id: string,
  status: "APPROVED" | "REJECTED",
  note: string | null,
): Promise<void> {
  const db = requireSupabase();
  const { data: auth } = await db.auth.getUser();
  const { error } = await db.from("leave_requests").update({
    status,
    decided_by: auth.user?.id ?? null,
    decided_by_email: auth.user?.email ?? null,
    decision_note: note,
    updated_at: new Date().toISOString(),
  }).eq("id", id);
  if (error) fail("decideLeave", error);
}

// ── Scheduling and attendance ───────────────────────────────────────────────

import type { Shift, AttendanceRecord } from "@/engine/scheduling";

export async function fetchShifts(fromIso: string, toIso: string): Promise<Shift[]> {
  const { data, error } = await requireSupabase()
    .from("shifts").select("*")
    .gte("starts_at", fromIso).lt("starts_at", toIso)
    .order("starts_at");
  if (error) fail("fetchShifts", error);
  return (data ?? []).map((r: any) => ({
    id: r.id, employeeId: r.employee_id ?? null,
    departmentId: r.department_id ?? null, jobRoleId: r.job_role_id ?? null,
    startsAt: r.starts_at, endsAt: r.ends_at,
    breakMinutes: r.break_minutes ?? 0, status: r.status,
  }));
}

export async function saveShift(input: {
  id?: string;
  employeeId: string | null;
  departmentId: string | null;
  jobRoleId: string | null;
  startsAt: string;
  endsAt: string;
  breakMinutes: number;
  status: "DRAFT" | "PUBLISHED" | "CANCELLED";
  notes?: string | null;
}): Promise<void> {
  const db = requireSupabase();
  const { data: auth } = await db.auth.getUser();
  const row = {
    employee_id: input.employeeId, department_id: input.departmentId,
    job_role_id: input.jobRoleId, starts_at: input.startsAt, ends_at: input.endsAt,
    break_minutes: input.breakMinutes, status: input.status,
    notes: input.notes ?? null, updated_at: new Date().toISOString(),
  };
  const { error } = input.id
    ? await db.from("shifts").update(row).eq("id", input.id)
    : await db.from("shifts").insert({
        ...row, created_by: auth.user?.id ?? null,
        created_by_email: auth.user?.email ?? null,
      });
  // The database refuses an uncertified or on-leave assignment; that message
  // is the policy speaking and is worth showing as written.
  if (error) fail("saveShift", error);
}

export async function deleteShift(id: string): Promise<void> {
  const { error } = await requireSupabase().from("shifts").delete().eq("id", id);
  if (error) fail("deleteShift", error);
}

export async function fetchAttendance(
  fromIso: string, toIso: string,
): Promise<AttendanceRecord[]> {
  const { data, error } = await requireSupabase()
    .from("attendance").select("*")
    .gte("effective_in", fromIso).lt("effective_in", toIso)
    .order("effective_in", { ascending: false });
  if (error) fail("fetchAttendance", error);
  return (data ?? []).map((r: any) => ({
    employeeId: r.employee_id, shiftId: r.shift_id ?? null,
    effectiveIn: r.effective_in, effectiveOut: r.effective_out ?? null,
    hours: r.hours === null || r.hours === undefined ? null : Number(r.hours),
    corrected: Boolean(r.corrected),
  }));
}

/** Open punches — people currently on the clock. */
export async function fetchOpenEntries(): Promise<
  { id: string; employeeId: string; clockInAt: string; shiftId: string | null }[]
> {
  const { data, error } = await requireSupabase()
    .from("time_entries").select("id, employee_id, clock_in_at, shift_id")
    .is("clock_out_at", null);
  if (error) fail("fetchOpenEntries", error);
  return (data ?? []).map((r: any) => ({
    id: r.id, employeeId: r.employee_id,
    clockInAt: r.clock_in_at, shiftId: r.shift_id ?? null,
  }));
}

/**
 * Clock in, and say where from.
 *
 * The coordinates are sent for the database to judge; nothing here decides
 * whether they are close enough. A geofence checked in the browser is a
 * geofence anybody can pass, so the check lives in a trigger and this only
 * reports the position honestly — including reporting that there wasn't one,
 * which is recorded rather than hidden.
 */
export async function clockIn(
  employeeId: string,
  shiftId: string | null,
  position?: { latitude: number; longitude: number; accuracy: number } | null,
): Promise<void> {
  const db = requireSupabase();
  const { data: auth } = await db.auth.getUser();
  const { error } = await db.from("time_entries").insert({
    employee_id: employeeId, shift_id: shiftId,
    clock_in_at: new Date().toISOString(), source: "WEB",
    latitude: position?.latitude ?? null,
    longitude: position?.longitude ?? null,
    accuracy_m: position?.accuracy ?? null,
    recorded_by: auth.user?.id ?? null,
    recorded_by_email: auth.user?.email ?? null,
  });
  if (error) fail("clockIn", error);
}

export async function clockOut(entryId: string, breakMinutes: number): Promise<void> {
  const { error } = await requireSupabase().from("time_entries")
    .update({ clock_out_at: new Date().toISOString(), break_minutes: breakMinutes })
    .eq("id", entryId);
  if (error) fail("clockOut", error);
}

// ── Vendor portal and notifications ─────────────────────────────────────────

export interface PortalOrder {
  id: string; reference: string; status: string; orderedOn: string | null;
  expectedOn: string | null; totalAmount: string; buyerName: string;
  acknowledgedAt: string | null; supplierPromisedOn: string | null;
  supplierNote: string | null;
}

/** Null when the signed-in person is not a supplier contact. */
export async function fetchMySupplierId(): Promise<string | null> {
  const { data, error } = await requireSupabase().rpc("auth_supplier_id");
  if (error) fail("fetchMySupplierId", error);
  return (data as string | null) ?? null;
}

export async function fetchPortalOrders(): Promise<PortalOrder[]> {
  const { data, error } = await requireSupabase()
    .from("portal_orders").select("*").order("ordered_on", { ascending: false });
  if (error) fail("fetchPortalOrders", error);
  return (data ?? []).map((r: any) => ({
    id: r.id, reference: r.reference, status: r.status,
    orderedOn: r.ordered_on ?? null, expectedOn: r.expected_on ?? null,
    totalAmount: String(r.total_amount ?? 0), buyerName: r.buyer_name,
    acknowledgedAt: r.acknowledged_at ?? null,
    supplierPromisedOn: r.supplier_promised_on ?? null,
    supplierNote: r.supplier_note ?? null,
  }));
}

export async function fetchPortalOrderLines(orderId: string): Promise<
  { id: string; description: string | null; quantity: number; unit: string;
    unitPrice: string; lineTotal: string; quantityReceived: number }[]
> {
  const { data, error } = await requireSupabase()
    .from("portal_order_lines").select("*")
    .eq("purchase_order_id", orderId).order("line_number");
  if (error) fail("fetchPortalOrderLines", error);
  return (data ?? []).map((r: any) => ({
    id: r.id, description: r.description ?? null,
    quantity: Number(r.quantity), unit: r.unit,
    unitPrice: String(r.unit_price ?? 0), lineTotal: String(r.line_total ?? 0),
    quantityReceived: Number(r.quantity_received ?? 0),
  }));
}

export async function fetchPortalInvoices(): Promise<
  { id: string; invoiceNumber: string; invoiceDate: string; dueDate: string | null;
    totalAmount: string; status: string; hasQuery: boolean }[]
> {
  const { data, error } = await requireSupabase()
    .from("portal_invoices").select("*").order("invoice_date", { ascending: false });
  if (error) fail("fetchPortalInvoices", error);
  return (data ?? []).map((r: any) => ({
    id: r.id, invoiceNumber: r.invoice_number, invoiceDate: r.invoice_date,
    dueDate: r.due_date ?? null, totalAmount: String(r.total_amount ?? 0),
    status: r.status, hasQuery: Boolean(r.has_query),
  }));
}

export async function acknowledgeOrder(
  orderId: string, promisedOn: string | null, note: string | null,
): Promise<void> {
  const { error } = await requireSupabase().rpc("acknowledge_purchase_order", {
    order_id: orderId, promised_on: promisedOn, note,
  });
  if (error) fail("acknowledgeOrder", error);
}

export interface Notification {
  id: string; kind: string; subject: string; body: string | null;
  entityType: string | null; entityId: string | null;
  createdAt: string; readAt: string | null; forSupplier: boolean;
}

export async function fetchNotifications(): Promise<Notification[]> {
  const { data, error } = await requireSupabase()
    .from("notifications").select("*")
    .order("created_at", { ascending: false }).limit(200);
  if (error) fail("fetchNotifications", error);
  return (data ?? []).map((r: any) => ({
    id: r.id, kind: r.kind, subject: r.subject, body: r.body ?? null,
    entityType: r.entity_type ?? null, entityId: r.entity_id ?? null,
    createdAt: r.created_at, readAt: r.read_at ?? null,
    forSupplier: r.supplier_id !== null,
  }));
}

export async function markNotificationRead(id: string): Promise<void> {
  const db = requireSupabase();
  const { data: auth } = await db.auth.getUser();
  const { error } = await db.from("notifications")
    .update({ read_at: new Date().toISOString(), read_by: auth.user?.id ?? null })
    .eq("id", id);
  if (error) fail("markNotificationRead", error);
}

export async function inviteSupplierContact(
  supplierId: string, email: string,
): Promise<void> {
  const db = requireSupabase();
  const { data: auth } = await db.auth.getUser();
  const { error } = await db.from("supplier_users").insert({
    supplier_id: supplierId,
    email: email.trim().toLowerCase(),
    invited_by_email: auth.user?.email ?? null,
  });
  if (error) fail("inviteSupplierContact", error);
}

// ── Contracts ───────────────────────────────────────────────────────────────

export interface Contract {
  id: string; supplierId: string; reference: string; title: string;
  status: string; startsOn: string; endsOn: string | null;
  noticeBy: string | null; autoRenews: boolean;
  minimumCommitment: string | null; leadTimeDays: number | null;
  deliveryDays: string | null; serviceTerms: string | null; notes: string | null;
}

export async function fetchContracts(): Promise<Contract[]> {
  const { data, error } = await requireSupabase()
    .from("contracts").select("*").order("ends_on", { nullsFirst: false });
  if (error) fail("fetchContracts", error);
  return (data ?? []).map((r: any) => ({
    id: r.id, supplierId: r.supplier_id, reference: r.reference, title: r.title,
    status: r.status, startsOn: r.starts_on, endsOn: r.ends_on ?? null,
    noticeBy: r.notice_by ?? null, autoRenews: Boolean(r.auto_renews),
    minimumCommitment: r.minimum_commitment === null ? null : String(r.minimum_commitment),
    leadTimeDays: r.lead_time_days ?? null, deliveryDays: r.delivery_days ?? null,
    serviceTerms: r.service_terms ?? null, notes: r.notes ?? null,
  }));
}

export async function saveContract(input: Partial<Contract> & {
  supplierId: string; reference: string; title: string; startsOn: string;
}): Promise<void> {
  const db = requireSupabase();
  const { data: auth } = await db.auth.getUser();
  const row = {
    supplier_id: input.supplierId, reference: input.reference, title: input.title,
    starts_on: input.startsOn, ends_on: input.endsOn ?? null,
    notice_by: input.noticeBy ?? null, auto_renews: input.autoRenews ?? false,
    minimum_commitment: input.minimumCommitment ?? null,
    lead_time_days: input.leadTimeDays ?? null,
    delivery_days: input.deliveryDays ?? null,
    service_terms: input.serviceTerms ?? null, notes: input.notes ?? null,
    status: input.status ?? "ACTIVE",
    updated_at: new Date().toISOString(),
  };
  const { error } = input.id
    ? await db.from("contracts").update(row).eq("id", input.id)
    : await db.from("contracts").insert({ ...row, created_by_email: auth.user?.email ?? null });
  if (error) fail("saveContract", error);
}

export async function refreshContractStatuses(): Promise<void> {
  const { error } = await requireSupabase().rpc("refresh_contract_statuses");
  if (error) fail("refreshContractStatuses", error);
}

export async function fetchContractAttention(): Promise<
  { id: string; reference: string; title: string; supplierName: string;
    status: string; endsOn: string | null; noticeBy: string | null;
    daysToEnd: number | null; daysToNotice: number | null; autoRenews: boolean }[]
> {
  const { data, error } = await requireSupabase()
    .from("contract_attention").select("*").order("days_to_notice", { nullsFirst: false });
  if (error) fail("fetchContractAttention", error);
  return (data ?? []).map((r: any) => ({
    id: r.id, reference: r.reference, title: r.title,
    supplierName: r.supplier_name, status: r.status,
    endsOn: r.ends_on ?? null, noticeBy: r.notice_by ?? null,
    daysToEnd: r.days_to_end ?? null, daysToNotice: r.days_to_notice ?? null,
    autoRenews: Boolean(r.auto_renews),
  }));
}

export interface ContractPrice {
  id: string; contractId: string; productId: string | null;
  description: string | null; unit: string; unitPrice: string;
  effectiveFrom: string; effectiveTo: string | null;
}

export async function fetchContractPrices(contractId: string): Promise<ContractPrice[]> {
  const { data, error } = await requireSupabase()
    .from("contract_prices").select("*")
    .eq("contract_id", contractId).order("effective_from", { ascending: false });
  if (error) fail("fetchContractPrices", error);
  return (data ?? []).map((r: any) => ({
    id: r.id, contractId: r.contract_id, productId: r.product_id ?? null,
    description: r.description ?? null, unit: r.unit,
    unitPrice: String(r.unit_price), effectiveFrom: r.effective_from,
    effectiveTo: r.effective_to ?? null,
  }));
}

export async function addContractPrice(input: {
  contractId: string; productId: string | null; description: string | null;
  unit: string; unitPrice: string; effectiveFrom: string; effectiveTo: string | null;
}): Promise<void> {
  const { error } = await requireSupabase().from("contract_prices").insert({
    contract_id: input.contractId, product_id: input.productId,
    description: input.description, unit: input.unit,
    unit_price: input.unitPrice, effective_from: input.effectiveFrom,
    effective_to: input.effectiveTo,
  });
  if (error) fail("addContractPrice", error);
}

/** The agreed price for a product from a supplier on a date, if any. */
export async function contractPriceFor(
  productId: string, supplierId: string, onDate: string,
): Promise<string | null> {
  const { data, error } = await requireSupabase().rpc("contract_price_for", {
    p_product: productId, p_supplier: supplierId, p_on: onDate,
  });
  if (error) fail("contractPriceFor", error);
  return data === null || data === undefined ? null : String(data);
}

// ── Onboarding and offboarding ──────────────────────────────────────────────

export interface EmployeeTask {
  id: string; employeeId: string; employeeName: string; kind: string;
  category: string; title: string; detail: string | null;
  dueOn: string | null; blocksCompletion: boolean; daysUntilDue: number | null;
}

export async function fetchTaskBoard(): Promise<EmployeeTask[]> {
  const { data, error } = await requireSupabase()
    .from("employee_task_board").select("*").order("due_on", { nullsFirst: false });
  if (error) fail("fetchTaskBoard", error);
  return (data ?? []).map((r: any) => ({
    id: r.id, employeeId: r.employee_id, employeeName: r.employee_name,
    kind: r.kind, category: r.category, title: r.title, detail: r.detail ?? null,
    dueOn: r.due_on ?? null, blocksCompletion: Boolean(r.blocks_completion),
    daysUntilDue: r.days_until_due ?? null,
  }));
}

export async function startChecklist(
  employeeId: string, kind: "ONBOARDING" | "OFFBOARDING", anchor: string | null,
): Promise<number> {
  const { data, error } = await requireSupabase().rpc("start_checklist", {
    p_employee: employeeId, p_kind: kind, p_anchor: anchor,
  });
  if (error) fail("startChecklist", error);
  return Number(data ?? 0);
}

export async function completeTask(id: string, note: string | null): Promise<void> {
  const db = requireSupabase();
  const { data: auth } = await db.auth.getUser();
  const { error } = await db.from("employee_tasks").update({
    completed_at: new Date().toISOString(),
    completed_by_email: auth.user?.email ?? null,
    note,
  }).eq("id", id);
  if (error) fail("completeTask", error);
}

// ── Tax rates and channels ──────────────────────────────────────────────────

export interface TaxRate {
  id: string; name: string; percent: number; isDefault: boolean; note: string | null;
}

export async function fetchTaxRates(): Promise<TaxRate[]> {
  const { data, error } = await requireSupabase()
    .from("tax_rates").select("*").order("is_default", { ascending: false }).order("name");
  if (error) fail("fetchTaxRates", error);
  return (data ?? []).map((r: any) => ({
    id: r.id, name: r.name, percent: Number(r.percent),
    isDefault: Boolean(r.is_default), note: r.note ?? null,
  }));
}

export async function saveTaxRate(input: {
  id?: string; name: string; percent: number; note: string | null;
}): Promise<void> {
  const db = requireSupabase();
  const row = { name: input.name, percent: input.percent, note: input.note,
                updated_at: new Date().toISOString() };
  const { error } = input.id
    ? await db.from("tax_rates").update(row).eq("id", input.id)
    : await db.from("tax_rates").insert(row);
  if (error) fail("saveTaxRate", error);
}

/**
 * Make one rate the default.
 *
 * Two writes because a unique partial index enforces exactly one — clearing
 * the old one first is what keeps the constraint satisfiable.
 */
export async function setDefaultTaxRate(id: string): Promise<void> {
  const db = requireSupabase();
  const { error: clear } = await db.from("tax_rates")
    .update({ is_default: false }).eq("is_default", true);
  if (clear) fail("setDefaultTaxRate(clear)", clear);
  const { error } = await db.from("tax_rates").update({ is_default: true }).eq("id", id);
  if (error) fail("setDefaultTaxRate", error);
}

export async function deleteTaxRate(id: string): Promise<void> {
  const { error } = await requireSupabase().from("tax_rates").delete().eq("id", id);
  if (error) fail("deleteTaxRate", error);
}

export interface CategoryTaxRate { id: string; category: string; taxRateId: string }

export async function fetchCategoryTaxRates(): Promise<CategoryTaxRate[]> {
  const { data, error } = await requireSupabase()
    .from("category_tax_rates").select("*").order("category");
  if (error) fail("fetchCategoryTaxRates", error);
  return (data ?? []).map((r: any) => ({
    id: r.id, category: r.category, taxRateId: r.tax_rate_id,
  }));
}

export async function setCategoryTaxRate(
  category: string, taxRateId: string | null,
): Promise<void> {
  const db = requireSupabase();
  if (taxRateId === null) {
    const { error } = await db.from("category_tax_rates").delete().eq("category", category);
    if (error) fail("setCategoryTaxRate(clear)", error);
    return;
  }
  const { error } = await db.from("category_tax_rates")
    .upsert({ category, tax_rate_id: taxRateId }, { onConflict: "org_id,category" });
  if (error) fail("setCategoryTaxRate", error);
}

export interface MessageChannel {
  id: string; kind: string; name: string; enabled: boolean;
  config: Record<string, unknown>;
}

export async function fetchMessageChannels(): Promise<MessageChannel[]> {
  const { data, error } = await requireSupabase()
    .from("message_channels").select("*").order("kind");
  if (error) fail("fetchMessageChannels", error);
  return (data ?? []).map((r: any) => ({
    id: r.id, kind: r.kind, name: r.name,
    enabled: Boolean(r.enabled), config: r.config ?? {},
  }));
}

export async function saveMessageChannel(
  id: string, enabled: boolean, config: Record<string, unknown>,
): Promise<void> {
  const { error } = await requireSupabase().from("message_channels")
    .update({ enabled, config, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) fail("saveMessageChannel", error);
}

export async function fetchDeliveryHealth(): Promise<
  { status: string; count: number }[]
> {
  const { data, error } = await requireSupabase()
    .from("message_deliveries").select("status").limit(1000);
  if (error) fail("fetchDeliveryHealth", error);
  const counts = new Map<string, number>();
  for (const r of data ?? []) counts.set(r.status, (counts.get(r.status) ?? 0) + 1);
  return [...counts.entries()].map(([status, count]) => ({ status, count }));
}

// ── Sourcing ────────────────────────────────────────────────────────────────

export interface Rfq {
  id: string; reference: string; title: string; status: string;
  neededBy: string | null; closesAt: string | null; notes: string | null;
}

export async function fetchRfqs(): Promise<Rfq[]> {
  const { data, error } = await requireSupabase()
    .from("rfqs").select("*").order("created_at", { ascending: false });
  if (error) fail("fetchRfqs", error);
  return (data ?? []).map((r: any) => ({
    id: r.id, reference: r.reference, title: r.title, status: r.status,
    neededBy: r.needed_by ?? null, closesAt: r.closes_at ?? null, notes: r.notes ?? null,
  }));
}

export async function createRfq(input: {
  reference: string; title: string; neededBy: string | null; closesAt: string | null;
  lines: { productId: string | null; description: string | null; quantity: number; unit: string }[];
  supplierIds: string[];
}): Promise<void> {
  const db = requireSupabase();
  const { data: auth } = await db.auth.getUser();
  const { data, error } = await db.from("rfqs").insert({
    reference: input.reference, title: input.title,
    needed_by: input.neededBy, closes_at: input.closesAt,
    status: "DRAFT", created_by_email: auth.user?.email ?? null,
  }).select("*").single();
  if (error) fail("createRfq", error);

  const { error: le } = await db.from("rfq_lines").insert(
    input.lines.map((l, i) => ({
      rfq_id: data.id, product_id: l.productId, description: l.description,
      quantity: l.quantity, unit: l.unit, line_number: i + 1,
    })),
  );
  if (le) { await db.from("rfqs").delete().eq("id", data.id); fail("createRfq(lines)", le); }

  if (input.supplierIds.length > 0) {
    const { error: se } = await db.from("rfq_suppliers").insert(
      input.supplierIds.map((s) => ({ rfq_id: data.id, supplier_id: s })),
    );
    if (se) fail("createRfq(suppliers)", se);
  }
}

export async function sendRfq(id: string): Promise<void> {
  const { error } = await requireSupabase().from("rfqs")
    .update({ status: "SENT", sent_at: new Date().toISOString() }).eq("id", id);
  if (error) fail("sendRfq", error);
}

export interface QuoteRow {
  rfqLineId: string; lineNumber: number; description: string | null;
  quantity: number; unit: string; quoteId: string | null;
  supplierId: string | null; supplierName: string | null;
  unitPrice: string | null; lineTotal: string | null;
  leadTimeDays: number | null; isLate: boolean; awarded: boolean;
}

export async function fetchRfqComparison(rfqId: string): Promise<QuoteRow[]> {
  const { data, error } = await requireSupabase()
    .from("rfq_comparison").select("*").eq("rfq_id", rfqId).order("line_number");
  if (error) fail("fetchRfqComparison", error);
  return (data ?? []).map((r: any) => ({
    rfqLineId: r.rfq_line_id, lineNumber: r.line_number,
    description: r.description ?? null, quantity: Number(r.quantity), unit: r.unit,
    quoteId: r.quote_id ?? null, supplierId: r.supplier_id ?? null,
    supplierName: r.supplier_name ?? null,
    unitPrice: r.unit_price === null ? null : String(r.unit_price),
    lineTotal: r.line_total === null ? null : String(r.line_total),
    leadTimeDays: r.lead_time_days ?? null,
    isLate: Boolean(r.is_late), awarded: Boolean(r.awarded),
  }));
}

export async function awardQuote(input: {
  rfqId: string; rfqLineId: string; supplierId: string;
  quoteId: string | null; rationale: string;
}): Promise<void> {
  const db = requireSupabase();
  const { data: auth } = await db.auth.getUser();
  const { error } = await db.from("rfq_awards").insert({
    rfq_id: input.rfqId, rfq_line_id: input.rfqLineId,
    supplier_id: input.supplierId, quote_id: input.quoteId,
    rationale: input.rationale, awarded_by_email: auth.user?.email ?? null,
  });
  if (error) fail("awardQuote", error);
}

export async function fetchPortalRfqs(): Promise<
  { id: string; reference: string; title: string; status: string;
    neededBy: string | null; closesAt: string | null; buyerName: string;
    respondedAt: string | null }[]
> {
  const { data, error } = await requireSupabase()
    .from("portal_rfqs").select("*").order("closes_at");
  if (error) fail("fetchPortalRfqs", error);
  return (data ?? []).map((r: any) => ({
    id: r.id, reference: r.reference, title: r.title, status: r.status,
    neededBy: r.needed_by ?? null, closesAt: r.closes_at ?? null,
    buyerName: r.buyer_name, respondedAt: r.responded_at ?? null,
  }));
}

export async function fetchPortalRfqLines(rfqId: string): Promise<
  { id: string; lineNumber: number; description: string | null;
    quantity: number; unit: string; myUnitPrice: string | null;
    myLeadTimeDays: number | null; myNote: string | null }[]
> {
  const { data, error } = await requireSupabase()
    .from("portal_rfq_lines").select("*").eq("rfq_id", rfqId).order("line_number");
  if (error) fail("fetchPortalRfqLines", error);
  return (data ?? []).map((r: any) => ({
    id: r.id, lineNumber: r.line_number, description: r.description ?? null,
    quantity: Number(r.quantity), unit: r.unit,
    myUnitPrice: r.my_unit_price === null ? null : String(r.my_unit_price),
    myLeadTimeDays: r.my_lead_time_days ?? null, myNote: r.my_note ?? null,
  }));
}

export async function submitQuote(
  lineId: string, unitPrice: number, leadTimeDays: number | null, note: string | null,
): Promise<void> {
  const { error } = await requireSupabase().rpc("submit_quote", {
    p_line: lineId, p_unit_price: unitPrice,
    p_lead_time_days: leadTimeDays, p_note: note,
  });
  if (error) fail("submitQuote", error);
}

// ── Development and hygiene ─────────────────────────────────────────────────

export interface TrainingCourse {
  id: string; code: string; title: string; description: string | null;
  grantsCertification: string | null; validMonths: number | null;
}

export interface TrainingAssignmentRow {
  id: string; courseId: string; employeeId: string;
  dueOn: string | null; completedOn: string | null;
  score: string | null; passed: boolean | null;
}

export async function fetchTrainingCourses(): Promise<TrainingCourse[]> {
  const { data, error } = await requireSupabase()
    .from("training_courses").select("*").is("retired_at", null).order("code");
  if (error) fail("fetchTrainingCourses", error);
  return (data ?? []).map((r: any) => ({
    id: r.id, code: r.code, title: r.title, description: r.description ?? null,
    grantsCertification: r.grants_certification ?? null,
    validMonths: r.valid_months ?? null,
  }));
}

export async function saveTrainingCourse(input: {
  id?: string; code: string; title: string; description: string | null;
  grantsCertification: string | null; validMonths: number | null;
}): Promise<void> {
  const db = requireSupabase();
  const row = {
    code: input.code, title: input.title, description: input.description,
    grants_certification: input.grantsCertification,
    valid_months: input.validMonths, updated_at: new Date().toISOString(),
  };
  const { error } = input.id
    ? await db.from("training_courses").update(row).eq("id", input.id)
    : await db.from("training_courses").insert(row);
  if (error) fail("saveTrainingCourse", error);
}

export async function fetchTrainingAssignments(): Promise<TrainingAssignmentRow[]> {
  const { data, error } = await requireSupabase()
    .from("training_assignments").select("*").order("due_on", { nullsFirst: false });
  if (error) fail("fetchTrainingAssignments", error);
  return (data ?? []).map((r: any) => ({
    id: r.id, courseId: r.course_id, employeeId: r.employee_id,
    dueOn: r.due_on ?? null, completedOn: r.completed_on ?? null,
    score: r.score === null ? null : String(r.score), passed: r.passed,
  }));
}

export async function assignTraining(
  courseId: string, employeeId: string, dueOn: string | null,
): Promise<void> {
  const { error } = await requireSupabase().from("training_assignments")
    .insert({ course_id: courseId, employee_id: employeeId, due_on: dueOn });
  if (error) fail("assignTraining", error);
}

export async function completeTraining(
  id: string, score: number | null,
): Promise<void> {
  const { error } = await requireSupabase().from("training_assignments").update({
    completed_on: new Date().toISOString().slice(0, 10),
    score, passed: score === null ? true : score >= 80,
  }).eq("id", id);
  if (error) fail("completeTraining", error);
}

export interface Competency {
  id: string; name: string; criteria: string; jobRoleId: string | null;
}
export interface CompetencyAssessment {
  id: string; competencyId: string; employeeId: string;
  level: number; evidence: string | null; assessedByEmail: string; assessedOn: string;
}

export async function fetchCompetencies(): Promise<Competency[]> {
  const { data, error } = await requireSupabase()
    .from("competencies").select("*").order("name");
  if (error) fail("fetchCompetencies", error);
  return (data ?? []).map((r: any) => ({
    id: r.id, name: r.name, criteria: r.criteria, jobRoleId: r.job_role_id ?? null,
  }));
}

export async function saveCompetency(input: {
  id?: string; name: string; criteria: string; jobRoleId: string | null;
}): Promise<void> {
  const db = requireSupabase();
  const row = { name: input.name, criteria: input.criteria, job_role_id: input.jobRoleId };
  const { error } = input.id
    ? await db.from("competencies").update(row).eq("id", input.id)
    : await db.from("competencies").insert(row);
  if (error) fail("saveCompetency", error);
}

export async function fetchCompetencyAssessments(): Promise<CompetencyAssessment[]> {
  const { data, error } = await requireSupabase()
    .from("competency_assessments").select("*").order("assessed_on", { ascending: false });
  if (error) fail("fetchCompetencyAssessments", error);
  return (data ?? []).map((r: any) => ({
    id: r.id, competencyId: r.competency_id, employeeId: r.employee_id,
    level: r.level, evidence: r.evidence ?? null,
    assessedByEmail: r.assessed_by_email, assessedOn: r.assessed_on,
  }));
}

export async function assessCompetency(input: {
  competencyId: string; employeeId: string; level: number; evidence: string;
}): Promise<void> {
  const db = requireSupabase();
  const { data: auth } = await db.auth.getUser();
  const { error } = await db.from("competency_assessments").insert({
    competency_id: input.competencyId, employee_id: input.employeeId,
    level: input.level, evidence: input.evidence,
    assessed_by_email: auth.user?.email ?? "unknown",
  });
  if (error) fail("assessCompetency", error);
}

export interface PerformanceReview {
  id: string; employeeId: string; periodStart: string; periodEnd: string;
  kind: string; status: string; selfComments: string | null;
  managerComments: string | null; agreedActions: string | null;
  reviewerEmail: string | null;
}

export async function fetchReviews(): Promise<PerformanceReview[]> {
  const { data, error } = await requireSupabase()
    .from("performance_reviews").select("*").order("period_end", { ascending: false });
  if (error) fail("fetchReviews", error);
  return (data ?? []).map((r: any) => ({
    id: r.id, employeeId: r.employee_id, periodStart: r.period_start,
    periodEnd: r.period_end, kind: r.kind, status: r.status,
    selfComments: r.self_comments ?? null, managerComments: r.manager_comments ?? null,
    agreedActions: r.agreed_actions ?? null, reviewerEmail: r.reviewer_email ?? null,
  }));
}

export async function saveReview(input: Partial<PerformanceReview> & {
  employeeId: string; periodStart: string; periodEnd: string;
}): Promise<void> {
  const db = requireSupabase();
  const { data: auth } = await db.auth.getUser();
  const row = {
    employee_id: input.employeeId, period_start: input.periodStart,
    period_end: input.periodEnd, kind: input.kind ?? "ANNUAL",
    status: input.status ?? "DRAFT",
    self_comments: input.selfComments ?? null,
    manager_comments: input.managerComments ?? null,
    agreed_actions: input.agreedActions ?? null,
    reviewer_email: input.reviewerEmail ?? auth.user?.email ?? null,
    updated_at: new Date().toISOString(),
  };
  const { error } = input.id
    ? await db.from("performance_reviews").update(row).eq("id", input.id)
    : await db.from("performance_reviews").insert(row);
  // A completion refused by the segregation-of-duties trigger arrives here.
  if (error) fail("saveReview", error);
}

export interface HrCase {
  id: string; employeeId: string; reference: string; kind: string;
  status: string; summary: string; detail: string | null; outcome: string | null;
  openedOn: string; openedByEmail: string | null;
}

export async function fetchHrCases(): Promise<HrCase[]> {
  const { data, error } = await requireSupabase()
    .from("hr_cases").select("*").order("opened_on", { ascending: false });
  if (error) fail("fetchHrCases", error);
  return (data ?? []).map((r: any) => ({
    id: r.id, employeeId: r.employee_id, reference: r.reference, kind: r.kind,
    status: r.status, summary: r.summary, detail: r.detail ?? null,
    outcome: r.outcome ?? null, openedOn: r.opened_on,
    openedByEmail: r.opened_by_email ?? null,
  }));
}

/**
 * Open a case, and name yourself on it.
 *
 * Two writes because a case with no participants is invisible to everybody
 * except an owner — including the person who just opened it.
 */
export async function openHrCase(input: {
  employeeId: string; reference: string; kind: string; summary: string;
  detail: string | null; participants: string[];
}): Promise<void> {
  const db = requireSupabase();
  const { data: auth } = await db.auth.getUser();
  const { data, error } = await db.from("hr_cases").insert({
    employee_id: input.employeeId, reference: input.reference, kind: input.kind,
    summary: input.summary, detail: input.detail,
    opened_by_email: auth.user?.email ?? null,
  }).select("id").single();
  if (error) fail("openHrCase", error);

  const emails = [...new Set([auth.user?.email, ...input.participants].filter(Boolean))];
  const { error: pe } = await db.from("hr_case_participants").insert(
    emails.map((e, i) => ({
      case_id: data.id, email: String(e).toLowerCase(),
      role: i === 0 ? "OWNER" : "PARTICIPANT",
    })),
  );
  if (pe) fail("openHrCase(participants)", pe);
}

export async function updateHrCase(
  id: string, status: string, outcome: string | null,
): Promise<void> {
  const { error } = await requireSupabase().from("hr_cases").update({
    status, outcome,
    closed_on: ["RESOLVED", "WITHDRAWN"].includes(status)
      ? new Date().toISOString().slice(0, 10) : null,
    updated_at: new Date().toISOString(),
  }).eq("id", id);
  if (error) fail("updateHrCase", error);
}

export interface HaccpForm {
  id: string; code: string; section: string; title: string;
  frequency: string; isCcp: boolean;
  /** What this form asks for, with limits. Empty on an older form. */
  fields: HaccpField[];
  lastCompleted: string | null; daysSince: number | null;
}

/*
 * A stored field is JSON, so it says nothing about the keys it leaves out.
 * A form with only an upper limit has no `min` key at all, and `undefined`
 * is not `null` — which rendered a freezer's limits as "undefined--18 °C"
 * and would have taken the wrong branch anywhere else that asks. Coerced once
 * here so nothing downstream has to know the difference.
 */
function normaliseFields(raw: unknown): HaccpField[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((f) => f && typeof f === "object" && typeof (f as any).label === "string")
    .map((f: any) => ({
      label: f.label,
      type: f.type ?? "text",
      unit: f.unit ?? null,
      min: f.min === undefined || f.min === null ? null : Number(f.min),
      max: f.max === undefined || f.max === null ? null : Number(f.max),
    }));
}

export async function fetchHaccpForms(): Promise<HaccpForm[]> {
  const { data, error } = await requireSupabase()
    .from("haccp_outstanding").select("*").order("code");
  if (error) fail("fetchHaccpForms", error);
  return (data ?? []).map((r: any) => ({
    id: r.form_id, code: r.code, section: r.section, title: r.title,
    frequency: r.frequency, isCcp: Boolean(r.is_ccp),
    fields: normaliseFields(r.fields),
    lastCompleted: r.last_completed ?? null,
    daysSince: r.days_since === null ? null : Number(r.days_since),
  }));
}

export interface HaccpRecord {
  id: string; formId: string; coversDate: string; shift: string | null;
  location: string | null; breach: boolean; breachDetail: string | null;
  correctiveAction: string | null; completedByEmail: string;
  verifiedByEmail: string | null;
}

export async function fetchHaccpRecords(): Promise<HaccpRecord[]> {
  const { data, error } = await requireSupabase()
    .from("haccp_records").select("*")
    .order("covers_date", { ascending: false }).limit(300);
  if (error) fail("fetchHaccpRecords", error);
  return (data ?? []).map((r: any) => ({
    id: r.id, formId: r.form_id, coversDate: r.covers_date,
    shift: r.shift ?? null, location: r.location ?? null,
    breach: Boolean(r.breach), breachDetail: r.breach_detail ?? null,
    correctiveAction: r.corrective_action ?? null,
    completedByEmail: r.completed_by_email,
    verifiedByEmail: r.verified_by_email ?? null,
  }));
}

export async function recordHaccp(input: {
  formId: string; coversDate: string; shift: string | null; location: string | null;
  values: Record<string, unknown>; breach: boolean;
  breachDetail: string | null; correctiveAction: string | null;
}): Promise<void> {
  const db = requireSupabase();
  const { data: auth } = await db.auth.getUser();
  const { error } = await db.from("haccp_records").insert({
    form_id: input.formId, covers_date: input.coversDate,
    shift: input.shift, location: input.location, values: input.values,
    breach: input.breach, breach_detail: input.breachDetail,
    corrective_action: input.correctiveAction,
    completed_by_email: auth.user?.email ?? "unknown",
  });
  // The trigger refuses a breach with no corrective action; show it as written.
  if (error) fail("recordHaccp", error);
}

export async function verifyHaccpRecord(id: string): Promise<void> {
  const db = requireSupabase();
  const { data: auth } = await db.auth.getUser();
  const { error } = await db.from("haccp_records").update({
    verified_by_email: auth.user?.email ?? null,
    verified_at: new Date().toISOString(),
  }).eq("id", id);
  if (error) fail("verifyHaccpRecord", error);
}

// ── Administration: access, parameters, hiring approval ─────────────────────
/*
 * The IT manager's half of the application.
 *
 * Everything below is read from views and written to tables that carry their
 * own triggers, so these functions are deliberately thin. The rules — who may
 * grant access, what a parameter may be set to, who signs a hire — are not
 * restated here, because a rule expressed twice is a rule that will disagree
 * with itself.
 */

export type AccessLevel = "NONE" | "READ" | "WRITE";

export interface AppSection {
  code: string;
  name: string;
  description: string;
  sortOrder: number;
  isCore: boolean;
}

export async function fetchAppSections(): Promise<AppSection[]> {
  const { data, error } = await requireSupabase()
    .from("app_sections").select("*").order("sort_order");
  if (error) fail("fetchAppSections", error);
  return (data ?? []).map((r: any) => ({
    code: r.code, name: r.name, description: r.description,
    sortOrder: r.sort_order ?? 0, isCore: Boolean(r.is_core),
  }));
}

export interface AccessRow {
  userId: string;
  email: string;
  role: OrgRole;
  /** Section code to level. Every section is present. */
  sections: Record<string, AccessLevel>;
}

/**
 * Everyone in the venue with what they can reach.
 *
 * The view already resolves an owner to WRITE everywhere, so the grid shows
 * the access that actually applies rather than the rows that happen to exist.
 */
export async function fetchAccessGrid(): Promise<AccessRow[]> {
  const { data, error } = await requireSupabase()
    .from("member_access_grid").select("*").order("email");
  if (error) fail("fetchAccessGrid", error);

  const byUser = new Map<string, AccessRow>();
  for (const r of (data ?? []) as any[]) {
    let row = byUser.get(r.user_id);
    if (!row) {
      row = { userId: r.user_id, email: r.email, role: r.role, sections: {} };
      byUser.set(r.user_id, row);
    }
    row.sections[r.section_code] = r.level as AccessLevel;
  }
  return [...byUser.values()];
}

/**
 * Grant, narrow or remove access to one section for one person.
 *
 * NONE deletes the row rather than storing it, so the table holds grants and
 * not a mixture of grants and denials — there is only one way to represent
 * "no access", which keeps the grid and the database agreeing.
 */
export async function setSectionAccess(
  userId: string,
  sectionCode: string,
  level: AccessLevel,
): Promise<void> {
  const db = requireSupabase();
  if (level === "NONE") {
    const { error } = await db.from("member_access").delete()
      .eq("user_id", userId).eq("section_code", sectionCode);
    if (error) fail("setSectionAccess", error);
    return;
  }
  const { data: auth } = await db.auth.getUser();
  const { error } = await db.from("member_access").upsert(
    {
      user_id: userId, section_code: sectionCode, level,
      granted_by_email: auth.user?.email ?? null, granted_at: new Date().toISOString(),
    },
    { onConflict: "org_id,user_id,section_code" },
  );
  if (error) fail("setSectionAccess", error);
}

/** What the signed-in user may reach, for the screens to reflect honestly. */
export async function fetchMySectionAccess(): Promise<Record<string, AccessLevel>> {
  const db = requireSupabase();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) return {};
  const { data, error } = await db
    .from("member_access_grid").select("section_code, level")
    .eq("user_id", auth.user.id);
  if (error) fail("fetchMySectionAccess", error);
  const out: Record<string, AccessLevel> = {};
  for (const r of (data ?? []) as any[]) out[r.section_code] = r.level as AccessLevel;
  return out;
}

export interface VenueParameter {
  id: string;
  code: string;
  name: string;
  description: string | null;
  value: number;
  unit: string;
  minValue: number | null;
  maxValue: number | null;
  updatedByEmail: string | null;
  updatedAt: string;
}

export async function fetchVenueParameters(): Promise<VenueParameter[]> {
  const { data, error } = await requireSupabase()
    .from("venue_parameters").select("*").order("code");
  if (error) fail("fetchVenueParameters", error);
  return (data ?? []).map((r: any) => ({
    id: r.id, code: r.code, name: r.name, description: r.description ?? null,
    value: Number(r.value), unit: r.unit,
    minValue: r.min_value === null ? null : Number(r.min_value),
    maxValue: r.max_value === null ? null : Number(r.max_value),
    updatedByEmail: r.updated_by_email ?? null, updatedAt: r.updated_at,
  }));
}

/**
 * The bounds are checked again by the trigger, which is what actually refuses
 * a typo. Sending the value unvalidated would work; sending it and reporting
 * the database's own message is what makes the refusal explainable.
 */
export async function saveVenueParameter(id: string, value: number): Promise<void> {
  const db = requireSupabase();
  const { data: auth } = await db.auth.getUser();
  const { error } = await db.from("venue_parameters")
    .update({ value, updated_by_email: auth.user?.email ?? null })
    .eq("id", id);
  if (error) fail("saveVenueParameter", error);
}

export interface ParameterChange {
  id: string;
  parameterCode: string;
  oldValue: number | null;
  newValue: number;
  changedByEmail: string | null;
  changedAt: string;
}

export async function fetchParameterChanges(): Promise<ParameterChange[]> {
  const { data, error } = await requireSupabase()
    .from("parameter_changes").select("*")
    .order("changed_at", { ascending: false }).limit(100);
  if (error) fail("fetchParameterChanges", error);
  return (data ?? []).map((r: any) => ({
    id: r.id, parameterCode: r.parameter_code,
    oldValue: r.old_value === null ? null : Number(r.old_value),
    newValue: Number(r.new_value),
    changedByEmail: r.changed_by_email ?? null, changedAt: r.changed_at,
  }));
}

export interface DepartmentApprover {
  id: string;
  departmentId: string;
  approverEmail: string;
  deputyEmail: string | null;
}

export async function fetchDepartmentApprovers(): Promise<DepartmentApprover[]> {
  const { data, error } = await requireSupabase()
    .from("department_approvers").select("*");
  if (error) fail("fetchDepartmentApprovers", error);
  return (data ?? []).map((r: any) => ({
    id: r.id, departmentId: r.department_id,
    approverEmail: r.approver_email, deputyEmail: r.deputy_email ?? null,
  }));
}

export async function saveDepartmentApprover(input: {
  departmentId: string;
  approverEmail: string;
  deputyEmail: string | null;
}): Promise<void> {
  const { error } = await requireSupabase().from("department_approvers").upsert(
    {
      department_id: input.departmentId,
      approver_email: input.approverEmail.trim().toLowerCase(),
      deputy_email: input.deputyEmail?.trim().toLowerCase() || null,
    },
    { onConflict: "department_id" },
  );
  if (error) fail("saveDepartmentApprover", error);
}

export type HiringStatus =
  | "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED" | "FILLED" | "CANCELLED";

export interface HiringRequest {
  id: string;
  reference: string;
  departmentId: string;
  jobRoleId: string | null;
  headcount: number;
  employmentType: string;
  reason: string;
  neededBy: string | null;
  estimatedMonthlyCost: number | null;
  status: HiringStatus;
  requestedByEmail: string | null;
  decidedByEmail: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
}

function hiringFromRow(r: any): HiringRequest {
  return {
    id: r.id, reference: r.reference, departmentId: r.department_id,
    jobRoleId: r.job_role_id ?? null, headcount: r.headcount,
    employmentType: r.employment_type, reason: r.reason,
    neededBy: r.needed_by ?? null,
    estimatedMonthlyCost: r.estimated_monthly_cost === null ? null : Number(r.estimated_monthly_cost),
    status: r.status, requestedByEmail: r.requested_by_email ?? null,
    decidedByEmail: r.decided_by_email ?? null, decidedAt: r.decided_at ?? null,
    decisionNote: r.decision_note ?? null, createdAt: r.created_at,
  };
}

export async function fetchHiringRequests(): Promise<HiringRequest[]> {
  const { data, error } = await requireSupabase()
    .from("hiring_requests").select("*").order("created_at", { ascending: false });
  if (error) fail("fetchHiringRequests", error);
  return (data ?? []).map(hiringFromRow);
}

export async function createHiringRequest(input: {
  departmentId: string;
  jobRoleId: string | null;
  headcount: number;
  employmentType: string;
  reason: string;
  neededBy: string | null;
  estimatedMonthlyCost: number | null;
}): Promise<void> {
  const db = requireSupabase();
  const { data: auth } = await db.auth.getUser();
  // A reference a person can quote in a conversation, unique per venue.
  const reference = `HR-${new Date().getFullYear()}-${Date.now().toString().slice(-6)}`;
  const { error } = await db.from("hiring_requests").insert({
    reference,
    department_id: input.departmentId,
    job_role_id: input.jobRoleId,
    headcount: input.headcount,
    employment_type: input.employmentType,
    reason: input.reason,
    needed_by: input.neededBy,
    estimated_monthly_cost: input.estimatedMonthlyCost,
    status: "SUBMITTED",
    submitted_at: new Date().toISOString(),
    requested_by_email: auth.user?.email ?? null,
  });
  if (error) fail("createHiringRequest", error);
}

/**
 * Approve or reject. The trigger decides whether the caller is entitled to,
 * and its message names who is — so the error is passed through rather than
 * replaced with something generic.
 */
export async function decideHiringRequest(
  id: string,
  status: "APPROVED" | "REJECTED",
  note: string | null,
): Promise<void> {
  const db = requireSupabase();
  const { data: auth } = await db.auth.getUser();
  const { error } = await db.from("hiring_requests").update({
    status,
    decision_note: note,
    decided_by_email: auth.user?.email ?? null,
    decided_at: new Date().toISOString(),
  }).eq("id", id);
  if (error) fail("decideHiringRequest", error);
}

/**
 * Write uploaded templates.
 *
 * A form of the same code is replaced rather than duplicated — a venue
 * uploading a revised sheet means "this is the form now", and ending up with
 * 3.1 twice is how a control sheet gets filled in on the wrong version.
 * Records already written keep pointing at the form and are untouched.
 */
export async function saveHaccpTemplates(
  forms: ImportedHaccpForm[],
): Promise<{ created: number; updated: number }> {
  const db = requireSupabase();
  let created = 0;
  let updated = 0;

  for (const form of forms) {
    const row = {
      code: form.code,
      section: form.section,
      title: form.title,
      frequency: form.frequency,
      is_ccp: form.isCcp,
      fields: form.fields,
      active: true,
    };
    if (form.existingId) {
      const { error } = await db.from("haccp_forms").update(row).eq("id", form.existingId);
      if (error) fail("saveHaccpTemplates", error);
      updated++;
    } else {
      const { error } = await db.from("haccp_forms").insert(row);
      if (error) fail("saveHaccpTemplates", error);
      created++;
    }
  }
  return { created, updated };
}

/** Every form, including retired ones, for the template screen. */
export async function fetchHaccpTemplates(): Promise<
  { id: string; code: string; title: string; active: boolean }[]
> {
  const { data, error } = await requireSupabase()
    .from("haccp_forms").select("id, code, title, active").order("code");
  if (error) fail("fetchHaccpTemplates", error);
  return (data ?? []).map((r: any) => ({
    id: r.id, code: r.code, title: r.title, active: Boolean(r.active),
  }));
}

// ── Human Resources: what gets sent to staff ────────────────────────────────

export type StaffDocumentKind =
  | "NEWSLETTER" | "ROTA" | "TRAINING" | "POLICY" | "PAYSLIP" | "OTHER";

export interface StaffDocument {
  id: string;
  kind: StaffDocumentKind;
  title: string;
  body: string | null;
  filePath: string | null;
  fileName: string | null;
  courseId: string | null;
  requiresAcknowledgement: boolean;
  publishedAt: string | null;
  publishedByEmail: string | null;
  /** Only populated on the HR side, where the recipient rows are visible. */
  sentTo?: number;
  readBy?: number;
}

export async function fetchStaffDocuments(): Promise<StaffDocument[]> {
  const db = requireSupabase();
  const { data, error } = await db
    .from("staff_documents")
    .select("*, staff_document_recipients(employee_id, read_at)")
    .order("published_at", { ascending: false, nullsFirst: false });
  if (error) fail("fetchStaffDocuments", error);
  return (data ?? []).map((r: any) => ({
    id: r.id, kind: r.kind, title: r.title, body: r.body ?? null,
    filePath: r.file_path ?? null, fileName: r.file_name ?? null,
    courseId: r.course_id ?? null,
    requiresAcknowledgement: Boolean(r.requires_acknowledgement),
    publishedAt: r.published_at ?? null,
    publishedByEmail: r.published_by_email ?? null,
    sentTo: (r.staff_document_recipients ?? []).length,
    readBy: (r.staff_document_recipients ?? []).filter((x: any) => x.read_at).length,
  }));
}

/**
 * Send something to a list of people.
 *
 * The file is uploaded first and the row written second, so a document row
 * never points at a file that is not there. The reverse order leaves a
 * "training material" in the list that opens to nothing.
 */
export async function sendStaffDocument(input: {
  kind: StaffDocumentKind;
  title: string;
  body: string | null;
  courseId: string | null;
  requiresAcknowledgement: boolean;
  employeeIds: string[];
  file: File | null;
}): Promise<void> {
  const db = requireSupabase();
  const { data: auth } = await db.auth.getUser();
  const orgId = await currentOrgId();

  const documentId = crypto.randomUUID();
  let filePath: string | null = null;

  if (input.file) {
    // org/document/filename — the policy reads the org from the first segment
    // and the document from the second, so the path is checkable on its own.
    filePath = `${orgId}/${documentId}/${input.file.name}`;
    const { error: upErr } = await db.storage
      .from("staff-documents")
      .upload(filePath, input.file, { upsert: false });
    if (upErr) fail("sendStaffDocument (upload)", upErr);
  }

  const { error } = await db.from("staff_documents").insert({
    id: documentId,
    kind: input.kind,
    title: input.title,
    body: input.body,
    course_id: input.courseId,
    requires_acknowledgement: input.requiresAcknowledgement,
    file_path: filePath,
    file_name: input.file?.name ?? null,
    published_at: new Date().toISOString(),
    published_by_email: auth.user?.email ?? null,
  });
  if (error) fail("sendStaffDocument", error);

  if (input.employeeIds.length > 0) {
    const { error: recErr } = await db.from("staff_document_recipients").insert(
      input.employeeIds.map((employeeId) => ({
        document_id: documentId,
        employee_id: employeeId,
      })),
    );
    if (recErr) fail("sendStaffDocument (recipients)", recErr);
  }
}

/** The organization rows are written to — the same one the triggers use. */
async function currentOrgId(): Promise<string> {
  const db = requireSupabase();
  const { data, error } = await db.rpc("auth_default_org_id");
  if (error) fail("currentOrgId", error);
  if (!data) throw new Error("No organization for the current user.");
  return data as string;
}

/** A time-limited link to a private file. The buckets are never public. */
export async function signedFileUrl(
  bucket: string,
  path: string,
  seconds = 300,
): Promise<string> {
  const { data, error } = await requireSupabase()
    .storage.from(bucket).createSignedUrl(path, seconds);
  if (error) fail("signedFileUrl", error);
  return data.signedUrl;
}

export interface Geofence {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radiusM: number;
  enabled: boolean;
}

export async function fetchGeofences(): Promise<Geofence[]> {
  const { data, error } = await requireSupabase()
    .from("venue_geofences").select("*").order("name");
  if (error) fail("fetchGeofences", error);
  return (data ?? []).map((r: any) => ({
    id: r.id, name: r.name,
    latitude: Number(r.latitude), longitude: Number(r.longitude),
    radiusM: Number(r.radius_m), enabled: Boolean(r.enabled),
  }));
}

export async function saveGeofence(input: {
  id?: string;
  name: string;
  latitude: number;
  longitude: number;
  radiusM: number;
  enabled: boolean;
}): Promise<void> {
  const db = requireSupabase();
  const row = {
    name: input.name, latitude: input.latitude, longitude: input.longitude,
    radius_m: input.radiusM, enabled: input.enabled,
  };
  const { error } = input.id
    ? await db.from("venue_geofences").update(row).eq("id", input.id)
    : await db.from("venue_geofences").insert(row);
  if (error) fail("saveGeofence", error);
}

// ── The staff portal ────────────────────────────────────────────────────────

export interface MyProfile {
  employeeId: string;
  orgId: string;
  venueName: string;
  employeeNumber: string;
  firstName: string;
  lastName: string;
  workEmail: string | null;
  department: string | null;
  jobTitle: string | null;
  managerName: string | null;
}

/**
 * Who the signed-in person is, as a member of staff.
 *
 * Null for somebody who runs the venue but is not on the payroll — an owner,
 * or an IT manager. That distinction is what decides which application they
 * see when they sign in.
 */
export async function fetchMyProfile(): Promise<MyProfile | null> {
  const { data, error } = await requireSupabase()
    .from("my_profile").select("*").maybeSingle();
  if (error) fail("fetchMyProfile", error);
  if (!data) return null;
  const r = data as any;
  return {
    employeeId: r.employee_id, orgId: r.org_id, venueName: r.venue_name,
    employeeNumber: r.employee_number, firstName: r.first_name,
    lastName: r.last_name, workEmail: r.work_email ?? null,
    department: r.department ?? null, jobTitle: r.job_title ?? null,
    managerName: r.manager_name ?? null,
  };
}

export interface MyDocument extends StaffDocument {
  recipientId: string;
  readAt: string | null;
  acknowledgedAt: string | null;
}

export async function fetchMyDocuments(): Promise<MyDocument[]> {
  const db = requireSupabase();
  const { data, error } = await db
    .from("staff_document_recipients")
    .select("id, read_at, acknowledged_at, staff_documents(*)")
    .order("read_at", { nullsFirst: true });
  if (error) fail("fetchMyDocuments", error);
  return (data ?? [])
    .filter((r: any) => r.staff_documents)
    .map((r: any) => {
      const d = r.staff_documents;
      return {
        id: d.id, kind: d.kind, title: d.title, body: d.body ?? null,
        filePath: d.file_path ?? null, fileName: d.file_name ?? null,
        courseId: d.course_id ?? null,
        requiresAcknowledgement: Boolean(d.requires_acknowledgement),
        publishedAt: d.published_at ?? null,
        publishedByEmail: d.published_by_email ?? null,
        recipientId: r.id,
        readAt: r.read_at ?? null,
        acknowledgedAt: r.acknowledged_at ?? null,
      };
    });
}

export async function markDocumentRead(
  recipientId: string,
  acknowledge: boolean,
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await requireSupabase()
    .from("staff_document_recipients")
    .update(acknowledge ? { read_at: now, acknowledged_at: now } : { read_at: now })
    .eq("id", recipientId);
  if (error) fail("markDocumentRead", error);
}

export interface MyExamQuestion {
  id: string;
  courseId: string;
  prompt: string;
  options: string[] | null;
  kind: string;
  points: number;
}

export async function fetchMyExam(courseId: string): Promise<MyExamQuestion[]> {
  const { data, error } = await requireSupabase()
    .from("my_exam_questions").select("*").eq("course_id", courseId);
  if (error) fail("fetchMyExam", error);
  return (data ?? []).map((r: any) => ({
    id: r.id, courseId: r.course_id, prompt: r.prompt,
    options: r.options ?? null, kind: r.kind, points: r.points ?? 1,
  }));
}

export interface ExamResult {
  score: number;
  correct: number;
  total: number;
  passed: boolean;
}

/**
 * Submit an exam.
 *
 * Marked in the database, not here. The answers live in a table the candidate
 * cannot read, which is the only way a score means anything — one computed in
 * the browser is one the candidate can edit.
 */
export async function submitExam(
  courseId: string,
  employeeId: string,
  answers: Record<string, number>,
): Promise<ExamResult> {
  const { data, error } = await requireSupabase().rpc("mark_quiz_attempt", {
    p_course: courseId,
    p_employee: employeeId,
    p_answers: answers,
    p_pass_mark: 80,
  });
  if (error) fail("submitExam", error);
  const r = data as any;
  return {
    score: Number(r.score), correct: Number(r.correct),
    total: Number(r.total), passed: Boolean(r.passed),
  };
}

export interface MyShift {
  id: string;
  startsAt: string;
  endsAt: string;
  breakMinutes: number;
  notes: string | null;
}

export async function fetchMyShifts(): Promise<MyShift[]> {
  const { data, error } = await requireSupabase()
    .from("shifts").select("id, starts_at, ends_at, break_minutes, notes")
    .gte("starts_at", new Date(Date.now() - 86400000).toISOString())
    .order("starts_at")
    .limit(60);
  if (error) fail("fetchMyShifts", error);
  return (data ?? []).map((r: any) => ({
    id: r.id, startsAt: r.starts_at, endsAt: r.ends_at,
    breakMinutes: r.break_minutes ?? 0, notes: r.notes ?? null,
  }));
}

export async function fetchMyOpenPunch(): Promise<{ id: string; clockInAt: string } | null> {
  const { data, error } = await requireSupabase()
    .from("time_entries").select("id, clock_in_at")
    .is("clock_out_at", null)
    .order("clock_in_at", { ascending: false })
    .limit(1);
  if (error) fail("fetchMyOpenPunch", error);
  const r = (data ?? [])[0] as any;
  return r ? { id: r.id, clockInAt: r.clock_in_at } : null;
}

export interface MyLeave {
  id: string;
  leaveTypeId: string;
  startsOn: string;
  endsOn: string;
  days: number;
  status: string;
  note: string | null;
  decisionNote: string | null;
  attachments: number;
}

export async function fetchMyLeave(): Promise<MyLeave[]> {
  const { data, error } = await requireSupabase()
    .from("leave_requests")
    .select("*, leave_attachments(id)")
    .order("starts_on", { ascending: false });
  if (error) fail("fetchMyLeave", error);
  return (data ?? []).map((r: any) => ({
    id: r.id, leaveTypeId: r.leave_type_id, startsOn: r.starts_on,
    endsOn: r.ends_on, days: Number(r.days), status: r.status,
    note: r.note ?? null, decisionNote: r.decision_note ?? null,
    attachments: (r.leave_attachments ?? []).length,
  }));
}

export interface MyTraining {
  assignmentId: string;
  courseId: string;
  courseTitle: string;
  description: string | null;
  dueOn: string | null;
  completedOn: string | null;
  score: number | null;
  passed: boolean | null;
  hasExam: boolean;
}

export async function fetchMyTraining(): Promise<MyTraining[]> {
  const db = requireSupabase();
  const { data, error } = await db
    .from("training_assignments")
    .select("*, training_courses(id, title, description)")
    .order("due_on", { nullsFirst: false });
  if (error) fail("fetchMyTraining", error);

  const rows = (data ?? []).filter((r: any) => r.training_courses);
  // Which of them actually have questions, so the portal offers an exam only
  // where there is one to sit.
  const { data: qs } = await db.from("my_exam_questions").select("course_id");
  const withExam = new Set((qs ?? []).map((q: any) => q.course_id));

  return rows.map((r: any) => ({
    assignmentId: r.id,
    courseId: r.course_id,
    courseTitle: r.training_courses.title,
    description: r.training_courses.description ?? null,
    dueOn: r.due_on ?? null,
    completedOn: r.completed_on ?? null,
    score: r.score === null ? null : Number(r.score),
    passed: r.passed === null ? null : Boolean(r.passed),
    hasExam: withExam.has(r.course_id),
  }));
}
