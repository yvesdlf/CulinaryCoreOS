// ---------------------------------------------------------------------------
// Goods going back, and the credit that should follow
// ---------------------------------------------------------------------------
// A tab on Purchasing rather than a page of its own: a return is part of the
// same conversation as the order and the delivery, and it shares their
// number.
//
// Most returns are not created here. A rejected delivery line drafts one
// automatically (0095), because a storeman refusing three crates at six in
// the morning is not going to open a second screen. What this does is let
// somebody review that draft and post it.
//
// The distinction the screen has to carry: a line refused at the door never
// entered the ledger, so posting it moves no stock. A line returned from the
// shelf does. Getting that backwards invents a shortfall a stocktake then
// has to explain, so each line says which it is.
//
// The outstanding credits list is the half nobody has today. The thing that
// actually goes wrong is not the return — it is nobody noticing the credit
// never arrived.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useState } from "react";
import { Undo2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { EmptyState } from "@/components/shared/empty-state";
import { CurrencyDisplay } from "@/components/shared/currency-display";
import { StatusChip, type StatusTone } from "@/components/shared/status-chip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useCanWriteSection } from "@/stores/access-store";
import {
  fetchSupplierReturns, fetchReturnLines, postSupplierReturn,
  fetchOutstandingCredits,
  type SupplierReturn, type SupplierReturnLine, type OutstandingCredit,
} from "@/data/repository";

function said(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  return text.replace(/^\w+(\([^)]*\))? failed: /, "");
}

const TONE: Record<string, StatusTone> = {
  DRAFT: "warning", POSTED: "info", CREDITED: "success", CANCELLED: "neutral",
  EXPECTED: "warning", RECEIVED: "info", APPLIED: "success",
};

export function ReturnsPanel() {
  const canWrite = useCanWriteSection("PURCHASING");
  const [returns, setReturns] = useState<SupplierReturn[]>([]);
  const [credits, setCredits] = useState<OutstandingCredit[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [lines, setLines] = useState<SupplierReturnLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [r, c] = await Promise.all([fetchSupplierReturns(), fetchOutstandingCredits()]);
      setReturns(r);
      setCredits(c);
      setSelected((cur) => cur ?? r[0]?.id ?? null);
    } catch (err) {
      toast.error("Could not load returns", { description: said(err) });
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!selected) { setLines([]); return; }
    void fetchReturnLines(selected).then(setLines).catch((err) =>
      toast.error("Could not load the lines", { description: said(err) }));
  }, [selected]);

  const current = returns.find((r) => r.id === selected) ?? null;

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="space-y-6">
      {returns.length === 0 ? (
        <EmptyState icon={Undo2} title="Nothing has gone back">
          Rejecting a line on a delivery drafts a return here automatically,
          with the same number as the delivery it came from.
        </EmptyState>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
          <nav aria-label="Returns" className="space-y-2">
            {returns.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setSelected(r.id)}
                aria-current={r.id === selected ? "true" : undefined}
                className={`w-full rounded-lg border p-3 text-left transition-colors ${
                  r.id === selected ? "border-ring bg-accent" : "border-border hover:bg-accent/50"
                }`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="font-medium">{r.reference ?? "Draft"}</span>
                  <StatusChip tone={TONE[r.status] ?? "neutral"}>{r.status}</StatusChip>
                </span>
                <span className="mt-1 block text-sm text-muted-foreground">
                  {r.supplierName ?? "—"} · {r.lines} line{r.lines === 1 ? "" : "s"}
                </span>
              </button>
            ))}
          </nav>

          <div className="space-y-3">
            {current && (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-medium">{current.reference ?? "Draft return"}</h3>
                    <p className="text-sm text-muted-foreground">
                      {current.reason ?? "No reason recorded"}
                    </p>
                  </div>
                  {canWrite && current.status === "DRAFT" && (
                    <Button
                      disabled={busy || current.lines === 0}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          const n = await postSupplierReturn(current.id);
                          toast.success(
                            n === 0
                              ? "Sent. Nothing left stock — these were refused at the door."
                              : `Sent. ${n} products taken off the shelf.`,
                          );
                          await load();
                        } catch (err) {
                          toast.error("Not sent", { description: said(err) });
                        } finally { setBusy(false); }
                      }}
                    >
                      Send to supplier
                    </Button>
                  )}
                </div>

                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead className="text-right">Going back</TableHead>
                      <TableHead>Why</TableHead>
                      <TableHead>Stock</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lines.map((l) => (
                      <TableRow key={l.id}>
                        <TableCell className="font-medium">{l.productName ?? "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {l.quantity} <span className="text-muted-foreground">{l.unit}</span>
                        </TableCell>
                        <TableCell className="text-sm">{l.reason ?? "—"}</TableCell>
                        <TableCell>
                          {/* The rule that matters: refused at the door never
                              entered the ledger, so sending it takes nothing
                              out. */}
                          <Badge variant="outline">
                            {l.fromStock ? "comes off the shelf" : "never reached the shelf"}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </>
            )}
          </div>
        </div>
      )}

      <section className="space-y-3">
        <div>
          <h3 className="font-medium">Credits a supplier owes</h3>
          <p className="text-sm text-muted-foreground">
            Raised when a return is sent. The thing that goes wrong is not the
            return, it is nobody noticing the credit never came.
          </p>
        </div>
        {credits.length === 0 ? (
          <EmptyState icon={Undo2} title="Nothing outstanding">
            Every credit raised has been received and applied.
          </EmptyState>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Credit</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>For</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right">Waiting</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {credits.map((c) => (
                <TableRow key={c.creditNoteId}>
                  <TableCell className="font-medium">{c.reference ?? "—"}</TableCell>
                  <TableCell>{c.supplierName ?? "—"}</TableCell>
                  <TableCell>{c.returnReference ?? "—"}</TableCell>
                  <TableCell className="text-right">
                    {c.amount === null ? "—" : <CurrencyDisplay value={c.amount} />}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {c.daysOutstanding === null ? "—" : `${c.daysOutstanding} days`}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {credits.some((c) => (c.daysOutstanding ?? 0) > 30) && (
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>Something here has been outstanding more than a month.</span>
          </p>
        )}
      </section>
    </div>
  );
}
