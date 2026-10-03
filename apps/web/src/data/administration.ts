// ---------------------------------------------------------------------------
// Who may do what, and the numbers that decide the rest
// ---------------------------------------------------------------------------
// Accounts and access, the venue's protected parameters, the departments
// themselves, and the hiring chain that approves a new person.
//
// Split out of `repository.ts` in stage 1.4, which was 5.260 lines and 9% of
// the front end. Nothing here changed in the move: `repository.ts` re-exports
// all of it, so every caller imports exactly what it imported before.
// ---------------------------------------------------------------------------

import { requireSupabase } from "@/lib/supabase";
import { fail } from "./_shared";
import type { ImportedHaccpForm } from "@/engine/haccp-import";
import type { OrgRole } from "@/engine/purchasing";

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
  /**
   * Whether a grant here can name one business unit.
   *
   * Four sections guard tables that carry a unit; the rest do not, and a scoped
   * grant on one of them would be accepted, mean nothing, and then refuse every
   * write. The database computes this from the guards actually attached rather
   * than from a list, so the screen offers exactly what will work.
   */
  scopesByUnit: boolean;
}

export async function fetchAppSections(): Promise<AppSection[]> {
  const { data, error } = await requireSupabase()
    .from("app_sections").select("*").order("sort_order");
  if (error) fail("fetchAppSections", error);
  return (data ?? []).map((r: any) => ({
    code: r.code, name: r.name, description: r.description,
    sortOrder: r.sort_order ?? 0, isCore: Boolean(r.is_core),
    scopesByUnit: Boolean(r.scopes_by_unit),
  }));
}

/** A grant that names one business unit. Absent means the person has none. */
export interface UnitGrant {
  sectionCode: string;
  sectionName: string;
  businessUnitId: string;
  businessUnitCode: string;
  businessUnitName: string;
  level: AccessLevel;
}

export interface AccessRow {
  userId: string;
  email: string;
  role: OrgRole;
  /**
   * Section code to the level held across the whole venue. Every section is
   * present, which is what makes this a grid.
   */
  sections: Record<string, AccessLevel>;
  /**
   * The grants that name one unit, which are not a grid: a unit somebody was
   * never granted is an absence, not a cell reading NONE. Folding these into
   * `sections` would have let a kitchen-only WRITE overwrite the venue-wide
   * NONE beside it and read as full access.
   */
  unitGrants: UnitGrant[];
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
      row = {
        userId: r.user_id, email: r.email, role: r.role,
        sections: {}, unitGrants: [],
      };
      byUser.set(r.user_id, row);
    }
    if (r.business_unit_id === null || r.business_unit_id === undefined) {
      row.sections[r.section_code] = r.level as AccessLevel;
    } else {
      row.unitGrants.push({
        sectionCode: r.section_code,
        sectionName: r.section_name,
        businessUnitId: r.business_unit_id,
        businessUnitCode: r.business_unit_code,
        businessUnitName: r.business_unit_name,
        level: r.level as AccessLevel,
      });
    }
  }
  return [...byUser.values()];
}

/**
 * Grant, narrow or remove access to one section for one person.
 *
 * `businessUnitId` null means every unit, which is what every grant written
 * before migration 0062 means and what the screen offers by default.
 *
 * Through an RPC rather than an upsert, and not for tidiness. "One grant per
 * person per section" became "one unscoped grant, plus one per unit", which is
 * two partial unique indexes — and a partial index can arbitrate an ON CONFLICT
 * only when the statement repeats its WHERE clause, which PostgREST's
 * `onConflict` cannot send. `set_section_access` is SECURITY INVOKER, so the
 * Administration guard and the row-level policies apply exactly as they did to
 * the upsert this replaces.
 *
 * NONE still removes the row rather than storing it, so the table holds grants
 * and never denials: there is one way to say "no access" and the grid and the
 * database cannot disagree about which it is.
 */
export async function setSectionAccess(
  userId: string,
  sectionCode: string,
  level: AccessLevel,
  businessUnitId: string | null = null,
): Promise<void> {
  const { error } = await requireSupabase().rpc("set_section_access", {
    p_user: userId,
    p_section: sectionCode,
    p_level: level,
    p_unit: businessUnitId,
  });
  if (error) fail("setSectionAccess", error);
}

/** Access levels in the order they widen, so "the best of these" is a max. */
const ACCESS_RANK: Record<AccessLevel, number> = { NONE: 0, READ: 1, WRITE: 2 };

/**
 * What the signed-in user may reach, for the screens to reflect honestly.
 *
 * The best level held anywhere in each section, because that is the question
 * this answer is used for: whether the section appears at all, and whether its
 * buttons are enabled. Somebody with WRITE on People for the kitchen alone
 * should see the People screen with its controls live — and be refused by the
 * database on anybody else's record, which is where that refusal belongs.
 *
 * Taking the best is new and is not a widening: before migration 0062 there
 * was one row per section and the loop below assigned whichever arrived last.
 * With a row per unit that would have been a different answer on every load,
 * which is worse than either reading.
 */
export async function fetchMySectionAccess(): Promise<Record<string, AccessLevel>> {
  const db = requireSupabase();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) return {};
  const { data, error } = await db
    .from("member_access_grid").select("section_code, level")
    .eq("user_id", auth.user.id);
  if (error) fail("fetchMySectionAccess", error);
  const out: Record<string, AccessLevel> = {};
  for (const r of (data ?? []) as any[]) {
    const level = r.level as AccessLevel;
    const held = out[r.section_code];
    if (held === undefined || ACCESS_RANK[level] > ACCESS_RANK[held]) {
      out[r.section_code] = level;
    }
  }
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
  businessUnitId: string;
  approverEmail: string;
  deputyEmail: string | null;
}

export async function fetchDepartmentApprovers(): Promise<DepartmentApprover[]> {
  const { data, error } = await requireSupabase()
    .from("department_approvers").select("*");
  if (error) fail("fetchDepartmentApprovers", error);
  return (data ?? []).map((r: any) => ({
    id: r.id, businessUnitId: r.business_unit_id,
    approverEmail: r.approver_email, deputyEmail: r.deputy_email ?? null,
  }));
}

export async function saveDepartmentApprover(input: {
  businessUnitId: string;
  approverEmail: string;
  deputyEmail: string | null;
}): Promise<void> {
  const { error } = await requireSupabase().from("department_approvers").upsert(
    {
      business_unit_id: input.businessUnitId,
      approver_email: input.approverEmail.trim().toLowerCase(),
      deputy_email: input.deputyEmail?.trim().toLowerCase() || null,
    },
    { onConflict: "business_unit_id" },
  );
  if (error) fail("saveDepartmentApprover", error);
}

export type HiringStatus =
  | "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED" | "FILLED" | "CANCELLED";

export interface HiringRequest {
  id: string;
  reference: string;
  businessUnitId: string;
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
    id: r.id, reference: r.reference, businessUnitId: r.business_unit_id,
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
  businessUnitId: string;
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
    business_unit_id: input.businessUnitId,
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
