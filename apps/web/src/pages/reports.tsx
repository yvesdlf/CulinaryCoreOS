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
  BarChart3, Download, Printer, TriangleAlert, Wallet, Users, Boxes, Wine,
  ShieldCheck, LineChart, FileSearch, ChefHat, Wrench, BedDouble, Scale,
  DoorOpen,
} from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/layout/page-header";
import { VenueLogo } from "@/components/shared/venue-logo";
import { EmptyState } from "@/components/shared/empty-state";
import { CurrencyDisplay } from "@/components/shared/currency-display";
import { StatusChip } from "@/components/shared/status-chip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { toCsv, downloadCsv } from "@/lib/csv";
import {
  PeriodPicker, resolvePeriod, type PeriodChoice,
} from "@/components/reports/period-picker";
import { ExportMenu } from "@/components/reports/export-menu";
import { venueToday, useNow } from "@/lib/today";
import { useAuthStore } from "@/stores/auth-store";
import {
  fetchUnitProfit, fetchLabourAgainstRevenue, fetchCostOfGoods,
  fetchPayables, fetchPourCost, fetchHygieneByUnit,
  fetchProfitTrend, isComparable,
  type UnitProfitRow, type LabourRow, type GoodsRow,
  type PayableRow, type PourCostRow, type HygieneRow,
  type TrendRow, type TrendGrain,
  fetchTraceability, traceabilityCaveats, type TraceabilityRow,
  fetchProduction, productionCaveats, type ProductionRow,
  fetchMaintenance, maintenanceCaveats, type MaintenanceRow,
  fetchHousekeeping, housekeepingCaveats, type HousekeepingRow,
  fetchHrCases, hrCasesCaveats, type HrCaseRow,
  fetchRequests, requestsCaveats, type RequestsRow,
} from "@/data/reports";
import { TrendChart, type TrendPoint } from "@/components/shared/trend-chart";

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
  /*
   * A period, not a pair of dates. A manager asks for "last month", and the
   * pair is still there behind Custom for when they genuinely want one.
   * Last month by default: a finished period, so the first thing anybody
   * sees is comparable rather than a month nine days old.
   */
  const today = venueToday();
  const [choice, setChoice] = useState<PeriodChoice>(
    { mode: "PRESET", kind: "MONTH", offset: -1 });
  const [comparing, setComparing] = useState(false);
  const period = useMemo(() => resolvePeriod(choice, today), [choice, today]);
  const from = period.from;
  const to = period.to;

  const [profit, setProfit] = useState<UnitProfitRow[]>([]);
  const [labour, setLabour] = useState<LabourRow[]>([]);
  const [goods, setGoods] = useState<GoodsRow[]>([]);
  const [payables, setPayables] = useState<PayableRow[]>([]);
  const [pour, setPour] = useState<PourCostRow[]>([]);
  const [hygiene, setHygiene] = useState<HygieneRow[]>([]);
  const [trend, setTrend] = useState<TrendRow[]>([]);
  const [lots, setLots] = useState<TraceabilityRow[]>([]);
  const [production, setProduction] = useState<ProductionRow[]>([]);
  const [maintenance, setMaintenance] = useState<MaintenanceRow[]>([]);
  const [housekeeping, setHousekeeping] = useState<HousekeepingRow[]>([]);
  const [hrCases, setHrCases] = useState<HrCaseRow[]>([]);
  const [frontDoor, setFrontDoor] = useState<RequestsRow[]>([]);
  const [grain, setGrain] = useState<TrendGrain>("week");
  const [loading, setLoading] = useState(true);
  /*
   * Controlled, only so the printed sheet can say which report it is. An
   * uncontrolled tab panel is still the only one in the DOM and would print
   * correctly; it would print under the heading "Reports", which is the
   * heading of all seven.
   */
  const [tab, setTab] = useState("trend");

  const printedOn = useNow();
  const venue = useAuthStore((s) => s.activeOrg);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      /*
       * Each report tolerated separately. These read different sections, so
       * somebody with Purchasing and no Pay should get the payables report
       * and an empty labour one — not a blank page because one of six reads
       * was refused.
       */
      const [p, l, g, a, pc, h, tr, lt, pr, mt, hk, hc, rq] = await Promise.all([
        fetchUnitProfit(from, to).catch(() => []),
        fetchLabourAgainstRevenue(from, to).catch(() => []),
        fetchCostOfGoods(from, to).catch(() => []),
        fetchPayables().catch(() => []),
        fetchPourCost().catch(() => []),
        fetchHygieneByUnit().catch(() => []),
        fetchProfitTrend(from, to, grain).catch(() => []),
        // Tolerated like the rest: Traceability reads sections somebody may
        // not hold, and one refusal must not blank the other six reports.
        fetchTraceability(from, to).catch(() => []),
        // And Production, which is gated outright: a reader without it gets
        // an empty report rather than a partial one, which the caveats say.
        fetchProduction(from, to).catch(() => []),
        // Maintenance is gated outright too: a reader without it gets an
        // empty report rather than a partial one, which the caveats say.
        fetchMaintenance(from, to).catch(() => []),
        // And Housekeeping, gated the same way.
        fetchHousekeeping(from, to).catch(() => []),
        // HR cases are not section-gated at all: `can_see_case` decides, so
        // an empty result here is normal rather than a refusal.
        fetchHrCases(from, to).catch(() => []),
        // Requests are readable by every member of the venue — no section
        // and no unit — so this one should never come back empty for access.
        fetchRequests(from, to).catch(() => []),
      ]);
      setProfit(p); setLabour(l); setGoods(g);
      setPayables(a); setPour(pc); setHygiene(h); setTrend(tr); setLots(lt);
      setProduction(pr); setMaintenance(mt); setHousekeeping(hk);
      setHrCases(hc); setFrontDoor(rq);
    } catch (err) {
      toast.error("Could not load the reports", { description: said(err) });
    } finally {
      setLoading(false);
    }
  }, [from, to, grain]);

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
      {/* On paper the sheet is one report, titled below. Leaving this in
          gives the document two headings, the first of which describes six
          reports it does not contain. */}
      <div className="print:hidden">
        <PageHeader
          title="Reports"
          description="Figures the venue already computes, in one place. Where a number comes with a caveat, the caveat is beside it — a total that hides what it could not count is worse than no total."
        />
      </div>

      {/*
        * Only on paper. A screen has the venue switcher in the header, the
        * dates in the controls below and the report in the selected tab; a
        * sheet handed to an accountant or a landlord has none of that, and a
        * table of figures with no venue, no period and no date on it is a
        * page somebody has to be told how to read. `print:hidden` removes the
        * chrome and this puts back what the chrome was carrying.
        */}
      <div className="hidden print:block">
        {/* The venue's own mark, where it has one (0128). Beside the name
            rather than instead of it: a logo is recognised by people who
            already know the venue, and this sheet goes to people who may
            not. */}
        <VenueLogo venueName={venue?.name} className="mb-2 h-12" />
        <h1 className="text-xl font-semibold">
          {venue?.name ?? "This venue"} — {REPORT_NAMES[tab] ?? "Reports"}
        </h1>
        {/*
          * All three dates in the same form, and that form is ISO.
          * `toLocaleDateString` gave "11/9/2026" beside a period written
          * "2026-10-10 to 2026-11-09" — one sheet, two date formats, and the
          * short one is read as 11 September by half the world. A document
          * that leaves the room cannot explain itself.
          */}
        <p className="mt-1 text-sm">
          {from} to {to} · printed {printedOn.toISOString().slice(0, 10)}
        </p>
      </div>

      <div className="mt-4">
        <PeriodPicker value={choice} onChange={setChoice} today={today}
                      comparing={comparing} onComparingChange={setComparing} />
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
      <Tabs value={tab} onValueChange={setTab} className="mt-6">
        <TabsList className="print:hidden">
          <TabsTrigger value="trend"><LineChart className="size-4" />Trend</TabsTrigger>
          <TabsTrigger value="profit"><BarChart3 className="size-4" />Profit</TabsTrigger>
          <TabsTrigger value="labour"><Users className="size-4" />Labour</TabsTrigger>
          <TabsTrigger value="goods"><Boxes className="size-4" />Cost of goods</TabsTrigger>
          <TabsTrigger value="payables"><Wallet className="size-4" />Owed</TabsTrigger>
          <TabsTrigger value="pour"><Wine className="size-4" />Pour cost</TabsTrigger>
          <TabsTrigger value="hygiene"><ShieldCheck className="size-4" />Hygiene</TabsTrigger>
          <TabsTrigger value="traceability"><FileSearch className="size-4" />Traceability</TabsTrigger>
          <TabsTrigger value="production"><ChefHat className="size-4" />Production</TabsTrigger>
          <TabsTrigger value="maintenance"><Wrench className="size-4" />Maintenance</TabsTrigger>
          <TabsTrigger value="housekeeping"><BedDouble className="size-4" />Housekeeping</TabsTrigger>
          <TabsTrigger value="hr"><Scale className="size-4" />HR cases</TabsTrigger>
          <TabsTrigger value="requests"><DoorOpen className="size-4" />Requests</TabsTrigger>
        </TabsList>

        <TabsContent value="trend" className="mt-4 space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <p className="max-w-prose text-sm text-muted-foreground">
              Revenue and margin by period. A period that has not finished, or
              that is missing days, is hatched and left out of the change
              figure — the last bar is almost always a week in progress, and
              drawn solid beside the one before it that bar reads as a
              collapse.
            </p>
            <div className="flex items-end gap-3 print:hidden">
            <Button variant="outline" size="sm" onClick={() => window.print()}
                    disabled={trend.length === 0}>
              <Printer aria-hidden="true" />
              Print or save as PDF
            </Button>
            <div className="space-y-2">
              <Label htmlFor="rep-grain">By</Label>
              <select
                id="rep-grain"
                className="h-9 rounded-md border bg-transparent px-3 text-sm"
                value={grain}
                onChange={(e) => setGrain(e.target.value as TrendGrain)}
              >
                <option value="day">Day</option>
                <option value="week">Week</option>
                <option value="month">Month</option>
                <option value="quarter">Quarter</option>
                <option value="year">Year</option>
              </select>
            </div>
            </div>
          </div>

          {trend.length === 0 ? (
            <EmptyState icon={LineChart} title="Nothing to trend yet">
              A trend needs takings recorded over more than one period, and
              reads the same figures as the profit report.
            </EmptyState>
          ) : (
            <div className="grid gap-6 lg:grid-cols-2">
              <section className="space-y-2">
                <h3 className="text-sm font-medium">Net revenue</h3>
                <TrendChart
                  title={`Net revenue by ${grain}`}
                  points={trendPoints(trend, (r) => r.revenueNet)}
                  format={(v) => v.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                />
                <ChangeLine rows={trend} pick={(r) => r.revenueNet}
                            format={(v) => `${v.toFixed(1)}%`} />
              </section>
              <section className="space-y-2">
                <h3 className="text-sm font-medium">Gross profit margin</h3>
                <TrendChart
                  title={`Gross profit percent by ${grain}`}
                  points={trendPoints(trend, (r) => r.grossProfitPercent)}
                  format={(v) => `${v.toFixed(1)}%`}
                />
                <ChangeLine rows={trend} pick={(r) => r.grossProfitPercent}
                            format={(v) => `${v.toFixed(1)} points`} absolute />
              </section>
            </div>
          )}
        </TabsContent>

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

        {/* ── Traceability (0129) ─────────────────────────────────────────── */}
        <TabsContent value="traceability" className="mt-4 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <p className="max-w-prose text-sm text-muted-foreground">
              Every lot received in the period: who it came from, where it went,
              and what the record cannot answer. Article 18 asks a food business
              for one step back and one step forward, and the lines that cannot
              give either are the ones to work from.
            </p>
            <ExportMenu
              disabled={lots.length === 0}
              build={() => ({
                title: "Lot traceability",
                venue: venue?.name ?? "This venue",
                period: period.label,
                printedOn: printedOn.toISOString().slice(0, 10),
                caveats: traceabilityCaveats(lots),
                columns: [
                  { label: "Lot code" }, { label: "Product" },
                  { label: "Supplier" }, { label: "Delivery" },
                  { label: "Received" }, { label: "Expires" },
                  { label: "Date kind" }, { label: "Status" },
                  { label: "Received qty", numeric: true },
                  { label: "Drawn qty", numeric: true },
                  { label: "Movements", numeric: true },
                  { label: "Preparations", numeric: true },
                  { label: "First used" }, { label: "Last used" },
                  { label: "Services" }, { label: "Concerns" },
                ],
                rows: lots.map((r) => [
                  r.lotCode ?? "", r.productName ?? "", r.supplierName ?? "",
                  r.deliveryReference ?? "", r.receivedOn, r.expiresOn ?? "",
                  r.expiryKind ?? "", r.status,
                  r.quantityReceived ?? "", r.quantityOut,
                  r.movements, r.preparations,
                  r.firstUsedOn ?? "", r.lastUsedOn ?? "",
                  r.services ?? "", r.concerns.join("; "),
                ]),
              })}
            />
          </div>

          {/* The report-level notes, on screen and in every exported file. A
              sheet filed for two years has to say what it could not answer. */}
          {traceabilityCaveats(lots).map((c) => (
            <p key={c} className="flex items-start gap-2 rounded-lg border p-3 text-sm text-muted-foreground">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>{c}</span>
            </p>
          ))}

          {lots.length === 0 ? (
            <EmptyState icon={FileSearch} title="No lots received in this period">
              A lot is created when stock is received against a delivery. If
              goods have been received and nothing appears here, either the
              period is wrong or receiving is not recording lots — which is the
              gap this report exists to show.
            </EmptyState>
          ) : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>Lot</TableHead>
                <TableHead>Product</TableHead>
                <TableHead>From</TableHead>
                <TableHead>Received</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead className="text-right">Drawn</TableHead>
                <TableHead>Went to</TableHead>
                <TableHead>Concerns</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {lots.map((r) => (
                  <TableRow key={r.lotId}>
                    <TableCell className="font-medium">
                      {r.lotCode?.trim() || (
                        <span className="text-muted-foreground italic">none</span>
                      )}
                    </TableCell>
                    <TableCell>{r.productName}</TableCell>
                    <TableCell>
                      {r.supplierName ?? (
                        <span className="text-muted-foreground italic">unknown</span>
                      )}
                      {r.deliveryReference && (
                        <span className="text-muted-foreground"> · {r.deliveryReference}</span>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{r.receivedOn}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {r.expiresOn ?? "\u2014"}
                      {r.expiresOn && (
                        <span className="text-muted-foreground">
                          {" "}{r.expiryKind === "USE_BY" ? "use by"
                             : r.expiryKind === "BEST_BEFORE" ? "best before"
                             : "kind not stated"}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.readerSeesMovements ? r.quantityOut : "\u2014"}
                    </TableCell>
                    <TableCell>
                      {!r.readerSeesMovements
                        ? <span className="text-muted-foreground italic">not visible to you</span>
                        : r.movements === 0
                          ? <span className="text-muted-foreground">nothing drawn</span>
                          : `${r.movements} movement${r.movements === 1 ? "" : "s"}` +
                            (r.preparations > 0
                              ? `, ${r.preparations} preparation${r.preparations === 1 ? "" : "s"}`
                              : "") +
                            (r.services ? ` \u00b7 ${r.services}` : "")}
                    </TableCell>
                    <TableCell className="text-sm">
                      {r.concerns.length === 0
                        ? <span className="text-muted-foreground">—</span>
                        : r.concerns.map((c) => (
                            <span key={c} className="block text-status-warning">{c}</span>
                          ))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </TabsContent>

        {/* ── Production (0130) ───────────────────────────────────────────── */}
        <TabsContent value="production" className="mt-4 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <p className="max-w-prose text-sm text-muted-foreground">
              What the kitchen planned against what it actually made, one row
              per service. The three lines worth a sentence at the meeting are
              a service nobody cooked for, preparation made with no sheet
              behind it, and a batch corrected after the fact.
            </p>
            <ExportMenu
              disabled={production.length === 0}
              build={() => ({
                title: "Planned against made",
                venue: venue?.name ?? "This venue",
                period: period.label,
                printedOn: printedOn.toISOString().slice(0, 10),
                caveats: productionCaveats(production),
                columns: [
                  { label: "Date" }, { label: "Service" },
                  { label: "Dishes planned", numeric: true },
                  { label: "Covers planned", numeric: true },
                  { label: "Preparations made", numeric: true },
                  { label: "Batches", numeric: true },
                  { label: "Quantity", numeric: true },
                  { label: "Made by" },
                  { label: "Corrections", numeric: true },
                  { label: "First batch" }, { label: "Last batch" },
                  { label: "Concerns" },
                ],
                rows: production.map((r) => [
                  r.plannedFor,
                  r.service ?? (r.planId == null ? "no plan" : "all day"),
                  r.dishesPlanned, r.coversPlanned,
                  r.preparationsMade, r.batchesMade, r.quantityMade,
                  r.madeBy ?? "", r.corrections,
                  r.firstMadeAt ?? "", r.lastMadeAt ?? "",
                  r.concerns.join("; "),
                ]),
              })}
            />
          </div>

          {/* The report-level notes, on screen and in every exported file. */}
          {productionCaveats(production).map((c) => (
            <p key={c} className="flex items-start gap-2 rounded-lg border p-3 text-sm text-muted-foreground">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>{c}</span>
            </p>
          ))}

          {production.length === 0 ? (
            <EmptyState icon={ChefHat} title="No production planned or recorded">
              A row appears for every prep sheet saved in the period and for
              every day something was made without one. An empty report with
              services in the diary means the kitchen is not recording either —
              or that you do not have Production access, in which case this
              report is empty for you and not for the venue.
            </EmptyState>
          ) : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Service</TableHead>
                <TableHead className="text-right">Planned</TableHead>
                <TableHead className="text-right">Made</TableHead>
                <TableHead className="text-right">Batches</TableHead>
                <TableHead>Worked by</TableHead>
                <TableHead>Concerns</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {production.map((r) => (
                  <TableRow key={r.planId ?? `loose-${r.plannedFor}`}>
                    <TableCell className="whitespace-nowrap font-medium">
                      {r.plannedFor}
                    </TableCell>
                    <TableCell>
                      {r.planId == null
                        ? <span className="text-muted-foreground italic">no plan</span>
                        : r.service?.trim() || (
                            /* 0060: a plan with no service is the whole day. */
                            <span className="text-muted-foreground">all day</span>
                          )}
                    </TableCell>
                    {/* Dishes and covers, which is what a plan is written in. */}
                    <TableCell className="text-right tabular-nums">
                      {r.planId == null ? "\u2014" : (
                        <>
                          {r.dishesPlanned}
                          <span className="text-muted-foreground">
                            {" "}dish{r.dishesPlanned === 1 ? "" : "es"}
                            {r.coversPlanned > 0 && ` \u00b7 ${r.coversPlanned} covers`}
                          </span>
                        </>
                      )}
                    </TableCell>
                    {/* Preparations and batches, which is what a record is
                        written in. Deliberately not differenced: see
                        `productionCaveats`. */}
                    <TableCell className="text-right tabular-nums">
                      {r.preparationsMade === 0
                        ? <span className="text-muted-foreground">nothing</span>
                        : <>
                            {r.preparationsMade}
                            <span className="text-muted-foreground">
                              {" "}prep{r.preparationsMade === 1 ? "" : "s"}
                            </span>
                          </>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.batchesMade === 0 ? "\u2014" : r.batchesMade}
                    </TableCell>
                    <TableCell className="text-sm">
                      {r.madeBy ?? <span className="text-muted-foreground">{"\u2014"}</span>}
                    </TableCell>
                    <TableCell className="text-sm">
                      {r.concerns.length === 0
                        ? <span className="text-muted-foreground">{"\u2014"}</span>
                        : r.concerns.map((c) => (
                            <span key={c} className="block text-status-warning">{c}</span>
                          ))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </TabsContent>

        {/* ── Maintenance (0131) ──────────────────────────────────────────── */}
        <TabsContent value="maintenance" className="mt-4 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <p className="max-w-prose text-sm text-muted-foreground">
              One row per asset with work or a problem, ordered with the
              statutory checks first. Raised and completed are of the period;
              open, overdue and the planned-maintenance figures are as of
              today, because an open job is open now.
            </p>
            <ExportMenu
              disabled={maintenance.length === 0}
              build={() => ({
                title: "What broke, and what was never checked",
                venue: venue?.name ?? "This venue",
                period: period.label,
                printedOn: printedOn.toISOString().slice(0, 10),
                caveats: maintenanceCaveats(maintenance),
                columns: [
                  { label: "Asset" }, { label: "Name" }, { label: "Category" },
                  { label: "Criticality" }, { label: "State" },
                  { label: "Where" },
                  { label: "Raised (period)", numeric: true },
                  { label: "Completed (period)", numeric: true },
                  { label: "Open now", numeric: true },
                  { label: "Overdue now", numeric: true },
                  { label: "Emergencies", numeric: true },
                  { label: "Reactive", numeric: true },
                  { label: "Planned", numeric: true },
                  { label: "Downtime (min)", numeric: true },
                  { label: "Labour (min)", numeric: true },
                  { label: "Avg days to close", numeric: true },
                  { label: "Oldest open (days)", numeric: true },
                  { label: "Completed unverified", numeric: true },
                  { label: "Plans", numeric: true },
                  { label: "Plans overdue", numeric: true },
                  { label: "Statutory overdue", numeric: true },
                  { label: "Concerns" },
                ],
                rows: maintenance.map((r) => [
                  r.assetCode ?? "", r.assetName ?? "no asset",
                  r.category ?? "", r.criticality ?? "", r.assetStatus ?? "",
                  r.locationName ?? "",
                  r.raised, r.completed, r.stillOpen, r.overdue,
                  r.emergencies, r.reactive, r.planned,
                  r.downtimeMinutes, r.labourMinutes,
                  r.avgDaysToComplete ?? "", r.oldestOpenDays ?? "",
                  r.completedNotVerified,
                  r.plansActive, r.plansOverdue, r.statutoryOverdue,
                  r.concerns.join("; "),
                ]),
              })}
            />
          </div>

          {maintenanceCaveats(maintenance).map((c) => (
            <p key={c} className="flex items-start gap-2 rounded-lg border p-3 text-sm text-muted-foreground">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>{c}</span>
            </p>
          ))}

          {maintenance.length === 0 ? (
            <EmptyState icon={Wrench} title="Nothing on the maintenance agenda">
              An asset appears here when it has work in the period, a planned
              check past its date, or a state other than in service. Nothing
              at all means either a quiet period or no Maintenance access —
              this report is gated, so an empty one may be empty only for you.
            </EmptyState>
          ) : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>Asset</TableHead>
                <TableHead>Where</TableHead>
                <TableHead className="text-right">Period</TableHead>
                <TableHead className="text-right">Open now</TableHead>
                <TableHead className="text-right">Downtime</TableHead>
                <TableHead>Concerns</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {maintenance.map((r) => (
                  <TableRow key={r.assetId ?? "no-asset"}>
                    <TableCell>
                      {r.assetId == null ? (
                        <span className="text-muted-foreground italic">no asset</span>
                      ) : (
                        <>
                          <span className="font-medium">{r.assetName}</span>
                          <span className="block text-xs text-muted-foreground">
                            {r.assetCode}
                            {r.criticality === "CRITICAL" && " \u00b7 critical"}
                            {r.assetStatus !== "IN_SERVICE" &&
                              ` \u00b7 ${r.assetStatus === "OUT_OF_SERVICE"
                                ? "out of service" : "degraded"}`}
                          </span>
                        </>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {r.locationName ?? <span>{"\u2014"}</span>}
                    </TableCell>
                    {/* Of the period. */}
                    <TableCell className="text-right tabular-nums text-sm">
                      {r.raised} raised
                      <span className="block text-xs text-muted-foreground">
                        {r.completed} completed
                      </span>
                    </TableCell>
                    {/* As of today, which is why it is a separate column and
                        not a continuation of the one before it. */}
                    <TableCell className="text-right tabular-nums text-sm">
                      {r.stillOpen === 0
                        ? <span className="text-muted-foreground">none</span>
                        : <>
                            {r.stillOpen}
                            {r.oldestOpenDays != null && (
                              <span className="block text-xs text-muted-foreground">
                                oldest {r.oldestOpenDays}d
                              </span>
                            )}
                          </>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm">
                      {r.downtimeMinutes === 0
                        ? <span className="text-muted-foreground">{"\u2014"}</span>
                        : `${Math.round(r.downtimeMinutes / 60 * 10) / 10}h`}
                    </TableCell>
                    <TableCell className="text-sm">
                      {r.concerns.length === 0
                        ? <span className="text-muted-foreground">{"\u2014"}</span>
                        : r.concerns.map((c) => (
                            <span
                              key={c}
                              className={
                                /* A statutory breach is not the same kind of
                                   thing as a late filter change, and the
                                   colour is the only place the page says so
                                   at a glance. */
                                c.includes("statutory")
                                  ? "block text-status-danger"
                                  : "block text-status-warning"
                              }
                            >{c}</span>
                          ))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </TabsContent>

        {/* ── Housekeeping (0132) ─────────────────────────────────────────── */}
        <TabsContent value="housekeeping" className="mt-4 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <p className="max-w-prose text-sm text-muted-foreground">
              One row per room worked, ordered by what failed inspection.
              Rooms out of service are listed although they have no tasks —
              they have none because they are out of service, and that is
              usually the line worth raising.
            </p>
            <ExportMenu
              disabled={housekeeping.length === 0}
              build={() => ({
                title: "The rooms, and the ones nobody checked",
                venue: venue?.name ?? "This venue",
                period: period.label,
                printedOn: printedOn.toISOString().slice(0, 10),
                caveats: housekeepingCaveats(housekeeping),
                columns: [
                  { label: "Room" }, { label: "Type" }, { label: "Floor" },
                  { label: "State" }, { label: "Occupancy" },
                  { label: "Days in state", numeric: true },
                  { label: "Tasks", numeric: true },
                  { label: "Finished", numeric: true },
                  { label: "Unfinished", numeric: true },
                  { label: "Sent back", numeric: true },
                  { label: "Awaiting inspection", numeric: true },
                  { label: "Inspections", numeric: true },
                  { label: "Failed", numeric: true },
                  { label: "Time allowed (min)", numeric: true },
                  { label: "Time taken (min)", numeric: true },
                  { label: "Attendants", numeric: true },
                  { label: "Concerns" },
                ],
                rows: housekeeping.map((r) => [
                  r.roomNumber ?? "no room", r.roomType ?? "", r.floor ?? "",
                  r.roomState ?? "", r.occupancy ?? "",
                  r.daysInState ?? "",
                  r.tasks, r.finished, r.unfinished, r.rejected,
                  r.awaitingInspection, r.inspections, r.inspectionsFailed,
                  r.standardMinutes, r.actualMinutes, r.attendants,
                  r.concerns.join("; "),
                ]),
              })}
            />
          </div>

          {housekeepingCaveats(housekeeping).map((c) => (
            <p key={c} className="flex items-start gap-2 rounded-lg border p-3 text-sm text-muted-foreground">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>{c}</span>
            </p>
          ))}

          {housekeeping.length === 0 ? (
            <EmptyState icon={BedDouble} title="No rooms worked in this period">
              A room appears here when it was cleaned in the period, or when it
              is out of service. Nothing at all means either no sheets were
              worked or you do not have Housekeeping access — this report is
              gated, so an empty one may be empty only for you.
            </EmptyState>
          ) : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>Room</TableHead>
                <TableHead>State</TableHead>
                <TableHead className="text-right">Cleans</TableHead>
                <TableHead className="text-right">Inspected</TableHead>
                <TableHead className="text-right">Time</TableHead>
                <TableHead>Concerns</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {housekeeping.map((r) => (
                  <TableRow key={r.roomId ?? "no-room"}>
                    <TableCell>
                      {r.roomId == null ? (
                        <span className="text-muted-foreground italic">no room</span>
                      ) : (
                        <>
                          <span className="font-medium">{r.roomNumber}</span>
                          <span className="block text-xs text-muted-foreground">
                            {r.roomType}
                            {r.floor && ` \u00b7 floor ${r.floor}`}
                          </span>
                        </>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      {r.roomState == null
                        ? <span className="text-muted-foreground">{"\u2014"}</span>
                        : <>
                            {r.roomState.toLowerCase().replace(/_/g, " ")}
                            {r.daysInState != null && r.daysInState > 0 && (
                              <span className="block text-xs text-muted-foreground">
                                {r.daysInState}d
                              </span>
                            )}
                          </>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm">
                      {r.tasks === 0
                        ? <span className="text-muted-foreground">none</span>
                        : <>
                            {r.finished} of {r.tasks}
                            {r.unfinished > 0 && (
                              <span className="block text-xs text-muted-foreground">
                                {r.unfinished} unfinished
                              </span>
                            )}
                          </>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm">
                      {r.inspections === 0
                        ? <span className="text-muted-foreground">{"\u2014"}</span>
                        : <>
                            {r.inspections - r.inspectionsFailed} passed
                            {r.inspectionsFailed > 0 && (
                              <span className="block text-xs text-status-warning">
                                {r.inspectionsFailed} failed
                              </span>
                            )}
                          </>}
                    </TableCell>
                    {/*
                      Time taken against time allowed, as a pair rather than a
                      ratio: a percentage with no denominator beside it is the
                      number that gets somebody disciplined.
                    */}
                    <TableCell className="text-right tabular-nums text-sm">
                      {r.standardMinutes === 0
                        ? <span className="text-muted-foreground">{"\u2014"}</span>
                        : <>
                            {Math.round(r.actualMinutes / 60 * 10) / 10}h
                            <span className="block text-xs text-muted-foreground">
                              of {Math.round(r.standardMinutes / 60 * 10) / 10}h allowed
                            </span>
                          </>}
                    </TableCell>
                    <TableCell className="text-sm">
                      {r.concerns.length === 0
                        ? <span className="text-muted-foreground">{"\u2014"}</span>
                        : r.concerns.map((c) => (
                            <span
                              key={c}
                              className={
                                c.startsWith("out of service")
                                  ? "block text-status-danger"
                                  : c.startsWith("not a room")
                                    ? "block text-muted-foreground"
                                    : "block text-status-warning"
                              }
                            >{c}</span>
                          ))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </TabsContent>

        {/* ── HR cases (0133) ─────────────────────────────────────────────── */}
        <TabsContent value="hr" className="mt-4 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <p className="max-w-prose text-sm text-muted-foreground">
              The shape of the caseload: how many, of what kind, how old, and
              how many were closed without anybody recording what was decided.
              No names and no summaries — this sheet leaves the system as a
              file and the case does not.
            </p>
            <ExportMenu
              disabled={hrCases.length === 0}
              build={() => ({
                title: "The caseload",
                venue: venue?.name ?? "This venue",
                period: period.label,
                printedOn: printedOn.toISOString().slice(0, 10),
                caveats: hrCasesCaveats(hrCases),
                columns: [
                  { label: "Reference" }, { label: "Kind" }, { label: "Status" },
                  { label: "Opened" }, { label: "Closed" },
                  { label: "Days", numeric: true },
                  { label: "Participants", numeric: true },
                  { label: "Last changed" },
                  { label: "Outcome recorded" },
                  { label: "Concerns" },
                ],
                rows: hrCases.map((r) => [
                  r.reference, r.kind, r.status, r.openedOn, r.closedOn ?? "",
                  r.daysOpen, r.participants, r.lastChangedOn ?? "",
                  r.hasOutcome ? "yes" : "no",
                  r.concerns.join("; "),
                ]),
              })}
            />
          </div>

          {hrCasesCaveats(hrCases).map((c) => (
            <p key={c} className="flex items-start gap-2 rounded-lg border p-3 text-sm text-muted-foreground">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>{c}</span>
            </p>
          ))}

          {hrCases.length === 0 ? (
            <EmptyState icon={Scale} title="No cases you can see in this period">
              HR cases are not governed by section access. A case is visible to
              the people named on it and to the venue's owner, so an empty
              report here does not mean the venue has no cases — it means none
              of them are yours.
            </EmptyState>
          ) : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>Case</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Age</TableHead>
                <TableHead className="text-right">On it</TableHead>
                <TableHead>Outcome</TableHead>
                <TableHead>Concerns</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {hrCases.map((r) => (
                  <TableRow key={r.caseId}>
                    <TableCell>
                      <span className="font-medium">{r.reference}</span>
                      <span className="block text-xs text-muted-foreground">
                        {r.kind.toLowerCase()}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm">
                      {r.status.toLowerCase().replace(/_/g, " ")}
                      <span className="block text-xs text-muted-foreground">
                        {r.closedOn ? `closed ${r.closedOn}` : `opened ${r.openedOn}`}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm">
                      {r.daysOpen}d
                      {/* Only meaningful while it is still running. */}
                      {r.closedOn == null && r.lastChangedOn != null && (
                        <span className="block text-xs text-muted-foreground">
                          touched {r.lastChangedOn}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm">
                      {r.participants}
                    </TableCell>
                    <TableCell className="text-sm">
                      {r.closedOn == null
                        ? <span className="text-muted-foreground">{"\u2014"}</span>
                        : r.hasOutcome
                          ? <span className="text-muted-foreground">recorded</span>
                          : <span className="text-status-danger">none</span>}
                    </TableCell>
                    <TableCell className="text-sm">
                      {r.concerns.length === 0
                        ? <span className="text-muted-foreground">{"\u2014"}</span>
                        : r.concerns.map((c) => (
                            <span
                              key={c}
                              className={
                                c.startsWith("closed with no outcome")
                                  ? "block text-status-danger"
                                  : "block text-status-warning"
                              }
                            >{c}</span>
                          ))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </TabsContent>

        {/* ── Requests (0134) ─────────────────────────────────────────────── */}
        <TabsContent value="requests" className="mt-4 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <p className="max-w-prose text-sm text-muted-foreground">
              One row per kind of request, because the promise is made by the
              kind rather than by the department. Still waiting and answered
              late are kept apart: the first is a list of people, the second
              is history.
            </p>
            <ExportMenu
              disabled={frontDoor.length === 0}
              build={() => ({
                title: "The front door",
                venue: venue?.name ?? "This venue",
                period: period.label,
                printedOn: printedOn.toISOString().slice(0, 10),
                caveats: requestsCaveats(frontDoor),
                columns: [
                  { label: "Kind" }, { label: "Goes to" },
                  { label: "Promise (hours)", numeric: true },
                  { label: "Raised", numeric: true },
                  { label: "Acknowledged", numeric: true },
                  { label: "Resolved", numeric: true },
                  { label: "Rejected", numeric: true },
                  { label: "Became work orders", numeric: true },
                  { label: "Answered late", numeric: true },
                  { label: "No promise", numeric: true },
                  { label: "Open now", numeric: true },
                  { label: "Overdue now", numeric: true },
                  { label: "Never acknowledged", numeric: true },
                  { label: "Avg hours to answer", numeric: true },
                  { label: "Avg hours to resolve", numeric: true },
                  { label: "Oldest open (days)", numeric: true },
                  { label: "Concerns" },
                ],
                rows: frontDoor.map((r) => [
                  r.typeName, r.unitName ?? "",
                  r.respondWithinHours ?? "",
                  r.raised, r.acknowledged, r.resolved, r.rejected, r.converted,
                  r.answeredLate, r.noPromise, r.stillOpen, r.overdueNow,
                  r.neverAcknowledged,
                  r.avgHoursToAcknowledge ?? "", r.avgHoursToResolve ?? "",
                  r.oldestOpenDays ?? "",
                  r.concerns.join("; "),
                ]),
              })}
            />
          </div>

          {requestsCaveats(frontDoor).map((c) => (
            <p key={c} className="flex items-start gap-2 rounded-lg border p-3 text-sm text-muted-foreground">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>{c}</span>
            </p>
          ))}

          {frontDoor.length === 0 ? (
            <EmptyState icon={DoorOpen} title="Nothing came through the front door">
              Every member of the venue can read every request, so unlike the
              other reports here an empty one is not about your access. Either
              nothing was raised in this period, or nothing is open.
            </EmptyState>
          ) : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>Kind</TableHead>
                <TableHead>Goes to</TableHead>
                <TableHead className="text-right">Raised</TableHead>
                <TableHead className="text-right">Answered</TableHead>
                <TableHead className="text-right">Waiting</TableHead>
                <TableHead>Concerns</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {frontDoor.map((r) => (
                  <TableRow key={r.typeId}>
                    <TableCell>
                      <span className="font-medium">{r.typeName}</span>
                      <span className="block text-xs text-muted-foreground">
                        {r.respondWithinHours == null
                          ? "no promise"
                          : `within ${r.respondWithinHours}h`}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {r.unitName ?? <span>{"\u2014"}</span>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm">
                      {r.raised}
                      {r.rejected > 0 && (
                        <span className="block text-xs text-muted-foreground">
                          {r.rejected} rejected
                        </span>
                      )}
                    </TableCell>
                    {/* Of the period: how fast, and how many too slow. */}
                    <TableCell className="text-right tabular-nums text-sm">
                      {r.avgHoursToAcknowledge == null
                        ? <span className="text-muted-foreground">{"\u2014"}</span>
                        : <>
                            {r.avgHoursToAcknowledge}h
                            {r.answeredLate > 0 && (
                              <span className="block text-xs text-status-warning">
                                {r.answeredLate} late
                              </span>
                            )}
                          </>}
                    </TableCell>
                    {/* As of today: people, not history. */}
                    <TableCell className="text-right tabular-nums text-sm">
                      {r.stillOpen === 0
                        ? <span className="text-muted-foreground">none</span>
                        : <>
                            {r.stillOpen}
                            {r.overdueNow > 0 && (
                              <span className="block text-xs text-status-danger">
                                {r.overdueNow} past the promise
                              </span>
                            )}
                          </>}
                    </TableCell>
                    <TableCell className="text-sm">
                      {r.concerns.length === 0
                        ? <span className="text-muted-foreground">{"\u2014"}</span>
                        : r.concerns.map((c) => (
                            <span
                              key={c}
                              className={
                                c.includes("still waiting")
                                  ? "block text-status-danger"
                                  : "block text-status-warning"
                              }
                            >{c}</span>
                          ))}
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

/**
 * Rows as bars, with incompleteness carried through.
 *
 * `incomplete` is the union of two different things — the period has not
 * finished, and the period is missing days — because to a reader they mean
 * the same thing: do not compare this bar to the others.
 */
function trendPoints(
  rows: TrendRow[], pick: (r: TrendRow) => number | null,
): TrendPoint[] {
  return rows.map((r) => ({
    label: r.periodStart,
    value: pick(r),
    incomplete: !isComparable(r),
    note: r.isOpen
      ? "still running"
      : `${r.daysWithData} of ${r.daysInPeriod} days`,
  }));
}

/**
 * The change between the last two periods that can honestly be compared.
 *
 * Not the last two rows. The final period is nearly always in progress, and
 * a figure comparing a part-week to a whole one is the exact mistake the
 * hatching exists to prevent — so the comparison walks back to the last two
 * complete periods and says so when it cannot find them.
 */
function ChangeLine({ rows, pick, format, absolute }: {
  rows: TrendRow[];
  pick: (r: TrendRow) => number | null;
  format: (v: number) => string;
  absolute?: boolean;
}) {
  const complete = rows.filter(isComparable).filter((r) => pick(r) !== null);
  if (complete.length < 2) {
    return (
      <p className="text-xs text-muted-foreground">
        Not enough finished periods to compare yet.
      </p>
    );
  }
  const latest = pick(complete[complete.length - 1])!;
  const before = pick(complete[complete.length - 2])!;
  const change = absolute
    ? latest - before
    : before === 0 ? null : ((latest - before) / Math.abs(before)) * 100;

  if (change === null) {
    return (
      <p className="text-xs text-muted-foreground">
        The previous period was nothing, so there is no change to express.
      </p>
    );
  }

  return (
    <p className="text-xs text-muted-foreground">
      {change >= 0 ? "Up" : "Down"} {format(Math.abs(change))} on the period
      before, comparing the last two that finished.
    </p>
  );
}

/*
 * What the printed sheet calls itself. Keyed by the tab value, because the
 * tab labels are three words wide to fit a tab strip and a document's title
 * is not competing for horizontal space.
 */
const REPORT_NAMES: Record<string, string> = {
  trend: "Revenue and margin trend",
  profit: "Profit by outlet",
  labour: "Labour against revenue",
  goods: "Cost of goods",
  payables: "Owed by supplier",
  pour: "Pour cost",
  hygiene: "Hygiene by outlet",
  traceability: "Lot traceability",
  production: "Planned against made",
  maintenance: "What broke, and what was never checked",
  housekeeping: "The rooms, and the ones nobody checked",
  hr: "The caseload",
  requests: "The front door",
};

function ReportHead({ blurb, empty, onExport }: {
  blurb: string; empty: boolean; onExport: () => void;
}) {
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        {/*
          * The blurb prints. It is where the report says what it excludes —
          * "stock with no unit on it is excluded rather than spread" — and a
          * PDF of the table without it is a number with no provenance, which
          * is the thing this system is built not to produce.
          */}
        <p className="max-w-prose text-sm text-muted-foreground">{blurb}</p>
        <div className="flex gap-2 print:hidden">
          <Button variant="outline" size="sm" onClick={onExport} disabled={empty}>
            <Download aria-hidden="true" />
            Download CSV
          </Button>
          {/*
            * PDF through the browser's own print dialog, which every desktop
            * browser can save to a file. No dependency, no server, and the
            * sheet is exactly what the screen shows — including the caveats,
            * which a generated PDF would have had to be told about twice.
            */}
          <Button variant="outline" size="sm" onClick={() => window.print()}
                  disabled={empty}>
            <Printer aria-hidden="true" />
            Print or save as PDF
          </Button>
        </div>
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
