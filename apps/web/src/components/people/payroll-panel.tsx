// ---------------------------------------------------------------------------
// The file that goes to the bureau
// ---------------------------------------------------------------------------
// Building and sending are two buttons on purpose. The figures want reading
// before anybody presses the second one, and the second one is the point of
// no return: once a period is exported it cannot be exported again, because
// paying a fortnight twice costs the venue the fortnight and is very hard to
// claw back.
//
// Two things the screen is careful to say rather than hide:
//
//   A short line explains itself. An open punch — somebody who forgot to
//   clock out — means a day with no hours on it, and the line carries the
//   count so a wage that looks light says why. Silently paying it is how an
//   underpayment gets signed off.
//
//   A corrected figure says so. The hours on the file may not be the hours
//   on the clock, because somebody approved a correction, and a payroll
//   clerk comparing the two needs to know that before they ring the kitchen.
//
// The CSV column names are plain words rather than a bureau's codes. There is
// no such thing as "the payroll format" — every provider wants its own — so
// somebody maps this, once, and they need to see what each number is.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useState } from "react";
import { Download, FileSpreadsheet, Send, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { EmptyState } from "@/components/shared/empty-state";
import { CurrencyDisplay } from "@/components/shared/currency-display";
import { StatusChip } from "@/components/shared/status-chip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { toCsv, downloadCsv } from "@/lib/csv";
import {
  fetchPayrollRuns, fetchPayrollLines, buildPayrollRun, exportPayrollRun,
  type PayrollRun, type PayrollLine,
} from "@/data/payroll";

function said(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  return text.replace(/^\w+(\([^)]*\))? failed: /, "");
}

export function PayrollPanel({ canWrite }: { canWrite: boolean }) {
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [lines, setLines] = useState<PayrollLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await fetchPayrollRuns();
      setRuns(r);
      setSelected((s) => s ?? r[0]?.id ?? null);
    } catch (err) {
      toast.error("Could not load payroll runs", { description: said(err) });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!selected) return;
    fetchPayrollLines(selected)
      .then(setLines)
      .catch((err) => toast.error("Could not load the run", { description: said(err) }));
  }, [selected]);

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const here = runs.find((r) => r.id === selected) ?? null;
  const shortLines = lines.filter((l) => l.openPunches > 0);

  function download() {
    if (!here) return;
    const csv = toCsv(
      ["employee number", "name", "business unit", "basis", "days worked",
       "hours", "rate", "gross", "open punches", "corrections applied"],
      lines.map((l) => [
        l.employeeNumber ?? "", l.employeeName ?? "", l.businessUnitCode ?? "",
        l.basis ?? "", l.daysWorked, l.hours ?? "", l.rate ?? "", l.gross ?? "",
        l.openPunches, l.correctionsApplied,
      ]),
    );
    downloadCsv(`payroll-${here.periodFrom}-to-${here.periodTo}.csv`, csv);
  }

  return (
    <div className="space-y-6">
      {canWrite && (
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-2">
            <Label htmlFor="pr-from">From</Label>
            <Input id="pr-from" type="date" className="w-44"
                   value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pr-to">To</Label>
            <Input id="pr-to" type="date" className="w-44"
                   value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <Button
            disabled={busy || !from || !to}
            onClick={async () => {
              setBusy(true);
              try {
                const id = await buildPayrollRun(from, to);
                toast.success("Built as a draft", {
                  description: "Read the figures, then send it.",
                });
                await load();
                setSelected(id);
              } catch (err) {
                // The database names the clashing period and the date it was
                // exported, which is the part that says what to do next.
                toast.error("Nothing was built", { description: said(err) });
              } finally { setBusy(false); }
            }}
          >
            <FileSpreadsheet aria-hidden="true" />
            Build a run
          </Button>
        </div>
      )}

      {runs.length === 0 ? (
        <EmptyState icon={FileSpreadsheet} title="No payroll run yet">
          A run turns approved hours into a file a bureau can take, so nobody
          retypes them — which is the one place in this system where a typo
          becomes somebody's wages.
        </EmptyState>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
          <nav aria-label="Payroll runs" className="space-y-2">
            {runs.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setSelected(r.id)}
                aria-current={r.id === selected ? "true" : undefined}
                className={`w-full rounded-lg border p-3 text-left transition-colors ${
                  r.id === selected ? "border-ring bg-accent"
                                    : "border-border hover:bg-accent/50"
                }`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="font-medium">{r.periodFrom}</span>
                  <StatusChip
                    tone={r.status === "EXPORTED" ? "success"
                        : r.status === "SUPERSEDED" ? "neutral" : "warning"}
                  >
                    {r.status === "EXPORTED" ? "sent"
                      : r.status === "SUPERSEDED" ? "replaced" : "draft"}
                  </StatusChip>
                </span>
                <span className="mt-1 block text-sm text-muted-foreground">
                  to {r.periodTo}
                </span>
              </button>
            ))}
          </nav>

          <div className="space-y-4">
            {here && (
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-sm text-muted-foreground">
                  {here.periodFrom} to {here.periodTo}
                  {here.exportedAt && (
                    <> · sent {new Date(here.exportedAt).toLocaleDateString()}
                      {here.exportedByEmail && <> by {here.exportedByEmail}</>}</>
                  )}
                </p>
                <div className="ml-auto flex gap-2">
                  <Button variant="outline" onClick={download}
                          disabled={lines.length === 0}>
                    <Download aria-hidden="true" />
                    Download CSV
                  </Button>
                  {canWrite && here.status === "DRAFT" && (
                    <Button
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          const n = await exportPayrollRun(here.id);
                          toast.success(`${n} line${n === 1 ? "" : "s"} sent`, {
                            description:
                              "This period cannot be exported again without " +
                              "superseding this run.",
                          });
                          await load();
                        } catch (err) {
                          toast.error("Not sent", { description: said(err) });
                        } finally { setBusy(false); }
                      }}
                    >
                      <Send aria-hidden="true" />
                      Send it
                    </Button>
                  )}
                </div>
              </div>
            )}

            {here?.reason && (
              <p className="text-sm text-muted-foreground">
                Replaces an earlier run: {here.reason}
              </p>
            )}

            {shortLines.length > 0 && (
              <p className="flex items-start gap-2 text-sm text-muted-foreground">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <span>
                  {shortLines.length} line
                  {shortLines.length === 1 ? " has" : "s have"} a day where
                  somebody did not clock out, so those hours are not on the
                  file. The wage is short by that much and the line says so —
                  it is not a day of no work.
                </span>
              </p>
            )}

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead className="text-right">Days</TableHead>
                  <TableHead className="text-right">Hours</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                  <TableHead className="text-right">Gross</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((l) => (
                  <TableRow key={`${l.employeeNumber}-${l.employeeName}`}>
                    <TableCell className="font-medium">
                      {l.employeeName ?? "—"}
                      {l.employeeNumber && (
                        <span className="ml-2 text-sm text-muted-foreground">
                          {l.employeeNumber}
                        </span>
                      )}
                      {l.correctionsApplied > 0 && (
                        <Badge variant="outline" className="ml-2">
                          {l.correctionsApplied} corrected
                        </Badge>
                      )}
                      {l.openPunches > 0 && (
                        <Badge variant="outline" className="ml-2">
                          {l.openPunches} open punch
                          {l.openPunches === 1 ? "" : "es"}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {l.businessUnitCode ?? "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {l.daysWorked}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {l.hours ?? "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {l.rate === null ? "—" : <CurrencyDisplay value={l.rate} />}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {l.gross === null ? "—" : <CurrencyDisplay value={l.gross} />}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  );
}
