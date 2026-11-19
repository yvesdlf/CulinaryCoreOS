// ---------------------------------------------------------------------------
// The venue list is this person's, not this venue's
// ---------------------------------------------------------------------------
// `organization_members` is readable by every member of a venue — that is
// what makes the staff directory work, and it is deliberate. The consequence
// is that any query mapping those rows to *organisations* has to filter by
// user, or it returns the same venue once per colleague.
//
// It did not, and the symptom was the venue switcher: `VenuePicker` renders
// when `organizations.length >= 2`, so it appeared for anybody in a venue
// with two or more staff and listed their one venue once per member.
//
// The assertion that matters is the first one. A test that only checked the
// result had no duplicates would pass just as happily on a query that asked
// for every colleague and de-duplicated afterwards — which would still be
// wrong, just quieter: the same venue listed once is indistinguishable from
// the same venue listed once by accident.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { loadOrganizations } from "./auth-store";

/**
 * The thinnest thing that behaves like the query builder: it records the
 * filters asked for and returns what the real policy would hand back.
 */
function fakeClient(rows: unknown[]) {
  const filters: Record<string, unknown> = {};
  const builder: any = {
    select: () => builder,
    eq: (column: string, value: unknown) => {
      filters[column] = value;
      return builder;
    },
    order: () => Promise.resolve({ data: rows, error: null }),
  };
  return {
    client: { from: () => builder } as any,
    filters,
  };
}

/** One venue, three colleagues — what the policy returns without a filter. */
const COLLEAGUES = [
  { role: "OWNER", created_at: "2026-01-01", organizations: { id: "v1", name: "Demo Kitchen", slug: "demo" } },
  { role: "CHEF",  created_at: "2026-01-02", organizations: { id: "v1", name: "Demo Kitchen", slug: "demo" } },
  { role: "CHEF",  created_at: "2026-01-03", organizations: { id: "v1", name: "Demo Kitchen", slug: "demo" } },
];

describe("loadOrganizations", () => {
  it("asks only for this person's memberships", async () => {
    const { client, filters } = fakeClient([]);
    await loadOrganizations("user-1", client);
    expect(filters).toEqual({ user_id: "user-1" });
  });

  it("does not de-duplicate, because the filter is the fix", async () => {
    /*
     * The fake ignores the filter, so this is the row set the policy would
     * hand back if the filter were ever dropped — and the function maps all
     * three.
     *
     * That is deliberate and this check pins it. Adding a de-duplication
     * here would make the switcher look right while the query still asked
     * for every colleague in the venue, and the next person to read the
     * code would find no trace of the thing that was actually wrong.
     */
    const { client } = fakeClient(COLLEAGUES);
    const orgs = await loadOrganizations("user-1", client);
    expect(orgs.map((o) => o.id)).toEqual(["v1", "v1", "v1"]);
  });

  it("drops a membership whose venue the reader cannot see", async () => {
    /*
     * The join comes back null when row-level security hides the
     * organisation row itself. Mapping it would put `undefined` into the
     * switcher and crash the header.
     */
    const { client } = fakeClient([
      { role: "CHEF", created_at: "2026-01-01", organizations: null },
      { role: "OWNER", created_at: "2026-01-02", organizations: { id: "v2", name: "Other", slug: "other" } },
    ]);
    const orgs = await loadOrganizations("user-1", client);
    expect(orgs).toEqual([{ id: "v2", name: "Other", slug: "other", role: "OWNER" }]);
  });

  it("returns nothing when there is no database to ask", async () => {
    expect(await loadOrganizations("user-1", null as any)).toEqual([]);
  });
});
