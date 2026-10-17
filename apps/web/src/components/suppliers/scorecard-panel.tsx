// ---------------------------------------------------------------------------
// How each supplier has actually behaved
// ---------------------------------------------------------------------------
// There is no overall score on this screen and that is the design, not an
// omission. The weights behind a blended number are arbitrary, nobody
// remembers them a month later, and a supplier who is late but cheap comes
// out level with one who is punctual and dear — so the figure settles the
// argument by hiding it. What a buyer says on the phone is "you were late
// four times out of eleven", and that needs the four and the eleven.
//
// Three things this screen refuses to do:
//
//   Rank. The list sorts by how many concerns were raised, which orders it
//   without claiming lateness and rejections are commensurable.
//
//   Fill in a blank. A supplier nobody has ordered from shows "not ordered
//   from yet", not a row of zeroes — otherwise the bottom of the table is
//   whoever has been tried least, and a buyer acting on it moves business to
//   the supplier they know nothing about.
//
//   Hide a figure it thinks is unreliable. Thin evidence is labelled beside
//   the number rather than used to suppress it: "83% late, from 6 deliveries"
//   is a sentence somebody can weigh, and a hidden row is one they cannot.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useState } from "react";
import { ClipboardCheck, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { EmptyState } from "@/components/shared/empty-state";
import { StatusChip } from "@/components/shared/status-chip";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { fetchSupplierScorecard, type SupplierScore } from "@/data/scorecard";

function said(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  return text.replace(/^\w+(\([^)]*\))? failed: /, "");
}

/** A percentage with its denominator, because one without the other misleads. */
function outOf(percent: number | null, part: number | null, whole: number | null) {
  if (percent === null || whole === null) return null;
  return `${percent.toFixed(1)}% · ${part ?? 0} of ${whole}`;
}

export function ScorecardPanel() {
  const [rows, setRows] = useState<SupplierScore[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setRows(await fetchSupplierScorecard());
    } catch (err) {
      toast.error("Could not load the scorecard", { description: said(err) });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const measured = rows.filter((r) => r.componentsMeasured > 0);
  const untried = rows.filter((r) => r.componentsMeasured === 0);
  const windowDays = rows[0]?.windowDays ?? 180;

  if (measured.length === 0) {
    return (
      <EmptyState icon={ClipboardCheck} title="Nothing to score yet">
        Once orders have been placed and delivered, this shows how each
        supplier actually behaved — when they arrived, what came back, and how
        often the invoice was an argument.
      </EmptyState>
    );
  }

  const ranked = [...measured].sort((a, b) =>
    b.concerns - a.concerns || a.supplierName.localeCompare(b.supplierName));

  return (
    <div className="space-y-6">
      <p className="max-w-prose text-sm text-muted-foreground">
        The last {windowDays} days. There is no overall score on purpose: the
        weights behind one would be arbitrary, and a supplier who is late but
        cheap would come out level with one who is punctual and dear. Each
        column carries the count it was worked out from.
      </p>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Supplier</TableHead>
            <TableHead>Late</TableHead>
            <TableHead>Rejected on arrival</TableHead>
            <TableHead>Invoices in argument</TableHead>
            <TableHead>Prices</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {ranked.map((r) => (
            <TableRow key={r.supplierId}>
              <TableCell className="font-medium">
                {r.supplierName}
                {r.thinEvidence && (
                  <Badge variant="outline" className="ml-2">thin evidence</Badge>
                )}
              </TableCell>

              <TableCell>
                {r.deliveriesScored === null ? (
                  <span className="text-sm text-muted-foreground">
                    no dated orders
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <span className="tabular-nums">
                      {outOf(r.latePercent, r.late, r.deliveriesScored)}
                    </span>
                    {r.latenessFlagged && <StatusChip tone="warning">late</StatusChip>}
                  </span>
                )}
                {r.worstDaysLate !== null && r.worstDaysLate > 0 && (
                  <span className="mt-1 block text-sm text-muted-foreground">
                    worst was {r.worstDaysLate} day
                    {r.worstDaysLate === 1 ? "" : "s"} over
                  </span>
                )}
              </TableCell>

              <TableCell>
                {r.rejectedPercent === null ? (
                  <span className="text-sm text-muted-foreground">
                    nothing received
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <span className="tabular-nums">
                      {r.rejectedPercent.toFixed(2)}%
                    </span>
                    {r.qualityFlagged && <StatusChip tone="danger">quality</StatusChip>}
                  </span>
                )}
              </TableCell>

              <TableCell>
                {r.invoices === null ? (
                  <span className="text-sm text-muted-foreground">no invoices</span>
                ) : (
                  <span className="flex items-center gap-2">
                    <span className="tabular-nums">
                      {outOf(r.arguedPercent, r.inArgument, r.invoices)}
                    </span>
                    {r.paperworkFlagged && (
                      <StatusChip tone="warning">paperwork</StatusChip>
                    )}
                  </span>
                )}
                {r.creditNotes !== null && r.creditNotes > 0 && (
                  <span className="mt-1 block text-sm text-muted-foreground">
                    {r.creditNotes} credit note{r.creditNotes === 1 ? "" : "s"}
                  </span>
                )}
              </TableCell>

              <TableCell>
                {r.priceChanges === null || r.priceChanges === 0 ? (
                  <span className="text-sm text-muted-foreground">unchanged</span>
                ) : (
                  <span className="tabular-nums">
                    {r.priceRises ?? 0} rise
                    {(r.priceRises ?? 0) === 1 ? "" : "s"} of {r.priceChanges}
                    {r.averageMovePercent !== null && (
                      <span className="block text-sm text-muted-foreground">
                        averaging {r.averageMovePercent > 0 ? "+" : ""}
                        {r.averageMovePercent.toFixed(1)}%
                      </span>
                    )}
                  </span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {untried.length > 0 && (
        <p className="flex items-start gap-2 text-sm text-muted-foreground">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            {untried.length} supplier{untried.length === 1 ? " has" : "s have"}{" "}
            nothing to score in this window
            {/*
              * Named only while naming them is useful. A catalogue carrying
              * eighty suppliers of which one has been ordered from turns this
              * into a seventy-four-name paragraph nobody reads — and a
              * sentence nobody reads is the same as not saying it. The count
              * is the part that matters: it says how much of this table is
              * missing.
              */}
            {untried.length <= 8
              ? `: ${untried.map((u) => u.supplierName).join(", ")}.`
              : "."}{" "}
            They are kept out of the table rather than sitting at the bottom
            of it, because never having been ordered from is not the same as
            being bad at it.
          </span>
        </p>
      )}
    </div>
  );
}
