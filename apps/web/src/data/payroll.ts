// ---------------------------------------------------------------------------
// Payroll runs, and the file that leaves the building
// ---------------------------------------------------------------------------
// Building and exporting are database functions and stay there. The rule that
// matters — an exported period cannot be exported again — has to hold against
// anything that can call the API, not against a disabled button (AGENTS.md
// §1), and paying a fortnight twice is the failure that is hardest to undo.
// ---------------------------------------------------------------------------

import { requireSupabase } from "@/lib/supabase";
import { currentOrgId, fail } from "./_shared";

export interface PayrollRun {
  id: string;
  periodFrom: string;
  periodTo: string;
  status: "DRAFT" | "EXPORTED" | "SUPERSEDED";
  builtAt: string;
  builtByEmail: string | null;
  exportedAt: string | null;
  exportedByEmail: string | null;
  supersedesId: string | null;
  reason: string | null;
}

/**
 * Which departments the reader can see wages for.
 *
 * Read rather than inferred from the section store: the store holds what the
 * UI was told, and this is the question the database actually answers when
 * it filters the rows. A screen that says "you are seeing the kitchen" on
 * one authority and shows rows filtered by another will eventually say both
 * and mean neither.
 */
export interface PayScope {
  seesWholeVenue: boolean;
  unitsVisible: string[];
}

export async function fetchPayScope(): Promise<PayScope> {
  const { data, error } = await requireSupabase()
    .from("my_pay_scope")
    .select("sees_whole_venue, units_visible")
    .maybeSingle();
  if (error) fail("fetchPayScope", error);
  return {
    seesWholeVenue: Boolean((data as any)?.sees_whole_venue),
    unitsVisible: ((data as any)?.units_visible ?? []) as string[],
  };
}

export interface PayrollLine {
  employeeNumber: string | null;
  employeeName: string | null;
  businessUnitCode: string | null;
  basis: string | null;
  daysWorked: number;
  hours: number | null;
  rate: number | null;
  gross: number | null;
  openPunches: number;
  correctionsApplied: number;
}

export async function fetchPayrollRuns(): Promise<PayrollRun[]> {
  const { data, error } = await requireSupabase()
    .from("payroll_runs")
    .select("*")
    .order("period_from", { ascending: false })
    .limit(60);
  if (error) fail("fetchPayrollRuns", error);
  return (data ?? []).map((r: any) => ({
    id: r.id,
    periodFrom: r.period_from,
    periodTo: r.period_to,
    status: r.status,
    builtAt: r.built_at,
    builtByEmail: r.built_by_email ?? null,
    exportedAt: r.exported_at ?? null,
    exportedByEmail: r.exported_by_email ?? null,
    supersedesId: r.supersedes_id ?? null,
    reason: r.reason ?? null,
  }));
}

export async function fetchPayrollLines(runId: string): Promise<PayrollLine[]> {
  const { data, error } = await requireSupabase()
    .from("payroll_export_lines")
    .select("*")
    .eq("run_id", runId)
    .order("employee_name");
  if (error) fail("fetchPayrollLines", error);
  return (data ?? []).map((r: any) => ({
    employeeNumber: r.employee_number ?? null,
    employeeName: r.employee_name ?? null,
    businessUnitCode: r.business_unit_code ?? null,
    basis: r.basis ?? null,
    daysWorked: Number(r.days_worked ?? 0),
    hours: r.hours === null ? null : Number(r.hours),
    rate: r.rate === null ? null : Number(r.rate),
    gross: r.gross === null ? null : Number(r.gross),
    openPunches: Number(r.open_punches ?? 0),
    correctionsApplied: Number(r.corrections_applied ?? 0),
  }));
}

export async function buildPayrollRun(
  from: string, to: string, supersedes?: string | null, reason?: string | null,
): Promise<string> {
  const org = await currentOrgId();
  const { data, error } = await requireSupabase().rpc("build_payroll_run", {
    p_org: org, p_from: from, p_to: to,
    p_supersedes: supersedes ?? null, p_reason: reason ?? null,
  });
  if (error) fail("buildPayrollRun", error);
  return data as string;
}

/** Returns how many lines were sent. */
export async function exportPayrollRun(runId: string): Promise<number> {
  const { data, error } = await requireSupabase()
    .rpc("export_payroll_run", { p_run: runId });
  if (error) fail("exportPayrollRun", error);
  return Number(data ?? 0);
}
