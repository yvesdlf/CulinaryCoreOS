// ---------------------------------------------------------------------------
// Freight, duty, and what a delivery really cost
// ---------------------------------------------------------------------------
// The allocation is `allocate_receipt_charges` (0109) and stays there — it
// runs on a trigger whenever a charge changes, so this module never has to
// call it in the ordinary case and never recomputes a share itself. The
// rounding rule alone (the remainder goes to the largest share, so the parts
// sum to the charge exactly) is the kind of thing that exists in one place or
// in two places that disagree.
// ---------------------------------------------------------------------------

import { requireSupabase } from "@/lib/supabase";
import { currentOrgId, fail } from "./_shared";

export type ChargeKind =
  | "FREIGHT" | "DUTY" | "INSURANCE" | "CLEARANCE" | "HANDLING" | "OTHER";
export type ChargeBasis = "VALUE" | "QUANTITY" | "WEIGHT";

export interface ReceiptCharge {
  id: string;
  goodsReceiptId: string;
  kind: ChargeKind;
  basis: ChargeBasis;
  amount: number;
  invoiceReference: string | null;
  note: string | null;
}

export interface LandedLine {
  goodsReceiptLineId: string;
  goodsReceiptId: string;
  receiptReference: string;
  receivedOn: string;
  productName: string | null;
  quantity: number;
  unit: string;
  unitPrice: number | null;
  goodsValue: number | null;
  charges: number;
  landedUnitCost: number | null;
  upliftPercent: number | null;
  priceMissing: boolean;
}

export interface LandedReadiness {
  goodsReceiptId: string;
  reference: string;
  receivedOn: string;
  lines: number;
  linesWithoutAPrice: number;
  chargesRecorded: number;
  chargeLines: number;
  canBeLanded: boolean;
}

function num(v: unknown): number | null {
  return v === null || v === undefined ? null : Number(v);
}

export async function fetchLandedReadiness(): Promise<LandedReadiness[]> {
  const { data, error } = await requireSupabase()
    .from("landed_cost_ready")
    .select("*")
    .order("received_on", { ascending: false })
    .limit(100);
  if (error) fail("fetchLandedReadiness", error);
  return (data ?? []).map((r: any) => ({
    goodsReceiptId: r.goods_receipt_id,
    reference: r.reference,
    receivedOn: r.received_on,
    lines: Number(r.lines ?? 0),
    linesWithoutAPrice: Number(r.lines_without_a_price ?? 0),
    chargesRecorded: Number(r.charges_recorded ?? 0),
    chargeLines: Number(r.charge_lines ?? 0),
    canBeLanded: Boolean(r.can_be_landed),
  }));
}

export async function fetchLandedLines(receiptId: string): Promise<LandedLine[]> {
  const { data, error } = await requireSupabase()
    .from("receipt_line_landed_cost")
    .select("*")
    .eq("goods_receipt_id", receiptId);
  if (error) fail("fetchLandedLines", error);
  return (data ?? []).map((r: any) => ({
    goodsReceiptLineId: r.goods_receipt_line_id,
    goodsReceiptId: r.goods_receipt_id,
    receiptReference: r.receipt_reference,
    receivedOn: r.received_on,
    productName: r.product_name,
    quantity: Number(r.quantity ?? 0),
    unit: r.unit,
    unitPrice: num(r.unit_price),
    goodsValue: num(r.goods_value),
    charges: Number(r.charges ?? 0),
    landedUnitCost: num(r.landed_unit_cost),
    upliftPercent: num(r.uplift_percent),
    priceMissing: Boolean(r.price_missing),
  }));
}

export async function fetchReceiptCharges(receiptId: string): Promise<ReceiptCharge[]> {
  const { data, error } = await requireSupabase()
    .from("receipt_charges")
    .select("*")
    .eq("goods_receipt_id", receiptId)
    .order("created_at");
  if (error) fail("fetchReceiptCharges", error);
  return (data ?? []).map((r: any) => ({
    id: r.id,
    goodsReceiptId: r.goods_receipt_id,
    kind: r.kind,
    basis: r.basis,
    amount: Number(r.amount ?? 0),
    invoiceReference: r.invoice_reference,
    note: r.note,
  }));
}

/**
 * Adding a charge allocates it, by trigger.
 *
 * So a refusal here — a weight basis where a line has no weight, a value
 * basis over lines worth nothing — comes back as the insert failing, and the
 * charge is not left recorded-but-unspread. That is deliberate: a charge with
 * no allocation behind it reads on every report as though the delivery had no
 * freight at all.
 */
export async function addReceiptCharge(c: {
  receiptId: string;
  kind: ChargeKind;
  basis: ChargeBasis;
  amount: number;
  invoiceReference: string | null;
  note: string | null;
}): Promise<void> {
  const org = await currentOrgId();
  const { error } = await requireSupabase().from("receipt_charges").insert({
    org_id: org,
    goods_receipt_id: c.receiptId,
    kind: c.kind,
    basis: c.basis,
    amount: c.amount,
    invoice_reference: c.invoiceReference,
    note: c.note,
  });
  if (error) fail("addReceiptCharge", error);
}

export async function removeReceiptCharge(id: string): Promise<void> {
  const { error } = await requireSupabase().from("receipt_charges").delete().eq("id", id);
  if (error) fail("removeReceiptCharge", error);
}
