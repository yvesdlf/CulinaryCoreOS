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

// ── Housekeeping (0132) ─────────────────────────────────────────────────────

/**
 * One room worked in the period, plus any room out of service whether it was
 * worked or not, plus a row for work against a place rather than a room.
 *
 * A room out of service has no tasks *because* it is out of service, so it is
 * included deliberately rather than joined away — it is usually the line the
 * meeting most needs.
 *
 * `standardMinutes` and `actualMinutes` are summed over the tasks that
 * recorded an actual, which includes rejected cleans. Somebody spent that
 * time, and a room cleaned twice cost two cleans.
 */
export interface HousekeepingRow {
  roomId: string | null;
  roomNumber: string | null;
  roomType: string | null;
  floor: string | null;
  roomState: string | null;
  occupancy: string | null;
  daysInState: number | null;
  tasks: number;
  finished: number;
  unfinished: number;
  rejected: number;
  awaitingInspection: number;
  inspections: number;
  inspectionsFailed: number;
  standardMinutes: number;
  actualMinutes: number;
  attendants: number;
  concerns: string[];
}

export async function fetchHousekeeping(
  from: string,
  to: string,
): Promise<HousekeepingRow[]> {
  const { data, error } = await requireSupabase()
    .rpc("housekeeping_report", { p_from: from, p_to: to });
  if (error) fail("fetchHousekeeping", error);
  return (data ?? []).map((r: any) => ({
    roomId: r.room_id ?? null,
    roomNumber: r.room_number ?? null,
    roomType: r.room_type ?? null,
    floor: r.floor ?? null,
    roomState: r.room_state ?? null,
    occupancy: r.occupancy ?? null,
    daysInState: r.days_in_state == null ? null : Number(r.days_in_state),
    tasks: Number(r.tasks ?? 0),
    finished: Number(r.finished ?? 0),
    unfinished: Number(r.unfinished ?? 0),
    rejected: Number(r.rejected ?? 0),
    awaitingInspection: Number(r.awaiting_inspection ?? 0),
    inspections: Number(r.inspections ?? 0),
    inspectionsFailed: Number(r.inspections_failed ?? 0),
    standardMinutes: Number(r.standard_minutes ?? 0),
    actualMinutes: Number(r.actual_minutes ?? 0),
    attendants: Number(r.attendants ?? 0),
    concerns: r.concerns ?? [],
  }));
}

/**
 * What the sheet has to say about itself.
 *
 * The last note is the one that cannot be left out. A reader who takes this
 * for the room list will conclude the venue has twenty rooms when it has two
 * hundred, and will read an absent room as a room with no problems rather
 * than a room nobody worked.
 */
export function housekeepingCaveats(rows: HousekeepingRow[]): string[] {
  const notes: string[] = [];
  if (rows.length === 0) return notes;

  const failed = rows.reduce((n, r) => n + r.inspectionsFailed, 0);
  const inspections = rows.reduce((n, r) => n + r.inspections, 0);
  const awaiting = rows.reduce((n, r) => n + r.awaitingInspection, 0);
  const unfinished = rows.reduce((n, r) => n + r.unfinished, 0);
  const outOfService = rows.filter((r) => r.roomState === "OUT_OF_SERVICE").length;

  if (failed > 0 && inspections > 0) {
    notes.push(
      `${failed} of ${inspections} inspections failed — ` +
      `${Math.round((failed / inspections) * 100)}% of what was checked.`,
    );
  }
  if (awaiting > 0) {
    notes.push(
      `${awaiting} cleans were finished and never inspected. A pass is what ` +
      `makes a room sellable, so these are rooms in neither state.`,
    );
  }
  if (unfinished > 0) {
    notes.push(`${unfinished} tasks were never finished and carry no time against them.`);
  }
  if (outOfService > 0) {
    notes.push(
      `${outOfService} ${outOfService === 1 ? "room is" : "rooms are"} out of service. ` +
      `Those have no tasks by definition and are listed for the days they have been out.`,
    );
  }

  notes.push(
    "Time allowed and time taken are summed over the tasks that recorded an " +
    "actual. That includes cleans the inspector rejected: somebody spent that " +
    "time, and a room cleaned twice cost two cleans.",
  );
  notes.push(
    "Only rooms worked in the period, or out of service, are listed. This is " +
    "the week's sheet, not the room list — an absent room was not worked, " +
    "which is not the same as a room with nothing wrong.",
  );
  return notes;
}

// ── HR cases (0133) ─────────────────────────────────────────────────────────

/**
 * One HR case the caller may see.
 *
 * `readerSeesAll` is the field that matters and it is not decoration.
 * `hr_cases` is not section-gated: its read rule is `can_see_case`, which is
 * a participant or the organisation's owner. So for anybody but an owner
 * this is *the cases they are on*, not the venue's caseload — and a reader
 * who took "3 open cases" for the latter would be acting on a figure that
 * never claimed to be one.
 *
 * There is deliberately no name, summary, detail or outcome text here. Not
 * because the reader may not see them, but because this exports to four file
 * formats that leave the system, and access control does not travel with a
 * spreadsheet. `hasOutcome` says whether anything was written down, which is
 * the finding; the words themselves stay in the application.
 */
export interface HrCaseRow {
  caseId: string;
  reference: string;
  kind: string;
  status: string;
  openedOn: string;
  closedOn: string | null;
  daysOpen: number;
  participants: number;
  lastChangedOn: string | null;
  hasOutcome: boolean;
  readerSeesAll: boolean;
  concerns: string[];
}

export async function fetchHrCases(
  from: string,
  to: string,
): Promise<HrCaseRow[]> {
  const { data, error } = await requireSupabase()
    .rpc("hr_cases_report", { p_from: from, p_to: to });
  if (error) fail("fetchHrCases", error);
  return (data ?? []).map((r: any) => ({
    caseId: r.case_id,
    reference: r.reference,
    kind: r.kind,
    status: r.status,
    openedOn: r.opened_on,
    closedOn: r.closed_on ?? null,
    daysOpen: Number(r.days_open ?? 0),
    participants: Number(r.participants ?? 0),
    lastChangedOn: r.last_changed_on ?? null,
    hasOutcome: r.has_outcome === true,
    readerSeesAll: r.reader_sees_all === true,
    concerns: r.concerns ?? [],
  }));
}

/**
 * What the sheet has to say about itself.
 *
 * The first note is not optional and is not a count. Everything else here is
 * a figure about a caseload; that one says whose caseload it is, and without
 * it every other figure is capable of being read as the venue's.
 */
export function hrCasesCaveats(rows: HrCaseRow[]): string[] {
  const notes: string[] = [];
  if (rows.length === 0) return notes;

  if (!rows[0].readerSeesAll) {
    notes.push(
      "These are the cases you are a participant on, not the venue's caseload. " +
      "HR cases are visible to their participants and to the owner, so there " +
      "may be cases here that you cannot see and this total does not include.",
    );
  } else {
    notes.push("You are the owner, so this is every case in the venue.");
  }

  const open = rows.filter((r) => r.closedOn == null).length;
  const noOutcome = rows.filter((r) => r.closedOn != null && !r.hasOutcome).length;
  const alone = rows.filter((r) => r.participants <= 1 && r.closedOn == null).length;

  if (noOutcome > 0) {
    notes.push(
      `${noOutcome} closed ${noOutcome === 1 ? "case has" : "cases have"} no ` +
      `outcome recorded. A case closed without the decision written down is ` +
      `one the venue cannot account for afterwards.`,
    );
  }
  if (open > 0) {
    notes.push(`${open} are still open, counted from the day each was opened to today.`);
  }
  if (alone > 0) {
    notes.push(
      `${alone} open ${alone === 1 ? "case has" : "cases have"} one participant. ` +
      `Nobody but that person and the owner can reach ${alone === 1 ? "it" : "them"}.`,
    );
  }

  notes.push(
    "No names, summaries or outcome text appear here or in any export. This " +
    "sheet leaves the system as a file; the case itself does not. Open the " +
    "case in the application for the detail.",
  );
  return notes;
}

// ── Requests (0134) ─────────────────────────────────────────────────────────

/**
 * One request type: what came through the front door and how much of it was
 * answered inside the promise that type makes.
 *
 * The row is a type rather than a department because the promise lives on
 * the type. A department taking "Something is broken" within four hours and
 * "We have run out" within twenty-four has no single figure for whether it
 * answered in time, and averaging across them produces a number that means
 * nothing. The receiving department is carried on the row instead.
 *
 * `answeredLate` and `overdueNow` are deliberately separate. The first is
 * history — answered, after the promise had gone, and nobody can change it.
 * The second is a list of people still waiting, and the only figure here
 * anybody can act on.
 *
 * There is no `readerSeesAll` because there is nothing for it to say:
 * `requests_read` has no section and no unit in it, so every member of the
 * venue sees the same report.
 */
export interface RequestsRow {
  typeId: string;
  typeCode: string;
  typeName: string;
  unitName: string | null;
  respondWithinHours: number | null;
  raised: number;
  acknowledged: number;
  resolved: number;
  rejected: number;
  converted: number;
  answeredLate: number;
  noPromise: number;
  stillOpen: number;
  overdueNow: number;
  neverAcknowledged: number;
  avgHoursToAcknowledge: number | null;
  avgHoursToResolve: number | null;
  oldestOpenDays: number | null;
  concerns: string[];
}

export async function fetchRequests(
  from: string,
  to: string,
): Promise<RequestsRow[]> {
  const { data, error } = await requireSupabase()
    .rpc("requests_report", { p_from: from, p_to: to });
  if (error) fail("fetchRequests", error);
  return (data ?? []).map((r: any) => ({
    typeId: r.type_id,
    typeCode: r.type_code,
    typeName: r.type_name,
    unitName: r.unit_name ?? null,
    respondWithinHours: r.respond_within_hours == null ? null : Number(r.respond_within_hours),
    raised: Number(r.raised ?? 0),
    acknowledged: Number(r.acknowledged ?? 0),
    resolved: Number(r.resolved ?? 0),
    rejected: Number(r.rejected ?? 0),
    converted: Number(r.converted ?? 0),
    answeredLate: Number(r.answered_late ?? 0),
    noPromise: Number(r.no_promise ?? 0),
    stillOpen: Number(r.still_open ?? 0),
    overdueNow: Number(r.overdue_now ?? 0),
    neverAcknowledged: Number(r.never_acknowledged ?? 0),
    avgHoursToAcknowledge: r.avg_hours_to_acknowledge == null ? null : Number(r.avg_hours_to_acknowledge),
    avgHoursToResolve: r.avg_hours_to_resolve == null ? null : Number(r.avg_hours_to_resolve),
    oldestOpenDays: r.oldest_open_days == null ? null : Number(r.oldest_open_days),
    concerns: r.concerns ?? [],
  }));
}

/** What the sheet has to say about itself. */
export function requestsCaveats(rows: RequestsRow[]): string[] {
  const notes: string[] = [];
  if (rows.length === 0) return notes;

  const overdue = rows.reduce((n, r) => n + r.overdueNow, 0);
  const late = rows.reduce((n, r) => n + r.answeredLate, 0);
  const raised = rows.reduce((n, r) => n + r.raised, 0);
  const noPromise = rows.reduce((n, r) => n + r.noPromise, 0);
  const typesWithout = rows.filter((r) => r.respondWithinHours == null).length;

  if (overdue > 0) {
    notes.push(
      `${overdue} ${overdue === 1 ? "person is" : "people are"} still waiting ` +
      `past the time somebody promised. That is the only figure here anybody ` +
      `can still do something about.`,
    );
  }
  if (late > 0 && raised > 0) {
    notes.push(
      `${late} of ${raised} raised in this period were answered after the ` +
      `promise had passed. That is history and separate from the figure above.`,
    );
  }
  if (typesWithout > 0) {
    notes.push(
      `${typesWithout} ${typesWithout === 1 ? "kind of request promises" : "kinds of request promise"} ` +
      // The pronoun agrees with the *kind*, not with the number of requests:
      // one kind and seven requests reads "against them" otherwise.
      `no answer by any time, so the ${noPromise} raised against ` +
      `${typesWithout === 1 ? "it" : "them"} cannot be late and cannot be chased.`,
    );
  }

  notes.push(
    "Raised, answered and answered-late are of the period. Still open, " +
    "overdue and the oldest are as of today.",
  );
  notes.push(
    "A row is a kind of request, not a department, because the promise is " +
    "made by the kind. A department answering two kinds with different " +
    "targets has no single figure for whether it answered in time.",
  );
  return notes;
}
