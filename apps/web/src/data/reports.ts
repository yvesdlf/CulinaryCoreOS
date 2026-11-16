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

export type TrendGrain = "day" | "week" | "month" | "quarter" | "year";

export interface TrendRow {
  periodStart: string;
  periodEnd: string;
  revenueNet: number | null;
  labourCost: number | null;
  goodsCost: number | null;
  grossProfit: number | null;
  grossProfitPercent: number | null;
  labourPercentOfNet: number | null;
  covers: number | null;
  daysInPeriod: number;
  daysWithData: number;
  /** The period has not finished. Almost always true of the last row. */
  isOpen: boolean;
  previousRevenueNet: number | null;
  previousGrossProfitPercent: number | null;
}

/**
 * Daily profit bucketed into periods (0120).
 *
 * The completeness columns are the reason this is a function rather than a
 * `group by` on the client: a month four days old holds a quarter of a
 * month's revenue, and a chart that does not say so reads as a collapse.
 */
export async function fetchProfitTrend(
  from: string, to: string, grain: TrendGrain,
): Promise<TrendRow[]> {
  const { data, error } = await requireSupabase().rpc("profit_trend", {
    p_from: from, p_to: to, p_grain: grain, p_unit: null,
  });
  if (error) fail("fetchProfitTrend", error);
  return (data ?? []).map((r: any) => ({
    periodStart: r.period_start,
    periodEnd: r.period_end,
    revenueNet: num(r.revenue_net),
    labourCost: num(r.labour_cost),
    goodsCost: num(r.goods_cost),
    grossProfit: num(r.gross_profit),
    grossProfitPercent: num(r.gross_profit_percent),
    labourPercentOfNet: num(r.labour_percent_of_net),
    covers: num(r.covers),
    daysInPeriod: Number(r.days_in_period ?? 0),
    daysWithData: Number(r.days_with_data ?? 0),
    isOpen: Boolean(r.is_open),
    previousRevenueNet: num(r.previous_revenue_net),
    previousGrossProfitPercent: num(r.previous_gross_profit_percent),
  }));
}

/** A period is only comparable when it finished with every day in it. */
export function isComparable(r: TrendRow): boolean {
  return !r.isOpen && r.daysWithData >= r.daysInPeriod;
}

// ── Traceability (0129) ─────────────────────────────────────────────────────

/**
 * One lot received in the period: where it came from, where it went, and what
 * the record cannot answer.
 *
 * `readerSeesMovements` and `readerSeesProduction` are not decoration. The
 * function reads as the caller, and the forward trace lives behind Inventory
 * and Production while the lots themselves are shared — so a reader with
 * neither gets every lot and an empty trace, which looks exactly like a venue
 * that never used its stock. The sheet has to say which it is.
 */
export interface TraceabilityRow {
  lotId: string;
  lotCode: string | null;
  productName: string | null;
  supplierName: string | null;
  deliveryReference: string | null;
  receivedOn: string;
  expiresOn: string | null;
  expiryKind: string | null;
  receiptTemperatureC: number | null;
  status: string;
  statusReason: string | null;
  quantityReceived: number | null;
  quantityOut: number;
  movements: number;
  preparations: number;
  firstUsedOn: string | null;
  lastUsedOn: string | null;
  services: string | null;
  concerns: string[];
  readerSeesMovements: boolean;
  readerSeesProduction: boolean;
}

export async function fetchTraceability(
  from: string,
  to: string,
): Promise<TraceabilityRow[]> {
  const { data, error } = await requireSupabase()
    .rpc("traceability_report", { p_from: from, p_to: to });
  if (error) fail("fetchTraceability", error);
  return (data ?? []).map((r: any) => ({
    lotId: r.lot_id,
    lotCode: r.lot_code ?? null,
    productName: r.product_name ?? null,
    supplierName: r.supplier_name ?? null,
    deliveryReference: r.delivery_reference ?? null,
    receivedOn: r.received_on,
    expiresOn: r.expires_on ?? null,
    expiryKind: r.expiry_kind ?? null,
    receiptTemperatureC: r.receipt_temperature_c == null ? null : Number(r.receipt_temperature_c),
    status: r.status,
    statusReason: r.status_reason ?? null,
    quantityReceived: r.quantity_received == null ? null : Number(r.quantity_received),
    quantityOut: Number(r.quantity_out ?? 0),
    movements: Number(r.movements ?? 0),
    preparations: Number(r.preparations ?? 0),
    firstUsedOn: r.first_used_on ?? null,
    lastUsedOn: r.last_used_on ?? null,
    services: r.services ?? null,
    concerns: r.concerns ?? [],
    readerSeesMovements: r.reader_sees_movements === true,
    readerSeesProduction: r.reader_sees_production === true,
  }));
}

/**
 * What the sheet has to say about itself, beyond any single row.
 *
 * Built here rather than in the page so the same sentences reach the screen
 * and all four exported formats — the caveats are the part that must not be
 * lost on the way into a file.
 */
export function traceabilityCaveats(rows: TraceabilityRow[]): string[] {
  const notes: string[] = [];
  if (rows.length === 0) return notes;

  if (!rows[0].readerSeesMovements) {
    notes.push(
      "You do not have Inventory access, so the forward trace is empty on " +
      "every line. That is not the same as the stock never having been used.",
    );
  } else if (!rows[0].readerSeesProduction) {
    notes.push(
      "You do not have Production access, so lines show that stock was drawn " +
      "but not which preparations it went into.",
    );
  }

  const count = (p: (r: TraceabilityRow) => boolean) => rows.filter(p).length;
  const noSupplier = count((r) => !r.supplierName);
  const noCode = count((r) => !r.lotCode?.trim());
  const unjudgeable = count((r) => r.expiresOn != null && !r.expiryKind);
  const blocked = count((r) => r.status !== "OK");

  if (noSupplier > 0) {
    notes.push(`${noSupplier} of ${rows.length} lots name no supplier: one step back is not answerable for them.`);
  }
  if (noCode > 0) {
    notes.push(`${noCode} have no lot code, so a delivery cannot be told apart from another of the same product.`);
  }
  if (unjudgeable > 0) {
    notes.push(`${unjudgeable} carry a date with no kind, which cannot be judged safe or merely stale.`);
  }
  if (blocked > 0) {
    notes.push(`${blocked} are blocked, recalled or withdrawn.`);
  }
  return notes;
}

// ── Production (0130) ───────────────────────────────────────────────────────

/**
 * One planned service in the period, plus a row for each day of production
 * that answered to no plan at all.
 *
 * `dishesPlanned` and `preparationsMade` are counted in different things and
 * are never subtracted from one another — a plan line is a dish and a number
 * of covers, a completion record is a preparation and a number of batches.
 * The report says whether a plan was answered, not whether it was answered
 * correctly; the second question needs a map between recipes and preparations
 * that the database does not have.
 *
 * `planId` is null on the unplanned rows. That is the half worth reading: a
 * kitchen improvising is either covering a shortage or ignoring the sheet.
 */
export interface ProductionRow {
  plannedFor: string;
  service: string | null;
  planId: string | null;
  dishesPlanned: number;
  coversPlanned: number;
  preparationsMade: number;
  batchesMade: number;
  quantityMade: number;
  madeBy: string | null;
  corrections: number;
  firstMadeAt: string | null;
  lastMadeAt: string | null;
  concerns: string[];
}

export async function fetchProduction(
  from: string,
  to: string,
): Promise<ProductionRow[]> {
  const { data, error } = await requireSupabase()
    .rpc("production_report", { p_from: from, p_to: to });
  if (error) fail("fetchProduction", error);
  return (data ?? []).map((r: any) => ({
    plannedFor: r.planned_for,
    service: r.service ?? null,
    planId: r.plan_id ?? null,
    dishesPlanned: Number(r.dishes_planned ?? 0),
    coversPlanned: Number(r.covers_planned ?? 0),
    preparationsMade: Number(r.preparations_made ?? 0),
    batchesMade: Number(r.batches_made ?? 0),
    quantityMade: Number(r.quantity_made ?? 0),
    madeBy: r.made_by ?? null,
    corrections: Number(r.corrections ?? 0),
    firstMadeAt: r.first_made_at ?? null,
    lastMadeAt: r.last_made_at ?? null,
    concerns: r.concerns ?? [],
  }));
}

/**
 * What the sheet has to say about itself, beyond any single row.
 *
 * Deliberately counts rather than lists. A head of department reading this
 * before a Monday meeting needs "four services went uncooked", not four
 * sentences; the rows underneath say which. The one exception is an empty
 * report, where the reason it is empty is the only thing worth saying.
 */
export function productionCaveats(rows: ProductionRow[]): string[] {
  const notes: string[] = [];
  if (rows.length === 0) return notes;

  const planned = rows.filter((r) => r.planId != null);
  const count = (p: (r: ProductionRow) => boolean) => rows.filter(p).length;

  const barren = planned.filter((r) => r.preparationsMade === 0).length;
  const noDishes = planned.filter((r) => r.dishesPlanned === 0).length;
  const loose = count((r) => r.planId == null);
  const corrected = rows.reduce((n, r) => n + r.corrections, 0);

  if (barren > 0) {
    notes.push(
      `${barren} of ${planned.length} planned services have no production ` +
      `recorded against them. Either the prep was not recorded or it was not done.`,
    );
  }
  if (noDishes > 0) {
    notes.push(`${noDishes} plans have no dishes written on them, so there was nothing to answer.`);
  }
  if (loose > 0) {
    notes.push(
      `${loose} days have production that answered to no plan. That is not ` +
      `necessarily wrong — a batch made mid-service is still a batch — but it is not on a sheet.`,
    );
  }
  if (corrected > 0) {
    notes.push(
      `${corrected} batches were corrected after the fact. The superseded ` +
      `records are excluded from every figure here; both rows remain on the Production screen.`,
    );
  }
  notes.push(
    "Dishes planned and preparations made are counted in different units and " +
    "are not compared. This report says whether a plan was answered, not whether " +
    "what was made matched what was on it.",
  );
  return notes;
}

// ── Maintenance (0131) ──────────────────────────────────────────────────────

/**
 * One asset with work or a problem in the period, plus a row for work raised
 * against no asset at all.
 *
 * Two kinds of number live in this row and the names are the only thing
 * separating them. `raised` and `completed` are of the period. `stillOpen`,
 * `overdue`, `oldestOpenDays` and every `plans*` column are as of today,
 * because an open job is open now and a statutory check that came round in
 * August is not resolved by the period ending in November.
 *
 * An absent asset means "nothing to say about it", not "no such asset": the
 * report lists what is on the agenda, not the whole register.
 */
export interface MaintenanceRow {
  assetId: string | null;
  assetCode: string | null;
  assetName: string | null;
  category: string | null;
  criticality: string | null;
  assetStatus: string | null;
  locationName: string | null;
  raised: number;
  completed: number;
  stillOpen: number;
  overdue: number;
  emergencies: number;
  reactive: number;
  planned: number;
  downtimeMinutes: number;
  labourMinutes: number;
  avgDaysToComplete: number | null;
  oldestOpenDays: number | null;
  completedNotVerified: number;
  plansActive: number;
  plansOverdue: number;
  statutoryOverdue: number;
  concerns: string[];
}

export async function fetchMaintenance(
  from: string,
  to: string,
): Promise<MaintenanceRow[]> {
  const { data, error } = await requireSupabase()
    .rpc("maintenance_report", { p_from: from, p_to: to });
  if (error) fail("fetchMaintenance", error);
  return (data ?? []).map((r: any) => ({
    assetId: r.asset_id ?? null,
    assetCode: r.asset_code ?? null,
    assetName: r.asset_name ?? null,
    category: r.category ?? null,
    criticality: r.criticality ?? null,
    assetStatus: r.asset_status ?? null,
    locationName: r.location_name ?? null,
    raised: Number(r.raised ?? 0),
    completed: Number(r.completed ?? 0),
    stillOpen: Number(r.still_open ?? 0),
    overdue: Number(r.overdue ?? 0),
    emergencies: Number(r.emergencies ?? 0),
    reactive: Number(r.reactive ?? 0),
    planned: Number(r.planned ?? 0),
    downtimeMinutes: Number(r.downtime_minutes ?? 0),
    labourMinutes: Number(r.labour_minutes ?? 0),
    avgDaysToComplete: r.avg_days_to_complete == null ? null : Number(r.avg_days_to_complete),
    oldestOpenDays: r.oldest_open_days == null ? null : Number(r.oldest_open_days),
    completedNotVerified: Number(r.completed_not_verified ?? 0),
    plansActive: Number(r.plans_active ?? 0),
    plansOverdue: Number(r.plans_overdue ?? 0),
    statutoryOverdue: Number(r.statutory_overdue ?? 0),
    concerns: r.concerns ?? [],
  }));
}

/**
 * What the sheet has to say about itself.
 *
 * The last two notes are not optional and are not counts: they are the two
 * ways this particular report misleads a reader who takes it at face value.
 * A month-end total that silently excluded eleven overdue statutory checks,
 * or a list read as the asset register, are both worse than no report.
 */
export function maintenanceCaveats(rows: MaintenanceRow[]): string[] {
  const notes: string[] = [];
  if (rows.length === 0) return notes;

  const statutory = rows.reduce((n, r) => n + r.statutoryOverdue, 0);
  const plans = rows.reduce((n, r) => n + r.plansOverdue, 0);
  const unverified = rows.reduce((n, r) => n + r.completedNotVerified, 0);
  const overdue = rows.reduce((n, r) => n + r.overdue, 0);

  if (statutory > 0) {
    notes.push(
      `${statutory} statutory ${statutory === 1 ? "check is" : "checks are"} past ` +
      `${statutory === 1 ? "its" : "their"} date. That is an obligation, not a backlog item.`,
    );
  }
  if (plans - statutory > 0) {
    notes.push(`${plans - statutory} other planned checks are past their date.`);
  }
  if (overdue > 0) {
    notes.push(`${overdue} work orders are open past the date they were due.`);
  }
  if (unverified > 0) {
    notes.push(
      `${unverified} jobs were completed in this period and never verified. ` +
      `Verification is a separate status so that somebody other than the person ` +
      `who did the work signs it off; one nobody reaches is not a control.`,
    );
  }

  notes.push(
    "Raised and completed are of the period. Open, overdue and the planned-" +
    "maintenance figures are as of today, because an open job is open now.",
  );
  notes.push(
    "Only assets with work or a problem are listed. An asset that is absent " +
    "has nothing to report, which is not the same as not existing — this is " +
    "the agenda, not the asset register.",
  );
  return notes;
}
