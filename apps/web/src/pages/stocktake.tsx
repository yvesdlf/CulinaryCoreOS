// ---------------------------------------------------------------------------
// Stocktake — counting the shelves
// ---------------------------------------------------------------------------
// The screen over the sessions built in 0091 and scoped to a room in 0096.
//
// Three things on this page exist because of rules the database already
// enforces, and the job here is to make them visible rather than to repeat
// them:
//
//   A blank is not a zero. The count box can be empty, and empty means
//   nobody reached that shelf — it posts nothing. Typing 0 means somebody
//   looked and there was none, and posts the whole write-off. The two are
//   shown differently and the difference is stated on screen, because an
//   operator who thinks a blank will be treated as zero will leave shelves
//   blank deliberately.
//
//   The expected figure is frozen and is deliberately NOT shown while
//   counting. `count-sheet.ts` makes the same argument about the printed
//   sheet: somebody who can see "expected 4" writes 4, and a count that
//   agrees with the books because the books were on the sheet is not a
//   count. It appears on the variance step, after the numbers are in.
//
//   Nobody approves their own count. The approve button is hidden from the
//   person who submitted it — and the trigger refuses them anyway, which is
//   what actually holds. The button is hidden so the refusal is not a
//   surprise, not instead of it.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ClipboardList,
  Plus,
  Snowflake,
  TriangleAlert,
  CircleCheck,
  Lock,
} from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusChip, type StatusTone } from "@/components/shared/status-chip";
import { CurrencyDisplay } from "@/components/shared/currency-display";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useCanWriteSection } from "@/stores/access-store";
import { useAuthStore } from "@/stores/auth-store";
import {
  fetchStocktakes, fetchStocktakeLines, fetchCountLocations,
  createStocktake, openStocktake, saveCount, setStocktakeStatus, postStocktake,
  type Stocktake, type StocktakeVarianceLine, type CountLocation,
} from "@/data/stocktake";

/** The database's message, without the data layer's "operation failed:" prefix. */
function said(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  return text.replace(/^\w+(\([^)]*\))? failed: /, "");
}

const STATUS_TONE: Record<string, StatusTone> = {
  OPEN: "neutral",
  COUNTING: "info",
  SUBMITTED: "warning",
  APPROVED: "info",
  POSTED: "success",
  CANCELLED: "neutral",
};

const STATUS_WORDS: Record<string, string> = {
  OPEN: "Not started",
  COUNTING: "Being counted",
  SUBMITTED: "Waiting for approval",
  APPROVED: "Approved, not posted",
  POSTED: "Posted to stock",
  CANCELLED: "Cancelled",
};

/*
 * Quantities only. Money goes through CurrencyDisplay, which knows the
 * venue's currency and its convention — IDR has no minor unit, and a
 * variance printed as "17,905.759" reads as a different kind of number
 * entirely.
 */
function fmt(n: number | null, unit?: string): string {
  if (n === null) return "—";
  const s = Number(n).toLocaleString(undefined, { maximumFractionDigits: 3 });
  return unit ? `${s} ${unit}` : s;
}

export function StocktakePage() {
  const canWrite = useCanWriteSection("INVENTORY");
  const myEmail = useAuthStore((s) => s.session?.user?.email ?? null);

  const [takes, setTakes] = useState<Stocktake[]>([]);
  const [locations, setLocations] = useState<CountLocation[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [lines, setLines] = useState<StocktakeVarianceLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [newKind, setNewKind] = useState<"FULL" | "PARTIAL" | "SPOT">("FULL");
  const [newLocation, setNewLocation] = useState<string>("");
  const [newNote, setNewNote] = useState("");

  const load = useCallback(async () => {
    try {
      const [t, l] = await Promise.all([fetchStocktakes(), fetchCountLocations()]);
      setTakes(t);
      setLocations(l);
      setSelected((cur) => cur ?? t[0]?.id ?? null);
    } catch (err) {
      toast.error("Could not load counts", { description: said(err) });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const loadLines = useCallback(async (id: string) => {
    try {
      setLines(await fetchStocktakeLines(id));
    } catch (err) {
      toast.error("Could not load the count sheet", { description: said(err) });
    }
  }, []);

  useEffect(() => {
    if (selected) void loadLines(selected);
    else setLines([]);
  }, [selected, loadLines]);

  const current = takes.find((t) => t.id === selected) ?? null;
  const counting = current?.status === "COUNTING";
  const showVariance =
    current != null && ["SUBMITTED", "APPROVED", "POSTED"].includes(current.status);

  const summary = useMemo(() => {
    const counted = lines.filter((l) => !l.notCounted);
    const value = counted.reduce((s, l) => s + (l.differenceValue ?? 0), 0);
    return {
      total: lines.length,
      counted: counted.length,
      outstanding: lines.length - counted.length,
      value,
    };
  }, [lines]);

  /*
   * The submitter cannot approve, so they are not offered it.
   *
   * The trigger refuses them regardless — that is the control. This only
   * stops somebody being shown a button that will always refuse, which is a
   * worse experience than not seeing it and tells them nothing about why.
   */
  const iSubmittedThis =
    current?.submittedByEmail != null &&
    myEmail != null &&
    current.submittedByEmail.toLowerCase() === myEmail.toLowerCase();

  async function act(what: string, fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      await load();
      if (selected) await loadLines(selected);
    } catch (err) {
      toast.error(what, { description: said(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Stocktake"
        description="Count a room or the whole venue. The books are frozen when a count opens, so a delivery arriving mid-count does not hide a shortfall."
      >
        {canWrite && (
          <Button onClick={() => setNewOpen(true)}>
            <Plus aria-hidden="true" />
            New count
          </Button>
        )}
      </PageHeader>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : takes.length === 0 ? (
        <EmptyState icon={ClipboardList} title="No counts yet">
          A count freezes what the books say, collects what is on the shelf, and
          posts the difference once somebody else has approved it.
        </EmptyState>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
          <nav aria-label="Counts" className="space-y-2">
            {takes.map((t) => {
              const where = t.locationId
                ? locations.find((l) => l.id === t.locationId)?.name ?? "A room"
                : "Whole venue";
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setSelected(t.id)}
                  aria-current={t.id === selected ? "true" : undefined}
                  className={`w-full rounded-lg border p-3 text-left transition-colors ${
                    t.id === selected
                      ? "border-ring bg-accent"
                      : "border-border hover:bg-accent/50"
                  }`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-medium">{t.reference ?? where}</span>
                    <StatusChip tone={STATUS_TONE[t.status] ?? "neutral"}>
                      {STATUS_WORDS[t.status] ?? t.status}
                    </StatusChip>
                  </span>
                  {/* The place is the title when there is no reference, so
                      repeating it underneath reads as a mistake. */}
                  <span className="mt-1 block text-sm text-muted-foreground">
                    {t.reference ? `${where} · ` : ""}
                    {new Date(t.snapshotAt).toLocaleString(undefined, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </span>
                </button>
              );
            })}
          </nav>

          <div className="space-y-4">
            {current == null ? null : (
              <>
                <Card>
                  <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        <Snowflake className="size-4" aria-hidden="true" />
                        Books frozen {new Date(current.snapshotAt).toLocaleString()}
                      </CardTitle>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {current.status === "OPEN"
                          ? "Open it to build the sheet from what the books say right now."
                          : `${summary.counted} of ${summary.total} counted, ${summary.outstanding} not reached.`}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      {canWrite && current.status === "OPEN" && (
                        <Button
                          disabled={busy}
                          onClick={() =>
                            act("Could not open the count", async () => {
                              const n = await openStocktake(current.id);
                              toast.success(`${n} lines on the sheet`);
                            })
                          }
                        >
                          Open and freeze
                        </Button>
                      )}
                      {canWrite && counting && (
                        <Button
                          disabled={busy || summary.counted === 0}
                          onClick={() =>
                            act("Could not submit", () =>
                              setStocktakeStatus(current.id, "SUBMITTED"),
                            )
                          }
                        >
                          Submit for approval
                        </Button>
                      )}
                      {canWrite && current.status === "SUBMITTED" && !iSubmittedThis && (
                        <Button
                          disabled={busy}
                          onClick={() =>
                            act("Could not approve", () =>
                              setStocktakeStatus(current.id, "APPROVED"),
                            )
                          }
                        >
                          Approve
                        </Button>
                      )}
                      {canWrite && current.status === "APPROVED" && (
                        <Button
                          disabled={busy}
                          onClick={() =>
                            act("Could not post", async () => {
                              const n = await postStocktake(current.id);
                              toast.success(
                                n === 0
                                  ? "Nothing to adjust — the count agreed with the books"
                                  : `${n} adjustments posted to stock`,
                              );
                            })
                          }
                        >
                          Post to stock
                        </Button>
                      )}
                    </div>
                  </CardHeader>

                  {current.status === "SUBMITTED" && iSubmittedThis && (
                    <CardContent className="pt-0">
                      <p className="flex items-start gap-2 rounded-lg border border-status-warning bg-status-warning-soft p-3 text-sm">
                        <Lock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                        <span>
                          You submitted this count, so somebody else has to approve
                          it. That rule is enforced by the database, not by this
                          screen.
                        </span>
                      </p>
                    </CardContent>
                  )}
                </Card>

                {current.status === "OPEN" ? (
                  <EmptyState icon={Snowflake} title="Not opened yet">
                    Opening the count writes down what the books say for every
                    product, so a delivery that arrives while you are counting
                    cannot change the figure you are measured against.
                  </EmptyState>
                ) : (
                  <Card>
                    <CardHeader>
                      <CardTitle>
                        {counting ? "Count sheet" : "Variance"}
                      </CardTitle>
                      <p className="text-sm text-muted-foreground">
                        {counting ? (
                          <>
                            Leave a box empty for a shelf you did not reach — it
                            posts nothing. Type <strong>0</strong> only where you
                            looked and there was none. The expected figures are
                            hidden until the count is in, so the sheet cannot tell
                            you the answer.
                          </>
                        ) : (
                          <>
                            Sorted by what the difference is worth, not by how much
                            of it there is.
                          </>
                        )}
                      </p>
                    </CardHeader>
                    <CardContent>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Product</TableHead>
                            {showVariance && (
                              <TableHead className="text-right">Expected</TableHead>
                            )}
                            <TableHead className="text-right">Counted</TableHead>
                            {showVariance && (
                              <>
                                <TableHead className="text-right">Difference</TableHead>
                                <TableHead className="text-right">Worth</TableHead>
                              </>
                            )}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {[...lines]
                            .sort((a, b) =>
                              showVariance
                                ? Math.abs(b.differenceValue ?? 0) -
                                  Math.abs(a.differenceValue ?? 0)
                                : a.productName.localeCompare(b.productName),
                            )
                            .map((l) => (
                              <TableRow key={l.lineId}>
                                <TableCell className="font-medium">
                                  {l.productName}
                                  {l.notCounted && showVariance && (
                                    <Badge variant="outline" className="ml-2">
                                      not counted
                                    </Badge>
                                  )}
                                </TableCell>
                                {showVariance && (
                                  <TableCell className="text-right tabular-nums">
                                    {fmt(l.expectedQty, l.countUnit)}
                                  </TableCell>
                                )}
                                <TableCell className="text-right">
                                  {counting && canWrite ? (
                                    <CountBox line={l} onSaved={() => loadLines(current.id)} />
                                  ) : (
                                    <span className="tabular-nums">
                                      {l.countedQty === null
                                        ? "—"
                                        : fmt(l.countedQty, l.countUnit)}
                                    </span>
                                  )}
                                </TableCell>
                                {showVariance && (
                                  <>
                                    <TableCell className="text-right tabular-nums">
                                      {l.differenceQty === null
                                        ? "—"
                                        : fmt(l.differenceQty, l.countUnit)}
                                    </TableCell>
                                    <TableCell
                                      className={`text-right tabular-nums ${
                                        (l.differenceValue ?? 0) < 0
                                          ? "text-status-danger"
                                          : ""
                                      }`}
                                    >
                                      {l.differenceValue === null ? (
                                        "—"
                                      ) : (
                                        <CurrencyDisplay value={l.differenceValue} />
                                      )}
                                    </TableCell>
                                  </>
                                )}
                              </TableRow>
                            ))}
                        </TableBody>
                      </Table>

                      {showVariance && (
                        <p className="mt-4 flex items-center gap-2 text-sm">
                          {summary.value < 0 ? (
                            <TriangleAlert
                              className="size-4 text-status-danger"
                              aria-hidden="true"
                            />
                          ) : (
                            <CircleCheck
                              className="size-4 text-status-success"
                              aria-hidden="true"
                            />
                          )}
                          <span>
                            {summary.counted} lines counted, worth{" "}
                            <strong>
                              <CurrencyDisplay value={summary.value} />
                            </strong>{" "}
                            against the books.
                            {summary.outstanding > 0 && (
                              <>
                                {" "}
                                {summary.outstanding} shelves were not reached and
                                are not in that figure.
                              </>
                            )}
                          </span>
                        </p>
                      )}
                    </CardContent>
                  </Card>
                )}
              </>
            )}
          </div>
        </div>
      )}

      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New count</DialogTitle>
            <DialogDescription>
              The books are frozen the moment this is created.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="st-kind">Kind</Label>
              <select
                id="st-kind"
                className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
                value={newKind}
                onChange={(e) => setNewKind(e.target.value as typeof newKind)}
              >
                <option value="FULL">Full</option>
                <option value="PARTIAL">Partial</option>
                <option value="SPOT">Spot check</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="st-where">Where</Label>
              <select
                id="st-where"
                className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
                value={newLocation}
                onChange={(e) => setNewLocation(e.target.value)}
              >
                <option value="">Whole venue</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
              <p className="text-sm text-muted-foreground">
                A count of one room lists only what that room holds, which is
                the difference between twenty minutes and closing the venue.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="st-note">Note</Label>
              <Textarea
                id="st-note"
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                placeholder="Month end"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const id = await createStocktake({
                    kind: newKind,
                    locationId: newLocation || null,
                    note: newNote.trim() || null,
                  });
                  setNewOpen(false);
                  setNewNote("");
                  await load();
                  setSelected(id);
                } catch (err) {
                  toast.error("Could not create the count", {
                    description: said(err),
                  });
                } finally {
                  setBusy(false);
                }
              }}
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/*
 * One count box.
 *
 * Its own component so that each line keeps its own draft while typing and a
 * save on one row does not re-render the value out from under another.
 *
 * Empty and zero are different values on the way out, not just on the way in:
 * clearing the box sends null, which puts the line back to "not reached".
 */
function CountBox({
  line,
  onSaved,
}: {
  line: StocktakeVarianceLine;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState(
    line.countedQty === null ? "" : String(line.countedQty),
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(line.countedQty === null ? "" : String(line.countedQty));
  }, [line.countedQty]);

  async function commit() {
    const trimmed = draft.trim();
    const next = trimmed === "" ? null : Number(trimmed);
    if (next !== null && !Number.isFinite(next)) {
      toast.error("That is not a number", { description: `"${draft}"` });
      setDraft(line.countedQty === null ? "" : String(line.countedQty));
      return;
    }
    if (next === line.countedQty) return;
    setSaving(true);
    try {
      await saveCount(line.lineId, next);
      onSaved();
    } catch (err) {
      toast.error("Not saved", { description: said(err) });
      setDraft(line.countedQty === null ? "" : String(line.countedQty));
    } finally {
      setSaving(false);
    }
  }

  return (
    <span className="inline-flex items-center justify-end gap-2">
      <Input
        value={draft}
        inputMode="decimal"
        disabled={saving}
        aria-label={`Counted ${line.productName}, in ${line.countUnit}. Leave empty if not counted.`}
        className="h-9 w-28 text-right tabular-nums"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
      />
      <span className="w-10 text-left text-sm text-muted-foreground">
        {line.countUnit}
      </span>
    </span>
  );
}
