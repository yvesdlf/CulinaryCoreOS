// ---------------------------------------------------------------------------
// Supplier price list import
// ---------------------------------------------------------------------------
// Two-step by design: choose a file, read what it would do, then decide. The
// preview is not a courtesy — it is the control that catches a misread decimal
// separator, a supplier list in the wrong units, or a file for a different
// venue. All three write plausible numbers into a thousand products and are
// invisible afterwards.
//
// Nothing is written until the confirm button, and the confirm button says how
// many products it will change.
// ---------------------------------------------------------------------------

import { useRef, useState } from "react";
import { Upload, TriangleAlert, ArrowRight } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { CurrencyDisplay } from "@/components/shared/currency-display";
import { parseCsv } from "@/lib/csv";
import { formatPercent } from "@/lib/format";
import { planPriceImport, type ImportPlan } from "@/engine/price-import";
import { useProductStore } from "@/stores/product-store";
import { updateProductAndCascade } from "@/stores/cascade-actions";

/** Enough rows to judge the file by; the count says how many more there are. */
const PREVIEW_ROWS = 25;

export function PriceImportDialog() {
  const products = useProductStore((s) => s.products);
  const fileInput = useRef<HTMLInputElement>(null);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [filename, setFilename] = useState("");
  const [applying, setApplying] = useState(false);

  async function handleFile(file: File) {
    const text = await file.text();
    setFilename(file.name);
    setPlan(planPriceImport(parseCsv(text), products));
  }

  function reset() {
    setPlan(null);
    setFilename("");
    if (fileInput.current) fileInput.current.value = "";
  }

  function apply() {
    if (!plan) return;
    setApplying(true);
    try {
      /*
       * One cascade per product. Slower than re-costing everything once at the
       * end, and chosen anyway: this is the same path a manual price edit
       * takes, so an import cannot produce figures a hand edit would not.
       */
      let dishes = 0;
      for (const change of plan.changes) {
        const affected = updateProductAndCascade(change.product.id, {
          cost: {
            ...change.product.cost,
            buyingPricePerUnit: change.newPrice,
            grossPricePerUnit: change.newPrice,
            nettPricePerUnit: change.newPrice,
          },
          // Merged, not replaced: a file carrying only kcal must not blank the
          // macros somebody entered by hand.
          ...(change.nutrition
            ? {
                nutrition: {
                  ...change.product.nutrition,
                  ...change.nutrition,
                },
              }
            : {}),
        });
        dishes += affected.recipeIds.length;
      }
      toast.success(
        `Updated ${plan.changes.length} ${plan.changes.length === 1 ? "price" : "prices"}`,
        { description: `${dishes} dish re-costings triggered.` },
      );
      reset();
    } catch (err) {
      toast.error("Import failed", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setApplying(false);
    }
  }

  return (
    <div>
      <input
        ref={fileInput}
        type="file"
        accept=".csv,text/csv"
        className="sr-only"
        aria-label="Supplier price list (CSV)"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
        }}
      />

      <Button variant="outline" onClick={() => fileInput.current?.click()}>
        <Upload className="mr-1 size-4" aria-hidden="true" />
        Import prices
      </Button>

      {plan && (
        <div className="mt-4 rounded-lg border p-4">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-medium">
                {filename} — nothing has been changed yet
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {plan.matchedOn ? (
                  <>
                    Read <strong>{plan.matchedOn.name}</strong> as the product
                    and <strong>{plan.matchedOn.price}</strong> as the price.{" "}
                  </>
                ) : null}
                {plan.changes.length} to change · {plan.unchanged} already
                current · {plan.problems.length} not applied
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={reset}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={apply}
                disabled={plan.changes.length === 0 || applying}
              >
                {/* The count is on the button on purpose: this is the last
                    moment anyone can tell 3 from 1.100. */}
                Apply {plan.changes.length}{" "}
                {plan.changes.length === 1 ? "price" : "prices"}
              </Button>
            </div>
          </div>

          {plan.problems.length > 0 && (
            <div
              role="alert"
              className="mb-3 rounded-md border border-status-warning/40 bg-status-warning-soft p-3"
            >
              <p className="flex items-center gap-2 text-sm font-medium text-status-warning">
                <TriangleAlert className="size-4" aria-hidden="true" />
                {plan.problems.length}{" "}
                {plan.problems.length === 1 ? "row" : "rows"} will not be applied
              </p>
              <ul className="mt-2 space-y-1 text-xs text-foreground/80">
                {plan.problems.slice(0, 8).map((p) => (
                  <li key={`${p.line}-${p.name}`}>
                    Line {p.line}
                    {p.name && <> · {p.name}</>} — {p.reason}
                  </li>
                ))}
              </ul>
              {plan.problems.length > 8 && (
                <p className="mt-1 text-xs text-foreground/80">
                  and {plan.problems.length - 8} more
                </p>
              )}
            </div>
          )}

          {plan.changes.length > 0 && (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead className="text-right">Current</TableHead>
                    <TableHead className="text-right">New</TableHead>
                    <TableHead className="text-right">Change</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {plan.changes.slice(0, PREVIEW_ROWS).map((c) => (
                    <TableRow key={c.product.id}>
                      <TableCell className="font-medium">
                        {c.product.name}
                      </TableCell>
                      <TableCell className="text-right">
                        <CurrencyDisplay value={c.oldPrice} decimals={2} />
                      </TableCell>
                      <TableCell className="text-right">
                        <CurrencyDisplay value={c.newPrice} decimals={2} />
                      </TableCell>
                      <TableCell
                        className={
                          // Sorted biggest-first, so a misread separator is at
                          // the top; colour is supplementary to the sign.
                          Math.abs(c.percentChange) >= 50
                            ? "text-right font-medium text-status-warning"
                            : "text-right text-muted-foreground"
                        }
                      >
                        {c.percentChange > 0 ? "+" : ""}
                        {formatPercent(c.percentChange)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {plan.changes.length > PREVIEW_ROWS && (
                <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
                  <ArrowRight className="size-3" aria-hidden="true" />
                  Showing the {PREVIEW_ROWS} largest moves of{" "}
                  {plan.changes.length}.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
