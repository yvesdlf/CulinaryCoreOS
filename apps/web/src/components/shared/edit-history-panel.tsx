// ---------------------------------------------------------------------------
// What changed, who changed it, and when
// ---------------------------------------------------------------------------
// The screen for 0126. One record's edit history, newest first.
//
// Four things it is careful about, and three of them are about not lying:
//
//   A withheld value is not an empty one. For a bank account or a national ID
//   the ledger records that the field changed and deliberately does not copy
//   the values. Rendering that as "— → —" would tell somebody the account
//   number had been cleared when it had been changed, which is the opposite
//   of what happened.
//
//   A cleared value is not an unknown one. A price that was 12.500 and is now
//   blank is an edit worth seeing — it costs every recipe using it nothing —
//   so it is spelled out rather than left as a gap in a table.
//
//   An edit with no name on it says so. Rows written by a seed or a migration
//   have no session and therefore no address. "The system" is a worse answer
//   than "no sign-in recorded", because the first invents an actor.
//
//   The panel is not rendered at all without write access to the section.
//   The policy on `field_changes` already returns nothing, and an empty panel
//   is indistinguishable from a feature that is broken. Somebody with read
//   access gets no history tab rather than an empty one.
// ---------------------------------------------------------------------------

import { useEffect, useState } from "react";
import { History, Loader2, Pencil, PlusCircle, ShieldOff, Trash2 } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  fetchEditHistory, type EditHistoryEntry,
} from "@/data/edit-history";

/*
 * Where the mechanical name reads badly. Everything else is de-underscored
 * and sentence-cased below, which gets "Payment terms days" from
 * `payment_terms_days` — clear enough not to be worth a line here.
 *
 * `buying_price_per_pack` is worth a line: it is the number a person types
 * and every other price in the system is derived from it, so the label says
 * which price it is rather than leaving somebody to guess between four.
 */
const LABELS: Record<string, string> = {
  "products.buying_price_per_pack": "Buying price (per pack, as entered)",
  "products.ref_percent": "Ref %",
  "products.yield_percent": "Yield %",
  "products.par_level": "Par level",
  "products.supplier_id": "Supplier",
  "products.supplier": "Supplier (as typed)",
  "products.stock_unit": "Unit stock is counted in",
  "menu_items.recipe_id": "Dish",
  "products.allergens": "Allergens",
  "recipes.menu_price": "Menu price",
  "recipes.tax_percent": "Tax %",
  "recipes.waste_percent": "Waste %",
  "recipes.inflation_percent": "Inflation %",
  "recipes.yield_qty": "Yield",
  "sub_recipes.batch_yield_qty": "Batch yield",
  "sub_recipes.security_margin_percent": "Security margin %",
  "menu_items.selling_price": "Selling price",
  "menu_items.tax_rate_id": "Tax rate",
  "menu_items.is_available": "On the menu",
  "employees.job_role_id": "Job role",
  "employees.department_id": "Department",
  "employees.business_unit_id": "Business unit",
  "employees.manager_id": "Manager",
  "employees.contracted_hours_per_week": "Contracted hours per week",
  "organizations.standard_vat_percent": "Standard VAT %",
  "organizations.reduced_vat_percent": "Reduced VAT %",
  "organizations.service_charge_percent": "Service charge %",
  "organizations.prices_include_tax": "Prices include tax",
  "organizations.allergen_profile_code": "Allergen profile",
  "organizations.food_regime": "Food information regime",
  "member_access.section_code": "Section",
  "member_access.level": "Access level",
  "approval_policies.min_amount": "Approval threshold",
  "approval_policies.required_role": "Role required to approve",
};

export function fieldLabel(table: string, field: string): string {
  const named = LABELS[`${table}.${field}`];
  if (named) return named;
  const words = field.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/*
 * The ledger stores every value as text, because one column has to hold a
 * price, a date, a boolean and a uuid. Numbers therefore arrive as Postgres
 * printed them — `10000.00000` — and a trailing run of zeros on every price
 * in the list makes the one that matters harder to read.
 *
 * A uuid is left exactly as it is. Resolving it to a name would mean a lookup
 * per row against a table the reader may not be allowed to read, and a
 * half-resolved column that sometimes shows a name and sometimes an id is
 * worse than one that always shows the id.
 */
function showValue(raw: string | null): { text: string; muted: boolean } {
  if (raw === null) return { text: "cleared", muted: true };
  if (raw === "") return { text: "blank", muted: true };
  if (raw === "true") return { text: "Yes", muted: false };
  if (raw === "false") return { text: "No", muted: false };
  if (/^-?\d+\.\d+$/.test(raw)) {
    const trimmed = raw.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
    return { text: trimmed, muted: false };
  }
  return { text: raw, muted: false };
}

export function Value({ raw }: { raw: string | null }) {
  const { text, muted } = showValue(raw);
  return (
    <span className={muted ? "text-muted-foreground italic" : "tabular-nums"}>
      {text}
    </span>
  );
}

export function EditHistoryPanel({
  table,
  recordId,
  what = "this record",
}: {
  /** As `audited_tables` names it — `products`, `recipes`, `employees`. */
  table: string;
  recordId: string;
  /** How the empty state refers to the thing, e.g. "this product". */
  what?: string;
}) {
  const [rows, setRows] = useState<EditHistoryEntry[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setRows(null);
    setProblem(null);
    (async () => {
      try {
        const found = await fetchEditHistory(table, recordId);
        if (live) setRows(found);
      } catch (err) {
        /*
         * Said rather than swallowed. An empty list and a failed read look the
         * same on screen, and one of them means the history is unreliable.
         */
        if (live) {
          setRows([]);
          setProblem(err instanceof Error ? err.message : String(err));
        }
      }
    })();
    return () => {
      live = false;
    };
  }, [table, recordId]);

  if (rows === null) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        Reading the history…
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
      <EmptyState icon={History} title="No edits recorded">
        Nothing has been changed on {what} since the history began. Entries
        appear here on their own — every edit records itself, and none of them
        can be removed afterwards.
      </EmptyState>
    );
  }

  return (
    <div className="space-y-3">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>When</TableHead>
            <TableHead>What</TableHead>
            <TableHead>From</TableHead>
            <TableHead>To</TableHead>
            <TableHead>Who</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                {new Date(r.changedAt).toLocaleString()}
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
                    {fieldLabel(table, r.fieldName ?? "")}
                  </span>
                )}
              </TableCell>
              {r.action !== "UPDATE" ? (
                <TableCell colSpan={2} className="text-sm text-muted-foreground">
                  —
                </TableCell>
              ) : r.valuesWithheld ? (
                /*
                 * The whole row, not a value in each column. Two dashes side
                 * by side read as "was nothing, became nothing"; this reads as
                 * the deliberate refusal it is.
                 */
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
          ))}
        </TableBody>
      </Table>
      <p className="text-xs text-muted-foreground">
        Append-only. An entry cannot be changed or removed, including by an
        owner — a correction is a new edit, which records itself.
      </p>
    </div>
  );
}
