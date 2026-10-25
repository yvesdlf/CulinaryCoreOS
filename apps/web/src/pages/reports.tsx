// ---------------------------------------------------------------------------
// Reports — the figures that had nowhere to be read
// ---------------------------------------------------------------------------
// This application had eighty-three views and almost no reporting screens.
// Profit by unit, labour against revenue, what the venue owes and how late,
// the pour cost of every bottle, and which hygiene breaches nobody was told
// about were all computed, tested, and reachable only from a psql prompt.
//
// So this page is deliberately thin. It adds no arithmetic: every figure is a
// column of a view, and where a view carries a caveat the caveat is shown
// beside the number rather than filtered out to make the table tidy. Those
// columns are the ones that stop a total reading as more certain than it is:
//
//   `unattributed_goods_cost` — stock that moved with no business unit on it.
//   Real money, chargeable to nobody, and folding it into whichever unit
//   sorts first would invent a fact.
//
//   `movements_with_no_cost` — a cost of goods that is low because nobody
//   priced the movements, not because nothing was used.
//
//   `stuck` — invoices in exception or dispute. A supplier balance of zero
//   means something quite different when three invoices are arguments.
//
//   `breaches_nobody_was_told_about` — a recorded breach that raised no
//   request. The number worth reading on the whole page, because it is
//   evidence somebody knew.
//
// Each report exports to CSV with its caveat columns included, because the
// spreadsheet is where these figures get argued about and a caveat that does
// not survive the export is a caveat that was never really attached.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BarChart3, Download, TriangleAlert, Wallet, Users, Boxes, Wine, ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { CurrencyDisplay } from "@/components/shared/currency-display";
import { StatusChip } from "@/components/shared/status-chip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { toCsv, downloadCsv } from "@/lib/csv";
import { venueToday, addDays } from "@/lib/today";
import {
  fetchUnitProfit, fetchLabourAgainstRevenue, fetchCostOfGoods,
  fetchPayables, fetchPourCost, fetchHygieneByUnit,
  type UnitProfitRow, type LabourRow, type GoodsRow,
  type PayableRow, type PourCostRow, type HygieneRow,
} from "@/data/reports";

function said(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  return text.replace(/^\w+(\([^)]*\))? failed: /, "");
}

function money(v: number | null) {
  return v === null ? <span className="text-muted-foreground">—</span>
                    : <CurrencyDisplay value={v} />;
}
function pct(v: number | null) {
  return v === null ? "—" : `${v.toFixed(1)}%`;
}

export function ReportsPage() {
  // A month back by default: long enough to be a pattern, short enough that
  // a venue with a year of data does not wait for it on first open.
  const [to, setTo] = useState(venueToday());
  const [from, setFrom] = useState(addDays(venueToday(), -30));

  const [profit, setProfit] = useState<UnitProfitRow[]>([]);
  const [labour, setLabour] = useState<LabourRow[]>([]);
  const [goods, setGoods] = useState<GoodsRow[]>([]);
  const [payables, setPayables] = useState<PayableRow[]>([]);
  const [pour, setPour] = useState<PourCostRow[]>([]);
  const [hygiene, setHygiene] = useState<HygieneRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      /*
       * Each report tolerated separately. These read different sections, so
       * somebody with Purchasing and no Pay should get the payables report
       * and an empty labour one — not a blank page because one of six reads
       * was refused.
       */
      const [p, l, g, a, pc, h] = await Promise.all([
        fetchUnitProfit(from, to).catch(() => []),
        fetchLabourAgainstRevenue(from, to).catch(() => []),
        fetchCostOfGoods(from, to).catch(() => []),
        fetchPayables().catch(() => []),
        fetchPourCost().catch(() => []),
        fetchHygieneByUnit().catch(() => []),
      ]);
      setProfit(p); setLabour(l); setGoods(g);
      setPayables(a); setPour(pc); setHygiene(h);
    } catch (err) {
      toast.error("Could not load the reports", { description: said(err) });
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => { void load(); }, [load]);

  const unattributed = useMemo(
    () => profit.reduce((n, r) => n + (r.unattributedGoodsCost ?? 0), 0),
    [profit],
  );
  const uncosted = useMemo(
    () => goods.reduce((n, r) => n + r.movementsWithNoCost, 0),
    [goods],
  );
  const unreported = useMemo(
    () => hygiene.reduce((n, r) => n + r.breachesNobodyWasToldAbout, 0),
    [hygiene],
  );

  function exportCsv(name: string, headers: string[], rows: (string | number)[][]) {
    downloadCsv(`${name}-${from}-to-${to}.csv`, toCsv(headers, rows));
  }

  return (
    <div>
      <PageHeader
        title="Reports"
        description="Figures the venue already computes, in one place. Where a number comes with a caveat, the caveat is beside it — a total that hides what it could not count is worse than no total."
      />

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div className="space-y-2">
          <Label htmlFor="rep-from">From</Label>
          <Input id="rep-from" type="date" className="w-44"
                 value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="rep-to">To</Label>
          <Input id="rep-to" type="date" className="w-44"
                 value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>

      {/* The three caveats worth seeing before any of the tables. */}
      {!loading && (unattributed > 0 || uncosted > 0 || unreported > 0) && (
        <div className="mt-4 space-y-2">
          {unreported > 0 && (
            <p className="flex items-start gap-2 rounded-lg border border-status-danger/40 bg-status-danger/10 p-3 text-sm">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>
                <strong>{unreported}</strong> recorded hygiene breach
                {unreported === 1 ? "" : "es"} raised nothing. A breach that
                was written down and reported to nobody is evidence somebody
                knew.
              </span>
            </p>
          )}
          {unattributed > 0 && (
            <p className="flex items-start gap-2 rounded-lg border p-3 text-sm text-muted-foreground">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>
                <CurrencyDisplay value={unattributed} /> of stock moved with no
                business unit on it. It is real cost and it belongs to nobody,
                so no unit's profit below includes it.
              </span>
            </p>
          )}
          {uncosted > 0 && (
            <p className="flex items-start gap-2 rounded-lg border p-3 text-sm text-muted-foreground">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>
                <strong>{uncosted}</strong> stock movement
                {uncosted === 1 ? "" : "s"} carried no cost. The cost of goods
                below is low by whatever they were worth, not by nothing.
              </span>
            </p>
          )}
        </div>
      )}

      {loading ? (
        <p className="mt-6 text-sm text-muted-foreground">Loading…</p>
      ) : (
      <Tabs defaultValue="profit" className="mt-6">
        <TabsList>
          <TabsTrigger value="profit"><BarChart3 className="size-4" />Profit</TabsTrigger>
          <TabsTrigger value="labour"><Users className="size-4" />Labour</TabsTrigger>
          <TabsTrigger value="goods"><Boxes className="size-4" />Cost of goods</TabsTrigger>
          <TabsTrigger value="payables"><Wallet className="size-4" />Owed</TabsTrigger>
          <TabsTrigger value="pour"><Wine className="size-4" />Pour cost</TabsTrigger>
          <TabsTrigger value="hygiene"><ShieldCheck className="size-4" />Hygiene</TabsTrigger>
        </TabsList>

        <TabsContent value="profit" className="mt-4 space-y-3">
          <ReportHead
            blurb="Revenue less labour, goods and waste, per outlet per day. Stock with no unit on it is excluded rather than spread."
            empty={profit.length === 0}
            onExport={() => exportCsv("profit-by-unit",
              ["date","unit","net revenue","covers","labour","goods","waste",
               "gross profit","gross profit %","unattributed goods cost"],
              profit.map((r) => [r.onDate, r.unitName ?? "", r.revenueNet ?? "",
                r.covers ?? "", r.labourCost ?? "", r.goodsCost ?? "",
                r.wasteCost ?? "", r.grossProfit ?? "",
                r.grossProfitPercent ?? "", r.unattributedGoodsCost ?? ""]))}
          />
          {profit.length > 0 && (
            <Table>
              <TableHeader><TableRow>
                <TableHead>Day</TableHead><TableHead>Outlet</TableHead>
                <TableHead className="text-right">Net revenue</TableHead>
                <TableHead className="text-right">Labour</TableHead>
                <TableHead className="text-right">Goods</TableHead>
                <TableHead className="text-right">Waste</TableHead>
                <TableHead className="text-right">Gross profit</TableHead>
                <TableHead className="text-right">%</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {profit.map((r) => (
                  <TableRow key={`${r.onDate}-${r.unitCode}`}>
                    <TableCell className="whitespace-nowrap">{r.onDate}</TableCell>
                    <TableCell className="font-medium">{r.unitName ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(r.revenueNet)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(r.labourCost)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(r.goodsCost)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(r.wasteCost)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(r.grossProfit)}</TableCell>
                    <TableCell className="text-right tabular-nums">{pct(r.grossProfitPercent)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </TabsContent>

        <TabsContent value="labour" className="mt-4 space-y-3">
          <ReportHead
            blurb="Hours and their cost against what the outlet took. The rate is the one in force on the day worked, not today's."
            empty={labour.length === 0}
            onExport={() => exportCsv("labour-against-revenue",
              ["date","unit","net revenue","covers","hours","labour cost","labour % of net"],
              labour.map((r) => [r.onDate, r.unitName ?? "", r.net ?? "",
                r.covers ?? "", r.hours ?? "", r.labourCost ?? "",
                r.labourPercentOfNet ?? ""]))}
          />
          {labour.length > 0 && (
            <Table>
              <TableHeader><TableRow>
                <TableHead>Day</TableHead><TableHead>Outlet</TableHead>
                <TableHead className="text-right">Net revenue</TableHead>
                <TableHead className="text-right">Hours</TableHead>
                <TableHead className="text-right">Labour</TableHead>
                <TableHead className="text-right">% of net</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {labour.map((r) => (
                  <TableRow key={`${r.onDate}-${r.unitName}`}>
                    <TableCell className="whitespace-nowrap">{r.onDate}</TableCell>
                    <TableCell className="font-medium">{r.unitName ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(r.net)}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.hours ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(r.labourCost)}</TableCell>
                    <TableCell className="text-right tabular-nums">{pct(r.labourPercentOfNet)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </TabsContent>

        <TabsContent value="goods" className="mt-4 space-y-3">
          <ReportHead
            blurb="What left the store, and what was thrown away. Kept apart: waste is a decision and usage is not."
            empty={goods.length === 0}
            onExport={() => exportCsv("cost-of-goods",
              ["date","used","wasted","total","movements with no cost"],
              goods.map((r) => [r.onDate, r.usedCost ?? "", r.wastedCost ?? "",
                r.totalCost ?? "", r.movementsWithNoCost]))}
          />
          {goods.length > 0 && (
            <Table>
              <TableHeader><TableRow>
                <TableHead>Day</TableHead>
                <TableHead className="text-right">Used</TableHead>
                <TableHead className="text-right">Wasted</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Uncosted movements</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {goods.map((r) => (
                  <TableRow key={r.onDate}>
                    <TableCell className="whitespace-nowrap">{r.onDate}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(r.usedCost)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(r.wastedCost)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(r.totalCost)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.movementsWithNoCost > 0
                        ? <Badge variant="outline">{r.movementsWithNoCost}</Badge>
                        : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </TabsContent>

        <TabsContent value="payables" className="mt-4 space-y-3">
          <ReportHead
            blurb="What each supplier is owed, credits netted off. Invoices in argument are counted separately: a balance of zero means less when three are stuck."
            empty={payables.length === 0}
            onExport={() => exportCsv("owed-by-supplier",
              ["supplier","invoices","stuck","approved to pay","overdue",
               "credits owed to us","net payable","oldest days overdue"],
              payables.map((r) => [r.supplierName ?? "", r.invoices, r.stuck,
                r.approvedToPay ?? "", r.overdue ?? "", r.creditsOwedToUs ?? "",
                r.netPayable ?? "", r.oldestDaysOverdue ?? ""]))}
          />
          {payables.length > 0 && (
            <Table>
              <TableHeader><TableRow>
                <TableHead>Supplier</TableHead>
                <TableHead className="text-right">Net payable</TableHead>
                <TableHead className="text-right">Overdue</TableHead>
                <TableHead className="text-right">Oldest</TableHead>
                <TableHead>In argument</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {payables.map((r) => (
                  <TableRow key={r.supplierName ?? ""}>
                    <TableCell className="font-medium">{r.supplierName ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(r.netPayable)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(r.overdue)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.oldestDaysOverdue && r.oldestDaysOverdue > 0
                        ? `${r.oldestDaysOverdue} days` : "—"}
                    </TableCell>
                    <TableCell>
                      {r.stuck > 0
                        ? <StatusChip tone="warning">{r.stuck} stuck</StatusChip>
                        : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </TabsContent>

        <TabsContent value="pour" className="mt-4 space-y-3">
          <ReportHead
            blurb="What one measure costs, after the expected loss on the bottle."
            empty={pour.length === 0}
            onExport={() => exportCsv("pour-cost",
              ["product","container","measure","measures per container",
               "cost per measure","expected loss %"],
              pour.map((r) => [r.productName ?? "", r.containerSize ?? "",
                r.measureSize ?? "", r.measuresPerContainer ?? "",
                r.costPerMeasure ?? "", r.expectedLossPercent ?? ""]))}
          />
          {pour.length > 0 && (
            <Table>
              <TableHeader><TableRow>
                <TableHead>Product</TableHead>
                <TableHead className="text-right">Measure</TableHead>
                <TableHead className="text-right">Per container</TableHead>
                <TableHead className="text-right">Cost per measure</TableHead>
                <TableHead className="text-right">Expected loss</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {pour.map((r) => (
                  <TableRow key={r.productName ?? ""}>
                    <TableCell className="font-medium">{r.productName ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.measureSize ?? "—"} {r.stockUnit ?? ""}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.measuresPerContainer === null
                        ? "—" : r.measuresPerContainer.toFixed(1)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{money(r.costPerMeasure)}</TableCell>
                    <TableCell className="text-right tabular-nums">{pct(r.expectedLossPercent)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </TabsContent>

        <TabsContent value="hygiene" className="mt-4 space-y-3">
          <ReportHead
            blurb="Breaches in the last thirty days, and how many of them told nobody. The second column is the one to read."
            empty={hygiene.length === 0}
            onExport={() => exportCsv("hygiene-by-unit",
              ["unit","form","frequency","critical control point",
               "last completed","breaches 30d","breaches that raised nothing"],
              hygiene.map((r) => [r.unitName ?? "", r.formTitle ?? "",
                r.frequency ?? "", r.isCcp ? "yes" : "no",
                r.lastCompletedOn ?? "", r.breachesLast30Days,
                r.breachesNobodyWasToldAbout]))}
          />
          {hygiene.length > 0 && (
            <Table>
              <TableHeader><TableRow>
                <TableHead>Outlet</TableHead><TableHead>Form</TableHead>
                <TableHead>Last done</TableHead>
                <TableHead className="text-right">Breaches</TableHead>
                <TableHead>Told nobody</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {hygiene.map((r) => (
                  <TableRow key={`${r.unitName}-${r.formTitle}`}>
                    <TableCell>{r.unitName ?? "—"}</TableCell>
                    <TableCell className="font-medium">
                      {r.formTitle ?? "—"}
                      {r.isCcp && <Badge variant="outline" className="ml-2">CCP</Badge>}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {r.lastCompletedOn ?? "never"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{r.breachesLast30Days}</TableCell>
                    <TableCell>
                      {r.breachesNobodyWasToldAbout > 0
                        ? <StatusChip tone="danger">{r.breachesNobodyWasToldAbout}</StatusChip>
                        : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </TabsContent>
      </Tabs>
      )}
    </div>
  );
}

function ReportHead({ blurb, empty, onExport }: {
  blurb: string; empty: boolean; onExport: () => void;
}) {
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-prose text-sm text-muted-foreground">{blurb}</p>
        <Button variant="outline" size="sm" onClick={onExport} disabled={empty}>
          <Download aria-hidden="true" />
          Download CSV
        </Button>
      </div>
      {empty && (
        <EmptyState icon={BarChart3} title="Nothing in this period">
          {/* Said rather than left blank: an empty report and a report
              somebody is not allowed to see look identical. */}
          Either nothing was recorded between these dates, or this report
          reads a section you do not have access to.
        </EmptyState>
      )}
    </>
  );
}
