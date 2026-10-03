// ---------------------------------------------------------------------------
// What came in
// ---------------------------------------------------------------------------
// Everything else on this screen is money going out. This is the other side,
// and until migration 0065 the platform did not have it at all — so every
// figure it produced was one half of a subtraction.
//
// Two things this screen is careful about, both of which are easy to get wrong
// and expensive to find:
//
//   **Gross is not net.** The customer paid the gross; a delivery platform
//   kept its commission; the venue banked the net. Both columns are shown and
//   neither is labelled "revenue", because which one a report means decides
//   whether a menu looks profitable.
//
//   **A blank is not a zero.** A day where somebody recorded the money and not
//   the covers has no spend per head, and says so. Inventing one from an empty
//   field produces a number that steers a menu.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from "react";
import { Banknote } from "lucide-react";
import { toast } from "sonner";

import { EmptyState } from "@/components/shared/empty-state";
import { CurrencyDisplay } from "@/components/shared/currency-display";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { unitOptions } from "@/engine/units";
import {
  fetchRevenueChannels, fetchTakings, recordTakings,
  type RevenueChannel, type TakingsRow, type BusinessUnit,
} from "@/data/repository";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoISO(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

export function TakingsTab({
  units, canWrite,
}: {
  units: BusinessUnit[];
  canWrite: boolean;
}) {
  const [channels, setChannels] = useState<RevenueChannel[]>([]);
  const [rows, setRows] = useState<TakingsRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);

  // A fortnight, which is the window somebody closing up actually looks at.
  const from = daysAgoISO(13);
  const to = todayISO();

  async function load() {
    setLoading(true);
    try {
      const [c, r] = await Promise.all([fetchRevenueChannels(), fetchTakings(from, to)]);
      setChannels(c.filter((x) => x.active));
      setRows(r);
    } catch (err) {
      toast.error("Could not read the takings", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const totals = useMemo(() => {
    let gross = 0, net = 0, covers = 0, counted = 0;
    for (const r of rows) {
      gross += Number(r.grossAmount);
      net += Number(r.netAmount);
      if (r.covers !== null) { covers += r.covers; counted += 1; }
    }
    return { gross, net, covers, counted, withheld: gross - net };
  }, [rows]);

  if (loading) {
    return <p className="py-12 text-center text-sm text-muted-foreground">Loading…</p>;
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="py-4">
            <p className="text-xs text-muted-foreground">Customers paid</p>
            <p className="text-xl font-semibold">
              <CurrencyDisplay value={String(totals.gross)} />
            </p>
            <p className="text-xs text-muted-foreground">Last fourteen days, every channel</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className="text-xs text-muted-foreground">The venue kept</p>
            <p className="text-xl font-semibold">
              <CurrencyDisplay value={String(totals.net)} />
            </p>
            <p className="text-xs text-muted-foreground">
              {totals.withheld > 0
                ? <>Platforms withheld <CurrencyDisplay value={String(totals.withheld)} /></>
                : "Nothing withheld, or nobody has said"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className="text-xs text-muted-foreground">Covers</p>
            <p className="text-xl font-semibold">{totals.covers || "—"}</p>
            <p className="text-xs text-muted-foreground">
              {/*
                * Said out loud rather than averaged over everything. A total
                * built from half the days is not the fortnight's covers, and a
                * spend per head computed from it is wrong in the direction
                * that flatters.
                */}
              {rows.length === 0
                ? "Nothing recorded yet"
                : totals.counted === rows.length
                  ? "Counted on every entry"
                  : `Counted on ${totals.counted} of ${rows.length} entries`}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-4 pb-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Banknote aria-hidden="true" className="size-4" /> Takings
            </CardTitle>
            <p className="pt-1 text-xs text-muted-foreground">
              Per department, per day, per channel. A figure typed again for the
              same day replaces it, and what it was stays on the record.
            </p>
          </div>
          <Button variant="outline" size="sm" disabled={!canWrite}
            onClick={() => setAdding((o) => !o)}>
            {adding ? "Cancel" : "Record a day"}
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {adding && (
            <RecordTakingsForm
              units={units}
              channels={channels}
              onDone={() => { setAdding(false); void load(); }}
            />
          )}

          {rows.length === 0 ? (
            <EmptyState icon={Banknote} title="Nothing recorded in the last fortnight">
              Takings are what the platform is missing to turn a cost into a
              margin. One figure per department per day per channel is enough.
            </EmptyState>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead className="text-right">Customers paid</TableHead>
                  <TableHead className="text-right">Withheld</TableHead>
                  <TableHead className="text-right">Kept</TableHead>
                  <TableHead className="text-right">Covers</TableHead>
                  <TableHead className="text-right">Per cover</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{r.onDate}</TableCell>
                    <TableCell>{r.businessUnitName}</TableCell>
                    <TableCell className="text-muted-foreground">{r.channelName}</TableCell>
                    <TableCell className="text-right">
                      <CurrencyDisplay value={r.grossAmount} />
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {r.commissionAmount
                        ? <CurrencyDisplay value={r.commissionAmount} />
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <CurrencyDisplay value={r.netAmount} />
                    </TableCell>
                    <TableCell className="text-right">
                      {r.covers ?? <span className="text-muted-foreground">Not counted</span>}
                    </TableCell>
                    <TableCell className="text-right">
                      {r.spendPerCover
                        ? <CurrencyDisplay value={r.spendPerCover} />
                        : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function RecordTakingsForm({
  units, channels, onDone,
}: {
  units: BusinessUnit[];
  channels: RevenueChannel[];
  onDone: () => void;
}) {
  const choices = unitOptions(units);
  const [unitId, setUnitId] = useState(choices[0]?.id ?? "");
  const [channelId, setChannelId] = useState(channels[0]?.id ?? "");
  const [onDate, setOnDate] = useState(todayISO());
  const [gross, setGross] = useState("");
  const [commission, setCommission] = useState("");
  const [covers, setCovers] = useState("");
  const [busy, setBusy] = useState(false);

  const channel = channels.find((c) => c.id === channelId);

  /*
   * A suggestion, never the figure of record. A platform's actual deduction
   * moves with promotions, disputes and the month, so a commission computed
   * from a stored percentage is a number the venue cannot reconcile to its
   * remittance. Offered, and overwritten by whoever has the statement.
   */
  const suggested = useMemo(() => {
    const pct = channel?.typicalCommissionPercent;
    const g = Number(gross);
    if (!pct || !Number.isFinite(g) || g <= 0) return null;
    return (g * Number(pct)) / 100;
  }, [channel, gross]);

  const valid = unitId !== "" && channelId !== "" && onDate !== ""
    && gross.trim() !== "" && Number(gross) >= 0
    && onDate <= todayISO();

  async function save() {
    setBusy(true);
    try {
      await recordTakings({
        businessUnitId: unitId,
        channelId,
        onDate,
        grossAmount: gross.trim(),
        commissionAmount: commission.trim() === "" ? null : commission.trim(),
        covers: covers.trim() === "" ? null : Number(covers),
      });
      toast.success("Takings recorded", {
        description: covers.trim() === ""
          ? "No covers given, so there is no spend per head for that day."
          : undefined,
      });
      onDone();
    } catch (err) {
      toast.error("Could not record it", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor="tk-unit">Department</Label>
          <select id="tk-unit"
            className="h-9 w-full rounded-md border bg-transparent px-2 text-sm"
            value={unitId} onChange={(e) => setUnitId(e.target.value)}>
            {choices.length === 0 && <option value="">No open department</option>}
            {choices.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="tk-channel">Channel</Label>
          <select id="tk-channel"
            className="h-9 w-full rounded-md border bg-transparent px-2 text-sm"
            value={channelId} onChange={(e) => setChannelId(e.target.value)}>
            {channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="tk-date">Date</Label>
          <Input id="tk-date" type="date" max={todayISO()} value={onDate}
            onChange={(e) => setOnDate(e.target.value)} />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor="tk-gross">What customers paid</Label>
          <Input id="tk-gross" type="number" min="0" step="any" value={gross}
            onChange={(e) => setGross(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="tk-commission">Withheld by the channel</Label>
          <Input id="tk-commission" type="number" min="0" step="any" value={commission}
            placeholder={suggested !== null ? String(Math.round(suggested)) : "—"}
            onChange={(e) => setCommission(e.target.value)} />
          <p className="text-xs text-muted-foreground">
            {suggested !== null
              ? `${channel?.name} usually keeps ${channel?.typicalCommissionPercent}%. Use the remittance, not this.`
              : "Leave blank where nothing was withheld."}
          </p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="tk-covers">Covers</Label>
          <Input id="tk-covers" type="number" min="0" step="1" value={covers}
            onChange={(e) => setCovers(e.target.value)} />
          <p className="text-xs text-muted-foreground">
            Orders, for a delivery platform. Blank means nobody counted, which
            is not the same as nobody came.
          </p>
        </div>
      </div>

      <div className="flex justify-end">
        <Button size="sm" disabled={!valid || busy} onClick={() => void save()}>
          Record it
        </Button>
      </div>
    </div>
  );
}
