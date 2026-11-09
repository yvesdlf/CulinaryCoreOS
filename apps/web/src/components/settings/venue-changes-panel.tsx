// ---------------------------------------------------------------------------
// What has changed in this venue
// ---------------------------------------------------------------------------
// The per-record history (0126, `edit-history-panel.tsx`) answers "who changed
// this price". This answers the question people actually arrive with, which is
// the other way round: something is wrong this week, what moved?
//
// It is honest about two things it would be easy to overstate.
//
//   It is not every edit in the venue. `field_changes` admits one section at a
//   time — WRITE on the section that guards writing the audited table — so an
//   owner sees all of it and somebody holding only Administration sees access
//   grants and venue parameters. The list says so rather than looking
//   complete, because a trail that looks complete and is not is worse than no
//   trail: it is used to rule things out.
//
//   It is not every field. The registry records what a person enters, not what
//   the engine derives from it — a price edit is one line, not the six
//   rewrites the cascade performs behind it. The footnote says that too, since
//   somebody looking for a cost change will otherwise conclude nothing
//   happened.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { History, Loader2, Pencil, PlusCircle, ShieldOff, Trash2 } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { fieldLabel, Value } from "@/components/shared/edit-history-panel";
import {
  fetchVenueEditHistory, type VenueEditHistoryEntry,
} from "@/data/edit-history";

/** What the record is, in the venue's words rather than the schema's. */
const WHAT: Record<string, string> = {
  products: "Product",
  recipes: "Recipe",
  sub_recipes: "Preparation",
  menus: "Menu",
  menu_items: "Menu line",
  suppliers: "Supplier",
  employees: "Person",
  employee_private: "Personal details",
  organizations: "Venue parameters",
  member_access: "Access grant",
  approval_policies: "Approval threshold",
};

/*
 * Only where a detail route exists and takes the record's own id. Everything
 * else is left as plain text: a link that lands on a list and leaves somebody
 * to find the row themselves is worse than no link, because they will believe
 * they have been taken to it.
 */
const ROUTE: Record<string, (id: string) => string> = {
  products: (id) => `/products/${id}`,
  recipes: (id) => `/recipes/${id}`,
  sub_recipes: (id) => `/sub-recipes/${id}`,
};

export function VenueChangesPanel() {
  const [rows, setRows] = useState<VenueEditHistoryEntry[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [only, setOnly] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const found = await fetchVenueEditHistory({ limit: 200 });
        if (live) setRows(found);
      } catch (err) {
        if (live) {
          setRows([]);
          setProblem(err instanceof Error ? err.message : String(err));
        }
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  /*
   * The filter offers the tables that are actually in the list, not the whole
   * registry. A chip for a table the reader cannot see would filter to
   * nothing and read as an empty history rather than as a permission.
   */
  const tables = useMemo(() => {
    const seen = new Set((rows ?? []).map((r) => r.tableName));
    return [...seen].sort((a, b) => (WHAT[a] ?? a).localeCompare(WHAT[b] ?? b));
  }, [rows]);

  const shown = useMemo(
    () => (only ? (rows ?? []).filter((r) => r.tableName === only) : rows ?? []),
    [rows, only],
  );

  if (rows === null) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        Reading the venue's history…
      </div>
    );
  }

  if (problem) {
    return (
      <div role="alert" className="rounded-lg border border-border bg-muted/30 p-4">
        <h3 className="text-sm font-medium">The history could not be read</h3>
        <p className="mt-1 text-sm text-muted-foreground">{problem}</p>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <EmptyState icon={History} title="No edits recorded yet">
        Every change to a price, a yield, an approval threshold or somebody's
        access records itself here. Nothing you can see has been changed yet —
        the list only covers the sections you can write.
      </EmptyState>
    );
  }

  return (
    <div className="space-y-3">
      {tables.length > 1 && (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant={only === null ? "secondary" : "ghost"}
            onClick={() => setOnly(null)}
          >
            Everything
          </Button>
          {tables.map((t) => (
            <Button
              key={t}
              size="sm"
              variant={only === t ? "secondary" : "ghost"}
              onClick={() => setOnly(t)}
            >
              {WHAT[t] ?? t}
            </Button>
          ))}
        </div>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>When</TableHead>
            <TableHead>Record</TableHead>
            <TableHead>What</TableHead>
            <TableHead>From</TableHead>
            <TableHead>To</TableHead>
            <TableHead>Who</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {shown.map((r) => {
            const route = r.tableName in ROUTE ? ROUTE[r.tableName] : null;
            return (
              <TableRow key={r.id}>
                <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                  {new Date(r.changedAt).toLocaleString()}
                </TableCell>
                <TableCell className="text-sm">
                  {/* Not for a deleted row: the route would land on a
                      redirect, and offering a link to something that is gone
                      is a worse answer than the plain name. */}
                  {route && r.action !== "DELETE" ? (
                    <Link to={route(r.recordId)} className="underline-offset-2 hover:underline">
                      {WHAT[r.tableName] ?? r.tableName}
                    </Link>
                  ) : (
                    (WHAT[r.tableName] ?? r.tableName)
                  )}
                </TableCell>
                <TableCell className="text-sm">
                  {r.action === "INSERT" && (
                    <span className="inline-flex items-center gap-1.5">
                      <PlusCircle className="size-3.5 text-muted-foreground" aria-hidden="true" />
                      Created
                    </span>
                  )}
                  {r.action === "DELETE" && (
                    <span className="inline-flex items-center gap-1.5">
                      <Trash2 className="size-3.5 text-muted-foreground" aria-hidden="true" />
                      Deleted
                    </span>
                  )}
                  {r.action === "UPDATE" && (
                    <span className="inline-flex items-center gap-1.5">
                      <Pencil className="size-3.5 text-muted-foreground" aria-hidden="true" />
                      {fieldLabel(r.tableName, r.fieldName ?? "")}
                    </span>
                  )}
                </TableCell>
                {r.action !== "UPDATE" ? (
                  <TableCell colSpan={2} className="text-sm text-muted-foreground">
                    —
                  </TableCell>
                ) : r.valuesWithheld ? (
                  <TableCell colSpan={2} className="text-sm">
                    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                      <ShieldOff className="size-3.5" aria-hidden="true" />
                      Changed. The values are not recorded here.
                    </span>
                  </TableCell>
                ) : (
                  <>
                    <TableCell className="text-sm"><Value raw={r.oldValue} /></TableCell>
                    <TableCell className="text-sm"><Value raw={r.newValue} /></TableCell>
                  </>
                )}
                <TableCell className="text-sm">
                  {r.changedByEmail ?? (
                    <Badge variant="outline" className="font-normal">
                      no sign-in recorded
                    </Badge>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      <p className="text-xs text-muted-foreground">
        The 200 most recent edits you are entitled to see — one line per field,
        and only the fields a person enters, not the figures the costing engine
        derives from them. Append-only: nothing here can be changed or removed.
      </p>
    </div>
  );
}
