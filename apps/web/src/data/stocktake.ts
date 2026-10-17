// ---------------------------------------------------------------------------
// Counting the shelves
// ---------------------------------------------------------------------------
// Queries for the stocktake sessions built in 0091 and scoped to a place in
// 0096.
//
// Nothing here decides anything. Opening a count, posting it and the
// segregation-of-duties rule that stops the counter approving their own work
// are all database functions and triggers; this module calls them and reports
// what they said. That is deliberate — the refusals are the feature, and a
// second copy of the rules in TypeScript would be the version that goes
// stale.
// ---------------------------------------------------------------------------

import { requireSupabase } from "@/lib/supabase";
import { fail } from "./_shared";

export type StocktakeStatus =
  | "OPEN" | "COUNTING" | "SUBMITTED" | "APPROVED" | "POSTED" | "CANCELLED";
export type StocktakeKind = "FULL" | "PARTIAL" | "SPOT";

export interface Stocktake {
  id: string;
  reference: string | null;
  kind: StocktakeKind;
  status: StocktakeStatus;
  locationId: string | null;
  snapshotAt: string;
  note: string | null;
  submittedByEmail: string | null;
  approvedByEmail: string | null;
  postedAt: string | null;
}

export interface StocktakeVarianceLine {
  lineId: string;
  productId: string;
  productName: string;
  category: string | null;
  expectedQty: number;
  /** Null means nobody counted it, which is not the same as none. */
  countedQty: number | null;
  countUnit: string;
  differenceQty: number | null;
  differenceValue: number | null;
  notCounted: boolean;
}

export interface CountLocation {
  id: string;
  name: string;
  kind: string | null;
}

export async function fetchStocktakes(): Promise<Stocktake[]> {
  const { data, error } = await requireSupabase()
    .from("stocktakes")
    .select("*")
    .order("snapshot_at", { ascending: false })
    .limit(100);
  if (error) fail("fetchStocktakes", error);
  return (data ?? []).map((r: any) => ({
    id: r.id,
    reference: r.reference,
    kind: r.kind,
    status: r.status,
    locationId: r.location_id,
    snapshotAt: r.snapshot_at,
    note: r.note,
    submittedByEmail: r.submitted_by_email,
    approvedByEmail: r.approved_by_email,
    postedAt: r.posted_at,
  }));
}

/**
 * The variance view rather than the lines table.
 *
 * It carries the product name, the money and the not-counted flag that the
 * lines alone do not, and using it here means the screen and any report
 * cannot disagree about which lines are outstanding.
 */
export async function fetchStocktakeLines(
  stocktakeId: string,
): Promise<StocktakeVarianceLine[]> {
  const { data, error } = await requireSupabase()
    .from("stocktake_variance")
    .select("*")
    .eq("stocktake_id", stocktakeId)
    .order("product_name");
  if (error) fail("fetchStocktakeLines", error);
  return (data ?? []).map((r: any) => ({
    lineId: r.stocktake_line_id,
    productId: r.product_id,
    productName: r.product_name,
    category: r.category,
    expectedQty: Number(r.expected_qty ?? 0),
    countedQty: r.counted_qty === null ? null : Number(r.counted_qty),
    countUnit: r.count_unit,
    differenceQty: r.difference_qty === null ? null : Number(r.difference_qty),
    differenceValue:
      r.difference_value === null ? null : Number(r.difference_value),
    notCounted: Boolean(r.not_counted),
  }));
}

/** The places a count can be of. A count with none is of the whole venue. */
export async function fetchCountLocations(): Promise<CountLocation[]> {
  const { data, error } = await requireSupabase()
    .from("locations")
    .select("id, name, kind")
    .eq("active", true)
    .in("kind", ["STORE_ROOM", "CHILLER", "FREEZER", "DRY_STORE", "BAR_STORE"])
    .order("name");
  if (error) fail("fetchCountLocations", error);
  return (data ?? []).map((r: any) => ({ id: r.id, name: r.name, kind: r.kind }));
}

export async function createStocktake(input: {
  kind: StocktakeKind;
  locationId: string | null;
  note: string | null;
}): Promise<string> {
  const { data, error } = await requireSupabase()
    .from("stocktakes")
    .insert({
      kind: input.kind,
      location_id: input.locationId,
      note: input.note,
      // Now, explicitly. The column defaults to now() anyway, but the freeze
      // is the whole point of the session and it should be visible here.
      snapshot_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error) fail("createStocktake", error);
  return (data as any).id;
}

/** Builds the lines and freezes the expected figures. Returns how many. */
export async function openStocktake(id: string): Promise<number> {
  const { data, error } = await requireSupabase().rpc("open_stocktake", {
    p_stocktake: id,
  });
  if (error) fail("openStocktake", error);
  return Number(data ?? 0);
}

/**
 * Clearing a count is not entering zero.
 *
 * `null` puts the line back to "nobody reached this shelf"; `0` says somebody
 * looked and there was none. The screen has to be able to express both or the
 * distinction the database keeps is lost on the way in.
 */
export async function saveCount(
  lineId: string,
  countedQty: number | null,
): Promise<void> {
  const { error } = await requireSupabase()
    .from("stocktake_lines")
    .update({ counted_qty: countedQty })
    .eq("id", lineId);
  if (error) fail("saveCount", error);
}

export async function setStocktakeStatus(
  id: string,
  status: StocktakeStatus,
): Promise<void> {
  const { error } = await requireSupabase()
    .from("stocktakes")
    .update({ status })
    .eq("id", id);
  if (error) fail("setStocktakeStatus", error);
}

/** Writes the adjustments. Returns how many movements it made. */
export async function postStocktake(id: string): Promise<number> {
  const { data, error } = await requireSupabase().rpc("post_stocktake", {
    p_stocktake: id,
  });
  if (error) fail("postStocktake", error);
  return Number(data ?? 0);
}
