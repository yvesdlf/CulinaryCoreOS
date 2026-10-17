// ---------------------------------------------------------------------------
// How each supplier has actually behaved
// ---------------------------------------------------------------------------
// Reads only. Every figure is a view (0110), including the flags, which are
// computed against thresholds the venue sets in `venue_parameters` rather
// than against constants here — so a page and a report cannot disagree about
// whether a supplier is late, and changing the threshold changes both.
// ---------------------------------------------------------------------------

import { requireSupabase } from "@/lib/supabase";
import { fail } from "./_shared";

export interface SupplierScore {
  supplierId: string;
  supplierName: string;
  windowDays: number;

  /** Null where nothing was ordered — never zero. See METRICS.md §4. */
  deliveriesScored: number | null;
  late: number | null;
  latePercent: number | null;
  worstDaysLate: number | null;
  latenessFlagged: boolean | null;

  quantityReceived: number | null;
  quantityRejected: number | null;
  rejectedPercent: number | null;
  qualityFlagged: boolean | null;

  priceChanges: number | null;
  priceRises: number | null;
  averageMovePercent: number | null;

  invoices: number | null;
  inArgument: number | null;
  arguedPercent: number | null;
  creditNotes: number | null;
  paperworkFlagged: boolean | null;

  concerns: number;
  thinEvidence: boolean;
  componentsMeasured: number;
}

function num(v: unknown): number | null {
  return v === null || v === undefined ? null : Number(v);
}
function bool(v: unknown): boolean | null {
  return v === null || v === undefined ? null : Boolean(v);
}

export async function fetchSupplierScorecard(): Promise<SupplierScore[]> {
  const { data, error } = await requireSupabase()
    .from("supplier_scorecard")
    .select("*")
    .order("supplier_name");
  if (error) fail("fetchSupplierScorecard", error);

  return (data ?? []).map((r: any) => ({
    supplierId: r.supplier_id,
    supplierName: r.supplier_name,
    windowDays: Number(r.window_days ?? 180),
    deliveriesScored: num(r.deliveries_scored),
    late: num(r.late),
    latePercent: num(r.late_percent),
    worstDaysLate: num(r.worst_days_late),
    latenessFlagged: bool(r.lateness_flagged),
    quantityReceived: num(r.quantity_received),
    quantityRejected: num(r.quantity_rejected),
    rejectedPercent: num(r.rejected_percent),
    qualityFlagged: bool(r.quality_flagged),
    priceChanges: num(r.price_changes),
    priceRises: num(r.price_rises),
    averageMovePercent: num(r.average_move_percent),
    invoices: num(r.invoices),
    inArgument: num(r.in_argument),
    arguedPercent: num(r.argued_percent),
    creditNotes: num(r.credit_notes),
    paperworkFlagged: bool(r.paperwork_flagged),
    concerns: Number(r.concerns ?? 0),
    thinEvidence: Boolean(r.thin_evidence),
    componentsMeasured: Number(r.components_measured ?? 0),
  }));
}
