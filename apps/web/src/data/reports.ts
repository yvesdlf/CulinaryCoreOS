// ---------------------------------------------------------------------------
// The figures that had nowhere to be read
// ---------------------------------------------------------------------------
// Every report here is a view that already existed and that no screen asked
// for. Eighty-three views and almost no reporting pages is the shape this
// codebase had: the analysis was done and the answers were only reachable by
// somebody with a psql prompt.
//
// So this module computes nothing. Each function is a read of one view, in
// the shape the view returns, and the caveat columns come with it rather than
// being filtered out on the way — `unattributed_goods_cost`,
// `movements_with_no_cost`, `stuck`, `breaches_nobody_was_told_about`. Those
// are the columns that stop a total being read as more certain than it is,
// and a reporting layer that dropped them to tidy a table would be the most
// expensive thing in the application.
// ---------------------------------------------------------------------------

import { requireSupabase } from "@/lib/supabase";
import { fail } from "./_shared";

function num(v: unknown): number | null {
  return v === null || v === undefined ? null : Number(v);
}

export interface UnitProfitRow {
  unitCode: string | null;
  unitName: string | null;
  onDate: string;
  revenueNet: number | null;
  covers: number | null;
  labourCost: number | null;
  goodsCost: number | null;
  wasteCost: number | null;
  grossProfit: number | null;
  grossProfitPercent: number | null;
  /** Stock movements carrying no unit: real cost, chargeable to nobody. */
  unattributedGoodsCost: number | null;
}

export async function fetchUnitProfit(from: string, to: string): Promise<UnitProfitRow[]> {
  const { data, error } = await requireSupabase()
    .from("unit_profit_daily")
    .select("*")
    .gte("on_date", from)
    .lte("on_date", to)
    .order("on_date", { ascending: false });
  if (error) fail("fetchUnitProfit", error);
  return (data ?? []).map((r: any) => ({
    unitCode: r.unit_code, unitName: r.unit_name, onDate: r.on_date,
    revenueNet: num(r.revenue_net), covers: num(r.covers),
    labourCost: num(r.labour_cost), goodsCost: num(r.goods_cost),
    wasteCost: num(r.waste_cost), grossProfit: num(r.gross_profit),
    grossProfitPercent: num(r.gross_profit_percent),
    unattributedGoodsCost: num(r.unattributed_goods_cost),
  }));
}

export interface LabourRow {
  unitName: string | null;
  onDate: string;
  net: number | null;
  covers: number | null;
  hours: number | null;
  labourCost: number | null;
  labourPercentOfNet: number | null;
}

export async function fetchLabourAgainstRevenue(from: string, to: string): Promise<LabourRow[]> {
  const { data, error } = await requireSupabase()
    .from("unit_labour_against_revenue")
    .select("*")
    .gte("on_date", from)
    .lte("on_date", to)
    .order("on_date", { ascending: false });
  if (error) fail("fetchLabourAgainstRevenue", error);
  return (data ?? []).map((r: any) => ({
    unitName: r.business_unit_name, onDate: r.on_date,
    net: num(r.net), covers: num(r.covers), hours: num(r.hours),
    labourCost: num(r.labour_cost),
    labourPercentOfNet: num(r.labour_percent_of_net),
  }));
}

export interface GoodsRow {
  onDate: string;
  usedCost: number | null;
  wastedCost: number | null;
  totalCost: number | null;
  /** Counted, because a zero cost on a movement is usually a gap. */
  movementsWithNoCost: number;
}

export async function fetchCostOfGoods(from: string, to: string): Promise<GoodsRow[]> {
  const { data, error } = await requireSupabase()
    .from("cost_of_goods_daily")
    .select("*")
    .gte("on_date", from)
    .lte("on_date", to)
    .order("on_date", { ascending: false });
  if (error) fail("fetchCostOfGoods", error);
  return (data ?? []).map((r: any) => ({
    onDate: r.on_date, usedCost: num(r.used_cost),
    wastedCost: num(r.wasted_cost), totalCost: num(r.total_cost),
    movementsWithNoCost: Number(r.movements_with_no_cost ?? 0),
  }));
}

export interface PayableRow {
  supplierName: string | null;
  invoices: number;
  /** In exception or dispute: a balance of zero means less than it looks. */
  stuck: number;
  approvedToPay: number | null;
  overdue: number | null;
  creditsOwedToUs: number | null;
  netPayable: number | null;
  oldestDaysOverdue: number | null;
}

export async function fetchPayables(): Promise<PayableRow[]> {
  const { data, error } = await requireSupabase()
    .from("ap_by_supplier")
    .select("*")
    .order("net_payable", { ascending: false });
  if (error) fail("fetchPayables", error);
  return (data ?? []).map((r: any) => ({
    supplierName: r.supplier_name, invoices: Number(r.invoices ?? 0),
    stuck: Number(r.stuck ?? 0), approvedToPay: num(r.approved_to_pay),
    overdue: num(r.overdue), creditsOwedToUs: num(r.credits_owed_to_us),
    netPayable: num(r.net_payable), oldestDaysOverdue: num(r.oldest_days_overdue),
  }));
}

export interface PourCostRow {
  productName: string | null;
  stockUnit: string | null;
  measureSize: number | null;
  containerSize: number | null;
  measuresPerContainer: number | null;
  costPerMeasure: number | null;
  expectedLossPercent: number | null;
}

export async function fetchPourCost(): Promise<PourCostRow[]> {
  const { data, error } = await requireSupabase()
    .from("pour_cost")
    .select("*")
    .order("product_name");
  if (error) fail("fetchPourCost", error);
  return (data ?? []).map((r: any) => ({
    productName: r.product_name, stockUnit: r.stock_unit,
    measureSize: num(r.measure_size), containerSize: num(r.container_size),
    measuresPerContainer: num(r.measures_per_container),
    costPerMeasure: num(r.cost_per_measure),
    expectedLossPercent: num(r.expected_loss_percent),
  }));
}

export interface HygieneRow {
  unitName: string | null;
  formTitle: string | null;
  frequency: string | null;
  isCcp: boolean;
  lastCompletedOn: string | null;
  breachesLast30Days: number;
  /** A recorded breach that raised nothing is evidence somebody knew. */
  breachesNobodyWasToldAbout: number;
}

export async function fetchHygieneByUnit(): Promise<HygieneRow[]> {
  const { data, error } = await requireSupabase()
    .from("hygiene_by_unit")
    .select("*")
    .order("breaches_nobody_was_told_about", { ascending: false });
  if (error) fail("fetchHygieneByUnit", error);
  return (data ?? []).map((r: any) => ({
    unitName: r.unit_name, formTitle: r.form_title, frequency: r.frequency,
    isCcp: Boolean(r.is_ccp), lastCompletedOn: r.last_completed_on,
    breachesLast30Days: Number(r.breaches_last_30_days ?? 0),
    breachesNobodyWasToldAbout: Number(r.breaches_nobody_was_told_about ?? 0),
  }));
}
