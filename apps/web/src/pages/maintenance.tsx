// ---------------------------------------------------------------------------
// Maintenance — assets, planned work and jobs
// ---------------------------------------------------------------------------
// The page opens on what is late, not on the asset register, for the same
// reason Hygiene opens on what has not been done: a tidy list of equipment
// tells a manager nothing, and the statutory inspection nobody booked is the
// thing that ends up in a report.
//
// Every refusal here comes from the database — an uncertified technician, a
// sign-off by the person who did the work, a meter running backwards. The
// screen's job is to say the rule before the button is pressed, so a refusal
// is never the first time somebody hears about it.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from "react";
import {
  Wrench, TriangleAlert, Boxes, Gauge, Users, ShieldAlert, Check,
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
  fetchAssets, fetchMaintenanceDue, fetchWorkOrders, fetchMaintenanceManning,
  fetchMeters, createWorkOrder, assignWorkOrder, updateWorkOrderStatus,
  recordMeterReading, fetchEmployees,
  type AssetRow, type MaintenanceDueRow, type WorkOrderRow,
  type ManningRow, type MeterRow,
} from "@/data/repository";
import { isSupabaseConfigured } from "@/lib/supabase";
import {
  planDue, comparePlanUrgency, assetVerdict, manningVerdict, compareWorkOrders, isOpen,
} from "@/engine/maintenance";

const PRIORITY_CLASS: Record<string, string> = {
  EMERGENCY: "bg-status-danger-soft text-status-danger",
  HIGH: "bg-status-warning-soft text-status-warning",
  NORMAL: "bg-muted text-muted-foreground",
  LOW: "bg-muted text-muted-foreground",
};

const GRADE_CLASS: Record<string, string> = {
  replace: "bg-status-danger-soft text-status-danger",
  watch: "bg-status-warning-soft text-status-warning",
  healthy: "bg-status-success-soft text-status-success",
  unknown: "bg-muted text-muted-foreground",
};

const LOAD_CLASS: Record<string, string> = {
  over: "text-status-danger",
  full: "text-status-warning",
  ok: "text-status-success",
  idle: "text-muted-foreground",
  off: "text-muted-foreground",
};

function minutes(n: number): string {
  if (n < 60) return `${n} min`;
  const h = Math.floor(n / 60);
  const m = n % 60;
  return m === 0 ? `${h} h` : `${h} h ${m}`;
}

export function MaintenancePage() {
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [due, setDue] = useState<MaintenanceDueRow[]>([]);
  const [orders, setOrders] = useState<WorkOrderRow[]>([]);
  const [manning, setManning] = useState<ManningRow[]>([]);
  const [meters, setMeters] = useState<MeterRow[]>([]);
  const [people, setPeople] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [raising, setRaising] = useState<MaintenanceDueRow | null>(null);
  const [raisingFree, setRaisingFree] = useState(false);
  const [closing, setClosing] = useState<WorkOrderRow | null>(null);
  const [reading, setReading] = useState<MeterRow | null>(null);

  async function load() {
    if (!isSupabaseConfigured) { setLoading(false); return; }
    setLoading(true);
    try {
      const [a, d, w, m, mt, emp] = await Promise.all([
        fetchAssets(), fetchMaintenanceDue(), fetchWorkOrders(),
        fetchMaintenanceManning(), fetchMeters(), fetchEmployees(),
      ]);
      setAssets(a); setDue(d); setOrders(w); setManning(m); setMeters(mt);
      setPeople(emp.map((e) => ({ id: e.id, name: `${e.firstName} ${e.lastName}` })));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load maintenance");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const overdue = useMemo(
    () => due.filter((p) => planDue(toPlan(p)).daysOverdue >= 0)
            .sort((a, b) => comparePlanUrgency(toPlan(a), toPlan(b))),
    [due],
  );
  const statutoryLate = useMemo(
    () => due.filter((p) => planDue(toPlan(p)).statutoryBreach),
    [due],
  );
  const open = useMemo(
    () => orders.filter((w) => isOpen(w.status)).sort((a, b) => compareWorkOrders(a, b)),
    [orders],
  );
  const awaitingSignoff = useMemo(
    () => orders.filter((w) => w.status === "COMPLETED"),
    [orders],
  );

  return (
    <div className="p-6">
      <PageHeader
        title="Maintenance"
        description="Assets, planned maintenance and jobs. Assignment follows the rota and the certificates HR holds."
      >
        <Button onClick={() => setRaisingFree(true)}>
          <Wrench className="size-4" />Raise a job
        </Button>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Statutory, late"
          value={statutoryLate.length}
          hint="A legal finding, not a delay"
          danger={statutoryLate.length > 0}
        />
        <Stat label="Planned work overdue" value={overdue.length} hint={`of ${due.length} plans`} />
        <Stat label="Jobs open" value={open.length} hint={`${open.filter((w) => w.priority === "EMERGENCY").length} emergency`} />
        <Stat
          label="Waiting to be signed off"
          value={awaitingSignoff.length}
          hint="Done, not yet verified by anybody else"
        />
      </div>

      <Tabs defaultValue="due" className="mt-6">
        <TabsList>
          <TabsTrigger value="due">
            <TriangleAlert className="size-4" />Due ({overdue.length})
          </TabsTrigger>
          <TabsTrigger value="jobs">
            <Wrench className="size-4" />Work orders ({open.length})
          </TabsTrigger>
          <TabsTrigger value="assets">
            <Boxes className="size-4" />Assets ({assets.length})
          </TabsTrigger>
          <TabsTrigger value="meters">
            <Gauge className="size-4" />Meters ({meters.length})
          </TabsTrigger>
          <TabsTrigger value="team">
            <Users className="size-4" />Team
          </TabsTrigger>
        </TabsList>

        {/* ── What is late ─────────────────────────────────────────────── */}
        <TabsContent value="due" className="mt-4">
          {loading ? (
            <Loading />
          ) : overdue.length === 0 ? (
            <EmptyState icon={TriangleAlert} title="Nothing overdue">
              A maintenance plan appears here once it passes its interval. Plans are
              set against an asset or a location, and the job they produce is an
              ordinary work order.
            </EmptyState>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Plan</TableHead>
                    <TableHead>Asset</TableHead>
                    <TableHead>Due</TableHead>
                    <TableHead>Takes</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {overdue.map((p) => {
                    const d = planDue(toPlan(p));
                    return (
                      <TableRow key={p.planId}>
                        <TableCell>
                          <div className="font-medium">{p.title}</div>
                          <div className="text-xs text-muted-foreground">
                            {p.code} · every {p.intervalDays} days
                            {p.statutory && (
                              <Badge className="ml-2 bg-status-danger-soft text-status-danger">
                                <ShieldAlert className="size-3" />Statutory
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">
                          {p.assetName ?? p.locationName ?? "—"}
                        </TableCell>
                        <TableCell>
                          <span className={d.daysOverdue > 0 ? "text-status-danger" : ""}>
                            {d.daysOverdue > 0
                              ? `${d.daysOverdue} days late`
                              : d.daysOverdue === 0 ? "Today" : `in ${-d.daysOverdue} days`}
                          </span>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {minutes(p.estimatedMinutes)}
                        </TableCell>
                        <TableCell className="text-right">
                          {p.jobOpen ? (
                            <span className="text-xs text-muted-foreground">Job already open</span>
                          ) : (
                            <Button size="sm" variant="outline" onClick={() => setRaising(p)}>
                              Raise the job
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        {/* ── Jobs ─────────────────────────────────────────────────────── */}
        <TabsContent value="jobs" className="mt-4">
          {open.length === 0 ? (
            <EmptyState
              icon={Wrench}
              title="No open jobs"
              action={
                <Button variant="outline" onClick={() => setRaisingFree(true)}>
                  Raise a job
                </Button>
              }
            >
              Anything reported or planned appears here until somebody signs it off.
              A job is assigned within the rota, and to somebody who holds the
              certificate the work needs.
            </EmptyState>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Reference</TableHead>
                    <TableHead>Job</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>Assigned to</TableHead>
                    <TableHead>Due</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {open.map((w) => (
                    <TableRow key={w.id}>
                      <TableCell className="font-mono text-xs">{w.reference}</TableCell>
                      <TableCell>
                        <div className="font-medium">{w.title}</div>
                        <div className="text-xs text-muted-foreground">{w.status}</div>
                      </TableCell>
                      <TableCell>
                        <Badge className={PRIORITY_CLASS[w.priority] ?? ""}>
                          {w.priority.toLowerCase()}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <select
                          aria-label={`Assign ${w.reference}`}
                          className="h-8 rounded-md border bg-background px-2 text-sm"
                          value={w.assignedTo ?? ""}
                          onChange={async (e) => {
                            try {
                              await assignWorkOrder(w.id, e.target.value || null);
                              toast.success("Assigned");
                              await load();
                            } catch (err) {
                              // Shown as the database wrote it: it names the
                              // person and what is missing.
                              toast.error(err instanceof Error ? err.message : "Refused");
                            }
                          }}
                        >
                          <option value="">Unassigned</option>
                          {people.map((p) => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </select>
                      </TableCell>
                      <TableCell className="text-sm">{w.dueBy ?? "—"}</TableCell>
                      <TableCell className="text-right">
                        {w.status === "COMPLETED" ? (
                          <Button
                            size="sm" variant="outline"
                            onClick={async () => {
                              try {
                                await updateWorkOrderStatus(w.id, "VERIFIED");
                                toast.success("Signed off");
                                await load();
                              } catch (err) {
                                toast.error(err instanceof Error ? err.message : "Refused");
                              }
                            }}
                          >
                            <Check className="size-4" />Sign off
                          </Button>
                        ) : (
                          <Button size="sm" variant="outline" onClick={() => setClosing(w)}>
                            Complete
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {awaitingSignoff.length > 0 && (
            <p className="mt-3 text-xs text-muted-foreground">
              A job is signed off by somebody other than the person who did it. The
              database refuses your own.
            </p>
          )}
        </TabsContent>

        {/* ── Assets ───────────────────────────────────────────────────── */}
        <TabsContent value="assets" className="mt-4">
          {assets.length === 0 ? (
            <EmptyState icon={Boxes} title="No assets recorded yet">
              An asset is anything worth keeping a history against — a chiller, a
              generator, an oven. Recording what it cost is what lets the repair
              spend be judged against it later.
            </EmptyState>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Asset</TableHead>
                    <TableHead>Where</TableHead>
                    <TableHead>Faults (year)</TableHead>
                    <TableHead>Downtime</TableHead>
                    <TableHead>Verdict</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {assets.map((a) => {
                    const v = assetVerdict({
                      code: a.code, jobsYear: a.jobsYear, jobsOpen: a.jobsOpen,
                      downtimeMinutesYear: a.downtimeMinutesYear,
                      partsCostYear: a.partsCostYear, purchaseCost: a.purchaseCost,
                      criticality: a.criticality,
                    });
                    return (
                      <TableRow key={a.id}>
                        <TableCell>
                          <div className="font-medium">{a.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {a.code} · {a.category}
                            {a.criticality === "CRITICAL" && " · critical"}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">{a.locationName ?? "—"}</TableCell>
                        <TableCell className="text-sm">{a.jobsYear}</TableCell>
                        <TableCell className="text-sm">
                          {a.downtimeMinutesYear > 0 ? minutes(a.downtimeMinutesYear) : "—"}
                        </TableCell>
                        <TableCell>
                          <Badge className={GRADE_CLASS[v.grade]}>{v.grade}</Badge>
                          <div className="mt-1 text-xs text-muted-foreground">{v.reason}</div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        {/* ── Meters ───────────────────────────────────────────────────── */}
        <TabsContent value="meters" className="mt-4">
          {meters.length === 0 ? (
            <EmptyState icon={Gauge} title="No meters yet">
              Electricity, water, LPG and fuel. Readings are kept as a ledger, so
              consumption is worked out by the database rather than typed in, and a
              meter that reads backwards has to say why.
            </EmptyState>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Meter</TableHead>
                    <TableHead>Last read</TableHead>
                    <TableHead>Reading</TableHead>
                    <TableHead>Since last</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {meters.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell>
                        <div className="font-medium">{m.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {m.code} · {m.unit}{m.cumulative ? " · cumulative" : ""}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">{m.lastReadOn ?? "never"}</TableCell>
                      <TableCell className="text-sm">{m.lastReading ?? "—"}</TableCell>
                      <TableCell className="text-sm">
                        {m.lastConsumption === null
                          ? <span className="text-muted-foreground">—</span>
                          : `${m.lastConsumption} ${m.unit}`}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="outline" onClick={() => setReading(m)}>
                          Record a reading
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            A cumulative meter that reads lower than last time is refused unless you say
            it was replaced or has rolled over. Consumption across a reset is left blank
            rather than guessed.
          </p>
        </TabsContent>

        {/* ── Team ─────────────────────────────────────────────────────── */}
        <TabsContent value="team" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Who is in, and what they are carrying</CardTitle>
            </CardHeader>
            <CardContent>
              {manning.length === 0 ? (
                <EmptyState icon={Users} title="No staff records">
                  Technicians come from Human Resources. Their shifts decide who can
                  be assigned work, and their certificates decide what work.
                </EmptyState>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Technician</TableHead>
                      <TableHead>On today</TableHead>
                      <TableHead>Open</TableHead>
                      <TableHead>Late</TableHead>
                      <TableHead>Load</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {manning.map((m) => {
                      const v = manningVerdict(m);
                      return (
                        <TableRow key={m.employeeId}>
                          <TableCell className="font-medium">{m.name}</TableCell>
                          <TableCell className="text-sm">
                            {m.shiftsToday > 0 ? "Yes" : "—"}
                          </TableCell>
                          <TableCell className="text-sm">{m.jobsOpen}</TableCell>
                          <TableCell className={`text-sm ${m.jobsLate > 0 ? "text-status-danger" : ""}`}>
                            {m.jobsLate}
                          </TableCell>
                          <TableCell className={`text-sm ${LOAD_CLASS[v.state]}`}>
                            {v.note}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
              <p className="mt-3 text-xs text-muted-foreground">
                Capacity comes from the published rota. Somebody who is not on today is
                shown as off rather than as spare capacity.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <RaiseJobDialog
        plan={raising}
        free={raisingFree}
        onClose={() => { setRaising(null); setRaisingFree(false); }}
        onDone={load}
      />
      <CompleteDialog order={closing} onClose={() => setClosing(null)} onDone={load} />
      <ReadingDialog meter={reading} onClose={() => setReading(null)} onDone={load} />
    </div>
  );
}

function toPlan(p: MaintenanceDueRow) {
  return {
    code: p.code, title: p.title, intervalDays: p.intervalDays,
    estimatedMinutes: p.estimatedMinutes, statutory: p.statutory,
    lastCompletedOn: p.lastCompletedOn, jobOpen: p.jobOpen,
  };
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


function RaiseJobDialog({ plan, free, onClose, onDone }: {
  plan: MaintenanceDueRow | null; free: boolean;
  onClose: () => void; onDone: () => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [priority, setPriority] = useState("NORMAL");
  const [saving, setSaving] = useState(false);
  const openFor = plan ?? (free ? null : undefined);

  useEffect(() => {
    if (plan) { setTitle(plan.title); setPriority(plan.statutory ? "HIGH" : "NORMAL"); }
    else if (free) { setTitle(""); setPriority("NORMAL"); }
    setDetail("");
  }, [plan, free]);

  if (openFor === undefined) return null;

  async function save() {
    if (title.trim() === "") { toast.error("The job needs a title"); return; }
    setSaving(true);
    try {
      await createWorkOrder({
        title: title.trim(), detail: detail.trim() || null,
        assetId: plan?.assetId ?? null, locationId: null, costCentreId: null,
        priority, source: plan ? "PLANNED" : "REACTIVE",
        planId: plan?.planId ?? null, dueBy: plan?.dueOn ?? null,
      });
      toast.success("Job raised");
      onClose();
      await onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not raise the job");
    } finally { setSaving(false); }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{plan ? "Raise the planned job" : "Raise a job"}</DialogTitle>
          <DialogDescription>
            It takes its number from this unit's daily sequence. The number is issued on
            save, so closing this leaves no gap.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="wo-title">What needs doing</Label>
            <Input id="wo-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="wo-detail">Detail</Label>
            <Textarea id="wo-detail" value={detail} onChange={(e) => setDetail(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="wo-priority">Priority</Label>
            <select
              id="wo-priority"
              className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm"
              value={priority} onChange={(e) => setPriority(e.target.value)}
            >
              <option value="EMERGENCY">Emergency</option>
              <option value="HIGH">High</option>
              <option value="NORMAL">Normal</option>
              <option value="LOW">Low</option>
            </select>
            <p className="mt-1 text-xs text-muted-foreground">
              Emergency and high hold a guest room from being sold until the job is closed.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>Raise it</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CompleteDialog({ order, onClose, onDone }: {
  order: WorkOrderRow | null; onClose: () => void; onDone: () => Promise<void>;
}) {
  const [note, setNote] = useState("");
  const [labour, setLabour] = useState("");
  const [downtime, setDowntime] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => { setNote(""); setLabour(""); setDowntime(""); }, [order]);
  if (!order) return null;

  async function save() {
    setSaving(true);
    try {
      await updateWorkOrderStatus(order!.id, "COMPLETED", {
        completionNote: note.trim(),
        labourMinutes: labour ? Number(labour) : null,
        downtimeMinutes: downtime ? Number(downtime) : null,
      });
      toast.success("Recorded. Somebody else signs it off.");
      onClose();
      await onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not complete the job");
    } finally { setSaving(false); }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Complete {order.reference}</DialogTitle>
          <DialogDescription>
            Say what was done. The next person to open this asset reads this note, and a
            history of forty rows saying "done" cannot explain why the same pump keeps
            failing.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="wo-note">What was done</Label>
            <Textarea id="wo-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="wo-labour">Minutes worked</Label>
              <Input id="wo-labour" inputMode="numeric" value={labour}
                     onChange={(e) => setLabour(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="wo-down">Minutes out of service</Label>
              <Input id="wo-down" inputMode="numeric" value={downtime}
                     onChange={(e) => setDowntime(e.target.value)} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Downtime is not the same as time worked: a part on order keeps an asset down
            while nobody is touching it.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>Mark it done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReadingDialog({ meter, onClose, onDone }: {
  meter: MeterRow | null; onClose: () => void; onDone: () => Promise<void>;
}) {
  const [value, setValue] = useState("");
  const [reset, setReset] = useState(false);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => { setValue(""); setReset(false); setReason(""); }, [meter]);
  if (!meter) return null;

  const goesBackwards =
    meter.cumulative && meter.lastReading !== null && value !== "" &&
    Number(value) < meter.lastReading;

  async function save() {
    setSaving(true);
    try {
      await recordMeterReading({
        meterId: meter!.id, readOn: new Date().toISOString().slice(0, 10),
        reading: Number(value), reset, resetReason: reset ? reason.trim() : null, note: null,
      });
      toast.success("Reading recorded");
      onClose();
      await onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not record the reading");
    } finally { setSaving(false); }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{meter.name}</DialogTitle>
          <DialogDescription>
            {meter.lastReading === null
              ? "The first reading sets the baseline; it is not counted as consumption."
              : `Last read ${meter.lastReading} ${meter.unit} on ${meter.lastReadOn}.`}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="meter-value">Reading ({meter.unit})</Label>
            <Input id="meter-value" inputMode="decimal" value={value}
                   onChange={(e) => setValue(e.target.value)} />
          </div>
          {goesBackwards && (
            <div className="rounded-md border border-status-warning bg-status-warning-soft p-3">
              <p className="text-sm text-status-warning">
                That is lower than the last reading. A cumulative meter does not run
                backwards, so this will be refused unless the meter was replaced or has
                rolled over.
              </p>
              <label className="mt-2 flex items-center gap-2 text-sm">
                <input type="checkbox" checked={reset}
                       onChange={(e) => setReset(e.target.checked)} />
                The meter was replaced or reset
              </label>
              {reset && (
                <Input
                  className="mt-2" placeholder="What happened to it"
                  value={reason} onChange={(e) => setReason(e.target.value)}
                  aria-label="What happened to the meter"
                />
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving || value === ""}>Record it</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
