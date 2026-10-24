// ---------------------------------------------------------------------------
// What next week probably looks like, and how wrong it was last week
// ---------------------------------------------------------------------------
// A tab on Sales rather than a page of its own: the forecast is made of the
// takings this screen already owns, and the sidebar is the UI review's first
// complaint.
//
// The design brief for 0107 was that the method stay explainable, and most of
// the care on this screen is in holding to that after the number reaches a
// person. So:
//
//   Every figure says what it was built from. "106 covers" alone invites
//   either blind trust or dismissal; "106 covers, averaged over 3 same
//   weekdays in the last 6 weeks" can be argued with, which is the only way
//   a forecast earns its keep.
//
//   Thin evidence is labelled rather than hidden. A forecast from one past
//   day is a guess with a decimal point on it. Suppressing it would be worse
//   — the row would silently vanish and nobody would know a figure was
//   missing — so it shows with the sample size beside it.
//
//   No forecast and a forecast of zero look completely different. An outlet
//   with no trading history on that weekday has no row at all and is listed
//   separately as such, because a confident zero on a roster is how a shift
//   goes unstaffed.
//
//   The accuracy column is past tense only. It appears once somebody has
//   recorded what actually happened, and until then the cell says so rather
//   than showing a dash that reads like "no error".
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, ChartLine, Plus, Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { EmptyState } from "@/components/shared/empty-state";
import { CurrencyDisplay } from "@/components/shared/currency-display";
import { StatusChip } from "@/components/shared/status-chip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useCanWriteSection } from "@/stores/access-store";
import { fetchBusinessUnits, type BusinessUnit } from "@/data/purchasing";
import {
  fetchForecasts, fetchKnownEvents, buildForecast,
  addKnownEvent, removeKnownEvent, recordActual,
  type ForecastRow, type KnownEvent,
} from "@/data/forecast";

function said(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  return text.replace(/^\w+(\([^)]*\))? failed: /, "");
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** A date that reads like a day of the week, because that is the method. */
function longDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString(undefined, {
    weekday: "long", day: "numeric", month: "long",
  });
}

function covers(n: number | null): string {
  return n === null ? "—" : n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export function ForecastPanel() {
  const canWrite = useCanWriteSection("REVENUE");
  const [units, setUnits] = useState<BusinessUnit[]>([]);
  const [rows, setRows] = useState<ForecastRow[]>([]);
  const [events, setEvents] = useState<KnownEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [forDate, setForDate] = useState(today());
  const [eventOpen, setEventOpen] = useState(false);
  const [evName, setEvName] = useState("");
  const [evDate, setEvDate] = useState(today());
  const [evUnit, setEvUnit] = useState("");
  const [evKind, setEvKind] = useState<"override" | "extra">("extra");
  const [evCovers, setEvCovers] = useState("");

  const [actualFor, setActualFor] = useState<ForecastRow | null>(null);
  const [actCovers, setActCovers] = useState("");
  const [actNet, setActNet] = useState("");

  const load = useCallback(async () => {
    try {
      // A fortnight back, so last week's forecasts are still here to be
      // measured against. A forecast you can no longer see is one nobody
      // ever checks.
      const from = new Date();
      from.setDate(from.getDate() - 14);
      const since = from.toISOString().slice(0, 10);
      const [u, f, e] = await Promise.all([
        fetchBusinessUnits(),
        fetchForecasts(since),
        fetchKnownEvents(since),
      ]);
      setUnits(u);
      setRows(f);
      setEvents(e);
    } catch (err) {
      toast.error("Could not load the forecast", { description: said(err) });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const active = useMemo(() => units.filter((u) => u.active), [units]);

  /*
   * Outlets that got no figure for the chosen date. Named rather than left
   * out: the useful sentence on this screen is often "the bar has never
   * traded on a Monday", and a missing row does not say it.
   */
  const withoutForecast = useMemo(() => {
    const have = new Set(rows.filter((r) => r.forecastFor === forDate).map((r) => r.businessUnitId));
    return active.filter((u) => !have.has(u.id));
  }, [rows, active, forDate]);

  const upcoming = useMemo(
    () => [...rows].sort((a, b) =>
      a.forecastFor === b.forecastFor
        ? (a.unitName ?? "").localeCompare(b.unitName ?? "")
        : a.forecastFor.localeCompare(b.forecastFor)),
    [rows],
  );

  async function build() {
    setBusy(true);
    try {
      const made = await buildForecast(forDate, null);
      if (made === 0) {
        // Not an error, and not a success either.
        toast.warning("Nothing to forecast", {
          description:
            "No outlet has traded on that weekday within the sample, so there " +
            "is nothing to average. A figure here would be invented.",
        });
      } else {
        toast.success(`${made} outlet${made === 1 ? "" : "s"} forecast`);
      }
      await load();
    } catch (err) {
      toast.error("No forecast was built", { description: said(err) });
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-2">
          <Label htmlFor="fc-date">Forecast for</Label>
          <Input
            id="fc-date"
            type="date"
            className="w-48"
            value={forDate}
            onChange={(e) => setForDate(e.target.value)}
          />
        </div>
        {canWrite && (
          <>
            <Button disabled={busy} onClick={() => void build()}>
              <ChartLine aria-hidden="true" />
              Build the forecast
            </Button>
            <Button
              variant="outline"
              onClick={() => { setEvDate(forDate); setEventOpen(true); }}
            >
              <Plus aria-hidden="true" />
              Add an event
            </Button>
          </>
        )}
      </div>

      <p className="max-w-prose text-sm text-muted-foreground">
        The same weekday over the last few weeks, averaged, with public
        holidays left out of the sample and events you have entered added back.
        That is the whole method — it is meant to be arguable, so every figure
        below says how many days it was built from.
      </p>

      {upcoming.length === 0 ? (
        <EmptyState icon={ChartLine} title="No forecast yet">
          Pick a date and build one. It needs takings already recorded for the
          same weekday; without them there is nothing to average and the screen
          will say so rather than showing a zero.
        </EmptyState>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Day</TableHead>
              <TableHead>Outlet</TableHead>
              <TableHead className="text-right">Covers</TableHead>
              <TableHead className="text-right">Net sales</TableHead>
              <TableHead>Built from</TableHead>
              <TableHead>Against actual</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {upcoming.map((r) => {
              const thin = (r.samplesUsed ?? 0) < 3;
              const measured = r.actualCovers !== null && r.actualCovers > 0;
              const errPct = measured && r.covers !== null
                ? Math.abs(r.covers - (r.actualCovers as number)) / (r.actualCovers as number) * 100
                : null;
              return (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap">{longDate(r.forecastFor)}</TableCell>
                  <TableCell className="font-medium">{r.unitName ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{covers(r.covers)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.netSales === null ? "—" : <CurrencyDisplay value={r.netSales} />}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {r.samplesUsed ?? 0} same weekday
                    {(r.samplesUsed ?? 0) === 1 ? "" : "s"} in {r.weeksSampled ?? "—"} weeks
                    {thin && (
                      <Badge variant="outline" className="ml-2">thin evidence</Badge>
                    )}
                    {r.note && (
                      <span className="mt-1 block">{r.note}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {errPct === null ? (
                      <span className="text-sm text-muted-foreground">
                        not yet known
                      </span>
                    ) : (
                      <StatusChip tone={errPct <= 10 ? "success" : errPct <= 25 ? "warning" : "danger"}>
                        {errPct.toFixed(0)}% out
                      </StatusChip>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {canWrite && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setActualFor(r);
                          setActCovers(r.actualCovers === null ? "" : String(r.actualCovers));
                          setActNet(r.actualNetSales === null ? "" : String(r.actualNetSales));
                        }}
                      >
                        {measured ? "Correct" : "Record actual"}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      {withoutForecast.length > 0 && (
        <p className="flex items-start gap-2 text-sm text-muted-foreground">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            No figure for {longDate(forDate)} at{" "}
            {withoutForecast.map((u) => u.name).join(", ")}. Either nothing has
            been recorded for that weekday yet, or you do not have Revenue
            access there. Neither is the same as a forecast of none.
          </span>
        </p>
      )}

      <section className="space-y-3">
        <div>
          <h3 className="font-medium">What the average cannot know</h3>
          <p className="max-w-prose text-sm text-muted-foreground">
            A wedding for ninety is not a Tuesday, and no amount of looking at
            past Tuesdays will find it. An event is applied when the forecast
            for its day is built.
          </p>
        </div>
        {events.length === 0 ? (
          <EmptyState icon={CalendarDays} title="Nothing in the diary">
            Weddings, functions, a closure, a festival in town.
          </EmptyState>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Day</TableHead>
                <TableHead>What</TableHead>
                <TableHead>Outlet</TableHead>
                <TableHead>Effect</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="whitespace-nowrap">{longDate(e.onDate)}</TableCell>
                  <TableCell className="font-medium">{e.name}</TableCell>
                  <TableCell>
                    {e.businessUnitId === null
                      ? "every outlet"
                      : units.find((u) => u.id === e.businessUnitId)?.name ?? "—"}
                  </TableCell>
                  <TableCell className="text-sm">
                    {e.coversOverride !== null
                      ? `${covers(e.coversOverride)} covers instead of the average`
                      : e.coversExtra !== null
                        ? `${covers(e.coversExtra)} covers on top of the average`
                        : "noted only"}
                  </TableCell>
                  <TableCell className="text-right">
                    {canWrite && (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Remove ${e.name}`}
                        onClick={async () => {
                          setBusy(true);
                          try {
                            await removeKnownEvent(e.id);
                            await load();
                          } catch (err) {
                            toast.error("Not removed", { description: said(err) });
                          } finally { setBusy(false); }
                        }}
                      >
                        <Trash2 aria-hidden="true" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      <Dialog open={eventOpen} onOpenChange={setEventOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add an event</DialogTitle>
            <DialogDescription>
              Something the arithmetic cannot see. It is applied next time the
              forecast for that day is built.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="ev-name">What is it</Label>
              <Input
                id="ev-name"
                value={evName}
                onChange={(e) => setEvName(e.target.value)}
                placeholder="Harding wedding"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ev-date">When</Label>
              <Input
                id="ev-date"
                type="date"
                value={evDate}
                onChange={(e) => setEvDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ev-unit">Where</Label>
              <select
                id="ev-unit"
                className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
                value={evUnit}
                onChange={(e) => setEvUnit(e.target.value)}
              >
                <option value="">Every outlet</option>
                {active.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </div>
            {/*
              * Replace or add, asked outright. "Ninety on top of a normal
              * Tuesday" and "ninety instead of one" are different bookings
              * and only the person entering it knows which; the database
              * refuses an event that claims to be both.
              */}
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">How it affects the day</legend>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="ev-kind"
                  checked={evKind === "extra"}
                  onChange={() => setEvKind("extra")}
                />
                These covers on top of a normal day
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="ev-kind"
                  checked={evKind === "override"}
                  onChange={() => setEvKind("override")}
                />
                These covers instead of a normal day
              </label>
            </fieldset>
            <div className="space-y-2">
              <Label htmlFor="ev-covers">Covers</Label>
              <Input
                id="ev-covers"
                inputMode="numeric"
                value={evCovers}
                onChange={(e) => setEvCovers(e.target.value)}
                placeholder="90"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEventOpen(false)}>Cancel</Button>
            <Button
              disabled={busy || evName.trim() === "" || evCovers.trim() === ""}
              onClick={async () => {
                setBusy(true);
                try {
                  const n = Number(evCovers);
                  await addKnownEvent({
                    unitId: evUnit || null,
                    onDate: evDate,
                    name: evName.trim(),
                    coversOverride: evKind === "override" ? n : null,
                    coversExtra: evKind === "extra" ? n : null,
                    note: null,
                  });
                  toast.success("Added", {
                    description: "Build the forecast for that day to apply it.",
                  });
                  setEventOpen(false);
                  setEvName(""); setEvCovers("");
                  await load();
                } catch (err) {
                  toast.error("Not added", { description: said(err) });
                } finally { setBusy(false); }
              }}
            >
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={actualFor !== null} onOpenChange={(o) => !o && setActualFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>What actually happened</DialogTitle>
            <DialogDescription>
              {actualFor && (
                <>
                  {longDate(actualFor.forecastFor)} at {actualFor.unitName ?? "this outlet"}.
                  The forecast said {covers(actualFor.covers)} covers.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="ac-covers">Covers</Label>
              <Input
                id="ac-covers"
                inputMode="numeric"
                value={actCovers}
                onChange={(e) => setActCovers(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ac-net">Net sales</Label>
              <Input
                id="ac-net"
                inputMode="decimal"
                value={actNet}
                onChange={(e) => setActNet(e.target.value)}
              />
              <p className="text-sm text-muted-foreground">
                Leave either blank if you do not know it. Blank means unknown,
                and the accuracy figure will say so rather than reading as a
                perfect forecast.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setActualFor(null)}>Cancel</Button>
            <Button
              disabled={busy || !actualFor}
              onClick={async () => {
                if (!actualFor) return;
                setBusy(true);
                try {
                  await recordActual(
                    actualFor.id,
                    actCovers.trim() === "" ? null : Number(actCovers),
                    actNet.trim() === "" ? null : Number(actNet),
                  );
                  toast.success("Recorded");
                  setActualFor(null);
                  await load();
                } catch (err) {
                  toast.error("Not recorded", { description: said(err) });
                } finally { setBusy(false); }
              }}
            >
              Record
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
