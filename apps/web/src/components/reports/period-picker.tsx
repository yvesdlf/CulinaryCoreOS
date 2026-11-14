// ---------------------------------------------------------------------------
// Which stretch of time, and what it is being held against
// ---------------------------------------------------------------------------
// One control for every report. A manager asks for "last month" or "this year
// so far", not for a pair of dates — and when they do want a pair, they still
// want it, so the custom range stays.
//
// The comparison is the part worth being careful about. "This time last year"
// is a different question for a week than for a month (see `periods.ts`), and
// the answer is shown as a sentence rather than left to be inferred from two
// dates: a reader comparing two numbers is entitled to know what was held
// constant, and a picker that silently chose is a picker that misleads.
// ---------------------------------------------------------------------------

import { useMemo } from "react";
import { CalendarRange, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  periodContaining, sameTimeLastYear, shiftDays, clipToElapsed, daysInclusive,
  type Period, type PeriodKind, type Comparison,
} from "@/engine/periods";

export type PeriodChoice =
  | { mode: "PRESET"; kind: PeriodKind; offset: number }
  | { mode: "CUSTOM"; from: string; to: string };

const PRESETS: { label: string; kind: PeriodKind; offset: number }[] = [
  { label: "Today", kind: "DAY", offset: 0 },
  { label: "Yesterday", kind: "DAY", offset: -1 },
  { label: "This week", kind: "WEEK", offset: 0 },
  { label: "Last week", kind: "WEEK", offset: -1 },
  { label: "This month", kind: "MONTH", offset: 0 },
  { label: "Last month", kind: "MONTH", offset: -1 },
  { label: "This quarter", kind: "QUARTER", offset: 0 },
  { label: "Year to date", kind: "YTD", offset: 0 },
  { label: "Last year", kind: "YEAR", offset: -1 },
];

/** The anchor date for a preset `offset` periods back from today. */
function anchorFor(kind: PeriodKind, offset: number, today: string): string {
  if (offset === 0) return today;
  if (kind === "DAY") return shiftDays(today, offset);
  if (kind === "WEEK") return shiftDays(today, offset * 7);
  /*
   * Months, quarters and years step by landing on the day before the current
   * period begins, and letting `periodContaining` find the edges from there.
   * Arithmetic on month numbers is where the off-by-one December bugs live.
   */
  let anchor = today;
  for (let i = 0; i < Math.abs(offset); i += 1) {
    anchor = shiftDays(periodContaining(kind, anchor, today).from, -1);
  }
  return anchor;
}

export function resolvePeriod(choice: PeriodChoice, today: string): Period {
  if (choice.mode === "CUSTOM") {
    return {
      kind: "DAY",
      from: choice.from,
      to: choice.to,
      label: `${choice.from} to ${choice.to}`,
      complete: choice.to < today,
      days: Math.max(1, daysInclusive(choice.from, choice.to)),
    };
  }
  return periodContaining(choice.kind, anchorFor(choice.kind, choice.offset, today), today);
}

export function PeriodPicker({
  value, onChange, today, comparing, onComparingChange,
}: {
  value: PeriodChoice;
  onChange: (next: PeriodChoice) => void;
  today: string;
  comparing: boolean;
  onComparingChange: (next: boolean) => void;
}) {
  const period = useMemo(() => resolvePeriod(value, today), [value, today]);
  const comparison: Comparison | null = useMemo(
    () => (comparing ? sameTimeLastYear(period, today) : null),
    [comparing, period, today],
  );
  const clipped = useMemo(
    () => (comparison ? clipToElapsed(comparison.previous, period, today) : null),
    [comparison, period, today],
  );

  return (
    <div className="space-y-3 print:hidden">
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((p) => {
          const active = value.mode === "PRESET"
            && value.kind === p.kind && value.offset === p.offset;
          return (
            <Button
              key={p.label}
              size="sm"
              variant={active ? "secondary" : "ghost"}
              onClick={() => onChange({ mode: "PRESET", kind: p.kind, offset: p.offset })}
            >
              {p.label}
            </Button>
          );
        })}
        <Button
          size="sm"
          variant={value.mode === "CUSTOM" ? "secondary" : "ghost"}
          onClick={() => onChange({ mode: "CUSTOM", from: period.from, to: period.to })}
        >
          <CalendarRange aria-hidden="true" />
          Custom
        </Button>
      </div>

      {value.mode === "CUSTOM" && (
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-2">
            <Label htmlFor="period-from">From</Label>
            <Input id="period-from" type="date" className="w-44" value={value.from}
                   onChange={(e) => onChange({ ...value, from: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="period-to">To</Label>
            <Input id="period-to" type="date" className="w-44" value={value.to}
                   onChange={(e) => onChange({ ...value, to: e.target.value })} />
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm">
          <strong>{period.label}</strong>{" "}
          <span className="text-muted-foreground">
            · {period.from} to {period.to} · {period.days}{" "}
            {period.days === 1 ? "day" : "days"}
            {!period.complete && " · still running"}
          </span>
        </span>
        <Button size="sm" variant={comparing ? "secondary" : "ghost"}
                onClick={() => onComparingChange(!comparing)}>
          Compare with last year
        </Button>
      </div>

      {comparison && (
        <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
          <p>
            Against <strong>{comparison.previous.label}</strong>{" "}
            <span className="text-muted-foreground">
              ({comparison.previous.from} to {comparison.previous.to}), matched by{" "}
              {comparison.basis === "WEEKDAY"
                ? "trading day — 52 weeks back, so a Saturday meets a Saturday"
                : "the calendar, so the season is held constant"}.
            </span>
          </p>
          {clipped && clipped.days !== comparison.previous.days && (
            <p className="mt-1 text-muted-foreground">
              Comparing like with like means {clipped.label.toLowerCase()} —{" "}
              {clipped.from} to {clipped.to}.
            </p>
          )}
          {comparison.caveats.map((c) => (
            <p key={c} className="mt-1 flex items-start gap-2 text-muted-foreground">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              <span>{c}</span>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
