// ---------------------------------------------------------------------------
// What is on the shelf
// ---------------------------------------------------------------------------
// Stock levels, the movements that change them, the lots those movements name,
// and the sales periods a count is taken against.
//
// Split out of `repository.ts` in stage 1.4, which was 5.260 lines and 9% of
// the front end. Nothing here changed in the move: `repository.ts` re-exports
// all of it, so every caller imports exactly what it imported before.
// ---------------------------------------------------------------------------

import { requireSupabase } from "@/lib/supabase";
import { fail, fetchAllPages } from "./_shared";
import type { StockLot } from "@/engine/traceability";

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
