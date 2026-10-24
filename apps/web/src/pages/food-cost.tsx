// ---------------------------------------------------------------------------
// Food cost — what the recipes say against what the shelves say
// ---------------------------------------------------------------------------
// The number the whole chain was built to produce. 0092 posts what the
// recipes say a period of sales should have consumed; 0091 posts what the
// counts found instead. The gap between them is shrinkage: waste nobody
// wrote down, over-portioning, breakage, theft, or a recipe that no longer
// describes what the kitchen actually does.
//
// The hard part of this screen is not the arithmetic, it is refusing to
// overstate what the arithmetic means.
//
//   A product nobody has counted has no actual side. Its variance is not
//   zero, it is unknown — and zero is also what a perfect count looks like.
//   Those rows are separated out rather than sorted into the middle of the
//   list where they read as the best performers.
//
//   One count is not a trend. A variance standing on a single count is one
//   count's worth of evidence, and the row says so.
//
//   An unmapped till code understates the theoretical side, because a sales
//   line with no recipe posts no consumption. Food cost then looks better
//   than it is, which is the direction nobody questions. That caveat is
//   shown across the whole page, not per row, because there is no way to
//   know which products it touched.
//
// All three come from the view (0097) rather than being remembered here, so
// an export or a second screen cannot lose them.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Scale, TriangleAlert, HelpCircle, Link2Off } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { CurrencyDisplay } from "@/components/shared/currency-display";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { fetchFoodCostVariance, type FoodCostRow } from "@/data/food-cost";

function said(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  return text.replace(/^\w+(\([^)]*\))? failed: /, "");
}

function qty(n: number | null): string {
  if (n === null) return "—";
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export function FoodCostPage() {
  const [rows, setRows] = useState<FoodCostRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setRows(await fetchFoodCostVariance());
    } catch (err) {
      toast.error("Could not load food cost", { description: said(err) });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const measured = useMemo(
    () => rows.filter((r) => !r.neverCounted),
    [rows],
  );
  const unknown = useMemo(
    () => rows.filter((r) => r.neverCounted && r.theoreticalUsed !== 0),
    [rows],
  );

  const totals = useMemo(() => {
    const theoretical = measured.reduce((s, r) => s + r.theoreticalValue, 0);
    const adjustment = measured.reduce((s, r) => s + r.adjustmentValue, 0);
    const unknownTheoretical = unknown.reduce((s, r) => s + r.theoreticalValue, 0);
    return { theoretical, adjustment, unknownTheoretical };
  }, [measured, unknown]);

  const caveated = rows.some((r) => r.salesPartlyUnmapped);

  const ranked = useMemo(
    () => [...measured].sort((a, b) => Math.abs(b.adjustmentValue) - Math.abs(a.adjustmentValue)),
    [measured],
  );

  return (
    <div>
      <PageHeader
        title="Food cost"
        description="What the recipes say went out, against what the counts found. The gap is what left the building without being sold."
      />

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <EmptyState icon={Scale} title="Nothing to compare yet">
          This needs both sides: a sales import posted to stock, and at least
          one stocktake. Neither has happened yet.
        </EmptyState>
      ) : (
        <div className="space-y-6">
          {caveated && (
            <div
              role="status"
              className="flex items-start gap-3 rounded-lg border border-status-warning bg-status-warning-soft p-4"
            >
              <Link2Off className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <div className="space-y-1 text-sm">
                <p className="font-medium">
                  Some sales are on till codes nothing maps to.
                </p>
                <p>
                  Those lines post no consumption, so the theoretical column
                  below is understated and food cost looks better than it is.
                  There is no way to know by how much.
                </p>
                <Button variant="outline" size="sm" render={<Link to="/menus" />}>
                  Map the codes
                </Button>
              </div>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Recipes say
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold">
                  <CurrencyDisplay value={totals.theoretical} />
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  went out, across {measured.length} counted products
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Counts corrected
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p
                  className={`text-2xl font-semibold ${
                    totals.adjustment < 0 ? "text-status-danger" : ""
                  }`}
                >
                  <CurrencyDisplay value={totals.adjustment} />
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {totals.adjustment < 0
                    ? "less on the shelf than the books said"
                    : "more on the shelf than the books said"}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Not yet countable
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold">{unknown.length}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  products used but never counted, worth{" "}
                  <CurrencyDisplay value={totals.unknownTheoretical} /> of usage
                </p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Where the difference is</CardTitle>
              <p className="text-sm text-muted-foreground">
                Ranked by what the difference is worth. Four hundred missing
                cocktail sticks and four hundred grams of missing saffron sort
                the same by quantity and not at all by money.
              </p>
            </CardHeader>
            <CardContent>
              {ranked.length === 0 ? (
                <EmptyState icon={HelpCircle} title="Nothing has been counted yet">
                  Every product below has been used but never counted, so there
                  is no actual side to compare against. Run a stocktake.
                </EmptyState>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead className="text-right">Recipes say</TableHead>
                      <TableHead className="text-right">Counts corrected</TableHead>
                      <TableHead className="text-right">Worth</TableHead>
                      <TableHead>Evidence</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ranked.map((r) => (
                      <TableRow key={r.productId}>
                        <TableCell className="font-medium">
                          {r.productName}
                          {r.category && (
                            <span className="ml-2 text-sm text-muted-foreground">
                              {r.category}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {qty(r.theoreticalUsed)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {qty(r.countAdjustment)}
                        </TableCell>
                        <TableCell
                          className={`text-right ${
                            r.adjustmentValue < 0 ? "text-status-danger" : ""
                          }`}
                        >
                          <CurrencyDisplay value={r.adjustmentValue} />
                        </TableCell>
                        <TableCell>
                          {/* One count is one count's worth of evidence, and
                              a reader deciding whether to act on a figure
                              needs to know which it is. */}
                          <Badge
                            variant={r.countsBehindIt === 1 ? "outline" : "secondary"}
                          >
                            {r.countsBehindIt === 1
                              ? "1 count"
                              : `${r.countsBehindIt} counts`}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {unknown.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <HelpCircle className="size-4" aria-hidden="true" />
                  Used, never counted
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  These are not doing badly — they are not measured at all.
                  Separated out because an unknown variance and a perfect one
                  both read as zero, and mean opposite things.
                </p>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead className="text-right">Recipes say</TableHead>
                      <TableHead className="text-right">Worth</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[...unknown]
                      .sort((a, b) => b.theoreticalValue - a.theoreticalValue)
                      .map((r) => (
                        <TableRow key={r.productId}>
                          <TableCell className="font-medium">{r.productName}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {qty(r.theoreticalUsed)}
                          </TableCell>
                          <TableCell className="text-right">
                            <CurrencyDisplay value={r.theoreticalValue} />
                          </TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
                <p className="mt-4 flex items-start gap-2 text-sm text-muted-foreground">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <span>
                    A stocktake covering these would turn the largest unmeasured
                    usage on this list into a number you can act on.
                  </span>
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
