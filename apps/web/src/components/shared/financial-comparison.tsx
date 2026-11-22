// ---------------------------------------------------------------------------
// The money, this period against the last and against a year ago
// ---------------------------------------------------------------------------
// The dashboard's own brief is "the CEO looking at the full scope of the
// business". This is that first glance: the venue P&L for a period you pick,
// beside the period before it and the same period a year ago, with the
// variance said out loud. It is the one thing a Simphony dashboard leads with
// and CCOS computed everything for and never showed.
//
// The figures come from `financial_summary` (0136), one call per range. The
// ranges come from the period engine, so "the same period last year" is
// decided in one tested place. The variance is `variancePct`, which refuses
// to invent a trend against a period that had no figure.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { TriangleAlert } from "lucide-react";

import {
  PeriodPicker,
  type PeriodChoice,
} from "@/components/reports/period-picker";
import { financialRanges, variancePct } from "@/engine/financial-compare";
import {
  fetchFinancialSummary,
  type FinancialSummaryRow,
} from "@/data/reports";
import { CurrencyDisplay } from "@/components/shared/currency-display";
import { useToday } from "@/lib/today";
import {
  Card, CardContent, CardHeader, CardTitle,
} from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

type Trio = {
  current: FinancialSummaryRow | null;
  previous: FinancialSummaryRow | null;
  yearAgo: FinancialSummaryRow | null;
};

/** A variance cell: the percentage, coloured by direction, or a dash. */
function Delta({ now, then, goodWhenUp = true }: {
  now: number; then: number; goodWhenUp?: boolean;
}) {
  const v = variancePct(now, then);
  if (v === null) return <span className="text-muted-foreground">—</span>;
  const up = v > 0;
  const good = up === goodWhenUp;
  return (
    <span className={v === 0
      ? "text-muted-foreground"
      : good ? "text-status-good" : "text-status-warning"}>
      {up ? "+" : ""}{v.toFixed(1)}%
    </span>
  );
}

export function FinancialComparison({ maySeeMoney }: { maySeeMoney: boolean }) {
  const today = useToday();
  const [choice, setChoice] = useState<PeriodChoice>(
    { mode: "PRESET", kind: "MONTH", offset: 0 },
  );
  // The picker carries a "compare with last year" toggle for the Reports
  // page; here the comparison is always shown, so the toggle is wired but its
  // value is not read.
  const [comparing, setComparing] = useState(true);
  const ranges = useMemo(() => financialRanges(choice, today), [choice, today]);
  const [trio, setTrio] = useState<Trio>({ current: null, previous: null, yearAgo: null });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    setLoading(true);
    // Tolerated separately: a reader with REVENUE but not PAY should see
    // revenue and a blank labour line, not an empty panel.
    void Promise.all([
      fetchFinancialSummary(ranges.current.from, ranges.current.to).catch(() => null),
      fetchFinancialSummary(ranges.previous.from, ranges.previous.to).catch(() => null),
      fetchFinancialSummary(ranges.yearAgo.from, ranges.yearAgo.to).catch(() => null),
    ]).then(([current, previous, yearAgo]) => {
      if (live) { setTrio({ current, previous, yearAgo }); setLoading(false); }
    });
    return () => { live = false; };
  }, [ranges]);

  // Money is money: a reader without it does not get a P&L panel at all.
  if (!maySeeMoney) return null;

  const c = trio.current;
  const p = trio.previous;
  const y = trio.yearAgo;

  const money = (n: number | null | undefined) =>
    n == null ? <span className="text-muted-foreground">—</span>
      : <CurrencyDisplay value={String(n)} />;
  const pct = (n: number | null | undefined) =>
    n == null ? <span className="text-muted-foreground">—</span>
      : <span className="tabular-nums">{n.toFixed(1)}%</span>;

  /** Each row: label, the three figures, and whether up is good. */
  const rows: {
    label: string;
    render: (r: FinancialSummaryRow | null) => ReactNode;
    value: (r: FinancialSummaryRow | null) => number | null;
    goodWhenUp?: boolean;
  }[] = [
    { label: "Net revenue", render: (r) => money(r?.netRevenue), value: (r) => r?.netRevenue ?? null },
    { label: "Covers", render: (r) => r ? <span className="tabular-nums">{r.covers}</span> : money(null), value: (r) => r?.covers ?? null },
    { label: "Average spend", render: (r) => money(r?.avgSpend), value: (r) => r?.avgSpend ?? null },
    { label: "Gross profit", render: (r) => money(r?.grossProfit), value: (r) => r?.grossProfit ?? null },
    { label: "Gross profit %", render: (r) => pct(r?.grossProfitPercent), value: (r) => r?.grossProfitPercent ?? null },
    { label: "Cost of goods", render: (r) => money(r?.goodsCost), value: (r) => r?.goodsCost ?? null, goodWhenUp: false },
    { label: "Labour cost", render: (r) => money(r?.labourCost), value: (r) => r?.labourCost ?? null, goodWhenUp: false },
    { label: "Labour %", render: (r) => pct(r?.labourPercent), value: (r) => r?.labourPercent ?? null, goodWhenUp: false },
  ];

  const caveats: string[] = [];
  if (ranges.yearAgoCaveats.length) caveats.push(...ranges.yearAgoCaveats);
  if (c && c.daysWithData < ranges.current.days) {
    caveats.push(
      `${c.daysWithData} of ${ranges.current.days} days in this period have figures; ` +
      `the rest were never recorded, not zero.`,
    );
  }
  if (c && c.unattributedGoodsCost > 0) {
    caveats.push("Some cost of goods could not be attributed to an outlet; it is in the venue total but not any one department.");
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
        <CardTitle className="text-base">The money — {ranges.current.label}</CardTitle>
        <PeriodPicker value={choice} onChange={setChoice} today={today}
          comparing={comparing} onComparingChange={setComparing} />
      </CardHeader>
      <CardContent className="space-y-3">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Figure</TableHead>
              <TableHead className="text-right">{ranges.current.label}</TableHead>
              <TableHead className="text-right">vs previous</TableHead>
              <TableHead className="text-right">vs a year ago</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.label}>
                <TableCell className="font-medium">{row.label}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {loading ? "…" : row.render(c)}
                </TableCell>
                <TableCell className="text-right tabular-nums text-sm">
                  {loading || !c || !p ? "—" : (
                    <>
                      {row.render(p)}{" · "}
                      <Delta
                        now={row.value(c) ?? 0}
                        then={row.value(p) ?? 0}
                        goodWhenUp={row.goodWhenUp ?? true}
                      />
                    </>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums text-sm">
                  {loading || !c || !y ? "—" : (
                    <>
                      {row.render(y)}{" · "}
                      <Delta
                        now={row.value(c) ?? 0}
                        then={row.value(y) ?? 0}
                        goodWhenUp={row.goodWhenUp ?? true}
                      />
                    </>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {caveats.map((cv) => (
          <p key={cv} className="flex items-start gap-2 text-xs text-muted-foreground">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <span>{cv}</span>
          </p>
        ))}
      </CardContent>
    </Card>
  );
}
