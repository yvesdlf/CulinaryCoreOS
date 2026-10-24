// ---------------------------------------------------------------------------
// The work the venue does every day
// ---------------------------------------------------------------------------
// Hygiene records and development tasks, maintenance jobs and the assets they
// are raised against, housekeeping, the batches the kitchen makes, and the
// photographs that evidence any of it.
//
// Split out of `repository.ts` in stage 1.4, which was 5.260 lines and 9% of
// the front end. Nothing here changed in the move: `repository.ts` re-exports
// all of it, so every caller imports exactly what it imported before.
// ---------------------------------------------------------------------------

import { venueToday } from "@/lib/today";
import { requireSupabase } from "@/lib/supabase";
import { fail, currentOrgId } from "./_shared";
import { signedFileUrl } from "./people";
import { createRequisition } from "./purchasing";
import type { RequisitionLineRow } from "./purchasing";
import type { HaccpField } from "@/engine/haccp-import";

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
    completed_on: venueToday(),
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
      ? venueToday() : null,
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

// ── Maintenance ─────────────────────────────────────────────────────────────
/*
 * Reads come from the views wherever the database already joins things up —
 * asset_health, maintenance_due, maintenance_manning. A browser that rebuilt
 * those joins would be a second implementation of the same question, and the
 * two would eventually disagree about which asset is worst.
 */

export interface LocationRow {
  id: string; parentId: string | null; code: string; name: string;
  kind: string; businessUnitId: string | null; active: boolean;
}

export async function fetchLocations(): Promise<LocationRow[]> {
  const { data, error } = await requireSupabase()
    .from("locations").select("*").order("code");
  if (error) fail("fetchLocations", error);
  return (data ?? []).map((r: any) => ({
    id: r.id, parentId: r.parent_id ?? null, code: r.code, name: r.name,
    kind: r.kind, businessUnitId: r.business_unit_id ?? null, active: Boolean(r.active),
  }));
}

export async function createLocation(input: {
  code: string; name: string; kind: string;
  parentId: string | null; businessUnitId: string | null;
}): Promise<void> {
  const { error } = await requireSupabase().from("locations").insert({
    code: input.code, name: input.name, kind: input.kind,
    parent_id: input.parentId, business_unit_id: input.businessUnitId,
  });
  if (error) fail("createLocation", error);
}

export interface AssetRow {
  id: string; code: string; name: string; category: string;
  locationId: string | null; locationName: string | null;
  criticality: "CRITICAL" | "IMPORTANT" | "ROUTINE";
  status: string; purchaseCost: number | null; warrantyUntil: string | null;
  requiredCertifications: string[];
  jobsYear: number; jobsOpen: number;
  downtimeMinutesYear: number; partsCostYear: number;
  lastServicedAt: string | null;
}

/** The register and its health in one read, because no screen wants one without the other. */
export async function fetchAssets(): Promise<AssetRow[]> {
  const db = requireSupabase();
  const [health, register] = await Promise.all([
    db.from("asset_health").select("*"),
    db.from("assets").select("id, required_certifications, warranty_until"),
  ]);
  if (health.error) fail("fetchAssets", health.error);
  if (register.error) fail("fetchAssets/register", register.error);

  const extra = new Map(
    (register.data ?? []).map((r: any) => [r.id, r]),
  );
  return (health.data ?? []).map((r: any) => ({
    id: r.asset_id, code: r.code, name: r.name, category: r.category,
    locationId: r.location_id ?? null, locationName: r.location_name ?? null,
    criticality: r.criticality, status: r.status,
    purchaseCost: r.purchase_cost === null ? null : Number(r.purchase_cost),
    warrantyUntil: extra.get(r.asset_id)?.warranty_until ?? null,
    requiredCertifications: extra.get(r.asset_id)?.required_certifications ?? [],
    jobsYear: Number(r.jobs_year ?? 0), jobsOpen: Number(r.jobs_open ?? 0),
    downtimeMinutesYear: Number(r.downtime_minutes_year ?? 0),
    partsCostYear: Number(r.parts_cost_year ?? 0),
    lastServicedAt: r.last_serviced_at ?? null,
  }));
}

export async function createAsset(input: {
  code: string; name: string; category: string;
  locationId: string | null; criticality: string;
  purchaseCost: number | null; warrantyUntil: string | null;
  requiredCertifications: string[];
}): Promise<void> {
  const { error } = await requireSupabase().from("assets").insert({
    code: input.code, name: input.name, category: input.category,
    location_id: input.locationId, criticality: input.criticality,
    purchase_cost: input.purchaseCost, warranty_until: input.warrantyUntil,
    required_certifications: input.requiredCertifications,
  });
  if (error) fail("createAsset", error);
}

export interface MaintenanceDueRow {
  planId: string; code: string; title: string;
  intervalDays: number; estimatedMinutes: number;
  statutory: boolean; criticality: string;
  assetId: string | null; assetName: string | null; assetCode: string | null;
  locationName: string | null;
  lastCompletedOn: string | null; dueOn: string; daysOverdue: number;
  jobOpen: boolean;
}

export async function fetchMaintenanceDue(): Promise<MaintenanceDueRow[]> {
  const { data, error } = await requireSupabase()
    .from("maintenance_due").select("*").order("due_on");
  if (error) fail("fetchMaintenanceDue", error);
  return (data ?? []).map((r: any) => ({
    planId: r.plan_id, code: r.code, title: r.title,
    intervalDays: Number(r.interval_days), estimatedMinutes: Number(r.estimated_minutes),
    statutory: Boolean(r.statutory), criticality: r.criticality,
    assetId: r.asset_id ?? null, assetName: r.asset_name ?? null,
    assetCode: r.asset_code ?? null, locationName: r.location_name ?? null,
    lastCompletedOn: r.last_completed_on ?? null,
    dueOn: r.due_on, daysOverdue: Number(r.days_overdue ?? 0),
    jobOpen: Boolean(r.job_open),
  }));
}

export async function createMaintenancePlan(input: {
  code: string; title: string; instructions: string | null;
  assetId: string | null; locationId: string | null;
  intervalDays: number; estimatedMinutes: number;
  statutory: boolean; requiredCertifications: string[];
}): Promise<void> {
  const { error } = await requireSupabase().from("maintenance_plans").insert({
    code: input.code, title: input.title, instructions: input.instructions,
    asset_id: input.assetId, location_id: input.locationId,
    interval_days: input.intervalDays, estimated_minutes: input.estimatedMinutes,
    statutory: input.statutory, required_certifications: input.requiredCertifications,
  });
  if (error) fail("createMaintenancePlan", error);
}

export interface WorkOrderRow {
  id: string; reference: string | null; title: string; detail: string | null;
  assetId: string | null; locationId: string | null; businessUnitId: string | null;
  source: string; planId: string | null;
  priority: string; status: string;
  raisedByEmail: string | null; raisedAt: string; dueBy: string | null;
  assignedTo: string | null;
  completedByEmail: string | null; completionNote: string | null;
  verifiedByEmail: string | null;
  downtimeMinutes: number | null; labourMinutes: number | null;
  requisitionId: string | null;
}

function toWorkOrder(r: any): WorkOrderRow {
  return {
    id: r.id, reference: r.reference ?? null, title: r.title, detail: r.detail ?? null,
    assetId: r.asset_id ?? null, locationId: r.location_id ?? null,
    businessUnitId: r.business_unit_id ?? null,
    source: r.source, planId: r.plan_id ?? null,
    priority: r.priority, status: r.status,
    raisedByEmail: r.raised_by_email ?? null, raisedAt: r.raised_at,
    dueBy: r.due_by ?? null, assignedTo: r.assigned_to ?? null,
    completedByEmail: r.completed_by_email ?? null,
    completionNote: r.completion_note ?? null,
    verifiedByEmail: r.verified_by_email ?? null,
    downtimeMinutes: r.downtime_minutes === null ? null : Number(r.downtime_minutes),
    labourMinutes: r.labour_minutes === null ? null : Number(r.labour_minutes),
    requisitionId: r.requisition_id ?? null,
  };
}

export async function fetchWorkOrders(): Promise<WorkOrderRow[]> {
  const { data, error } = await requireSupabase()
    .from("work_orders").select("*").order("raised_at", { ascending: false }).limit(500);
  if (error) fail("fetchWorkOrders", error);
  return (data ?? []).map(toWorkOrder);
}

export async function createWorkOrder(input: {
  title: string; detail: string | null;
  assetId: string | null; locationId: string | null; businessUnitId: string | null;
  priority: string; source?: string; planId?: string | null; dueBy: string | null;
}): Promise<WorkOrderRow> {
  const db = requireSupabase();
  const { data: auth } = await db.auth.getUser();
  // No reference is sent. The trigger allocates it, and a number computed here
  // would race with anybody else raising a job for the same unit.
  const { data, error } = await db.from("work_orders").insert({
    title: input.title, detail: input.detail,
    asset_id: input.assetId, location_id: input.locationId,
    business_unit_id: input.businessUnitId,
    priority: input.priority, source: input.source ?? "REACTIVE",
    plan_id: input.planId ?? null, due_by: input.dueBy,
    raised_by_email: auth.user?.email ?? null,
  }).select("*").single();
  if (error) fail("createWorkOrder", error);
  return toWorkOrder(data);
}

/**
 * Assignment is refused by the database for an absent or uncertified
 * technician. The message it raises names the person and what is missing, so
 * it is shown as written rather than replaced with something vaguer.
 */
export async function assignWorkOrder(id: string, employeeId: string | null): Promise<void> {
  const { error } = await requireSupabase().from("work_orders")
    .update({ assigned_to: employeeId }).eq("id", id);
  if (error) fail("assignWorkOrder", error);
}

export async function updateWorkOrderStatus(
  id: string,
  status: string,
  extra: {
    completionNote?: string; labourMinutes?: number | null;
    downtimeMinutes?: number | null; cancelledReason?: string;
  } = {},
): Promise<void> {
  const db = requireSupabase();
  const { data: auth } = await db.auth.getUser();
  const patch: Record<string, unknown> = { status };
  if (status === "COMPLETED") {
    patch.completed_by_email = auth.user?.email ?? null;
    patch.completion_note = extra.completionNote ?? null;
    patch.labour_minutes = extra.labourMinutes ?? null;
    patch.downtime_minutes = extra.downtimeMinutes ?? null;
  }
  if (status === "VERIFIED") patch.verified_by_email = auth.user?.email ?? null;
  if (status === "CANCELLED") patch.cancelled_reason = extra.cancelledReason ?? null;
  if (status === "IN_PROGRESS") patch.started_at = new Date().toISOString();

  const { error } = await db.from("work_orders").update(patch).eq("id", id);
  if (error) fail("updateWorkOrderStatus", error);
}

export interface WorkOrderEventRow {
  fromStatus: string | null; toStatus: string; note: string | null;
  actorEmail: string | null; at: string;
}

export async function fetchWorkOrderEvents(workOrderId: string): Promise<WorkOrderEventRow[]> {
  const { data, error } = await requireSupabase()
    .from("work_order_events").select("*")
    .eq("work_order_id", workOrderId).order("at");
  if (error) fail("fetchWorkOrderEvents", error);
  return (data ?? []).map((r: any) => ({
    fromStatus: r.from_status ?? null, toStatus: r.to_status,
    note: r.note ?? null, actorEmail: r.actor_email ?? null, at: r.at,
  }));
}

export interface ManningRow {
  employeeId: string; name: string; shiftsToday: number;
  jobsOpen: number; jobsLate: number; minutesAssigned: number;
}

export async function fetchMaintenanceManning(): Promise<ManningRow[]> {
  const { data, error } = await requireSupabase()
    .from("maintenance_manning").select("*").order("name");
  if (error) fail("fetchMaintenanceManning", error);
  return (data ?? []).map((r: any) => ({
    employeeId: r.employee_id, name: r.name,
    shiftsToday: Number(r.shifts_today ?? 0), jobsOpen: Number(r.jobs_open ?? 0),
    jobsLate: Number(r.jobs_late ?? 0), minutesAssigned: Number(r.minutes_assigned ?? 0),
  }));
}

export interface MeterRow {
  id: string; code: string; name: string; unit: string;
  cumulative: boolean; costPerUnit: number | null;
  lastReading: number | null; lastReadOn: string | null;
  lastConsumption: number | null;
}

export async function fetchMeters(): Promise<MeterRow[]> {
  const db = requireSupabase();
  const [meters, readings] = await Promise.all([
    db.from("meters").select("*").eq("active", true).order("code"),
    db.from("meter_readings").select("*").order("read_on", { ascending: false }).limit(400),
  ]);
  if (meters.error) fail("fetchMeters", meters.error);
  if (readings.error) fail("fetchMeters/readings", readings.error);

  const latest = new Map<string, any>();
  for (const r of readings.data ?? []) {
    if (!latest.has(r.meter_id)) latest.set(r.meter_id, r);
  }
  return (meters.data ?? []).map((m: any) => {
    const last = latest.get(m.id);
    return {
      id: m.id, code: m.code, name: m.name, unit: m.unit,
      cumulative: Boolean(m.cumulative),
      costPerUnit: m.cost_per_unit === null ? null : Number(m.cost_per_unit),
      lastReading: last ? Number(last.reading) : null,
      lastReadOn: last?.read_on ?? null,
      lastConsumption:
        last?.consumption === null || last?.consumption === undefined
          ? null : Number(last.consumption),
    };
  });
}

/**
 * Consumption is not sent. The trigger computes it from the previous reading,
 * because two clients computing it from the same previous row would disagree
 * about the interval the moment they raced.
 */
export async function recordMeterReading(input: {
  meterId: string; readOn: string; reading: number;
  reset: boolean; resetReason: string | null; note: string | null;
}): Promise<void> {
  const db = requireSupabase();
  const { data: auth } = await db.auth.getUser();
  const { error } = await db.from("meter_readings").insert({
    meter_id: input.meterId, read_on: input.readOn, reading: input.reading,
    reset: input.reset, reset_reason: input.resetReason, note: input.note,
    read_by_email: auth.user?.email ?? null,
  });
  if (error) fail("recordMeterReading", error);
}

/**
 * Parts for a job, ordered the way everything else is ordered.
 *
 * A requisition, through the existing approval chain, linked back to the work
 * order. A stores process only engineering can see is how a venue stops
 * knowing what it owns.
 */
export async function raiseWorkOrderParts(input: {
  workOrderId: string; businessUnitId: string | null; unitCode?: string;
  neededBy: string | null; justification: string;
  lines: Omit<RequisitionLineRow, "id" | "lineTotal">[];
}): Promise<void> {
  const req = await createRequisition({
    businessUnitId: input.businessUnitId,
    unitCode: input.unitCode,
    neededBy: input.neededBy,
    justification: input.justification,
    lines: input.lines,
  });
  const { error } = await requireSupabase().from("work_orders")
    .update({ requisition_id: req.id }).eq("id", input.workOrderId);
  if (error) fail("raiseWorkOrderParts/link", error);
}

// ── Housekeeping ────────────────────────────────────────────────────────────

export interface RoomTypeRow {
  id: string; code: string; name: string; beds: number;
  departureMinutes: number; stayoverMinutes: number; deepCleanMinutes: number;
}

export async function fetchRoomTypes(): Promise<RoomTypeRow[]> {
  const { data, error } = await requireSupabase()
    .from("room_types").select("*").eq("active", true).order("code");
  if (error) fail("fetchRoomTypes", error);
  return (data ?? []).map((r: any) => ({
    id: r.id, code: r.code, name: r.name, beds: Number(r.beds),
    departureMinutes: Number(r.departure_minutes),
    stayoverMinutes: Number(r.stayover_minutes),
    deepCleanMinutes: Number(r.deep_clean_minutes),
  }));
}

export interface BoardRow {
  roomId: string; roomNumber: string; floor: string | null;
  state: string; stateChangedAt: string;
  occupancy: string; occupancySetAt: string | null;
  outOfServiceReason: string | null;
  roomType: string | null; roomTypeName: string | null;
  roomTypeId: string | null;
  locationId: string; locationName: string;
  taskId: string | null; taskKind: string | null; taskStatus: string | null;
  standardMinutes: number | null; actualMinutes: number | null;
  attendant: string | null;
  jobsOpen: number; jobsBlocking: number;
}

/**
 * The board, with maintenance included.
 *
 * `jobs_blocking` comes from the view rather than a second query, because the
 * whole point of these two modules being one database is that the question
 * "may this room be sold" has one answer.
 */
export async function fetchHousekeepingBoard(): Promise<BoardRow[]> {
  const db = requireSupabase();
  const [board, rooms] = await Promise.all([
    db.from("housekeeping_board").select("*"),
    db.from("rooms").select("id, room_type_id"),
  ]);
  if (board.error) fail("fetchHousekeepingBoard", board.error);
  if (rooms.error) fail("fetchHousekeepingBoard/rooms", rooms.error);
  const typeOf = new Map((rooms.data ?? []).map((r: any) => [r.id, r.room_type_id]));

  return (board.data ?? [])
    .map((r: any) => ({
      roomId: r.room_id, roomNumber: r.room_number, floor: r.floor ?? null,
      state: r.state, stateChangedAt: r.state_changed_at,
      occupancy: r.occupancy, occupancySetAt: r.occupancy_set_at ?? null,
      outOfServiceReason: r.out_of_service_reason ?? null,
      roomType: r.room_type ?? null, roomTypeName: r.room_type_name ?? null,
      roomTypeId: typeOf.get(r.room_id) ?? null,
      locationId: r.location_id, locationName: r.location_name,
      taskId: r.task_id ?? null, taskKind: r.task_kind ?? null,
      taskStatus: r.task_status ?? null,
      standardMinutes: r.standard_minutes === null ? null : Number(r.standard_minutes),
      actualMinutes: r.actual_minutes === null ? null : Number(r.actual_minutes),
      attendant: r.attendant ?? null,
      jobsOpen: Number(r.jobs_open ?? 0), jobsBlocking: Number(r.jobs_blocking ?? 0),
    }))
    .sort((a, b) => a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true }));
}

export async function createRoom(input: {
  locationId: string; roomTypeId: string | null;
  roomNumber: string; floor: string | null;
}): Promise<void> {
  const { error } = await requireSupabase().from("rooms").insert({
    location_id: input.locationId, room_type_id: input.roomTypeId,
    room_number: input.roomNumber, floor: input.floor,
  });
  if (error) fail("createRoom", error);
}

/**
 * The release rule is the database's. A room with an open emergency or high
 * priority job is refused, by name, and that message is worth showing intact —
 * it names the job, which is what the person has to chase.
 */
export async function setRoomState(
  roomId: string, state: string, outOfServiceReason?: string | null,
): Promise<void> {
  const db = requireSupabase();
  const { data: auth } = await db.auth.getUser();
  const { error } = await db.from("rooms").update({
    state,
    out_of_service_reason: state === "OUT_OF_SERVICE" ? (outOfServiceReason ?? null) : null,
    state_changed_by_email: auth.user?.email ?? null,
  }).eq("id", roomId);
  if (error) fail("setRoomState", error);
}

/**
 * Occupancy is recorded, not known — there is no property management system
 * behind it. The stamp is written here so every screen can say how old it is.
 */
export async function setRoomOccupancy(roomId: string, occupancy: string): Promise<void> {
  const db = requireSupabase();
  const { data: auth } = await db.auth.getUser();
  const { error } = await db.from("rooms").update({
    occupancy,
    occupancy_set_at: new Date().toISOString(),
    occupancy_set_by_email: auth.user?.email ?? null,
  }).eq("id", roomId);
  if (error) fail("setRoomOccupancy", error);
}

export interface HousekeepingTaskRow {
  id: string; roomId: string | null; locationId: string | null;
  kind: string; taskDate: string;
  assignedTo: string | null; standardMinutes: number;
  status: string; actualMinutes: number | null;
  startedAt: string | null; finishedAt: string | null;
}

export async function fetchHousekeepingTasks(onDate: string): Promise<HousekeepingTaskRow[]> {
  const { data, error } = await requireSupabase()
    .from("housekeeping_tasks").select("*").eq("task_date", onDate);
  if (error) fail("fetchHousekeepingTasks", error);
  return (data ?? []).map((r: any) => ({
    id: r.id, roomId: r.room_id ?? null, locationId: r.location_id ?? null,
    kind: r.kind, taskDate: r.task_date,
    assignedTo: r.assigned_to ?? null, standardMinutes: Number(r.standard_minutes),
    status: r.status,
    actualMinutes: r.actual_minutes === null ? null : Number(r.actual_minutes),
    startedAt: r.started_at ?? null, finishedAt: r.finished_at ?? null,
  }));
}

/**
 * Publish a proposed sheet.
 *
 * Inserted one row at a time rather than in a batch, because the capacity rule
 * is a row trigger: a batch that broke somebody's shift would be refused whole
 * and the screen could not say which room did it. One at a time costs a few
 * round trips and reports the exact room that overflowed.
 */
export async function publishHousekeepingSheet(
  tasks: { roomId: string; kind: string; standardMinutes: number; employeeId: string }[],
  taskDate: string,
): Promise<{ created: number; refused: { roomId: string; message: string }[] }> {
  const db = requireSupabase();
  let created = 0;
  const refused: { roomId: string; message: string }[] = [];
  for (const t of tasks) {
    const { error } = await db.from("housekeeping_tasks").insert({
      room_id: t.roomId, kind: t.kind, task_date: taskDate,
      standard_minutes: t.standardMinutes, assigned_to: t.employeeId,
    });
    if (error) refused.push({ roomId: t.roomId, message: error.message });
    else created += 1;
  }
  return { created, refused };
}

export async function startHousekeepingTask(id: string): Promise<void> {
  const { error } = await requireSupabase().from("housekeeping_tasks")
    .update({ status: "IN_PROGRESS", started_at: new Date().toISOString() }).eq("id", id);
  if (error) fail("startHousekeepingTask", error);
}

export async function finishHousekeepingTask(
  id: string, actualMinutes: number | null,
): Promise<void> {
  const { error } = await requireSupabase().from("housekeeping_tasks").update({
    status: "DONE", finished_at: new Date().toISOString(), actual_minutes: actualMinutes,
  }).eq("id", id);
  if (error) fail("finishHousekeepingTask", error);
}

/**
 * An inspection moves the task and the room by trigger, so nothing else is
 * written here. Doing it in the browser would leave a room inspected and a
 * task not, whenever the second request failed.
 */
export async function inspectHousekeepingTask(input: {
  taskId: string; passed: boolean; score: number | null; findings: string | null;
}): Promise<void> {
  const db = requireSupabase();
  const { data: auth } = await db.auth.getUser();
  const { error } = await db.from("housekeeping_inspections").insert({
    task_id: input.taskId, passed: input.passed,
    score: input.score, findings: input.findings,
    inspector_email: auth.user?.email ?? null,
  });
  if (error) fail("inspectHousekeepingTask", error);
}

export interface WorkloadRow {
  employeeId: string; name: string; taskDate: string;
  minutesAssigned: number; minutesWorked: number;
  roomsAssigned: number; roomsFinished: number; minutesRostered: number;
}

export async function fetchHousekeepingWorkload(): Promise<WorkloadRow[]> {
  const { data, error } = await requireSupabase()
    .from("housekeeping_workload").select("*").order("name");
  if (error) fail("fetchHousekeepingWorkload", error);
  return (data ?? []).map((r: any) => ({
    employeeId: r.employee_id, name: r.name, taskDate: r.task_date,
    minutesAssigned: Number(r.minutes_assigned ?? 0),
    minutesWorked: Number(r.minutes_worked ?? 0),
    roomsAssigned: Number(r.rooms_assigned ?? 0),
    roomsFinished: Number(r.rooms_finished ?? 0),
    minutesRostered: Number(r.minutes_rostered ?? 0),
  }));
}

export interface LostPropertyRow {
  id: string; reference: string | null; description: string;
  foundInRoomId: string | null; foundOn: string; holdUntil: string | null;
  storageRef: string | null; status: string;
  releasedTo: string | null; releasedOn: string | null;
}

export async function fetchLostProperty(): Promise<LostPropertyRow[]> {
  const { data, error } = await requireSupabase()
    .from("lost_property").select("*").order("found_on", { ascending: false }).limit(300);
  if (error) fail("fetchLostProperty", error);
  return (data ?? []).map((r: any) => ({
    id: r.id, reference: r.reference ?? null, description: r.description,
    foundInRoomId: r.found_in_room_id ?? null, foundOn: r.found_on,
    holdUntil: r.hold_until ?? null, storageRef: r.storage_ref ?? null,
    status: r.status, releasedTo: r.released_to ?? null, releasedOn: r.released_on ?? null,
  }));
}

export async function bookLostProperty(input: {
  description: string; foundInRoomId: string | null;
  foundByEmployeeId: string | null; storageRef: string | null;
}): Promise<void> {
  const { error } = await requireSupabase().from("lost_property").insert({
    description: input.description, found_in_room_id: input.foundInRoomId,
    found_by_employee_id: input.foundByEmployeeId, storage_ref: input.storageRef,
  });
  if (error) fail("bookLostProperty", error);
}

export async function releaseLostProperty(input: {
  id: string; status: "RETURNED" | "DISPOSED" | "DONATED";
  releasedTo: string | null; releaseNote: string | null;
}): Promise<void> {
  const db = requireSupabase();
  const { data: auth } = await db.auth.getUser();
  const { error } = await db.from("lost_property").update({
    status: input.status, released_to: input.releasedTo,
    release_note: input.releaseNote, released_by_email: auth.user?.email ?? null,
  }).eq("id", input.id);
  if (error) fail("releaseLostProperty", error);
}

export interface ReplenishmentRow {
  productId: string; productName: string; unit: string | null;
  neededToday: number; onHand: number; afterToday: number;
}

export async function fetchHousekeepingReplenishment(): Promise<ReplenishmentRow[]> {
  const { data, error } = await requireSupabase()
    .from("housekeeping_replenishment").select("*");
  if (error) fail("fetchHousekeepingReplenishment", error);
  return (data ?? []).map((r: any) => ({
    productId: r.product_id, productName: r.product_name, unit: r.unit ?? null,
    neededToday: Number(r.needed_today ?? 0),
    onHand: Number(r.on_hand ?? 0),
    afterToday: Number(r.after_today ?? 0),
  }));
}

// ── Photographs and short video ─────────────────────────────────────────────
/*
 * Attachments, and why the limits are fetched rather than written down here.
 *
 * The database holds one list of allowed types and size caps —
 * `public.media_limits()` — and both the bucket's own configuration and the
 * insert trigger read it. Copying that list into a constant in this file would
 * give the screen a third opinion, and the one that drifts is always the one
 * in the client: a venue whose administrator widens the list gets a file
 * picker that still refuses it, and nobody can see why. So the screen asks.
 *
 * The limits are advice here and nothing more. Every one of them is refused by
 * the storage service, by the row trigger, or by both; checking in the browser
 * only means a porter finds out before a three-minute upload rather than
 * after it.
 */

export type AttachmentParentType = "WORK_ORDER" | "HACCP_RECORD" | "STOCK_MOVEMENT";

export interface MediaLimit {
  mimeType: string;
  kind: "IMAGE" | "VIDEO";
  maxBytes: number;
}

/** Thirty seconds, from the check constraint on `attachments.duration_seconds`. */
export const MAX_VIDEO_SECONDS = 30;

export async function fetchMediaLimits(): Promise<MediaLimit[]> {
  const { data, error } = await requireSupabase().rpc("media_limits");
  if (error) fail("fetchMediaLimits", error);
  return (data ?? []).map((r: any) => ({
    mimeType: r.mime_type, kind: r.kind, maxBytes: Number(r.max_bytes),
  }));
}

export interface AttachmentRow {
  id: string;
  parentType: AttachmentParentType;
  parentId: string;
  bucketId: string;
  objectPath: string;
  fileName: string;
  mimeType: string;
  kind: "IMAGE" | "VIDEO";
  byteSize: number;
  durationSeconds: number | null;
  caption: string | null;
  uploadedByEmail: string | null;
  uploadedAt: string;
  deleteAfter: string | null;
}

function attachmentFromRow(r: any): AttachmentRow {
  return {
    id: r.id, parentType: r.parent_type, parentId: r.parent_id,
    bucketId: r.bucket_id, objectPath: r.object_path,
    fileName: r.file_name, mimeType: r.mime_type, kind: r.kind,
    byteSize: Number(r.byte_size),
    durationSeconds: r.duration_seconds === null ? null : Number(r.duration_seconds),
    caption: r.caption ?? null,
    uploadedByEmail: r.uploaded_by_email ?? null,
    uploadedAt: r.uploaded_at,
    deleteAfter: r.delete_after ?? null,
  };
}

export async function fetchAttachments(
  parentType: AttachmentParentType,
  parentId: string,
): Promise<AttachmentRow[]> {
  const { data, error } = await requireSupabase()
    .from("attachments").select("*")
    .eq("parent_type", parentType).eq("parent_id", parentId)
    .order("uploaded_at");
  if (error) fail("fetchAttachments", error);
  return (data ?? []).map(attachmentFromRow);
}

export interface StagedMedia {
  file: File;
  /** Measured in the browser where the file is a video; null for a photograph. */
  durationSeconds: number | null;
  caption: string | null;
}

/**
 * Attach files to a record that already exists.
 *
 * The file goes up first and the row second, which is the order
 * `sendStaffDocument` already uses and the order the insert trigger insists
 * on: it refuses a row whose object is not there, because a row pointing at
 * nothing shows in the list as a photograph that opens to an error.
 *
 * Nothing here tells the database who is uploading. `uploaded_by_email` comes
 * from the caller's JWT by trigger, and anything this file sent would be
 * discarded — see migration 0054, which exists because a decision was filed
 * under somebody else's name.
 *
 * One failure stops the rest, and the files already attached stay attached.
 * They are legitimately attached; unwinding them would mean deleting evidence,
 * which is the one thing this table does not allow.
 */
export async function uploadAttachments(
  parentType: AttachmentParentType,
  parentId: string,
  items: StagedMedia[],
  orgId?: string,
): Promise<AttachmentRow[]> {
  if (items.length === 0) return [];
  const db = requireSupabase();

  /*
   * The organisation in the path has to be the parent record's own, and the
   * storage policy checks exactly that. Falling back to the caller's default
   * organisation is correct while gap 20 stands — there is no organisation
   * switcher, so a user works in one — and a caller that knows the parent's
   * organisation should pass it. A mismatch is refused by the policy rather
   * than written wrongly, which is the right way round.
   */
  const org = orgId ?? (await currentOrgId());
  const written: AttachmentRow[] = [];

  for (const item of items) {
    const dot = item.file.name.lastIndexOf(".");
    const extension = dot > 0 ? item.file.name.slice(dot).toLowerCase() : "";
    const path = `${org}/${parentType}/${parentId}/${crypto.randomUUID()}${extension}`;

    const { error: upErr } = await db.storage.from("media").upload(path, item.file, {
      upsert: false,
      contentType: item.file.type,
    });
    if (upErr) fail(`uploadAttachments (${item.file.name})`, upErr);

    const { data, error } = await db.from("attachments").insert({
      parent_type: parentType,
      parent_id: parentId,
      bucket_id: "media",
      object_path: path,
      file_name: item.file.name,
      mime_type: item.file.type,
      // Replaced by the trigger from the type above, which is the figure that
      // decides the size cap and the retention. Sent because the column is
      // NOT NULL and a client is not trusted to get it right.
      kind: item.file.type.startsWith("video/") ? "VIDEO" : "IMAGE",
      byte_size: item.file.size,
      duration_seconds: item.durationSeconds,
      caption: item.caption,
    }).select("*").single();
    if (error) fail(`uploadAttachments (${item.file.name})`, error);
    written.push(attachmentFromRow(data));
  }
  return written;
}

/**
 * A link to one attachment, good for five minutes.
 *
 * The bucket is private and stays private, so there is no permanent URL to
 * hold on to. The link is signed against the caller's own session, so somebody
 * from another venue asking for one is refused by the same policy that hides
 * the row.
 */
export async function attachmentUrl(a: AttachmentRow, seconds = 300): Promise<string> {
  return signedFileUrl(a.bucketId, a.objectPath, seconds);
}

// ── Production records ──────────────────────────────────────────────────────
/*
 * Reads here are plain; the write is an RPC.
 *
 * `record_production` puts the completion and the stock movements it consumed
 * in one transaction. Doing it as two inserts from the browser leaves a window
 * in which a batch exists that consumed nothing, and a batch that consumed
 * nothing reads in the variance report as a kitchen producing food out of thin
 * air. Same argument as recordMovements above, for the same reason.
 */

import type { VarianceRow } from "@/engine/production-records";

export interface ProductionPlanRow {
  id: string;
  plannedFor: string;
  service: string | null;
  note: string | null;
  createdByEmail: string | null;
  createdAt: string;
  /** Covers per dish, as the sheet was worked out. */
  covers: { recipeId: string; covers: number }[];
}

export async function fetchProductionPlans(limit = 30): Promise<ProductionPlanRow[]> {
  const db = requireSupabase();
  const { data, error } = await db
    .from("production_plans")
    .select("*, production_plan_lines(recipe_id, covers)")
    .order("planned_for", { ascending: false })
    .limit(limit);
  if (error) fail("fetchProductionPlans", error);
  return (data ?? []).map((r: any) => ({
    id: r.id,
    plannedFor: r.planned_for,
    service: r.service ?? null,
    note: r.note ?? null,
    createdByEmail: r.created_by_email ?? null,
    createdAt: r.created_at ?? "",
    covers: (r.production_plan_lines ?? []).map((l: any) => ({
      recipeId: l.recipe_id,
      covers: Number(l.covers),
    })),
  }));
}

/**
 * The plan a completion will point at, reused where nothing has changed.
 *
 * Covers get adjusted as a service firms up, and saving a new sheet on every
 * keystroke would give the kitchen forty plans a day and make "which sheet was
 * this made against" meaningless. A plan is reused when its date, service and
 * covers all match; otherwise a new one is written, because a different set of
 * covers is a different sheet.
 */
export async function ensureProductionPlan(input: {
  plannedFor: string;
  service: string | null;
  covers: { recipeId: string; covers: number }[];
}): Promise<string> {
  const db = requireSupabase();
  const key = (covers: { recipeId: string; covers: number }[]) =>
    covers
      .map((c) => `${c.recipeId}:${c.covers}`)
      .sort()
      .join("|");
  const wanted = key(input.covers);

  const existing = await fetchProductionPlans(50);
  const match = existing.find(
    (p) =>
      p.plannedFor === input.plannedFor &&
      (p.service ?? null) === input.service &&
      key(p.covers) === wanted,
  );
  if (match) return match.id;

  const { data: auth } = await db.auth.getUser();
  const { data, error } = await db
    .from("production_plans")
    .insert({
      planned_for: input.plannedFor,
      service: input.service,
      created_by_id: auth.user?.id ?? null,
      created_by_email: auth.user?.email ?? null,
    })
    .select("id")
    .single();
  if (error || !data) fail("ensureProductionPlan", error);

  if (input.covers.length > 0) {
    const { error: lineError } = await db.from("production_plan_lines").insert(
      input.covers.map((c) => ({
        plan_id: data.id,
        recipe_id: c.recipeId,
        covers: c.covers,
      })),
    );
    if (lineError) fail("ensureProductionPlan lines", lineError);
  }
  return data.id;
}

export interface ProductionRecordRow {
  id: string;
  planId: string | null;
  subRecipeId: string;
  preparationName: string;
  batches: number;
  batchYieldQty: number;
  quantityMade: number;
  unit: string;
  occurredAt: string;
  producedByEmail: string | null;
  note: string | null;
  correctsId: string | null;
  correctionReason: string | null;
  /** The preparation has been edited since this batch was made. */
  recipeChangedSince: boolean;
}

/** Only the records nothing supersedes. A corrected batch is not what was made. */
export async function fetchProductionRecords(
  fromIso?: string,
  toIso?: string,
): Promise<ProductionRecordRow[]> {
  let q = requireSupabase()
    .from("production_records_effective")
    .select("*")
    .order("occurred_at", { ascending: false })
    .limit(500);
  if (fromIso) q = q.gte("occurred_at", fromIso);
  if (toIso) q = q.lte("occurred_at", toIso);
  const { data, error } = await q;
  if (error) fail("fetchProductionRecords", error);
  return (data ?? []).map((r: any) => ({
    id: r.id,
    planId: r.plan_id ?? null,
    subRecipeId: r.sub_recipe_id,
    preparationName: r.preparation_name ?? "",
    batches: Number(r.batches),
    batchYieldQty: Number(r.batch_yield_qty),
    quantityMade: Number(r.quantity_made),
    unit: r.unit ?? "",
    occurredAt: r.occurred_at ?? "",
    producedByEmail: r.produced_by_email ?? null,
    note: r.note ?? null,
    correctsId: r.corrects_id ?? null,
    correctionReason: r.correction_reason ?? null,
    recipeChangedSince: Boolean(r.recipe_changed_since),
  }));
}

export interface NewConsumption {
  productId: string;
  /** Positive: what came off the shelf. The ledger holds the sign. */
  quantity: number;
  unit: string;
  unitCost: string | null;
  lotId?: string | null;
  note?: string | null;
}

export async function recordProduction(input: {
  subRecipeId: string;
  batches: number;
  /** The preparation's own yield unit; the database refuses anything else. */
  unit: string;
  consumption: NewConsumption[];
  planId?: string | null;
  occurredAt?: string | null;
  note?: string | null;
  correctsId?: string | null;
  correctionReason?: string | null;
}): Promise<string> {
  const { data, error } = await requireSupabase().rpc("record_production", {
    p_sub_recipe_id: input.subRecipeId,
    p_batches: input.batches,
    p_unit: input.unit,
    p_consumption: input.consumption.map((c) => ({
      product_id: c.productId,
      quantity: c.quantity,
      unit: c.unit,
      unit_cost: c.unitCost,
      lot_id: c.lotId ?? null,
      note: c.note ?? null,
    })),
    p_plan_id: input.planId ?? null,
    p_occurred_at: input.occurredAt ?? null,
    p_note: input.note ?? null,
    p_corrects_id: input.correctsId ?? null,
    p_correction_reason: input.correctionReason ?? null,
  });
  if (error) fail("recordProduction", error);
  return data as string;
}

/**
 * Theoretical against actual usage — SRS INV-FUNC-005.
 *
 * Nulls are carried through as nulls rather than coerced to zero. "Nobody
 * recorded any" and "none" are different statements and the report's whole
 * value is in keeping them apart.
 */
export async function fetchProductionVariance(
  fromDate: string,
  toDate: string,
): Promise<VarianceRow[]> {
  const { data, error } = await requireSupabase().rpc("production_variance", {
    p_from: fromDate,
    p_to: toDate,
  });
  if (error) fail("fetchProductionVariance", error);
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return ((data ?? []) as any[]).map((r: any) => ({
    productId: r.product_id,
    productName: r.product_name,
    category: r.category ?? null,
    unit: r.unit ?? "",
    theoreticalQty: num(r.theoretical_qty),
    actualQty: num(r.actual_qty),
    actualQtyUnlinked: Number(r.actual_qty_unlinked ?? 0),
    varianceQty: num(r.variance_qty),
    variancePercent: num(r.variance_percent),
    unitCost: String(r.unit_cost ?? "0"),
    theoreticalCost: r.theoretical_cost === null ? null : String(r.theoretical_cost),
    actualCost: r.actual_cost === null ? null : String(r.actual_cost),
    varianceCost: r.variance_cost === null ? null : String(r.variance_cost),
    batchesRecorded: Number(r.batches_recorded ?? 0),
    movements: Number(r.movements ?? 0),
    recipeChanged: Boolean(r.recipe_changed),
    comparable: Boolean(r.comparable),
    note: r.note ?? null,
  }));
}

export interface ForwardTraceRow {
  movementId: string;
  kind: string;
  quantity: number;
  unit: string;
  occurredAt: string;
  reason: string | null;
  actorEmail: string | null;
  preparationName: string | null;
  batches: number | null;
  quantityMade: number | null;
  madeUnit: string | null;
  producedByEmail: string | null;
  plannedFor: string | null;
  service: string | null;
  /** BATCH, UNRECORDED_USAGE, or the movement kind for waste and returns. */
  stepForward: string;
}

/** Where a lot went — Regulation 178/2002 Article 18, one step forward. */
export async function fetchLotForwardTrace(lotId: string): Promise<ForwardTraceRow[]> {
  const { data, error } = await requireSupabase()
    .from("lot_forward_trace")
    .select("*")
    .eq("lot_id", lotId)
    .order("occurred_at", { ascending: false });
  if (error) fail("fetchLotForwardTrace", error);
  return (data ?? []).map((r: any) => ({
    movementId: r.movement_id,
    kind: r.kind,
    quantity: Number(r.quantity),
    unit: r.unit ?? "",
    occurredAt: r.occurred_at ?? "",
    reason: r.reason ?? null,
    actorEmail: r.actor_email ?? null,
    preparationName: r.preparation_name ?? null,
    batches: r.batches === null || r.batches === undefined ? null : Number(r.batches),
    quantityMade:
      r.quantity_made === null || r.quantity_made === undefined
        ? null
        : Number(r.quantity_made),
    madeUnit: r.made_unit ?? null,
    producedByEmail: r.produced_by_email ?? null,
    plannedFor: r.planned_for ?? null,
    service: r.service ?? null,
    stepForward: r.step_forward ?? "",
  }));
}

/** The venue's own tolerance for a production variance, as a percentage. */
export async function fetchVarianceTolerance(): Promise<number> {
  const { data, error } = await requireSupabase()
    .from("venue_parameters")
    .select("value")
    .eq("code", "PRODUCTION_VARIANCE_TOLERANCE")
    .maybeSingle();
  if (error) fail("fetchVarianceTolerance", error);
  // A venue seeded before 0060 has no parameter row. Five per cent is the
  // seeded default; falling back to zero would paint every gram red.
  return data ? Number((data as { value: number }).value) : 5;
}

// ── Requests: the shared front door ─────────────────────────────────────────
/*
 * The intake every department shares, from migration 0066.
 *
 * In this module rather than one of its own because a request is operational
 * work — it sits beside maintenance jobs and hygiene records, and most of them
 * become one or inform one. The department it goes to is a property of the
 * kind, not of the caller, so nothing here lets a screen choose a destination.
 */

export type RequestStatus =
  | "NEW" | "ACKNOWLEDGED" | "IN_PROGRESS" | "BLOCKED"
  | "RESOLVED" | "CLOSED" | "REJECTED";

export type RequestPriority = "EMERGENCY" | "HIGH" | "NORMAL" | "LOW";

export interface RequestType {
  id: string;
  code: string;
  name: string;
  description: string | null;
  toUnitId: string;
  defaultPriority: RequestPriority;
  respondWithinHours: number | null;
  becomes: "WORK_ORDER" | null;
  active: boolean;
}

export async function fetchRequestTypes(): Promise<RequestType[]> {
  const { data, error } = await requireSupabase()
    .from("request_types").select("*").order("name");
  if (error) fail("fetchRequestTypes", error);
  return (data ?? []).map((r: any) => ({
    id: r.id, code: r.code, name: r.name, description: r.description ?? null,
    toUnitId: r.to_unit_id,
    defaultPriority: r.default_priority,
    respondWithinHours: r.respond_within_hours === null || r.respond_within_hours === undefined
      ? null : Number(r.respond_within_hours),
    becomes: r.becomes ?? null,
    active: Boolean(r.active),
  }));
}

export interface RequestRow {
  id: string;
  reference: string;
  title: string;
  detail: string | null;
  status: RequestStatus;
  priority: RequestPriority;
  businessUnitId: string;
  unitCode: string;
  unitName: string;
  kindCode: string;
  kindName: string;
  raisedByEmail: string | null;
  raisedFromUnit: string | null;
  locationName: string | null;
  ownerName: string | null;
  createdAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  respondBy: string | null;
  resolution: string | null;
  convertedType: string | null;
  convertedId: string | null;
  hoursOpen: number;
  /** Null where nothing was promised. Not false — there is nothing to be on time against. */
  answeredLate: boolean | null;
}

export async function fetchRequests(): Promise<RequestRow[]> {
  const { data, error } = await requireSupabase()
    .from("request_board").select("*").order("created_at", { ascending: false });
  if (error) fail("fetchRequests", error);
  return (data ?? []).map((r: any) => ({
    id: r.id, reference: r.reference, title: r.title, detail: r.detail ?? null,
    status: r.status, priority: r.priority,
    businessUnitId: r.business_unit_id, unitCode: r.unit_code, unitName: r.unit_name,
    kindCode: r.kind_code, kindName: r.kind_name,
    raisedByEmail: r.raised_by_email ?? null,
    raisedFromUnit: r.raised_from_unit ?? null,
    locationName: r.location_name ?? null,
    ownerName: r.owner_name ?? null,
    createdAt: r.created_at,
    acknowledgedAt: r.acknowledged_at ?? null,
    resolvedAt: r.resolved_at ?? null,
    respondBy: r.respond_by ?? null,
    resolution: r.resolution ?? null,
    convertedType: r.converted_type ?? null,
    convertedId: r.converted_id ?? null,
    hoursOpen: Number(r.hours_open ?? 0),
    answeredLate: r.answered_late === null || r.answered_late === undefined
      ? null : Boolean(r.answered_late),
  }));
}

/**
 * Raise one.
 *
 * No department is sent. The kind decides where it goes, and the database
 * overwrites anything a client supplies — a request addressed by whoever
 * raised it is a request that can be addressed to the wrong department, and
 * the person waiting would never know.
 */
export async function raiseRequest(input: {
  requestTypeId: string;
  title: string;
  detail?: string | null;
  priority?: RequestPriority | null;
  locationId?: string | null;
  raisedFromUnitId?: string | null;
}): Promise<string> {
  const { data, error } = await requireSupabase()
    .from("requests")
    .insert({
      request_type_id: input.requestTypeId,
      title: input.title,
      detail: input.detail ?? null,
      priority: input.priority ?? undefined,
      location_id: input.locationId ?? null,
      raised_from_unit_id: input.raisedFromUnitId ?? null,
    })
    .select("id")
    .single();
  if (error) fail("raiseRequest", error);
  return (data as { id: string }).id;
}

/**
 * Move one along.
 *
 * Only the receiving department may, and the database says so rather than this
 * file: `enforce_request_write` reads the row's own department and asks for a
 * grant on it, so a kitchen-scoped grant answers kitchen requests and nothing
 * else. A rejection without a reason is refused by a check constraint, which
 * is why `resolution` is required here for that one status.
 */
export async function updateRequest(
  id: string,
  patch: { status?: RequestStatus; resolution?: string | null; ownerEmployeeId?: string | null },
): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.resolution !== undefined) row.resolution = patch.resolution;
  if (patch.ownerEmployeeId !== undefined) row.owner_employee_id = patch.ownerEmployeeId;
  const { error } = await requireSupabase().from("requests").update(row).eq("id", id);
  if (error) fail("updateRequest", error);
}

/**
 * Turn one into a maintenance job, keeping both.
 *
 * One transaction in the database, because two inserts from the browser leave
 * a window in which the request says it was converted and the job does not
 * exist — and the request is the thing somebody is watching.
 */
export async function convertRequestToWorkOrder(
  requestId: string,
  note?: string | null,
): Promise<string> {
  const { data, error } = await requireSupabase().rpc("convert_request_to_work_order", {
    p_request: requestId,
    p_note: note ?? null,
  });
  if (error) fail("convertRequestToWorkOrder", error);
  return data as string;
}

export interface RequestLoadRow {
  businessUnitId: string;
  unitCode: string;
  unitName: string;
  openCount: number;
  unansweredCount: number;
  overdueCount: number;
  emergencyCount: number;
  oldestUnansweredAt: string | null;
}

/** One line per department: what is waiting on them. The row a tile reads. */
export async function fetchRequestLoad(): Promise<RequestLoadRow[]> {
  const { data, error } = await requireSupabase()
    .from("request_load").select("*").order("unit_name");
  if (error) fail("fetchRequestLoad", error);
  return (data ?? []).map((r: any) => ({
    businessUnitId: r.business_unit_id,
    unitCode: r.unit_code, unitName: r.unit_name,
    openCount: Number(r.open_count ?? 0),
    unansweredCount: Number(r.unanswered_count ?? 0),
    overdueCount: Number(r.overdue_count ?? 0),
    emergencyCount: Number(r.emergency_count ?? 0),
    oldestUnansweredAt: r.oldest_unanswered_at ?? null,
  }));
}

// ── Handover ────────────────────────────────────────────────────────────────
/*
 * What the last shift needs the next one to know (migration 0071).
 *
 * The competitor is WhatsApp, which wins on four seconds and loses on
 * everything afterwards. The parts of that worth carrying into the data layer:
 * an item can point at the request it is about rather than describing it
 * again, and a published handover does not change — a correction is another
 * item, which is why `addHandoverItem` works on a published one and
 * `updateHandover` does not.
 */

export type HandoverStatus = "DRAFT" | "PUBLISHED";
export type HandoverItemKind =
  "BROKEN" | "GUEST" | "STOCK" | "PEOPLE" | "SAFETY" | "NOTE";

export interface HandoverRow {
  id: string;
  businessUnitId: string;
  unitCode: string;
  unitName: string;
  onDate: string;
  service: string | null;
  status: HandoverStatus;
  summary: string | null;
  writtenByEmail: string | null;
  publishedAt: string | null;
  acknowledgedByEmail: string | null;
  acknowledgedAt: string | null;
  itemCount: number;
  openItems: number;
  /** Null for a draft: it has not been offered to anybody, so it is not unread. */
  unread: boolean | null;
}

export interface HandoverItem {
  id: string;
  handoverId: string;
  kind: HandoverItemKind;
  note: string;
  requestId: string | null;
  workOrderId: string | null;
  createdAt: string;
}

export async function fetchHandovers(sinceDate: string): Promise<HandoverRow[]> {
  const { data, error } = await requireSupabase()
    .from("handover_board").select("*")
    .gte("on_date", sinceDate)
    .order("on_date", { ascending: false });
  if (error) fail("fetchHandovers", error);
  return (data ?? []).map((r: any) => ({
    id: r.id,
    businessUnitId: r.business_unit_id,
    unitCode: r.unit_code, unitName: r.unit_name,
    onDate: r.on_date, service: r.service ?? null,
    status: r.status, summary: r.summary ?? null,
    writtenByEmail: r.written_by_email ?? null,
    publishedAt: r.published_at ?? null,
    acknowledgedByEmail: r.acknowledged_by_email ?? null,
    acknowledgedAt: r.acknowledged_at ?? null,
    itemCount: Number(r.item_count ?? 0),
    openItems: Number(r.open_items ?? 0),
    unread: r.unread === null || r.unread === undefined ? null : Boolean(r.unread),
  }));
}

export async function fetchHandoverItems(handoverId: string): Promise<HandoverItem[]> {
  const { data, error } = await requireSupabase()
    .from("handover_items").select("*")
    .eq("handover_id", handoverId)
    .order("created_at");
  if (error) fail("fetchHandoverItems", error);
  return (data ?? []).map((r: any) => ({
    id: r.id, handoverId: r.handover_id, kind: r.kind, note: r.note,
    requestId: r.request_id ?? null, workOrderId: r.work_order_id ?? null,
    createdAt: r.created_at,
  }));
}

export async function startHandover(input: {
  businessUnitId: string;
  onDate: string;
  service?: string | null;
  summary?: string | null;
}): Promise<string> {
  const { data, error } = await requireSupabase()
    .from("handovers")
    .insert({
      business_unit_id: input.businessUnitId,
      on_date: input.onDate,
      service: input.service ?? null,
      summary: input.summary ?? null,
    })
    .select("id").single();
  if (error) fail("startHandover", error);
  return (data as { id: string }).id;
}

/**
 * Edit a draft, or publish it.
 *
 * Publishing is one way. The database refuses to change the summary afterwards
 * — a handover is read by somebody who was not there, to learn what was known
 * at the time, and editing it replaces the record rather than correcting it.
 */
export async function updateHandover(
  id: string,
  patch: { summary?: string | null; status?: HandoverStatus },
): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.summary !== undefined) row.summary = patch.summary;
  if (patch.status !== undefined) row.status = patch.status;
  const { error } = await requireSupabase().from("handovers").update(row).eq("id", id);
  if (error) fail("updateHandover", error);
}

/**
 * Say the next shift has read it.
 *
 * The address sent here is discarded: the database files it under the caller.
 * "Somebody read this, by name" is the one fact a message on a phone cannot
 * give you, and it is worth nothing if the client can choose the name.
 */
export async function acknowledgeHandover(id: string): Promise<void> {
  const { error } = await requireSupabase()
    .from("handovers")
    .update({ acknowledged_by_email: "pending" })
    .eq("id", id);
  if (error) fail("acknowledgeHandover", error);
}

/** Works on a published handover too — that is how a correction is made. */
export async function addHandoverItem(input: {
  handoverId: string;
  kind: HandoverItemKind;
  note: string;
  requestId?: string | null;
}): Promise<void> {
  const { error } = await requireSupabase().from("handover_items").insert({
    handover_id: input.handoverId,
    kind: input.kind,
    note: input.note,
    request_id: input.requestId ?? null,
  });
  if (error) fail("addHandoverItem", error);
}
