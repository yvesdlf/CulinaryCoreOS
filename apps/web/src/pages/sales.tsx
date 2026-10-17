// ---------------------------------------------------------------------------
// Sales — the day's takings, and what they took off the shelf
// ---------------------------------------------------------------------------
// The last link in the food cost chain a person can walk. A till file comes
// in, the lines land, and posting explodes them through the recipes into
// stock movements (0092) — which is the theoretical side the food cost page
// compares against the counts.
//
// `AGENTS.md` §10: choose a file, read what it *would* do, then decide. The
// planner is pure (`engine/sales-import.ts`), so the preview on this screen
// and the rows that get written cannot disagree.
//
// Two things this screen is careful about, both of which are easy to get
// wrong in a way nobody notices:
//
//   A row whose till code maps to nothing still imports. Refusing the file
//   would stop a day's takings being recorded over one unmapped button;
//   dropping the row would lose the sale. It imports and is counted, and the
//   preview says how much money is about to land uncosted.
//
//   Posting happens once, and it is irreversible in the sense that matters —
//   it writes to an append-only ledger. So the preview of what will leave
//   stock is shown before the button, not after it.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Receipt, Upload, TriangleAlert, CircleCheck, Link2Off } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { CurrencyDisplay } from "@/components/shared/currency-display";
import { StatusChip } from "@/components/shared/status-chip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { parseCsv } from "@/lib/csv";
import { useCanWriteSection } from "@/stores/access-store";
import { planSalesImport, type SalesImportPlan } from "@/engine/sales-import";
import {
  fetchSalesPeriodSummaries, fetchCodeMappings, createImportedSalesPeriod, insertSalesLines,
  postSalesConsumption, fetchTheoretical,
  type SalesPeriodSummary, type TheoreticalLine,
} from "@/data/sales";

function said(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  return text.replace(/^\w+(\([^)]*\))? failed: /, "");
}

export function SalesPage() {
  const canWrite = useCanWriteSection("INVENTORY");
  const [periods, setPeriods] = useState<SalesPeriodSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [theoretical, setTheoretical] = useState<TheoreticalLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [plan, setPlan] = useState<SalesImportPlan | null>(null);
  const [fileName, setFileName] = useState("");
  const [periodName, setPeriodName] = useState("");
  const [businessDate, setBusinessDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      setPeriods(await fetchSalesPeriodSummaries());
    } catch (err) {
      toast.error("Could not load sales", { description: said(err) });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!selected) { setTheoretical([]); return; }
    void fetchTheoretical(selected)
      .then(setTheoretical)
      .catch((err) => toast.error("Could not read what it would use", { description: said(err) }));
  }, [selected]);

  const current = periods.find((p) => p.id === selected) ?? null;

  async function onFile(file: File) {
    try {
      const text = await file.text();
      const rows = parseCsv(text);
      const mappings = await fetchCodeMappings();
      setPlan(planSalesImport(rows, mappings));
      setFileName(file.name);
      if (periodName === "") setPeriodName(file.name.replace(/\.[^.]+$/, ""));
    } catch (err) {
      toast.error("Could not read the file", { description: said(err) });
    }
  }

  async function commit() {
    if (!plan || plan.lines.length === 0) return;
    setBusy(true);
    try {
      const id = await createImportedSalesPeriod({
        name: periodName.trim() || fileName,
        startsOn: businessDate,
        endsOn: businessDate,
      });
      await insertSalesLines(id, businessDate, plan.lines);
      toast.success(`${plan.lines.length} lines imported`, {
        description:
          plan.unmappedCount > 0
            ? `${plan.unmappedCount} of them are on codes nothing maps to yet.`
            : undefined,
      });
      setImportOpen(false);
      setPlan(null);
      setFileName("");
      await load();
      setSelected(id);
    } catch (err) {
      toast.error("Nothing was imported", { description: said(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Sales"
        description="Import the till's daily file, then post what it should have taken off the shelf. That figure is the theoretical side of food cost."
      >
        {canWrite && (
          <Button onClick={() => setImportOpen(true)}>
            <Upload aria-hidden="true" />
            Import a file
          </Button>
        )}
      </PageHeader>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : periods.length === 0 ? (
        <EmptyState icon={Receipt} title="No sales imported yet">
          A till file is a list of what was rung up. Importing it records the
          takings; posting it works out what the recipes say went out of the
          store to make them.
        </EmptyState>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[20rem_1fr]">
          <nav aria-label="Sales periods" className="space-y-2">
            {periods.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setSelected(p.id)}
                aria-current={p.id === selected ? "true" : undefined}
                className={`w-full rounded-lg border p-3 text-left transition-colors ${
                  p.id === selected ? "border-ring bg-accent" : "border-border hover:bg-accent/50"
                }`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="font-medium">{p.name ?? p.endsOn}</span>
                  <StatusChip tone={p.consumptionPostedAt ? "success" : "warning"}>
                    {p.consumptionPostedAt ? "Posted" : "Not posted"}
                  </StatusChip>
                </span>
                <span className="mt-1 block text-sm text-muted-foreground">
                  {p.lines} line{p.lines === 1 ? "" : "s"} ·{" "}
                  <CurrencyDisplay value={p.netSales} />
                  {p.unmappedLines > 0 && ` · ${p.unmappedLines} unmapped`}
                </span>
              </button>
            ))}
          </nav>

          {current && (
            <div className="space-y-4">
              {current.unmappedLines > 0 && (
                <div
                  role="status"
                  className="flex items-start gap-3 rounded-lg border border-status-warning bg-status-warning-soft p-4"
                >
                  <Link2Off className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <div className="space-y-1 text-sm">
                    <p className="font-medium">
                      {current.unmappedLines} line
                      {current.unmappedLines === 1 ? "" : "s"} on till codes
                      nothing maps to.
                    </p>
                    <p>
                      They were imported — refusing the file or dropping them
                      would have lost the sale — but nothing says what those
                      dishes are made of, so they will take nothing off the
                      shelf and food cost will read low.
                    </p>
                    <Button variant="outline" size="sm" render={<Link to="/menus" />}>
                      Map the codes
                    </Button>
                  </div>
                </div>
              )}

              <Card>
                <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
                  <div>
                    <CardTitle>
                      {current.consumptionPostedAt
                        ? "What this took off the shelf"
                        : "What this would take off the shelf"}
                    </CardTitle>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {current.consumptionPostedAt ? (
                        <>
                          Posted{" "}
                          {new Date(current.consumptionPostedAt).toLocaleString()}.
                          Consumption is posted once; a correction is a new
                          movement.
                        </>
                      ) : (
                        <>
                          Worked out from the recipes, through every level of
                          sub-recipe. Nothing has been written to stock yet.
                        </>
                      )}
                    </p>
                  </div>
                  {canWrite && !current.consumptionPostedAt && (
                    <Button
                      disabled={busy || theoretical.length === 0}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          const n = await postSalesConsumption(current.id);
                          toast.success(`${n} products taken off the shelf`);
                          await load();
                        } catch (err) {
                          toast.error("Nothing was posted", { description: said(err) });
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      Post to stock
                    </Button>
                  )}
                </CardHeader>
                <CardContent>
                  {theoretical.length === 0 ? (
                    <EmptyState icon={Link2Off} title="Nothing to post">
                      None of these lines maps to a dish, so there is no recipe
                      to work out consumption from. Map the till codes first.
                    </EmptyState>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Product</TableHead>
                          <TableHead className="text-right">Quantity</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {theoretical.map((t) => (
                          <TableRow key={`${t.productName}|${t.unit}`}>
                            <TableCell className="font-medium">{t.productName}</TableCell>
                            <TableCell className="text-right tabular-nums">
                              {t.qty.toLocaleString(undefined, { maximumFractionDigits: 2 })}{" "}
                              <span className="text-muted-foreground">{t.unit}</span>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      )}

      <Dialog
        open={importOpen}
        onOpenChange={(o) => { setImportOpen(o); if (!o) { setPlan(null); setFileName(""); } }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Import a till file</DialogTitle>
            <DialogDescription>
              Nothing is written until you press Import. What you see below is
              what will happen.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="sales-file">File</Label>
              <Input
                id="sales-file"
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onFile(f);
                }}
              />
              <p className="text-sm text-muted-foreground">
                A CSV with a till code column and a quantity column. Columns are
                found by their headings, so the order does not matter.
              </p>
            </div>

            {plan && (
              <>
                {plan.matchedOn && (
                  <p className="text-sm text-muted-foreground">
                    Read <strong>{plan.matchedOn.code}</strong> as the till code
                    and <strong>{plan.matchedOn.units}</strong> as the quantity
                    {plan.matchedOn.net && (
                      <>, <strong>{plan.matchedOn.net}</strong> as net sales</>
                    )}
                    .
                  </p>
                )}

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="sales-name">Name</Label>
                    <Input
                      id="sales-name"
                      value={periodName}
                      onChange={(e) => setPeriodName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="sales-date">Trading day</Label>
                    <Input
                      id="sales-date"
                      type="date"
                      value={businessDate}
                      onChange={(e) => setBusinessDate(e.target.value)}
                    />
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <StatusChip tone="success">
                    {plan.lines.length} line{plan.lines.length === 1 ? "" : "s"} will import
                  </StatusChip>
                  {plan.unmappedCount > 0 && (
                    <StatusChip tone="warning">
                      {plan.unmappedCount} on unmapped codes
                    </StatusChip>
                  )}
                  {plan.problems.length > 0 && (
                    <StatusChip tone="danger">
                      {plan.problems.length} will not import
                    </StatusChip>
                  )}
                </div>

                {plan.unmappedCount > 0 && (
                  <p className="rounded-lg border border-status-warning bg-status-warning-soft p-3 text-sm">
                    <CurrencyDisplay value={plan.unmappedNetSales} /> of sales is
                    on codes nothing maps to. Those lines import — the takings
                    are real — but they will take nothing off the shelf until
                    the codes are mapped.
                  </p>
                )}

                {plan.problems.length > 0 && (
                  <div>
                    <p className="mb-2 flex items-center gap-2 text-sm font-medium">
                      <TriangleAlert className="size-4 text-status-danger" aria-hidden="true" />
                      These rows will not import
                    </p>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-16">Line</TableHead>
                          <TableHead>Code</TableHead>
                          <TableHead>Why</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {plan.problems.map((p) => (
                          <TableRow key={`${p.line}-${p.code}`}>
                            <TableCell className="tabular-nums">{p.line}</TableCell>
                            <TableCell>{p.code || "—"}</TableCell>
                            <TableCell>{p.reason}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}

                {plan.lines.length > 0 && (
                  <div>
                    <p className="mb-2 flex items-center gap-2 text-sm font-medium">
                      <CircleCheck className="size-4 text-status-success" aria-hidden="true" />
                      What will import
                    </p>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Code</TableHead>
                          <TableHead>Dish</TableHead>
                          <TableHead className="text-right">Sold</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {plan.lines.slice(0, 50).map((l) => (
                          <TableRow key={l.line}>
                            <TableCell><code className="text-sm">{l.posItemCode}</code></TableCell>
                            <TableCell>
                              {l.itemName ?? (
                                <Badge variant="outline">no dish mapped</Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {l.unitsSold}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    {plan.lines.length > 50 && (
                      <p className="mt-2 text-sm text-muted-foreground">
                        Showing the first 50 of {plan.lines.length}.
                      </p>
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={busy || !plan || plan.lines.length === 0}
              onClick={() => void commit()}
            >
              Import {plan ? `${plan.lines.length} lines` : ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
