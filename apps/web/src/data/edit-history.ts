// ---------------------------------------------------------------------------
// Who typed this number, and when
// ---------------------------------------------------------------------------
// Reads `field_changes` (0126). Nothing here decides who may see what: the
// table's policy does, under WRITE on the section that guards writes to the
// audited table, so a reader without it gets an empty list rather than a
// refusal. That is the right shape for a panel — "no history" and "not your
// business" look the same to somebody who has no business seeing it, and the
// panel is not rendered for them at all.
//
// `values_withheld` is the one field a caller must not ignore. For a bank
// account or a national ID the ledger records that the field changed and
// deliberately does not copy the values, so a null `oldValue` means two
// different things depending on it. Rendering both the same way would tell
// somebody a bank account had been cleared when it had been changed.
// ---------------------------------------------------------------------------

import { requireSupabase } from "@/lib/supabase";
import { fail } from "./_shared";

export type EditAction = "INSERT" | "UPDATE" | "DELETE";

export interface EditHistoryEntry {
  id: string;
  action: EditAction;
  /** null for a creation or a deletion: those are facts about the row, not a field. */
  fieldName: string | null;
  oldValue: string | null;
  newValue: string | null;
  /** The values are not recorded on purpose. A null above is "withheld", not "empty". */
  valuesWithheld: boolean;
  /** Null where the edit was made with no session — a seed, or a migration. */
  changedByEmail: string | null;
  changedAt: string;
}

/**
 * One record's history, newest first.
 *
 * `table` is the table the record lives in, as `audited_tables` names it. A
 * table that is not audited simply has no rows, which is why this takes the
 * name rather than an enum: the registry is data, and a caller that hardcoded
 * the list would be a second copy of it.
 */
export async function fetchEditHistory(
  table: string,
  recordId: string,
  limit = 100,
): Promise<EditHistoryEntry[]> {
  const { data, error } = await requireSupabase()
    .from("field_changes")
    .select(
      "id, action, field_name, old_value, new_value, values_withheld," +
        " changed_by_email, changed_at",
    )
    .eq("table_name", table)
    .eq("record_id", recordId)
    .order("changed_at", { ascending: false })
    .limit(limit);
  if (error) fail("fetchEditHistory", error);
  return (data ?? []).map((r: any) => ({
    id: r.id,
    action: r.action,
    fieldName: r.field_name ?? null,
    oldValue: r.old_value ?? null,
    newValue: r.new_value ?? null,
    valuesWithheld: r.values_withheld === true,
    changedByEmail: r.changed_by_email ?? null,
    changedAt: r.changed_at,
  }));
}

/** Which tables keep a history at all, so a screen can decide to offer the tab. */
export async function fetchAuditedTables(): Promise<string[]> {
  const { data, error } = await requireSupabase()
    .from("audited_tables")
    .select("table_name");
  if (error) fail("fetchAuditedTables", error);
  return (data ?? []).map((r: any) => r.table_name);
}

export interface VenueEditHistoryEntry extends EditHistoryEntry {
  tableName: string;
  recordId: string;
}

/**
 * The venue's recent edits, newest first, across every audited table.
 *
 * Deliberately not "every edit in the venue". The policy on `field_changes`
 * admits one section at a time — WRITE on the section that guards writes to
 * the audited table — so this returns what the reader is entitled to and the
 * screen says so. An owner sees all of it; somebody holding only
 * Administration sees access grants and venue parameters and nothing else.
 *
 * `table` narrows it, for the one question people actually arrive with:
 * what happened to the catalogue this week.
 */
export async function fetchVenueEditHistory(opts?: {
  table?: string;
  limit?: number;
}): Promise<VenueEditHistoryEntry[]> {
  let q = requireSupabase()
    .from("field_changes")
    .select(
      "id, table_name, record_id, action, field_name, old_value, new_value," +
        " values_withheld, changed_by_email, changed_at",
    )
    .order("changed_at", { ascending: false })
    .limit(opts?.limit ?? 200);
  if (opts?.table) q = q.eq("table_name", opts.table);
  const { data, error } = await q;
  if (error) fail("fetchVenueEditHistory", error);
  return (data ?? []).map((r: any) => ({
    id: r.id,
    tableName: r.table_name,
    recordId: r.record_id,
    action: r.action,
    fieldName: r.field_name ?? null,
    oldValue: r.old_value ?? null,
    newValue: r.new_value ?? null,
    valuesWithheld: r.values_withheld === true,
    changedByEmail: r.changed_by_email ?? null,
    changedAt: r.changed_at,
  }));
}
