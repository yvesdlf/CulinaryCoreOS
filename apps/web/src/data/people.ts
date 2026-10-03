// ---------------------------------------------------------------------------
// Who works here
// ---------------------------------------------------------------------------
// Staff records, the rota, attendance, leave, training and certificates, what
// gets sent to staff and what they can see of it themselves.
//
// Split out of `repository.ts` in stage 1.4, which was 5.260 lines and 9% of
// the front end. Nothing here changed in the move: `repository.ts` re-exports
// all of it, so every caller imports exactly what it imported before.
// ---------------------------------------------------------------------------

import { requireSupabase } from "@/lib/supabase";
import { fail, fetchAllPages, currentOrgId } from "./_shared";
import type { OrgRole } from "@/engine/purchasing";

// ── Membership ──────────────────────────────────────────────────────────────

export interface OrgPerson {
  userId: string;
  email: string | null;
  role: OrgRole;
  joinedAt: string;
}

export interface Invitation {
  id: string;
  email: string;
  role: OrgRole;
  invitedByEmail: string | null;
  createdAt: string;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
}

export async function fetchOrgPeople(): Promise<OrgPerson[]> {
  const { data, error } = await requireSupabase()
    .from("organization_people")
    .select("*")
    .order("role");
  if (error) fail("fetchOrgPeople", error);
  return (data ?? []).map((r: any) => ({
    userId: r.user_id, email: r.email ?? null,
    role: r.role as OrgRole, joinedAt: r.created_at,
  }));
}

export async function fetchInvitations(): Promise<Invitation[]> {
  const { data, error } = await requireSupabase()
    .from("organization_invitations")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) fail("fetchInvitations", error);
  return (data ?? []).map((r: any) => ({
    id: r.id, email: r.email, role: r.role as OrgRole,
    invitedByEmail: r.invited_by_email ?? null,
    createdAt: r.created_at, expiresAt: r.expires_at,
    acceptedAt: r.accepted_at ?? null, revokedAt: r.revoked_at ?? null,
  }));
}

/**
 * Invite somebody.
 *
 * The database refuses an admin inviting an owner, so a rejection here is the
 * policy speaking and its message is worth showing as written.
 */
export async function inviteToOrg(email: string, role: OrgRole): Promise<void> {
  const db = requireSupabase();
  const { data: auth } = await db.auth.getUser();
  const { data: orgId, error: orgError } = await db.rpc("auth_default_org_id");
  if (orgError) fail("inviteToOrg(org)", orgError);
  const { error } = await db.from("organization_invitations").insert({
    organization_id: orgId,
    email: email.trim().toLowerCase(),
    role,
    invited_by: auth.user?.id ?? null,
    invited_by_email: auth.user?.email ?? null,
  });
  if (error) fail("inviteToOrg", error);
}

export async function revokeInvitation(id: string): Promise<void> {
  const { error } = await requireSupabase()
    .from("organization_invitations")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id);
  if (error) fail("revokeInvitation", error);
}

/** Invitations addressed to the signed-in user that are still open. */
export async function fetchMyInvitations(): Promise<
  (Invitation & { organizationName: string | null })[]
> {
  const db = requireSupabase();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user?.email) return [];
  const { data, error } = await db
    .from("organization_invitations")
    .select("*, organizations(name)")
    .is("accepted_at", null)
    .is("revoked_at", null);
  if (error) fail("fetchMyInvitations", error);
  return (data ?? [])
    .filter((r: any) => r.email?.toLowerCase() === auth.user!.email!.toLowerCase())
    .map((r: any) => ({
      id: r.id, email: r.email, role: r.role as OrgRole,
      invitedByEmail: r.invited_by_email ?? null,
      createdAt: r.created_at, expiresAt: r.expires_at,
      acceptedAt: null, revokedAt: null,
      organizationName: r.organizations?.name ?? null,
    }));
}

export async function acceptInvitation(id: string): Promise<void> {
  const { error } = await requireSupabase().rpc("accept_invitation", {
    invitation_id: id,
  });
  if (error) fail("acceptInvitation", error);
}

/** Change somebody's role. Guarded by trigger — see migration 0024. */
export async function setMemberRole(userId: string, role: OrgRole): Promise<void> {
  const db = requireSupabase();
  const { data: orgId, error: orgError } = await db.rpc("auth_default_org_id");
  if (orgError) fail("setMemberRole(org)", orgError);
  const { error } = await db
    .from("organization_members")
    .update({ role })
    .eq("user_id", userId)
    .eq("organization_id", orgId);
  if (error) fail("setMemberRole", error);
}

export async function removeMember(userId: string): Promise<void> {
  const db = requireSupabase();
  const { data: orgId, error: orgError } = await db.rpc("auth_default_org_id");
  if (orgError) fail("removeMember(org)", orgError);
  const { error } = await db
    .from("organization_members")
    .delete()
    .eq("user_id", userId)
    .eq("organization_id", orgId);
  if (error) fail("removeMember", error);
}

// ── People ──────────────────────────────────────────────────────────────────

import type {
  Employee, Certification, LeaveRequest, LeaveType,
} from "@/engine/people";

export interface JobRole {
  id: string; title: string; businessUnitId: string | null;
  level: number; requiredCertifications: string[];
}

export async function fetchJobRoles(): Promise<JobRole[]> {
  const { data, error } = await requireSupabase()
    .from("job_roles").select("*").order("title");
  if (error) fail("fetchJobRoles", error);
  return (data ?? []).map((r: any) => ({
    id: r.id, title: r.title, businessUnitId: r.business_unit_id ?? null,
    level: r.level ?? 1, requiredCertifications: r.required_certifications ?? [],
  }));
}

export async function fetchEmployees(): Promise<Employee[]> {
  const rows = await fetchAllPages<any>(
    (from, to) =>
      requireSupabase().from("employees").select("*").order("last_name").range(from, to),
    "fetchEmployees",
  );
  return rows.map((r) => ({
    id: r.id,
    employeeNumber: r.employee_number,
    firstName: r.first_name,
    lastName: r.last_name,
    businessUnitId: r.business_unit_id ?? null,
    jobRoleId: r.job_role_id ?? null,
    managerId: r.manager_id ?? null,
    employmentStatus: r.employment_status,
    employmentType: r.employment_type,
    startedOn: r.started_on ?? null,
    contractedHoursPerWeek:
      r.contracted_hours_per_week === null || r.contracted_hours_per_week === undefined
        ? null
        : Number(r.contracted_hours_per_week),
  }));
}

export async function upsertEmployee(input: {
  id?: string;
  employeeNumber: string;
  firstName: string;
  lastName: string;
  workEmail: string | null;
  businessUnitId: string | null;
  jobRoleId: string | null;
  managerId: string | null;
  employmentStatus: string;
  employmentType: string;
  startedOn: string | null;
  contractedHoursPerWeek: number | null;
}): Promise<void> {
  const row = {
    employee_number: input.employeeNumber,
    first_name: input.firstName,
    last_name: input.lastName,
    work_email: input.workEmail,
    business_unit_id: input.businessUnitId,
    job_role_id: input.jobRoleId,
    manager_id: input.managerId,
    employment_status: input.employmentStatus,
    employment_type: input.employmentType,
    started_on: input.startedOn,
    contracted_hours_per_week: input.contractedHoursPerWeek,
    updated_at: new Date().toISOString(),
  };
  const db = requireSupabase();
  const { error } = input.id
    ? await db.from("employees").update(row).eq("id", input.id)
    : await db.from("employees").insert(row);
  if (error) fail("upsertEmployee", error);
}

export async function fetchCertifications(): Promise<Certification[]> {
  const { data, error } = await requireSupabase()
    .from("employee_certifications").select("*").order("expires_on");
  if (error) fail("fetchCertifications", error);
  return (data ?? []).map((r: any) => ({
    id: r.id, employeeId: r.employee_id, kind: r.kind,
    expiresOn: r.expires_on ?? null,
  }));
}

export async function addCertification(input: {
  employeeId: string; kind: string; reference: string | null;
  issuedOn: string | null; expiresOn: string | null;
}): Promise<void> {
  const { error } = await requireSupabase().from("employee_certifications").insert({
    employee_id: input.employeeId, kind: input.kind, reference: input.reference,
    issued_on: input.issuedOn, expires_on: input.expiresOn,
  });
  if (error) fail("addCertification", error);
}

export async function fetchLeaveTypes(): Promise<LeaveType[]> {
  const { data, error } = await requireSupabase()
    .from("leave_types").select("*").order("name");
  if (error) fail("fetchLeaveTypes", error);
  return (data ?? []).map((r: any) => ({
    id: r.id, code: r.code, name: r.name, paid: r.paid,
    annualEntitlementDays:
      r.annual_entitlement_days === null ? null : Number(r.annual_entitlement_days),
    maxCarryoverDays:
      r.max_carryover_days === null ? null : Number(r.max_carryover_days),
  }));
}

export async function fetchLeaveRequests(): Promise<LeaveRequest[]> {
  const { data, error } = await requireSupabase()
    .from("leave_requests").select("*").order("starts_on", { ascending: false }).limit(1000);
  if (error) fail("fetchLeaveRequests", error);
  return (data ?? []).map((r: any) => ({
    id: r.id, employeeId: r.employee_id, leaveTypeId: r.leave_type_id,
    startsOn: r.starts_on, endsOn: r.ends_on, days: Number(r.days), status: r.status,
  }));
}

/**
 * Apply for leave, optionally with a photograph of a sick note.
 *
 * The request is written first and the note attached to it, because until the
 * request exists the note has nothing to belong to. The note goes to a private
 * bucket: it is health data about a named person, and the storage policy
 * limits it to them and to whoever administers People.
 */
export async function requestLeave(input: {
  employeeId: string; leaveTypeId: string;
  startsOn: string; endsOn: string; days: number; note: string | null;
  orgId?: string;
  sickNote?: File | null;
}): Promise<void> {
  const db = requireSupabase();
  const { data: auth } = await db.auth.getUser();
  const { data, error } = await db.from("leave_requests").insert({
    employee_id: input.employeeId, leave_type_id: input.leaveTypeId,
    starts_on: input.startsOn, ends_on: input.endsOn, days: input.days,
    note: input.note, status: "REQUESTED",
    ...(input.orgId ? { org_id: input.orgId } : {}),
    requested_by: auth.user?.id ?? null,
    requested_by_email: auth.user?.email ?? null,
  }).select("id").single();
  if (error) fail("requestLeave", error);

  if (input.sickNote && input.orgId) {
    // org/employee/filename — the storage policy reads both from the path, so
    // nobody can file a note against a colleague.
    const path = `${input.orgId}/${input.employeeId}/${Date.now()}-${input.sickNote.name}`;
    const { error: upErr } = await db.storage
      .from("sick-notes").upload(path, input.sickNote, { upsert: false });
    if (upErr) fail("requestLeave (sick note)", upErr);

    const { error: attErr } = await db.from("leave_attachments").insert({
      org_id: input.orgId,
      leave_request_id: (data as any).id,
      file_path: path,
      file_name: input.sickNote.name,
      content_type: input.sickNote.type,
      uploaded_by_email: auth.user?.email ?? null,
    });
    if (attErr) fail("requestLeave (attachment)", attErr);
  }
}

/**
 * Decide a leave request.
 *
 * The database refuses a decision by the person who asked, so a rejection
 * here is the policy speaking and its message is worth showing verbatim.
 */
export async function decideLeave(
  id: string,
  status: "APPROVED" | "REJECTED",
  note: string | null,
): Promise<void> {
  const db = requireSupabase();
  const { data: auth } = await db.auth.getUser();
  const { error } = await db.from("leave_requests").update({
    status,
    decided_by: auth.user?.id ?? null,
    decided_by_email: auth.user?.email ?? null,
    decision_note: note,
    updated_at: new Date().toISOString(),
  }).eq("id", id);
  if (error) fail("decideLeave", error);
}

// ── Scheduling and attendance ───────────────────────────────────────────────

import type { Shift, AttendanceRecord } from "@/engine/scheduling";

export async function fetchShifts(fromIso: string, toIso: string): Promise<Shift[]> {
  const { data, error } = await requireSupabase()
    .from("shifts").select("*")
    .gte("starts_at", fromIso).lt("starts_at", toIso)
    .order("starts_at");
  if (error) fail("fetchShifts", error);
  return (data ?? []).map((r: any) => ({
    id: r.id, employeeId: r.employee_id ?? null,
    businessUnitId: r.business_unit_id ?? null, jobRoleId: r.job_role_id ?? null,
    startsAt: r.starts_at, endsAt: r.ends_at,
    breakMinutes: r.break_minutes ?? 0, status: r.status,
  }));
}

export async function saveShift(input: {
  id?: string;
  employeeId: string | null;
  businessUnitId: string | null;
  jobRoleId: string | null;
  startsAt: string;
  endsAt: string;
  breakMinutes: number;
  status: "DRAFT" | "PUBLISHED" | "CANCELLED";
  notes?: string | null;
}): Promise<void> {
  const db = requireSupabase();
  const { data: auth } = await db.auth.getUser();
  const row = {
    employee_id: input.employeeId, business_unit_id: input.businessUnitId,
    job_role_id: input.jobRoleId, starts_at: input.startsAt, ends_at: input.endsAt,
    break_minutes: input.breakMinutes, status: input.status,
    notes: input.notes ?? null, updated_at: new Date().toISOString(),
  };
  const { error } = input.id
    ? await db.from("shifts").update(row).eq("id", input.id)
    : await db.from("shifts").insert({
        ...row, created_by: auth.user?.id ?? null,
        created_by_email: auth.user?.email ?? null,
      });
  // The database refuses an uncertified or on-leave assignment; that message
  // is the policy speaking and is worth showing as written.
  if (error) fail("saveShift", error);
}

export async function deleteShift(id: string): Promise<void> {
  const { error } = await requireSupabase().from("shifts").delete().eq("id", id);
  if (error) fail("deleteShift", error);
}

export async function fetchAttendance(
  fromIso: string, toIso: string,
): Promise<AttendanceRecord[]> {
  const { data, error } = await requireSupabase()
    .from("attendance").select("*")
    .gte("effective_in", fromIso).lt("effective_in", toIso)
    .order("effective_in", { ascending: false });
  if (error) fail("fetchAttendance", error);
  return (data ?? []).map((r: any) => ({
    employeeId: r.employee_id, shiftId: r.shift_id ?? null,
    effectiveIn: r.effective_in, effectiveOut: r.effective_out ?? null,
    hours: r.hours === null || r.hours === undefined ? null : Number(r.hours),
    corrected: Boolean(r.corrected),
  }));
}

/** Open punches — people currently on the clock. */
export async function fetchOpenEntries(): Promise<
  { id: string; employeeId: string; clockInAt: string; shiftId: string | null }[]
> {
  const { data, error } = await requireSupabase()
    .from("time_entries").select("id, employee_id, clock_in_at, shift_id")
    .is("clock_out_at", null);
  if (error) fail("fetchOpenEntries", error);
  return (data ?? []).map((r: any) => ({
    id: r.id, employeeId: r.employee_id,
    clockInAt: r.clock_in_at, shiftId: r.shift_id ?? null,
  }));
}

/**
 * Clock in, and say where from.
 *
 * The coordinates are sent for the database to judge; nothing here decides
 * whether they are close enough. A geofence checked in the browser is a
 * geofence anybody can pass, so the check lives in a trigger and this only
 * reports the position honestly — including reporting that there wasn't one,
 * which is recorded rather than hidden.
 */
export async function clockIn(
  employeeId: string,
  shiftId: string | null,
  position?: { latitude: number; longitude: number; accuracy: number } | null,
): Promise<void> {
  const db = requireSupabase();
  const { data: auth } = await db.auth.getUser();
  const { error } = await db.from("time_entries").insert({
    employee_id: employeeId, shift_id: shiftId,
    clock_in_at: new Date().toISOString(), source: "WEB",
    latitude: position?.latitude ?? null,
    longitude: position?.longitude ?? null,
    accuracy_m: position?.accuracy ?? null,
    recorded_by: auth.user?.id ?? null,
    recorded_by_email: auth.user?.email ?? null,
  });
  if (error) fail("clockIn", error);
}

export async function clockOut(entryId: string, breakMinutes: number): Promise<void> {
  const { error } = await requireSupabase().from("time_entries")
    .update({ clock_out_at: new Date().toISOString(), break_minutes: breakMinutes })
    .eq("id", entryId);
  if (error) fail("clockOut", error);
}

// ── Onboarding and offboarding ──────────────────────────────────────────────

export interface EmployeeTask {
  id: string; employeeId: string; employeeName: string; kind: string;
  category: string; title: string; detail: string | null;
  dueOn: string | null; blocksCompletion: boolean; daysUntilDue: number | null;
}

export async function fetchTaskBoard(): Promise<EmployeeTask[]> {
  const { data, error } = await requireSupabase()
    .from("employee_task_board").select("*").order("due_on", { nullsFirst: false });
  if (error) fail("fetchTaskBoard", error);
  return (data ?? []).map((r: any) => ({
    id: r.id, employeeId: r.employee_id, employeeName: r.employee_name,
    kind: r.kind, category: r.category, title: r.title, detail: r.detail ?? null,
    dueOn: r.due_on ?? null, blocksCompletion: Boolean(r.blocks_completion),
    daysUntilDue: r.days_until_due ?? null,
  }));
}

export async function startChecklist(
  employeeId: string, kind: "ONBOARDING" | "OFFBOARDING", anchor: string | null,
): Promise<number> {
  const { data, error } = await requireSupabase().rpc("start_checklist", {
    p_employee: employeeId, p_kind: kind, p_anchor: anchor,
  });
  if (error) fail("startChecklist", error);
  return Number(data ?? 0);
}

export async function completeTask(id: string, note: string | null): Promise<void> {
  const db = requireSupabase();
  const { data: auth } = await db.auth.getUser();
  const { error } = await db.from("employee_tasks").update({
    completed_at: new Date().toISOString(),
    completed_by_email: auth.user?.email ?? null,
    note,
  }).eq("id", id);
  if (error) fail("completeTask", error);
}

// ── Human Resources: what gets sent to staff ────────────────────────────────

export type StaffDocumentKind =
  | "NEWSLETTER" | "ROTA" | "TRAINING" | "POLICY" | "PAYSLIP" | "OTHER";

export interface StaffDocument {
  id: string;
  kind: StaffDocumentKind;
  title: string;
  body: string | null;
  filePath: string | null;
  fileName: string | null;
  courseId: string | null;
  requiresAcknowledgement: boolean;
  publishedAt: string | null;
  publishedByEmail: string | null;
  /** Only populated on the HR side, where the recipient rows are visible. */
  sentTo?: number;
  readBy?: number;
}

export async function fetchStaffDocuments(): Promise<StaffDocument[]> {
  const db = requireSupabase();
  const { data, error } = await db
    .from("staff_documents")
    .select("*, staff_document_recipients(employee_id, read_at)")
    .order("published_at", { ascending: false, nullsFirst: false });
  if (error) fail("fetchStaffDocuments", error);
  return (data ?? []).map((r: any) => ({
    id: r.id, kind: r.kind, title: r.title, body: r.body ?? null,
    filePath: r.file_path ?? null, fileName: r.file_name ?? null,
    courseId: r.course_id ?? null,
    requiresAcknowledgement: Boolean(r.requires_acknowledgement),
    publishedAt: r.published_at ?? null,
    publishedByEmail: r.published_by_email ?? null,
    sentTo: (r.staff_document_recipients ?? []).length,
    readBy: (r.staff_document_recipients ?? []).filter((x: any) => x.read_at).length,
  }));
}

/**
 * Send something to a list of people.
 *
 * The file is uploaded first and the row written second, so a document row
 * never points at a file that is not there. The reverse order leaves a
 * "training material" in the list that opens to nothing.
 */
export async function sendStaffDocument(input: {
  kind: StaffDocumentKind;
  title: string;
  body: string | null;
  courseId: string | null;
  requiresAcknowledgement: boolean;
  employeeIds: string[];
  file: File | null;
}): Promise<void> {
  const db = requireSupabase();
  const { data: auth } = await db.auth.getUser();
  const orgId = await currentOrgId();

  const documentId = crypto.randomUUID();
  let filePath: string | null = null;

  if (input.file) {
    // org/document/filename — the policy reads the org from the first segment
    // and the document from the second, so the path is checkable on its own.
    filePath = `${orgId}/${documentId}/${input.file.name}`;
    const { error: upErr } = await db.storage
      .from("staff-documents")
      .upload(filePath, input.file, { upsert: false });
    if (upErr) fail("sendStaffDocument (upload)", upErr);
  }

  const { error } = await db.from("staff_documents").insert({
    id: documentId,
    kind: input.kind,
    title: input.title,
    body: input.body,
    course_id: input.courseId,
    requires_acknowledgement: input.requiresAcknowledgement,
    file_path: filePath,
    file_name: input.file?.name ?? null,
    published_at: new Date().toISOString(),
    published_by_email: auth.user?.email ?? null,
  });
  if (error) fail("sendStaffDocument", error);

  if (input.employeeIds.length > 0) {
    const { error: recErr } = await db.from("staff_document_recipients").insert(
      input.employeeIds.map((employeeId) => ({
        document_id: documentId,
        employee_id: employeeId,
      })),
    );
    if (recErr) fail("sendStaffDocument (recipients)", recErr);
  }
}

/** A time-limited link to a private file. The buckets are never public. */
export async function signedFileUrl(
  bucket: string,
  path: string,
  seconds = 300,
): Promise<string> {
  const { data, error } = await requireSupabase()
    .storage.from(bucket).createSignedUrl(path, seconds);
  if (error) fail("signedFileUrl", error);
  return data.signedUrl;
}

export interface Geofence {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radiusM: number;
  enabled: boolean;
}

export async function fetchGeofences(): Promise<Geofence[]> {
  const { data, error } = await requireSupabase()
    .from("venue_geofences").select("*").order("name");
  if (error) fail("fetchGeofences", error);
  return (data ?? []).map((r: any) => ({
    id: r.id, name: r.name,
    latitude: Number(r.latitude), longitude: Number(r.longitude),
    radiusM: Number(r.radius_m), enabled: Boolean(r.enabled),
  }));
}

export async function saveGeofence(input: {
  id?: string;
  name: string;
  latitude: number;
  longitude: number;
  radiusM: number;
  enabled: boolean;
}): Promise<void> {
  const db = requireSupabase();
  const row = {
    name: input.name, latitude: input.latitude, longitude: input.longitude,
    radius_m: input.radiusM, enabled: input.enabled,
  };
  const { error } = input.id
    ? await db.from("venue_geofences").update(row).eq("id", input.id)
    : await db.from("venue_geofences").insert(row);
  if (error) fail("saveGeofence", error);
}

// ── The staff portal ────────────────────────────────────────────────────────

export interface MyProfile {
  employeeId: string;
  orgId: string;
  venueName: string;
  employeeNumber: string;
  firstName: string;
  lastName: string;
  workEmail: string | null;
  department: string | null;
  jobTitle: string | null;
  managerName: string | null;
}

/**
 * Who the signed-in person is, as a member of staff.
 *
 * Null for somebody who runs the venue but is not on the payroll — an owner,
 * or an IT manager. That distinction is what decides which application they
 * see when they sign in.
 */
export async function fetchMyProfile(): Promise<MyProfile | null> {
  const { data, error } = await requireSupabase()
    .from("my_profile").select("*").maybeSingle();
  if (error) fail("fetchMyProfile", error);
  if (!data) return null;
  const r = data as any;
  return {
    employeeId: r.employee_id, orgId: r.org_id, venueName: r.venue_name,
    employeeNumber: r.employee_number, firstName: r.first_name,
    lastName: r.last_name, workEmail: r.work_email ?? null,
    department: r.department ?? null, jobTitle: r.job_title ?? null,
    managerName: r.manager_name ?? null,
  };
}

export interface MyDocument extends StaffDocument {
  recipientId: string;
  readAt: string | null;
  acknowledgedAt: string | null;
}

export async function fetchMyDocuments(): Promise<MyDocument[]> {
  const db = requireSupabase();
  const { data, error } = await db
    .from("staff_document_recipients")
    .select("id, read_at, acknowledged_at, staff_documents(*)")
    .order("read_at", { nullsFirst: true });
  if (error) fail("fetchMyDocuments", error);
  return (data ?? [])
    .filter((r: any) => r.staff_documents)
    .map((r: any) => {
      const d = r.staff_documents;
      return {
        id: d.id, kind: d.kind, title: d.title, body: d.body ?? null,
        filePath: d.file_path ?? null, fileName: d.file_name ?? null,
        courseId: d.course_id ?? null,
        requiresAcknowledgement: Boolean(d.requires_acknowledgement),
        publishedAt: d.published_at ?? null,
        publishedByEmail: d.published_by_email ?? null,
        recipientId: r.id,
        readAt: r.read_at ?? null,
        acknowledgedAt: r.acknowledged_at ?? null,
      };
    });
}

export async function markDocumentRead(
  recipientId: string,
  acknowledge: boolean,
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await requireSupabase()
    .from("staff_document_recipients")
    .update(acknowledge ? { read_at: now, acknowledged_at: now } : { read_at: now })
    .eq("id", recipientId);
  if (error) fail("markDocumentRead", error);
}

export interface MyExamQuestion {
  id: string;
  courseId: string;
  prompt: string;
  options: string[] | null;
  kind: string;
  points: number;
}

export async function fetchMyExam(courseId: string): Promise<MyExamQuestion[]> {
  const { data, error } = await requireSupabase()
    .from("my_exam_questions").select("*").eq("course_id", courseId);
  if (error) fail("fetchMyExam", error);
  return (data ?? []).map((r: any) => ({
    id: r.id, courseId: r.course_id, prompt: r.prompt,
    options: r.options ?? null, kind: r.kind, points: r.points ?? 1,
  }));
}

export interface ExamResult {
  score: number;
  correct: number;
  total: number;
  passed: boolean;
}

/**
 * Submit an exam.
 *
 * Marked in the database, not here. The answers live in a table the candidate
 * cannot read, which is the only way a score means anything — one computed in
 * the browser is one the candidate can edit.
 */
export async function submitExam(
  courseId: string,
  employeeId: string,
  answers: Record<string, number>,
): Promise<ExamResult> {
  const { data, error } = await requireSupabase().rpc("mark_quiz_attempt", {
    p_course: courseId,
    p_employee: employeeId,
    p_answers: answers,
    p_pass_mark: 80,
  });
  if (error) fail("submitExam", error);
  const r = data as any;
  return {
    score: Number(r.score), correct: Number(r.correct),
    total: Number(r.total), passed: Boolean(r.passed),
  };
}

export interface MyShift {
  id: string;
  startsAt: string;
  endsAt: string;
  breakMinutes: number;
  notes: string | null;
}

export async function fetchMyShifts(): Promise<MyShift[]> {
  const { data, error } = await requireSupabase()
    .from("shifts").select("id, starts_at, ends_at, break_minutes, notes")
    .gte("starts_at", new Date(Date.now() - 86400000).toISOString())
    .order("starts_at")
    .limit(60);
  if (error) fail("fetchMyShifts", error);
  return (data ?? []).map((r: any) => ({
    id: r.id, startsAt: r.starts_at, endsAt: r.ends_at,
    breakMinutes: r.break_minutes ?? 0, notes: r.notes ?? null,
  }));
}

export async function fetchMyOpenPunch(): Promise<{ id: string; clockInAt: string } | null> {
  const { data, error } = await requireSupabase()
    .from("time_entries").select("id, clock_in_at")
    .is("clock_out_at", null)
    .order("clock_in_at", { ascending: false })
    .limit(1);
  if (error) fail("fetchMyOpenPunch", error);
  const r = (data ?? [])[0] as any;
  return r ? { id: r.id, clockInAt: r.clock_in_at } : null;
}

export interface MyLeave {
  id: string;
  leaveTypeId: string;
  startsOn: string;
  endsOn: string;
  days: number;
  status: string;
  note: string | null;
  decisionNote: string | null;
  attachments: number;
}

export async function fetchMyLeave(): Promise<MyLeave[]> {
  const { data, error } = await requireSupabase()
    .from("leave_requests")
    .select("*, leave_attachments(id)")
    .order("starts_on", { ascending: false });
  if (error) fail("fetchMyLeave", error);
  return (data ?? []).map((r: any) => ({
    id: r.id, leaveTypeId: r.leave_type_id, startsOn: r.starts_on,
    endsOn: r.ends_on, days: Number(r.days), status: r.status,
    note: r.note ?? null, decisionNote: r.decision_note ?? null,
    attachments: (r.leave_attachments ?? []).length,
  }));
}

export interface MyTraining {
  assignmentId: string;
  courseId: string;
  courseTitle: string;
  description: string | null;
  dueOn: string | null;
  completedOn: string | null;
  score: number | null;
  passed: boolean | null;
  hasExam: boolean;
}

export async function fetchMyTraining(): Promise<MyTraining[]> {
  const db = requireSupabase();
  const { data, error } = await db
    .from("training_assignments")
    .select("*, training_courses(id, title, description)")
    .order("due_on", { nullsFirst: false });
  if (error) fail("fetchMyTraining", error);

  const rows = (data ?? []).filter((r: any) => r.training_courses);
  // Which of them actually have questions, so the portal offers an exam only
  // where there is one to sit.
  const { data: qs } = await db.from("my_exam_questions").select("course_id");
  const withExam = new Set((qs ?? []).map((q: any) => q.course_id));

  return rows.map((r: any) => ({
    assignmentId: r.id,
    courseId: r.course_id,
    courseTitle: r.training_courses.title,
    description: r.training_courses.description ?? null,
    dueOn: r.due_on ?? null,
    completedOn: r.completed_on ?? null,
    score: r.score === null ? null : Number(r.score),
    passed: r.passed === null ? null : Boolean(r.passed),
    hasExam: withExam.has(r.course_id),
  }));
}

// ── The HR home screen ──────────────────────────────────────────────────────

export interface CalendarEntry {
  kind: "HOLIDAY" | "BIRTHDAY" | "LEAVE";
  onDate: string;
  title: string;
  detail: string | null;
  employeeId: string | null;
}

/**
 * Holidays, birthdays and approved leave, merged by the database.
 *
 * One query rather than three because a calendar wants one list in date order,
 * and three lists merged in the browser is three chances to sort them
 * differently.
 */
export async function fetchCalendar(): Promise<CalendarEntry[]> {
  const { data, error } = await requireSupabase()
    .from("venue_calendar").select("*").order("on_date");
  if (error) fail("fetchCalendar", error);
  return (data ?? []).map((r: any) => ({
    kind: r.kind, onDate: r.on_date, title: r.title,
    detail: r.detail || null, employeeId: r.employee_id ?? null,
  }));
}

export interface PublicHoliday {
  id: string; name: string; holidayOn: string; closed: boolean; note: string | null;
}

export async function fetchPublicHolidays(): Promise<PublicHoliday[]> {
  const { data, error } = await requireSupabase()
    .from("public_holidays").select("*").order("holiday_on");
  if (error) fail("fetchPublicHolidays", error);
  return (data ?? []).map((r: any) => ({
    id: r.id, name: r.name, holidayOn: r.holiday_on,
    closed: Boolean(r.closed), note: r.note ?? null,
  }));
}

export type StaffRequestKind =
  | "SHIFT_CHANGE" | "LOAN" | "FINAL_EXIT" | "DOCUMENT_LETTER"
  | "EXPENSE_CLAIM" | "OTHER";

export interface StaffRequest {
  id: string;
  employeeId: string;
  kind: StaffRequestKind;
  subject: string;
  detail: string | null;
  fields: Record<string, unknown>;
  status: string;
  decidedByEmail: string | null;
  decisionNote: string | null;
  createdAt: string;
}

function staffRequestFromRow(r: any): StaffRequest {
  return {
    id: r.id, employeeId: r.employee_id, kind: r.kind, subject: r.subject,
    detail: r.detail ?? null,
    fields: (r.fields && typeof r.fields === "object" ? r.fields : {}) as Record<string, unknown>,
    status: r.status, decidedByEmail: r.decided_by_email ?? null,
    decisionNote: r.decision_note ?? null, createdAt: r.created_at,
  };
}

export async function fetchMyRequests(): Promise<StaffRequest[]> {
  const { data, error } = await requireSupabase()
    .from("staff_requests").select("*").order("created_at", { ascending: false });
  if (error) fail("fetchMyRequests", error);
  return (data ?? []).map(staffRequestFromRow);
}

export async function raiseStaffRequest(input: {
  employeeId: string;
  orgId: string;
  kind: StaffRequestKind;
  subject: string;
  detail: string | null;
  fields: Record<string, unknown>;
}): Promise<void> {
  const { error } = await requireSupabase().from("staff_requests").insert({
    org_id: input.orgId,
    employee_id: input.employeeId,
    kind: input.kind,
    subject: input.subject,
    detail: input.detail,
    fields: input.fields,
    status: "SUBMITTED",
  });
  if (error) fail("raiseStaffRequest", error);
}

/**
 * Decide somebody else's request.
 *
 * `decided_by_email` is deliberately not sent. The database records the caller,
 * and anything sent here would be discarded — see migration 0054, where a
 * client-supplied address let a decision be filed under the employee's own
 * name.
 */
export async function decideStaffRequest(
  id: string,
  status: "APPROVED" | "REJECTED",
  note: string | null,
): Promise<void> {
  const { error } = await requireSupabase().from("staff_requests")
    .update({ status, decision_note: note })
    .eq("id", id);
  if (error) fail("decideStaffRequest", error);
}

export type BoardPostKind = "FOR_SALE" | "WANTED" | "EVENT" | "NOTICE";

export interface BoardPost {
  id: string;
  employeeId: string;
  kind: BoardPostKind;
  title: string;
  body: string | null;
  price: number | null;
  contact: string | null;
  eventOn: string | null;
  status: string;
  approvedByEmail: string | null;
  decisionNote: string | null;
  createdAt: string;
}

function boardPostFromRow(r: any): BoardPost {
  return {
    id: r.id, employeeId: r.employee_id, kind: r.kind, title: r.title,
    body: r.body ?? null,
    price: r.price === null || r.price === undefined ? null : Number(r.price),
    contact: r.contact ?? null, eventOn: r.event_on ?? null,
    status: r.status, approvedByEmail: r.approved_by_email ?? null,
    decisionNote: r.decision_note ?? null, createdAt: r.created_at,
  };
}

export async function fetchBoardPosts(): Promise<BoardPost[]> {
  const { data, error } = await requireSupabase()
    .from("board_posts").select("*").order("created_at", { ascending: false });
  if (error) fail("fetchBoardPosts", error);
  return (data ?? []).map(boardPostFromRow);
}

/**
 * Put something on the board.
 *
 * Status is not sent: the database forces PENDING on insert whatever a client
 * asks for, because a board that published first and moderated later would put
 * a colleague's phone number in front of the venue before anybody read it.
 */
export async function createBoardPost(input: {
  employeeId: string;
  orgId: string;
  kind: BoardPostKind;
  title: string;
  body: string | null;
  price: number | null;
  contact: string | null;
  eventOn: string | null;
}): Promise<void> {
  const { error } = await requireSupabase().from("board_posts").insert({
    org_id: input.orgId,
    employee_id: input.employeeId,
    kind: input.kind,
    title: input.title,
    body: input.body,
    price: input.price,
    contact: input.contact,
    event_on: input.eventOn,
  });
  if (error) fail("createBoardPost", error);
}

export async function moderateBoardPost(
  id: string,
  status: "PUBLISHED" | "REJECTED",
  note: string | null,
): Promise<void> {
  const { error } = await requireSupabase().from("board_posts")
    .update({ status, decision_note: note })
    .eq("id", id);
  if (error) fail("moderateBoardPost", error);
}

export async function withdrawBoardPost(id: string): Promise<void> {
  const { error } = await requireSupabase().from("board_posts")
    .update({ status: "WITHDRAWN" }).eq("id", id);
  if (error) fail("withdrawBoardPost", error);
}

// ── Pay ─────────────────────────────────────────────────────────────────────
/*
 * The only data in this directory narrowed on *read* rather than on write.
 *
 * Every other table here is readable by anybody in the venue and restricted on
 * what they may change. A pay rate is the other way round, because the harm is
 * in the looking: somebody who runs the rota, approves leave and keeps
 * certificates current has no business knowing what their colleagues earn.
 * `PAY` is its own grant and nobody holds it by default, not even an
 * administrator.
 *
 * So these functions return nothing rather than failing for a caller without
 * it — the policy answers, and an empty list is the honest shape of "not for
 * you" in a list. The screen asks `useCanReadSection("PAY")` and does not draw
 * the tab at all, which is the kinder version of the same answer.
 */

export type PayBasis = "HOURLY" | "MONTHLY";

export interface PayRate {
  id: string;
  employeeId: string;
  basis: PayBasis;
  /** Decimal string. The venue's own currency; there is one per venue. */
  amount: string;
  effectiveFrom: string;
  note: string | null;
  setByEmail: string | null;
  createdAt: string;
}

function payRateFromRow(r: any): PayRate {
  return {
    id: r.id,
    employeeId: r.employee_id,
    basis: r.basis,
    amount: String(r.amount),
    effectiveFrom: r.effective_from,
    note: r.note ?? null,
    setByEmail: r.set_by_email ?? null,
    createdAt: r.created_at,
  };
}

export async function fetchPayRates(): Promise<PayRate[]> {
  const { data, error } = await requireSupabase()
    .from("pay_rates").select("*").order("effective_from", { ascending: false });
  if (error) fail("fetchPayRates", error);
  return (data ?? []).map(payRateFromRow);
}

/**
 * Set a rate from a date.
 *
 * There is no "change the rate" — a rate is a period, and the way to end one
 * is to start the next. The database refuses to edit a rate that has already
 * taken effect, which is what makes "last month stays calculated at last
 * month's rate" true by construction rather than by everybody being careful.
 *
 * Nothing here says who set it. `set_by_email` comes from the caller's JWT by
 * trigger and anything sent from the browser is discarded — migration 0054
 * exists because a decision was once filed under somebody else's name, and a
 * salary is a worse thing to misattribute than a decision.
 */
export async function setPayRate(input: {
  employeeId: string;
  basis: PayBasis;
  amount: string;
  effectiveFrom: string;
  note?: string | null;
}): Promise<PayRate> {
  const { data, error } = await requireSupabase()
    .from("pay_rates")
    .insert({
      employee_id: input.employeeId,
      basis: input.basis,
      amount: input.amount,
      effective_from: input.effectiveFrom,
      note: input.note ?? null,
    })
    .select("*")
    .single();
  if (error) fail("setPayRate", error);
  return payRateFromRow(data);
}

export interface LabourCostRow {
  employeeId: string;
  businessUnitId: string | null;
  onDate: string;
  hours: number;
  basis: PayBasis | null;
  /** Decimal string, or null where nobody has set a rate. Never zero for that. */
  rate: string | null;
  cost: string | null;
}

/**
 * What work cost, per person per day, between two dates.
 *
 * A null cost means nobody has set a rate for that person — not that they cost
 * nothing. The screen says so rather than summing the nulls into a total that
 * is too good by exactly the wages of everybody nobody got round to entering.
 */
export async function fetchLabourCost(
  fromDate: string,
  toDate: string,
): Promise<LabourCostRow[]> {
  const { data, error } = await requireSupabase()
    .from("labour_cost_daily").select("*")
    .gte("on_date", fromDate).lte("on_date", toDate)
    .order("on_date", { ascending: false });
  if (error) fail("fetchLabourCost", error);
  return (data ?? []).map((r: any) => ({
    employeeId: r.employee_id,
    businessUnitId: r.business_unit_id ?? null,
    onDate: r.on_date,
    hours: Number(r.hours ?? 0),
    basis: r.basis ?? null,
    rate: r.rate === null || r.rate === undefined ? null : String(r.rate),
    cost: r.cost === null || r.cost === undefined ? null : String(r.cost),
  }));
}
