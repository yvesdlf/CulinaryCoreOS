// ---------------------------------------------------------------------------
// The handful of things every query in this directory needs
// ---------------------------------------------------------------------------
// Pulled out of `repository.ts` when it was split by area, because these are
// the only parts of it that were not about one area. Everything else moved to
// the module for the screens that use it.
// ---------------------------------------------------------------------------

import { requireSupabase } from "@/lib/supabase";

/** Surface Postgres errors with the operation that caused them. */
export function fail(op: string, error: { message: string } | null): never {
  throw new Error(`${op} failed: ${error?.message ?? "unknown error"}`);
}

/**
 * Raised when a row changed underneath the editor.
 *
 * Distinguishable from a generic failure so the UI can offer to reload rather
 * than just reporting an error.
 */
export class ConflictError extends Error {
  constructor(entity: string) {
    super(
      `This ${entity} was changed by someone else since you opened it. ` +
        `Reload to get the latest version before saving again.`,
    );
    this.name = "ConflictError";
  }
}

/**
 * PostgREST caps a response at 1.000 rows by default and returns that silently
 * — no error, no flag. The Manuza catalogue has 1.106 ingredients, so a plain
 * select dropped 106 of them: recipe lines referencing those products rendered
 * as "Unknown Product" and costed nothing.
 *
 * Every list read therefore pages until a short page proves the end.
 */
const PAGE = 1000;

export async function fetchAllPages<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  op: string,
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) fail(op, error);
    const page = data ?? [];
    all.push(...page);
    if (page.length < PAGE) return all;
  }
}

/**
 * The organisation rows are written to — the same one the triggers use.
 *
 * Here rather than in one area's module because two of them need it, which is
 * the whole bar for being in this file. It asks the database rather than
 * reading a value the client is holding, so the answer is the same one
 * `set_org_id` will use a moment later.
 */
export async function currentOrgId(): Promise<string> {
  const db = requireSupabase();
  const { data, error } = await db.rpc("auth_default_org_id");
  if (error) fail("currentOrgId", error);
  if (!data) throw new Error("No organization for the current user.");
  return data as string;
}
