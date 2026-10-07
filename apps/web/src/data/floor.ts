// ---------------------------------------------------------------------------
// The staff portal's three doors onto the floor (0084)
// ---------------------------------------------------------------------------
// A portal user is not a member of the venue, so nothing here reads or writes
// a table. Reads come from views that already filter to the caller's share;
// writes go through definer functions that check the caller is staff of this
// venue and do one job each. The database decides every rule — including
// whether a fridge reading is a breach — and its messages are shown as they
// are written, because each one names what to do.
// ---------------------------------------------------------------------------

import { requireSupabase } from "@/lib/supabase";
import { fail } from "./_shared";

export interface FloorRequestType {
  id: string; name: string; description: string | null;
  defaultPriority: string; unitName: string | null;
}

export interface FloorRequest {
  id: string; reference: string | null; title: string; status: string;
  priority: string; createdAt: string; resolution: string | null; unitName: string | null;
}

export interface FloorField {
  label: string; type: string; unit: string | null; min: number | null; max: number | null;
}

export interface FloorForm {
  id: string; code: string; title: string; section: string;
  isCcp: boolean; fields: FloorField[];
}

export interface FloorCheck {
  id: string; formId: string; title: string; completedAt: string;
  breach: boolean; breachDetail: string | null;
}

export interface FloorRoom {
  taskId: string; kind: string; status: string; standardMinutes: number;
  roomNumber: string | null; floor: string | null; roomState: string | null;
}

export interface RoomToInspect {
  taskId: string; kind: string; finishedAt: string | null;
  roomNumber: string | null; floor: string | null; cleanedBy: string | null;
}

export async function fetchFloorRequestTypes(): Promise<FloorRequestType[]> {
  const { data, error } = await requireSupabase().from("my_request_types").select("*").order("name");
  if (error) fail("fetchFloorRequestTypes", error);
  return (data ?? []).map((r: any) => ({
    id: r.id, name: r.name, description: r.description ?? null,
    defaultPriority: r.default_priority, unitName: r.unit_name ?? null,
  }));
}

export async function fetchFloorRequests(): Promise<FloorRequest[]> {
  const { data, error } = await requireSupabase().from("my_requests").select("*")
    .order("created_at", { ascending: false }).limit(30);
  if (error) fail("fetchFloorRequests", error);
  return (data ?? []).map((r: any) => ({
    id: r.id, reference: r.reference ?? null, title: r.title, status: r.status,
    priority: r.priority, createdAt: r.created_at, resolution: r.resolution ?? null,
    unitName: r.unit_name ?? null,
  }));
}

export async function raiseFloorRequest(input: {
  typeId: string; title: string; detail: string | null; priority: string | null;
}): Promise<void> {
  const { error } = await requireSupabase().rpc("raise_my_request", {
    p_type: input.typeId, p_title: input.title,
    p_detail: input.detail, p_priority: input.priority,
  });
  if (error) fail("raiseFloorRequest", error);
}

export async function fetchFloorForms(): Promise<FloorForm[]> {
  const { data, error } = await requireSupabase().from("my_haccp_forms").select("*").order("code");
  if (error) fail("fetchFloorForms", error);
  return (data ?? []).map((r: any) => ({
    id: r.id, code: r.code, title: r.title, section: r.section, isCcp: Boolean(r.is_ccp),
    fields: (r.fields ?? []).map((f: any) => ({
      label: f.label, type: f.type, unit: f.unit ?? null,
      min: f.min ?? null, max: f.max ?? null,
    })),
  }));
}

export async function fetchFloorChecksToday(): Promise<FloorCheck[]> {
  const { data, error } = await requireSupabase().from("my_checks_today").select("*")
    .order("completed_at", { ascending: false });
  if (error) fail("fetchFloorChecksToday", error);
  return (data ?? []).map((r: any) => ({
    id: r.id, formId: r.form_id, title: r.title, completedAt: r.completed_at,
    breach: Boolean(r.breach), breachDetail: r.breach_detail ?? null,
  }));
}

/** The database decides the breach from the form's limits and says so in words. */
export async function recordFloorCheck(input: {
  formId: string; values: Record<string, string>; correctiveAction: string | null;
}): Promise<{ breach: boolean; detail: string }> {
  const { data, error } = await requireSupabase().rpc("record_my_check", {
    p_form: input.formId, p_values: input.values,
    p_corrective_action: input.correctiveAction,
  });
  if (error) fail("recordFloorCheck", error);
  return { breach: Boolean((data as any)?.breach), detail: (data as any)?.detail ?? "" };
}

export async function fetchFloorRooms(): Promise<FloorRoom[]> {
  const { data, error } = await requireSupabase().from("my_rooms").select("*").order("room_number");
  if (error) fail("fetchFloorRooms", error);
  return (data ?? []).map((r: any) => ({
    taskId: r.task_id, kind: r.kind, status: r.status,
    standardMinutes: Number(r.standard_minutes ?? 0),
    roomNumber: r.room_number ?? null, floor: r.floor ?? null, roomState: r.room_state ?? null,
  }));
}

export async function fetchRoomsToInspect(): Promise<RoomToInspect[]> {
  const { data, error } = await requireSupabase().from("rooms_to_inspect").select("*").order("room_number");
  if (error) fail("fetchRoomsToInspect", error);
  return (data ?? []).map((r: any) => ({
    taskId: r.task_id, kind: r.kind, finishedAt: r.finished_at ?? null,
    roomNumber: r.room_number ?? null, floor: r.floor ?? null, cleanedBy: r.cleaned_by ?? null,
  }));
}

export async function startFloorRoom(taskId: string): Promise<void> {
  const { error } = await requireSupabase().rpc("start_my_room", { p_task: taskId });
  if (error) fail("startFloorRoom", error);
}

/** Done is done; the room is released unless an urgent job blocks it, and then we say which. */
export async function finishFloorRoom(taskId: string): Promise<{ released: boolean; reason: string | null }> {
  const { data, error } = await requireSupabase().rpc("finish_my_room", { p_task: taskId });
  if (error) fail("finishFloorRoom", error);
  return { released: Boolean((data as any)?.room_released), reason: (data as any)?.reason ?? null };
}

export async function inspectFloorRoom(input: {
  taskId: string; passed: boolean; findings: string | null;
}): Promise<void> {
  const { error } = await requireSupabase().rpc("inspect_room", {
    p_task: input.taskId, p_passed: input.passed, p_findings: input.findings,
  });
  if (error) fail("inspectFloorRoom", error);
}
