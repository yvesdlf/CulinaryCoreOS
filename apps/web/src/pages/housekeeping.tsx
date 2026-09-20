// ---------------------------------------------------------------------------
// Housekeeping — the board, the sheets, inspections and lost property
// ---------------------------------------------------------------------------
// The board leads, because the question a housekeeper is asked all day is
// "which rooms can I sell" and every other screen here is a report on how the
// morning went.
//
// Two things are said out loud on this page rather than implied.
//
// Occupancy is recorded, not known: there is no property management system
// behind it, so the board shows how old the figure is and lets somebody fix it
// rather than presenting a guess as fact.
//
// A clean room is not a sellable room. Only an inspected one is, because
// "clean" is the attendant's own opinion of their own work, and a front desk
// that sells on it finds out the difference through the guest.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from "react";
import {
  BedDouble, ClipboardCheck, Search, PackageSearch, Users, Sparkles, TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  fetchHousekeepingBoard, fetchRoomTypes, fetchHousekeepingWorkload,
  fetchLostProperty, fetchHousekeepingReplenishment,
  setRoomState, setRoomOccupancy, publishHousekeepingSheet,
  finishHousekeepingTask, inspectHousekeepingTask,
  bookLostProperty, releaseLostProperty, fetchEmployees,
  type BoardRow, type RoomTypeRow, type WorkloadRow,
  type LostPropertyRow, type ReplenishmentRow,
} from "@/data/repository";
import { isSupabaseConfigured } from "@/lib/supabase";
import {
  proposeSheets, summariseBoard, cleanVariance,
  type RoomLike, type AttendantLike,
} from "@/engine/housekeeping";

const STATE_CLASS: Record<string, string> = {
  DIRTY: "bg-status-warning-soft text-status-warning",
  IN_PROGRESS: "bg-status-info-soft text-status-info",
  CLEAN: "bg-status-info-soft text-status-info",
  INSPECTED: "bg-status-success-soft text-status-success",
  OUT_OF_SERVICE: "bg-status-danger-soft text-status-danger",
};

const STATE_LABEL: Record<string, string> = {
  DIRTY: "Dirty", IN_PROGRESS: "Being cleaned", CLEAN: "Clean, not inspected",
  INSPECTED: "Inspected", OUT_OF_SERVICE: "Out of service",
};

function ageOf(iso: string | null, now: number): string {
  if (!iso) return "never set";
  const hours = (now - new Date(iso).getTime()) / 3600000;
  if (hours < 1) return "just now";
  if (hours < 24) return `${Math.floor(hours)} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

export function HousekeepingPage() {
  const [board, setBoard] = useState<BoardRow[]>([]);
  const [types, setTypes] = useState<RoomTypeRow[]>([]);
  const [workload, setWorkload] = useState<WorkloadRow[]>([]);
  const [lost, setLost] = useState<LostPropertyRow[]>([]);
  const [stock, setStock] = useState<ReplenishmentRow[]>([]);
  const [people, setPeople] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [inspecting, setInspecting] = useState<BoardRow | null>(null);
  const [booking, setBooking] = useState(false);
  const [outOfService, setOutOfService] = useState<BoardRow | null>(null);
  /*
   * When the board was last read.
   *
   * Staleness used to be measured against `Date.now()` inside a `useMemo`,
   * which is impure: the memo is keyed on the board, so the answer never
   * changed as time passed, and the same board rendered differently depending
   * on when the component happened to re-render. Measured against the moment
   * the data actually arrived instead, which is also the honest reading —
   * "these figures were this old when we fetched them".
   */
  const [readAt, setReadAt] = useState(() => Date.now());

  async function load() {
    if (!isSupabaseConfigured) { setLoading(false); return; }
    setLoading(true);
    try {
      const [b, t, w, l, s, emp] = await Promise.all([
        fetchHousekeepingBoard(), fetchRoomTypes(), fetchHousekeepingWorkload(),
        fetchLostProperty(), fetchHousekeepingReplenishment(), fetchEmployees(),
      ]);
      setBoard(b); setTypes(t); setWorkload(w); setLost(l); setStock(s);
      setPeople(emp.map((e) => ({ id: e.id, name: `${e.firstName} ${e.lastName}` })));
      setReadAt(Date.now());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load housekeeping");
    } finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []);

  const summary = useMemo(
    () => summariseBoard(board.map((r) => ({
      state: r.state, jobsBlocking: r.jobsBlocking, taskStatus: r.taskStatus,
    }))),
    [board],
  );

  const unassigned = useMemo(
    () => board.filter((r) => r.taskId === null && r.state !== "INSPECTED"
                              && r.state !== "OUT_OF_SERVICE"),
    [board],
  );

  const stale = useMemo(
    () => board.filter((r) => r.occupancySetAt === null
      || readAt - new Date(r.occupancySetAt).getTime() > 36 * 3600000),
    [board, readAt],
  );

  const toInspect = useMemo(
    () => board.filter((r) => r.state === "CLEAN" && r.taskStatus === "DONE"),
    [board],
  );

  async function proposeAndPublish() {
    const rooms: RoomLike[] = unassigned.map((r) => ({
      id: r.roomId, roomNumber: r.roomNumber, roomTypeId: r.roomTypeId,
      state: r.state, occupancy: r.occupancy, jobsBlocking: r.jobsBlocking,
    }));
    const attendants: AttendantLike[] = workload
      .filter((w) => w.minutesRostered > 0)
      .map((w) => ({
        employeeId: w.employeeId, name: w.name,
        minutesRostered: w.minutesRostered, minutesAssigned: w.minutesAssigned,
      }));

    if (attendants.length === 0) {
      toast.error("Nobody is rostered today. Publish the rota first.");
      return;
    }

    const plan = proposeSheets(rooms, types.map((t) => ({
      id: t.id, code: t.code, departureMinutes: t.departureMinutes,
      stayoverMinutes: t.stayoverMinutes, deepCleanMinutes: t.deepCleanMinutes,
    })), attendants);

    if (plan.tasks.length === 0) {
      toast.error("Nothing could be assigned. Check the rota and open jobs.");
      return;
    }

    const result = await publishHousekeepingSheet(
      plan.tasks.map((t) => ({
        roomId: t.roomId, kind: t.kind,
        standardMinutes: t.standardMinutes, employeeId: t.employeeId,
      })),
      new Date().toISOString().slice(0, 10),
    );

    if (result.refused.length > 0) {
      toast.error(`${result.created} assigned, ${result.refused.length} refused: ${result.refused[0].message}`);
    } else if (plan.unassigned.length > 0) {
      toast.success(`${result.created} rooms assigned. ${plan.unassigned.length} could not be — see the sheet.`);
    } else {
      toast.success(`${result.created} rooms assigned.`);
    }
    await load();
  }

  return (
    <div className="p-6">
      <PageHeader
        title="Housekeeping"
        description="The room board, today's sheets and inspections. Work is assigned within the rota, never past it."
      >
        <Button onClick={proposeAndPublish} disabled={unassigned.length === 0}>
          <Sparkles className="size-4" />Build today's sheets
        </Button>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Sellable now" value={summary.sellable}
              hint={`${summary.clean} clean but not inspected`} />
        <Stat label="Still to clean" value={summary.dirty + summary.inProgress}
              hint={`${unassigned.length} not on a sheet`} />
        <Stat label="Held by engineering" value={summary.blocked}
              hint="Open emergency or high job" danger={summary.blocked > 0} />
        <Stat label="Occupancy unconfirmed" value={stale.length}
              hint="Nobody has set it since yesterday" danger={stale.length > 0} />
      </div>

      {stale.length > 0 && (
        <div className="mt-4 rounded-lg border border-status-warning bg-status-warning-soft p-3">
          <p className="text-sm text-status-warning">
            <TriangleAlert className="mr-1 inline size-4" />
            {stale.length} room{stale.length === 1 ? " has" : "s have"} no recent occupancy.
            There is no property management system behind this board, so arrivals and
            departures are whatever somebody last recorded — a stale list sends an
            attendant to a room that was never vacated.
          </p>
        </div>
      )}

      <Tabs defaultValue="board" className="mt-6">
        <TabsList>
          <TabsTrigger value="board">
            <BedDouble className="size-4" />Board ({board.length})
          </TabsTrigger>
          <TabsTrigger value="inspect">
            <ClipboardCheck className="size-4" />To inspect ({toInspect.length})
          </TabsTrigger>
          <TabsTrigger value="team">
            <Users className="size-4" />Team
          </TabsTrigger>
          <TabsTrigger value="lost">
            <Search className="size-4" />Lost property ({lost.filter((l) => l.status === "HELD").length})
          </TabsTrigger>
          <TabsTrigger value="stock">
            <PackageSearch className="size-4" />Amenities ({stock.length})
          </TabsTrigger>
        </TabsList>

        {/* ── The board ────────────────────────────────────────────────── */}
        <TabsContent value="board" className="mt-4">
          {loading ? <Loading /> : board.length === 0 ? (
            <EmptyState icon={BedDouble} title="No rooms yet">
              A room is a location of kind "guest room", with a room type that says
              how long it takes to clean. The room type is what lets a morning's
              sheets be balanced on minutes rather than on room count.
            </EmptyState>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Room</TableHead>
                    <TableHead>State</TableHead>
                    <TableHead>Occupancy</TableHead>
                    <TableHead>Today</TableHead>
                    <TableHead>Engineering</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {board.map((r) => {
                    const v = cleanVariance(r.standardMinutes ?? 0, r.actualMinutes);
                    return (
                      <TableRow key={r.roomId}>
                        <TableCell>
                          <div className="font-medium">{r.roomNumber}</div>
                          <div className="text-xs text-muted-foreground">
                            {r.roomTypeName ?? "no type"}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge className={STATE_CLASS[r.state] ?? ""}>
                            {STATE_LABEL[r.state] ?? r.state}
                          </Badge>
                          {r.outOfServiceReason && (
                            <div className="mt-1 text-xs text-muted-foreground">
                              {r.outOfServiceReason}
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          <select
                            aria-label={`Occupancy for room ${r.roomNumber}`}
                            className="h-8 rounded-md border bg-background px-2 text-sm"
                            value={r.occupancy}
                            onChange={async (e) => {
                              try {
                                await setRoomOccupancy(r.roomId, e.target.value);
                                await load();
                              } catch (err) {
                                toast.error(err instanceof Error ? err.message : "Refused");
                              }
                            }}
                          >
                            {["VACANT","OCCUPIED","ARRIVAL","DEPARTURE","STAYOVER","UNKNOWN"]
                              .map((o) => <option key={o} value={o}>{o.toLowerCase()}</option>)}
                          </select>
                          <div className="mt-1 text-xs text-muted-foreground">
                            set {ageOf(r.occupancySetAt, readAt)}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">
                          {r.attendant ? (
                            <>
                              <div>{r.attendant}</div>
                              <div className="text-xs text-muted-foreground">
                                {r.taskStatus?.toLowerCase()}
                                {v.state !== "unknown" && v.deltaMinutes !== null &&
                                  ` · ${v.deltaMinutes > 0 ? "+" : ""}${v.deltaMinutes} min`}
                              </div>
                            </>
                          ) : (
                            <span className="text-muted-foreground">not assigned</span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm">
                          {r.jobsBlocking > 0 ? (
                            <span className="text-status-danger">
                              {r.jobsBlocking} blocking
                            </span>
                          ) : r.jobsOpen > 0 ? (
                            <span className="text-muted-foreground">{r.jobsOpen} open</span>
                          ) : "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          <RoomActions
                            row={r}
                            onFinish={async () => {
                              if (!r.taskId) return;
                              try {
                                await finishHousekeepingTask(r.taskId, null);
                                await setRoomState(r.roomId, "CLEAN");
                                toast.success("Marked clean. A supervisor inspects it.");
                                await load();
                              } catch (err) {
                                toast.error(err instanceof Error ? err.message : "Refused");
                              }
                            }}
                            onInspect={() => setInspecting(r)}
                            onOutOfService={() => setOutOfService(r)}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        {/* ── Inspections ──────────────────────────────────────────────── */}
        <TabsContent value="inspect" className="mt-4">
          {toInspect.length === 0 ? (
            <EmptyState icon={ClipboardCheck} title="Nothing waiting to inspect">
              A room appears here once its attendant marks it clean. Until somebody
              other than the attendant has passed it, it is not sellable.
            </EmptyState>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Room</TableHead>
                    <TableHead>Cleaned by</TableHead>
                    <TableHead>Took</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {toInspect.map((r) => {
                    const v = cleanVariance(r.standardMinutes ?? 0, r.actualMinutes);
                    return (
                      <TableRow key={r.roomId}>
                        <TableCell className="font-medium">{r.roomNumber}</TableCell>
                        <TableCell className="text-sm">{r.attendant ?? "—"}</TableCell>
                        <TableCell className="text-sm">
                          {r.actualMinutes === null ? "not recorded"
                            : `${r.actualMinutes} of ${r.standardMinutes} min`}
                          {v.state === "fast" && (
                            <div className="text-xs text-muted-foreground">
                              Well under the standard
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button size="sm" variant="outline" onClick={() => setInspecting(r)}>
                            Inspect
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            You cannot inspect a room you cleaned. The database refuses it on the signed-in
            account, not on the name typed into the form.
          </p>
        </TabsContent>

        {/* ── Team ─────────────────────────────────────────────────────── */}
        <TabsContent value="team" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Today's sheets against today's rota</CardTitle>
            </CardHeader>
            <CardContent>
              {workload.length === 0 ? (
                <EmptyState icon={Users} title="No staff records">
                  Attendants come from Human Resources. Their published shifts are
                  what decides how much work can be given to them.
                </EmptyState>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Attendant</TableHead>
                      <TableHead>Rostered</TableHead>
                      <TableHead>Assigned</TableHead>
                      <TableHead>Rooms</TableHead>
                      <TableHead>Finished</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {workload.map((w) => {
                      const over = w.minutesAssigned > w.minutesRostered;
                      return (
                        <TableRow key={w.employeeId}>
                          <TableCell className="font-medium">{w.name}</TableCell>
                          <TableCell className="text-sm">
                            {w.minutesRostered === 0
                              ? <span className="text-muted-foreground">not on</span>
                              : `${w.minutesRostered} min`}
                          </TableCell>
                          <TableCell className={`text-sm ${over ? "text-status-danger" : ""}`}>
                            {w.minutesAssigned} min
                          </TableCell>
                          <TableCell className="text-sm">{w.roomsAssigned}</TableCell>
                          <TableCell className="text-sm">{w.roomsFinished}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
              <p className="mt-3 text-xs text-muted-foreground">
                A sheet that exceeds somebody's rostered minutes is refused rather than
                flagged. A sheet nobody can finish is why rooms get signed clean without
                being cleaned.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Lost property ────────────────────────────────────────────── */}
        <TabsContent value="lost" className="mt-4">
          {lost.length > 0 && (
            <div className="mb-3 flex justify-end">
              <Button size="sm" variant="outline" onClick={() => setBooking(true)}>
                Book an item in
              </Button>
            </div>
          )}
          {lost.length === 0 ? (
            <EmptyState
              icon={Search}
              title="Nothing booked in"
              action={
                <Button variant="outline" onClick={() => setBooking(true)}>
                  Book an item in
                </Button>
              }
            >
              An item found in a room is held ninety days and gets a reference.
              Returning it records who it went to; disposing of it early has to
              say why.
            </EmptyState>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Reference</TableHead>
                    <TableHead>Item</TableHead>
                    <TableHead>Found</TableHead>
                    <TableHead>Held until</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lost.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="font-mono text-xs">{l.reference}</TableCell>
                      <TableCell className="text-sm">{l.description}</TableCell>
                      <TableCell className="text-sm">{l.foundOn}</TableCell>
                      <TableCell className="text-sm">{l.holdUntil ?? "—"}</TableCell>
                      <TableCell>
                        <Badge className={l.status === "HELD" ? "bg-muted text-muted-foreground"
                          : "bg-status-success-soft text-status-success"}>
                          {l.status.toLowerCase()}
                        </Badge>
                        {l.releasedTo && (
                          <div className="mt-1 text-xs text-muted-foreground">
                            to {l.releasedTo}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {l.status === "HELD" && (
                          <ReleaseButton item={l} onDone={load} />
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            Items are held ninety days. Somebody else's property is not the venue's to
            clear out because a cupboard is full — disposing early is possible and has to
            be written down.
          </p>
        </TabsContent>

        {/* ── Amenities ────────────────────────────────────────────────── */}
        <TabsContent value="stock" className="mt-4">
          {stock.length === 0 ? (
            <EmptyState icon={PackageSearch} title="No amenities configured">
              Link a product to a room type and this shows what today's cleans will
              consume against what is on the shelf. Amenities are ordinary stock in
              the same ledger as the kitchen, so reordering goes through Purchasing.
            </EmptyState>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead>Needed today</TableHead>
                    <TableHead>On hand</TableHead>
                    <TableHead>After today</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stock.map((s) => (
                    <TableRow key={s.productId}>
                      <TableCell className="font-medium">{s.productName}</TableCell>
                      <TableCell className="text-sm">{s.neededToday} {s.unit}</TableCell>
                      <TableCell className="text-sm">{s.onHand} {s.unit}</TableCell>
                      <TableCell className={`text-sm ${s.afterToday < 0 ? "text-status-danger" : ""}`}>
                        {s.afterToday} {s.unit}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            Amenities and linen are ordinary stock, counted in the same ledger as the
            kitchen. Reordering goes through Purchasing like any other buy.
          </p>
        </TabsContent>
      </Tabs>

      <InspectDialog row={inspecting} onClose={() => setInspecting(null)} onDone={load} />
      <BookDialog open={booking} rooms={board} people={people}
                  onClose={() => setBooking(false)} onDone={load} />
      <OutOfServiceDialog row={outOfService} onClose={() => setOutOfService(null)} onDone={load} />
    </div>
  );
}

function RoomActions({ row, onFinish, onInspect, onOutOfService }: {
  row: BoardRow; onFinish: () => void; onInspect: () => void; onOutOfService: () => void;
}) {
  if (row.state === "OUT_OF_SERVICE") return <span className="text-xs text-muted-foreground">—</span>;
  if (row.state === "CLEAN") {
    return <Button size="sm" variant="outline" onClick={onInspect}>Inspect</Button>;
  }
  if (row.taskId) {
    return <Button size="sm" variant="outline" onClick={onFinish}>Mark clean</Button>;
  }
  return <Button size="sm" variant="ghost" onClick={onOutOfService}>Out of service</Button>;
}

function Stat({ label, value, hint, danger }: {
  label: string; value: number; hint: string; danger?: boolean;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className={`text-2xl font-semibold ${danger && value > 0 ? "text-status-danger" : ""}`}>
          {value}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
}

function Loading() {
  return <p className="py-12 text-center text-sm text-muted-foreground">Loading…</p>;
}


function InspectDialog({ row, onClose, onDone }: {
  row: BoardRow | null; onClose: () => void; onDone: () => Promise<void>;
}) {
  const [passed, setPassed] = useState(true);
  const [score, setScore] = useState("95");
  const [findings, setFindings] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => { setPassed(true); setScore("95"); setFindings(""); }, [row]);
  if (!row || !row.taskId) return null;

  async function save() {
    setSaving(true);
    try {
      await inspectHousekeepingTask({
        taskId: row!.taskId!, passed,
        score: score ? Number(score) : null,
        findings: findings.trim() || null,
      });
      toast.success(passed ? "Passed. The room is sellable." : "Sent back to be done again.");
      onClose();
      await onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not record the inspection");
    } finally { setSaving(false); }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Inspect room {row.roomNumber}</DialogTitle>
          <DialogDescription>
            Cleaned by {row.attendant ?? "somebody"}. A pass makes the room sellable; a
            failure sends it back rather than leaving it sitting as done.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex gap-2">
            <Button variant={passed ? "default" : "outline"} onClick={() => setPassed(true)}>
              Pass
            </Button>
            <Button variant={!passed ? "default" : "outline"} onClick={() => setPassed(false)}>
              Fail
            </Button>
          </div>
          <div>
            <Label htmlFor="insp-score">Score</Label>
            <Input id="insp-score" inputMode="numeric" value={score}
                   onChange={(e) => setScore(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="insp-findings">
              Findings {!passed && <span className="text-status-danger">(required)</span>}
            </Label>
            <Textarea id="insp-findings" value={findings}
                      onChange={(e) => setFindings(e.target.value)} />
            {!passed && (
              <p className="mt-1 text-xs text-muted-foreground">
                A failure with no finding is not something an attendant can act on, and it
                is not evidence either.
              </p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>Record it</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OutOfServiceDialog({ row, onClose, onDone }: {
  row: BoardRow | null; onClose: () => void; onDone: () => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => { setReason(""); }, [row]);
  if (!row) return null;

  async function save() {
    setSaving(true);
    try {
      await setRoomState(row!.roomId, "OUT_OF_SERVICE", reason.trim());
      toast.success("Out of service");
      onClose();
      await onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Refused");
    } finally { setSaving(false); }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Take room {row.roomNumber} out of service</DialogTitle>
          <DialogDescription>
            A room out of service says why. "Out of order" with no reason is how a room
            stays unsellable for three weeks and nobody remembers what for.
          </DialogDescription>
        </DialogHeader>
        <div>
          <Label htmlFor="oos-reason">Why</Label>
          <Textarea id="oos-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving || reason.trim() === ""}>Confirm</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BookDialog({ open, rooms, people, onClose, onDone }: {
  open: boolean; rooms: BoardRow[]; people: { id: string; name: string }[];
  onClose: () => void; onDone: () => Promise<void>;
}) {
  const [description, setDescription] = useState("");
  const [roomId, setRoomId] = useState("");
  const [finder, setFinder] = useState("");
  const [storage, setStorage] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) { setDescription(""); setRoomId(""); setFinder(""); setStorage(""); }
  }, [open]);
  if (!open) return null;

  async function save() {
    setSaving(true);
    try {
      await bookLostProperty({
        description: description.trim(),
        foundInRoomId: roomId || null,
        foundByEmployeeId: finder || null,
        storageRef: storage.trim() || null,
      });
      toast.success("Booked in");
      onClose();
      await onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not book it in");
    } finally { setSaving(false); }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Book an item in</DialogTitle>
          <DialogDescription>
            It gets a reference and a ninety day hold from today.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="lf-desc">What it is</Label>
            <Input id="lf-desc" value={description}
                   onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="lf-room">Found in</Label>
            <select id="lf-room" className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm"
                    value={roomId} onChange={(e) => setRoomId(e.target.value)}>
              <option value="">Not a guest room</option>
              {rooms.map((r) => (
                <option key={r.roomId} value={r.roomId}>Room {r.roomNumber}</option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="lf-finder">Found by</Label>
            <select id="lf-finder" className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm"
                    value={finder} onChange={(e) => setFinder(e.target.value)}>
              <option value="">Not recorded</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <Label htmlFor="lf-store">Where it is stored</Label>
            <Input id="lf-store" value={storage} onChange={(e) => setStorage(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving || description.trim() === ""}>Book it in</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReleaseButton({ item, onDone }: {
  item: LostPropertyRow; onDone: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  async function save(status: "RETURNED" | "DISPOSED" | "DONATED") {
    setSaving(true);
    try {
      await releaseLostProperty({
        id: item.id, status,
        releasedTo: to.trim() || null, releaseNote: note.trim() || null,
      });
      toast.success("Recorded");
      setOpen(false);
      await onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Refused");
    } finally { setSaving(false); }
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>Release</Button>
      {open && (
        <Dialog open onOpenChange={(o) => !o && setOpen(false)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Release {item.reference}</DialogTitle>
              <DialogDescription>{item.description}</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label htmlFor="rel-to">Returned to</Label>
                <Input id="rel-to" value={to} onChange={(e) => setTo(e.target.value)}
                       placeholder="Name, and how they were identified" />
              </div>
              <div>
                <Label htmlFor="rel-note">Note</Label>
                <Textarea id="rel-note" value={note} onChange={(e) => setNote(e.target.value)} />
                <p className="mt-1 text-xs text-muted-foreground">
                  Held until {item.holdUntil}. Disposing before then needs a reason here.
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => void save("DISPOSED")} disabled={saving}>
                Dispose
              </Button>
              <Button onClick={() => void save("RETURNED")} disabled={saving || to.trim() === ""}>
                Return to owner
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
