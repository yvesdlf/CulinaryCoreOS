// ---------------------------------------------------------------------------
// Barcodes, and what goes on a tub
// ---------------------------------------------------------------------------
// The label's contents come from `prep_label` (0113) and are never assembled
// here. Allergens in particular: the view explodes them through every level
// of nested preparation and carries `allergens_need_review` beside them, and
// a second assembly in TypeScript would be the one that forgets the caveat.
// On a printed label that is not a cosmetic difference — AGENTS.md §8, the
// dangerous failure is a confident allergen rather than a missing one.
// ---------------------------------------------------------------------------

import { requireSupabase } from "@/lib/supabase";
import { currentOrgId, fail } from "./_shared";

export type BarcodeKind = "EAN13" | "EAN8" | "UPCA" | "CODE128" | "QR" | "INTERNAL";

export interface ProductBarcode {
  id: string;
  productId: string;
  barcode: string;
  kind: BarcodeKind;
  isPrimary: boolean;
  describes: string | null;
}

export interface PrepLabel {
  productionRecordId: string;
  subRecipeId: string;
  itemName: string;
  batches: number;
  quantityMade: number | null;
  unit: string;
  madeOn: string;
  madeBy: string | null;
  useBy: string;
  expiryKind: string;
  allergens: string[];
  /** True while any contributing allergen is still inferred from a name. */
  allergensNeedReview: boolean;
  unverifiedProducts: string[];
}

export async function fetchBarcodes(productId: string): Promise<ProductBarcode[]> {
  const { data, error } = await requireSupabase()
    .from("product_barcodes")
    .select("*")
    .eq("product_id", productId)
    .order("is_primary", { ascending: false });
  if (error) fail("fetchBarcodes", error);
  return (data ?? []).map((r: any) => ({
    id: r.id,
    productId: r.product_id,
    barcode: r.barcode,
    kind: r.kind,
    isPrimary: Boolean(r.is_primary),
    describes: r.describes ?? null,
  }));
}

/**
 * The refusal is the useful part.
 *
 * A check digit that does not add up comes back as the insert failing, with
 * the database naming the code and the reason. Swallowing it and saving
 * anyway would attach a mistyped number to a product permanently, which is
 * discovered by somebody counting a walk-in at six in the morning.
 */
export async function addBarcode(b: {
  productId: string;
  barcode: string;
  kind: BarcodeKind;
  describes: string | null;
}): Promise<void> {
  const org = await currentOrgId();
  const { error } = await requireSupabase().from("product_barcodes").insert({
    org_id: org,
    product_id: b.productId,
    barcode: b.barcode,
    kind: b.kind,
    describes: b.describes,
  });
  if (error) fail("addBarcode", error);
}

export async function removeBarcode(id: string): Promise<void> {
  const { error } = await requireSupabase()
    .from("product_barcodes").delete().eq("id", id);
  if (error) fail("removeBarcode", error);
}

export async function fetchPrepLabel(recordId: string): Promise<PrepLabel | null> {
  const { data, error } = await requireSupabase()
    .from("prep_label")
    .select("*")
    .eq("production_record_id", recordId)
    .maybeSingle();
  if (error) fail("fetchPrepLabel", error);
  if (!data) return null;
  const r = data as any;
  return {
    productionRecordId: r.production_record_id,
    subRecipeId: r.sub_recipe_id,
    itemName: r.item_name,
    batches: Number(r.batches ?? 0),
    quantityMade: r.quantity_made === null ? null : Number(r.quantity_made),
    unit: r.unit,
    madeOn: r.made_on,
    madeBy: r.made_by ?? null,
    useBy: r.use_by,
    expiryKind: r.expiry_kind,
    allergens: r.allergens ?? [],
    allergensNeedReview: Boolean(r.allergens_need_review),
    unverifiedProducts: r.unverified_products ?? [],
  };
}

/**
 * Records that a label was printed, with what was on it.
 *
 * The allergens are copied onto the row rather than looked up later: the
 * catalogue can change and the tub in the walk-in cannot, and a recall needs
 * to know what the sticker actually said (178/2002 Art 18).
 */
export async function recordLabelPrint(l: {
  productionRecordId: string;
  copies: number;
  useBy: string;
  allergensShown: string[];
  allergensWereUnverified: boolean;
}): Promise<void> {
  const org = await currentOrgId();
  const { data: auth } = await requireSupabase().auth.getUser();
  const { error } = await requireSupabase().from("label_prints").insert({
    org_id: org,
    production_record_id: l.productionRecordId,
    copies: l.copies,
    printed_by_email: auth.user?.email ?? null,
    use_by: l.useBy,
    allergens_shown: l.allergensShown,
    allergens_were_unverified: l.allergensWereUnverified,
  });
  if (error) fail("recordLabelPrint", error);
}
