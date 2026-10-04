// ---------------------------------------------------------------------------
// The shared front door
// ---------------------------------------------------------------------------
// One screen for "something happened, or somebody wants something". Migration
// 0066 is the argument for why there is one of these rather than six; this is
// the part a porter actually uses.
//
// Two things the screen is built around, both of which are about the social
// failure rather than the technical one:
//
//   **Anybody can raise one, and watch it.** There is no permission on the
//   button and the list shows everything the venue has raised, not only what
//   this person may answer. "I reported it and nobody told me" is the
//   complaint the front door exists to answer, and a screen that hid other
//   people's requests would reproduce it.
//
//   **Late is said out loud, and so is "nothing was promised".** A kind of
//   request with no response time is neither late nor on time, and the row
//   says so rather than showing a reassuring tick. The system agreeing with
//   itself is how a board stops being read.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from "react";
import { DoorOpen, TriangleAlert, Plus, Wrench } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusChip, type StatusTone } from "@/components/shared/status-chip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  fetchRequestTypes, fetchRequests, fetchRequestLoad, raiseRequest,
  updateRequest, convertRequestToWorkOrder,
  type RequestType, type RequestRow, type RequestLoadRow, type RequestStatus,
} from "@/data/repository";
import { isSupabaseConfigured } from "@/lib/supabase";

const STATUS_TONE: Record<RequestStatus, StatusTone> = {
  NEW: "warning",
  ACKNOWLEDGED: "info",
  IN_PROGRESS: "info",
  BLOCKED: "warning",
  RESOLVED: "success",
  CLOSED: "neutral",
  REJECTED: "neutral",
};

const STATUS_LABEL: Record<RequestStatus, string> = {
  NEW: "Nobody has looked",
  ACKNOWLEDGED: "Somebody has it",
  IN_PROGRESS: "Being done",
  BLOCKED: "Waiting on something",
  RESOLVED: "Done",
  CLOSED: "Closed",
  REJECTED: "Not happening",
};

/** How long it has been waiting, in words somebody says out loud. */
function waited(hours: number): string {
  if (hours < 1) return "under an hour";
  if (hours < 24) return `${Math.round(hours)} hours`;
  const days = Math.round(hours / 24);
  return days === 1 ? "a day" : `${days} days`;
}

export function RequestsPage() {
  const [types, setTypes] = useState<RequestType[]>([]);
  const [rows, setRows] = useState<RequestRow[]>([]);
  const [load, setLoad] = useState<RequestLoadRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [raising, setRaising] = useState(false);
  const [answering, setAnswering] = useState<RequestRow | null>(null);

  async function reload() {
    if (!isSupabaseConfigured) { setLoading(false); return; }
    setLoading(true);
    try {
      const [t, r, l] = await Promise.all([
        fetchRequestTypes(), fetchRequests(), fetchRequestLoad(),
      ]);
      setTypes(t.filter((x) => x.active));
      setRows(r);
      setLoad(l);
    } catch (err) {
      toast.error("Could not read the requests", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void reload(); }, []);

  const open = useMemo(
    () => rows.filter((r) => !["CLOSED", "REJECTED"].includes(r.status)),
    [rows],
  );
  const unanswered = useMemo(() => open.filter((r) => r.status === "NEW"), [open]);
  const late = useMemo(() => open.filter((r) => r.answeredLate === true), [open]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Requests"
        description="Anything one department needs from another. Anybody can raise one; the department it goes to answers it."
      >
        <Button onClick={() => setRaising(true)} disabled={types.length === 0}>
          <Plus aria-hidden="true" />Raise a request
        </Button>
      </PageHeader>

      {late.length > 0 && (
        <Card className="border-destructive/40">
          <CardContent className="flex items-center gap-3 py-4">
            <TriangleAlert className="size-5 text-destructive" aria-hidden="true" />
            <div className="text-sm">
              <p className="font-medium">
                {late.length} {late.length === 1 ? "request is" : "requests are"} past
                the time somebody promised
              </p>
              <p className="text-muted-foreground">
                {late.map((r) => `${r.reference} (${r.unitName})`).join(", ")}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="open">
        <TabsList>
          {/*
            * Two figures, because they answer different questions. "Open" is
            * how much work is in flight; "nobody has looked" is how many
            * people are still waiting to hear anything at all, which is the
            * one this screen exists to make visible.
            */}
          <TabsTrigger value="open">
            Open ({open.length})
            {unanswered.length > 0 && ` · ${unanswered.length} unlooked-at`}
          </TabsTrigger>
          <TabsTrigger value="departments">By department</TabsTrigger>
          <TabsTrigger value="all">Everything ({rows.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="open" className="mt-4">
          <RequestTable
            rows={open} loading={loading} onAnswer={setAnswering}
            empty="Nothing is waiting on anybody"
            emptyDetail="A request is how one department asks another for something — a broken tap, a guest complaint, a shift nobody can cover."
          />
        </TabsContent>

        <TabsContent value="departments" className="mt-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">What each department is sitting on</CardTitle>
              <p className="pt-1 text-xs text-muted-foreground">
                Unanswered is the figure that matters: a request nobody has even
                looked at is the one somebody is still waiting on.
              </p>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Department</TableHead>
                    <TableHead className="text-right">Open</TableHead>
                    <TableHead className="text-right">Unanswered</TableHead>
                    <TableHead className="text-right">Past the promise</TableHead>
                    <TableHead className="text-right">Emergencies</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {load.map((u) => (
                    <TableRow key={u.businessUnitId}>
                      <TableCell className="font-medium">{u.unitName}</TableCell>
                      <TableCell className="text-right">{u.openCount || "—"}</TableCell>
                      <TableCell className="text-right">{u.unansweredCount || "—"}</TableCell>
                      <TableCell className="text-right">
                        {u.overdueCount > 0
                          ? <span className="text-destructive">{u.overdueCount}</span>
                          : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        {u.emergencyCount > 0
                          ? <span className="text-destructive">{u.emergencyCount}</span>
                          : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="all" className="mt-4">
          <RequestTable
            rows={rows} loading={loading} onAnswer={setAnswering}
            empty="Nothing has been raised yet"
            emptyDetail="Everything raised stays here, including what was rejected and why."
          />
        </TabsContent>
      </Tabs>

      {raising && (
        <RaiseDialog
          types={types}
          onClose={() => setRaising(false)}
          onDone={() => { setRaising(false); void reload(); }}
        />
      )}

      {answering && (
        <AnswerDialog
          request={answering}
          onClose={() => setAnswering(null)}
          onDone={() => { setAnswering(null); void reload(); }}
        />
      )}

      <p className="text-xs text-muted-foreground">
        {/*
          * Said on the screen rather than only in a migration comment, because
          * the person reading a board of unanswered requests is the one who
          * needs to know whether anybody was actually told.
          */}
        Nobody is emailed about these yet. The queue is filling and the part
        that sends needs a mail provider to be configured — until then, this
        screen is where a request is seen.
      </p>
    </div>
  );
}

function RequestTable({
  rows, loading, onAnswer, empty, emptyDetail,
}: {
  rows: RequestRow[];
  loading: boolean;
  onAnswer: (r: RequestRow) => void;
  empty: string;
  emptyDetail: string;
}) {
  if (loading) {
    return <p className="py-12 text-center text-sm text-muted-foreground">Loading…</p>;
  }
  if (rows.length === 0) {
    return <EmptyState icon={DoorOpen} title={empty}>{emptyDetail}</EmptyState>;
  }
  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Number</TableHead>
            <TableHead>What</TableHead>
            <TableHead>Asked of</TableHead>
            <TableHead>Waiting</TableHead>
            <TableHead>State</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="font-mono text-xs">{r.reference}</TableCell>
              <TableCell>
                <div className="font-medium">{r.title}</div>
                <div className="text-xs text-muted-foreground">
                  {r.kindName}
                  {r.locationName ? ` · ${r.locationName}` : ""}
                  {r.raisedFromUnit ? ` · from ${r.raisedFromUnit}` : ""}
                </div>
              </TableCell>
              <TableCell>{r.unitName}</TableCell>
              <TableCell>
                <span className={r.answeredLate === true ? "text-destructive" : undefined}>
                  {waited(r.hoursOpen)}
                </span>
                {/*
                  * Three states, not two. Null is a kind of request nobody
                  * promised to answer, and calling that "on time" would be the
                  * system marking its own homework.
                  */}
                <div className="text-xs text-muted-foreground">
                  {r.answeredLate === null
                    ? "no time promised"
                    : r.answeredLate
                      ? "past the promise"
                      : "within the promise"}
                </div>
              </TableCell>
              <TableCell>
                <StatusChip tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</StatusChip>
                {r.convertedType && (
                  <div className="pt-1 text-xs text-muted-foreground">
                    became a maintenance job
                  </div>
                )}
              </TableCell>
              <TableCell className="text-right">
                <Button variant="ghost" size="sm" onClick={() => onAnswer(r)}>
                  Open
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function RaiseDialog({
  types, onClose, onDone,
}: {
  types: RequestType[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [typeId, setTypeId] = useState(types[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);

  const kind = types.find((t) => t.id === typeId);
  const valid = typeId !== "" && title.trim() !== "";

  async function save() {
    setBusy(true);
    try {
      await raiseRequest({ requestTypeId: typeId, title: title.trim(), detail: detail.trim() || null });
      toast.success("Raised", {
        description: kind?.respondWithinHours
          ? `Somebody should pick it up within ${kind.respondWithinHours} hours.`
          : "Nobody has promised a time for this kind of request.",
      });
      onDone();
    } catch (err) {
      toast.error("Could not raise it", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Raise a request</DialogTitle>
          <DialogDescription>
            The kind decides which department it goes to, so there is nothing to
            address.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="rq-kind">What is it</Label>
            <select
              id="rq-kind"
              className="h-9 w-full rounded-md border bg-transparent px-2 text-sm"
              value={typeId}
              onChange={(e) => setTypeId(e.target.value)}
            >
              {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            {kind?.description && (
              <p className="text-xs text-muted-foreground">{kind.description}</p>
            )}
          </div>
          <div className="space-y-1">
            <Label htmlFor="rq-title">In one line</Label>
            <Input id="rq-title" value={title} onChange={(e) => setTitle(e.target.value)}
              placeholder="The tap in the prep sink will not turn off" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="rq-detail">Anything else</Label>
            <Textarea id="rq-detail" rows={3} value={detail}
              onChange={(e) => setDetail(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => void save()} disabled={!valid || busy}>Raise it</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AnswerDialog({
  request, onClose, onDone,
}: {
  request: RequestRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const [resolution, setResolution] = useState(request.resolution ?? "");
  const [busy, setBusy] = useState(false);

  async function move(status: RequestStatus) {
    if (status === "REJECTED" && resolution.trim() === "") {
      toast.error("Say why", {
        description: "A request turned down without a reason is a door shut in somebody's face.",
      });
      return;
    }
    setBusy(true);
    try {
      await updateRequest(request.id, {
        status,
        resolution: resolution.trim() || null,
      });
      toast.success(STATUS_LABEL[status]);
      onDone();
    } catch (err) {
      toast.error("Could not change it", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  }

  async function convert() {
    setBusy(true);
    try {
      await convertRequestToWorkOrder(request.id, resolution.trim() || null);
      toast.success("Turned into a maintenance job", {
        description: "The request stays, and says where the job is.",
      });
      onDone();
    } catch (err) {
      toast.error("Could not turn it into a job", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{request.reference}</DialogTitle>
          <DialogDescription>
            {request.kindName} · asked of {request.unitName} · waiting{" "}
            {waited(request.hoursOpen)}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <p className="font-medium">{request.title}</p>
            {request.detail && (
              <p className="whitespace-pre-wrap pt-1 text-sm text-muted-foreground">
                {request.detail}
              </p>
            )}
            <p className="pt-2 text-xs text-muted-foreground">
              Raised by {request.raisedByEmail ?? "somebody"}
              {request.locationName ? ` · ${request.locationName}` : ""}
            </p>
          </div>

          <div className="space-y-1">
            <Label htmlFor="rq-resolution">What happened</Label>
            <Textarea id="rq-resolution" rows={3} value={resolution}
              onChange={(e) => setResolution(e.target.value)}
              placeholder="Needed for turning it down; useful for everything else." />
          </div>

          {request.convertedType && (
            <p className="text-sm text-muted-foreground">
              This became a maintenance job. The job is where the work is tracked.
            </p>
          )}
        </div>
        <DialogFooter className="flex-wrap gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>Close</Button>
          {!request.convertedType && (
            <Button variant="outline" onClick={() => void convert()} disabled={busy}>
              <Wrench aria-hidden="true" />Make it a job
            </Button>
          )}
          <Button variant="outline" onClick={() => void move("REJECTED")} disabled={busy}>
            Turn it down
          </Button>
          {request.status === "NEW" && (
            <Button onClick={() => void move("ACKNOWLEDGED")} disabled={busy}>
              I have this
            </Button>
          )}
          {request.status !== "NEW" && (
            <Button onClick={() => void move("RESOLVED")} disabled={busy}>
              Done
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
