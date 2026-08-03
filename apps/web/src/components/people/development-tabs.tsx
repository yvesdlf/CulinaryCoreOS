// ---------------------------------------------------------------------------
// Training, competency, performance and HR cases
// ---------------------------------------------------------------------------
// The development half of People. Four things that share a page because they
// are the same conversation at different lengths: what somebody has been
// taught, what they can demonstrably do, how the year went, and the things
// that had to be handled formally.
//
// HR cases sit here but are not like the others. They are visible only to the
// people named on them, so a case somebody else opened is not merely hidden
// from this list — it was never fetched.
// ---------------------------------------------------------------------------

import { useMemo, useState } from "react";
import {
  GraduationCap, Target, ClipboardCheck, Lock, Plus, Check,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PermissionGate } from "@/components/shared/permission-gate";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { fullName, isWorking, type Employee } from "@/engine/people";
import {
  saveTrainingCourse, assignTraining, completeTraining,
  saveCompetency, assessCompetency, saveReview, openHrCase, updateHrCase,
  type TrainingCourse, type TrainingAssignmentRow, type Competency,
  type CompetencyAssessment, type PerformanceReview, type HrCase, type JobRole,
} from "@/data/repository";

/** What each competency level means, so an assessment is comparable. */
const LEVELS = [
  "1 — learning, needs supervision",
  "2 — does it with support",
  "3 — independent",
  "4 — teaches others",
];

export function TrainingTab({
  courses, assignments, employees, onDone,
}: {
  courses: TrainingCourse[]; assignments: TrainingAssignmentRow[];
  employees: Employee[]; onDone: () => void | Promise<void>;
}) {
  const [editing, setEditing] = useState<TrainingCourse | "new" | null>(null);
  const [assigning, setAssigning] = useState<TrainingCourse | null>(null);
  const byId = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees]);

  const outstanding = assignments.filter((a) => !a.completedOn);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {courses.length} course{courses.length === 1 ? "" : "s"},{" "}
          {outstanding.length} outstanding
        </p>
        <PermissionGate>
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus className="size-4" />New course
          </Button>
        </PermissionGate>
      </div>

      {courses.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No courses yet. A course that grants a certification issues it on
          completion, which is what the rota checks before rostering somebody.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Course</TableHead>
                <TableHead>Grants</TableHead>
                <TableHead>Valid for</TableHead>
                <TableHead className="text-right">Assigned</TableHead>
                <TableHead className="w-px" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {courses.map((c) => {
                const mine = assignments.filter((a) => a.courseId === c.id);
                return (
                  <TableRow key={c.id}>
                    <TableCell className="font-mono text-xs">{c.code}</TableCell>
                    <TableCell className="font-medium">{c.title}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {c.grantsCertification ?? "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {c.validMonths ? `${c.validMonths} months` : "does not expire"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {mine.filter((a) => a.completedOn).length}/{mine.length}
                    </TableCell>
                    <TableCell>
                      <PermissionGate>
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="ghost" onClick={() => setAssigning(c)}>
                            Assign
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditing(c)}>
                            Edit
                          </Button>
                        </div>
                      </PermissionGate>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {outstanding.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-medium">Outstanding</h2>
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Who</TableHead>
                  <TableHead>Course</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead className="w-px" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {outstanding.map((a) => {
                  const late = a.dueOn && a.dueOn < new Date().toISOString().slice(0, 10);
                  return (
                    <TableRow key={a.id}>
                      <TableCell className="font-medium">
                        {byId.has(a.employeeId) ? fullName(byId.get(a.employeeId)!) : "Unknown"}
                      </TableCell>
                      <TableCell>
                        {courses.find((c) => c.id === a.courseId)?.title ?? "—"}
                      </TableCell>
                      <TableCell className={late ? "text-status-warning" : "text-muted-foreground"}>
                        {a.dueOn ?? "—"}{late && " (late)"}
                      </TableCell>
                      <TableCell>
                        <PermissionGate>
                          <Button size="sm" variant="ghost" onClick={async () => {
                            await completeTraining(a.id, null);
                            toast.success("Marked complete", {
                              description: "Any certificate it grants has been issued.",
                            });
                            await onDone();
                          }}>
                            <Check className="size-4" />Complete
                          </Button>
                        </PermissionGate>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {editing && (
        <CourseDialog course={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onDone={async () => { setEditing(null); await onDone(); }} />
      )}
      {assigning && (
        <AssignDialog course={assigning} employees={employees}
          onClose={() => setAssigning(null)}
          onDone={async () => { setAssigning(null); await onDone(); }} />
      )}
    </div>
  );
}

function CourseDialog({ course, onClose, onDone }: {
  course: TrainingCourse | null; onClose: () => void; onDone: () => void | Promise<void>;
}) {
  const [f, setF] = useState({
    code: course?.code ?? "", title: course?.title ?? "",
    description: course?.description ?? "",
    grants: course?.grantsCertification ?? "",
    months: course?.validMonths?.toString() ?? "",
  });
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{course ? "Edit course" : "New course"}</DialogTitle>
          <DialogDescription>
            A course that grants a certification issues it on completion, so
            the rota stops refusing somebody who did the training last week.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="c-code">Code</Label>
              <Input id="c-code" value={f.code} placeholder="ALG-01"
                onChange={(e) => setF({ ...f, code: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="c-months">Certificate valid for (months)</Label>
              <Input id="c-months" type="number" min="0" value={f.months}
                placeholder="blank = never expires"
                onChange={(e) => setF({ ...f, months: e.target.value })} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="c-title">Title</Label>
            <Input id="c-title" value={f.title}
              onChange={(e) => setF({ ...f, title: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="c-grants">Grants which certification</Label>
            <Input id="c-grants" value={f.grants} placeholder="ALLERGEN, FOOD_SAFETY_L2"
              onChange={(e) => setF({ ...f, grants: e.target.value })} />
            <p className="text-xs text-muted-foreground">
              Must match what a job role requires, or the rota will not see it.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button disabled={busy || !f.code.trim() || !f.title.trim()} onClick={async () => {
            setBusy(true);
            try {
              await saveTrainingCourse({
                id: course?.id, code: f.code.trim(), title: f.title.trim(),
                description: f.description.trim() || null,
                grantsCertification: f.grants.trim() || null,
                validMonths: f.months === "" ? null : Number(f.months),
              });
              toast.success("Saved"); await onDone();
            } catch (err) {
              toast.error("Could not save", {
                description: err instanceof Error ? err.message : String(err),
              });
            } finally { setBusy(false); }
          }}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AssignDialog({ course, employees, onClose, onDone }: {
  course: TrainingCourse; employees: Employee[];
  onClose: () => void; onDone: () => void | Promise<void>;
}) {
  const [who, setWho] = useState<string[]>([]);
  const [dueOn, setDueOn] = useState("");
  const [busy, setBusy] = useState(false);
  const working = employees.filter(isWorking);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Assign {course.title}</DialogTitle>
          <DialogDescription>Who needs to do it, and by when.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="a-due">Due by</Label>
            <Input id="a-due" type="date" value={dueOn}
              onChange={(e) => setDueOn(e.target.value)} />
          </div>
          <div className="max-h-52 space-y-1 overflow-y-auto rounded-lg border p-2">
            {working.map((e) => (
              <label key={e.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={who.includes(e.id)}
                  onChange={(ev) => setWho((w) =>
                    ev.target.checked ? [...w, e.id] : w.filter((x) => x !== e.id))} />
                {fullName(e)}
              </label>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button disabled={busy || who.length === 0} onClick={async () => {
            setBusy(true);
            let done = 0;
            for (const id of who) {
              // Assigning somebody twice is not an error worth stopping for.
              try { await assignTraining(course.id, id, dueOn || null); done++; } catch { /* already assigned */ }
            }
            toast.success(`Assigned to ${done}`);
            setBusy(false); await onDone();
          }}>Assign</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CompetencyTab({
  competencies, assessments, employees, roles, onDone,
}: {
  competencies: Competency[]; assessments: CompetencyAssessment[];
  employees: Employee[]; roles: JobRole[]; onDone: () => void | Promise<void>;
}) {
  const [editing, setEditing] = useState<Competency | "new" | null>(null);
  const [assessing, setAssessing] = useState<Competency | null>(null);
  const byId = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees]);

  /** The latest assessment per person per competency — the matrix. */
  const latest = useMemo(() => {
    const m = new Map<string, CompetencyAssessment>();
    for (const a of [...assessments].sort((x, y) => x.assessedOn.localeCompare(y.assessedOn))) {
      m.set(`${a.competencyId}|${a.employeeId}`, a);
    }
    return m;
  }, [assessments]);

  const working = employees.filter(isWorking);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Assessed against observable criteria by a named person. No score is
          computed from anything.
        </p>
        <PermissionGate>
          <Button size="sm" onClick={() => setEditing("new")}>New competency</Button>
        </PermissionGate>
      </div>

      {competencies.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          None defined yet.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Competency</TableHead>
                {working.map((e) => (
                  <TableHead key={e.id} className="text-center text-xs">
                    {e.firstName}
                  </TableHead>
                ))}
                <TableHead className="w-px" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {competencies.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <div className="font-medium">{c.name}</div>
                    <div className="max-w-md whitespace-normal text-xs text-muted-foreground">
                      {c.criteria}
                    </div>
                  </TableCell>
                  {working.map((e) => {
                    const a = latest.get(`${c.id}|${e.id}`);
                    return (
                      <TableCell key={e.id} className="text-center">
                        {a ? (
                          <span className={`inline-flex size-6 items-center justify-center rounded-full text-xs font-medium ${
                            a.level >= 3 ? "bg-status-success-soft text-status-success"
                            : a.level === 2 ? "bg-status-info-soft text-status-info"
                            : "bg-status-warning-soft text-status-warning"}`}>
                            {a.level}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    );
                  })}
                  <TableCell>
                    <PermissionGate>
                      <Button size="sm" variant="ghost" onClick={() => setAssessing(c)}>
                        Assess
                      </Button>
                    </PermissionGate>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {editing && (
        <CompetencyDialog competency={editing === "new" ? null : editing} roles={roles}
          onClose={() => setEditing(null)}
          onDone={async () => { setEditing(null); await onDone(); }} />
      )}
      {assessing && (
        <AssessDialog competency={assessing} employees={working}
          onClose={() => setAssessing(null)}
          onDone={async () => { setAssessing(null); await onDone(); }} />
      )}
    </div>
  );
}

function CompetencyDialog({ competency, roles, onClose, onDone }: {
  competency: Competency | null; roles: JobRole[];
  onClose: () => void; onDone: () => void | Promise<void>;
}) {
  const [name, setName] = useState(competency?.name ?? "");
  const [criteria, setCriteria] = useState(competency?.criteria ?? "");
  const [roleId, setRoleId] = useState(competency?.jobRoleId ?? "");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{competency ? "Edit" : "New"} competency</DialogTitle>
          <DialogDescription>
            Write what good looks like. A competency without observable
            criteria is an opinion with a job title.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="k-name">Name</Label>
            <Input id="k-name" value={name} placeholder="Knife skills — butchery"
              onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="k-criteria">What good looks like</Label>
            <Textarea id="k-criteria" rows={3} value={criteria}
              placeholder="Breaks down a whole fish to portion-ready fillets within 6 minutes, yield above 45%, no bone fragments."
              onChange={(e) => setCriteria(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="k-role">Applies to role</Label>
            <select id="k-role" className="h-9 w-full rounded-md border bg-transparent px-2 text-sm"
              value={roleId} onChange={(e) => setRoleId(e.target.value)}>
              <option value="">Any</option>
              {roles.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
            </select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button disabled={busy || !name.trim() || !criteria.trim()} onClick={async () => {
            setBusy(true);
            try {
              await saveCompetency({ id: competency?.id, name: name.trim(),
                criteria: criteria.trim(), jobRoleId: roleId || null });
              toast.success("Saved"); await onDone();
            } catch (err) {
              toast.error("Could not save", {
                description: err instanceof Error ? err.message : String(err),
              });
            } finally { setBusy(false); }
          }}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AssessDialog({ competency, employees, onClose, onDone }: {
  competency: Competency; employees: Employee[];
  onClose: () => void; onDone: () => void | Promise<void>;
}) {
  const [employeeId, setEmployeeId] = useState(employees[0]?.id ?? "");
  const [level, setLevel] = useState(2);
  const [evidence, setEvidence] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Assess {competency.name}</DialogTitle>
          <DialogDescription>{competency.criteria}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="as-who">Who</Label>
            <select id="as-who" className="h-9 w-full rounded-md border bg-transparent px-2 text-sm"
              value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
              {employees.map((e) => <option key={e.id} value={e.id}>{fullName(e)}</option>)}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="as-level">Level</Label>
            <select id="as-level" className="h-9 w-full rounded-md border bg-transparent px-2 text-sm"
              value={level} onChange={(e) => setLevel(Number(e.target.value))}>
              {LEVELS.map((l, i) => <option key={i} value={i + 1}>{l}</option>)}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="as-ev">Evidence</Label>
            <Textarea id="as-ev" rows={2} value={evidence}
              placeholder="What you saw, and when"
              onChange={(e) => setEvidence(e.target.value)} />
            <p className="text-xs text-muted-foreground">
              Required. An assessment without evidence cannot be discussed.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button disabled={busy || !evidence.trim()} onClick={async () => {
            setBusy(true);
            try {
              await assessCompetency({ competencyId: competency.id, employeeId,
                level, evidence: evidence.trim() });
              toast.success("Recorded"); await onDone();
            } catch (err) {
              toast.error("Could not record", {
                description: err instanceof Error ? err.message : String(err),
              });
            } finally { setBusy(false); }
          }}>Record</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ReviewsTab({ reviews, employees, onDone }: {
  reviews: PerformanceReview[]; employees: Employee[];
  onDone: () => void | Promise<void>;
}) {
  const [editing, setEditing] = useState<PerformanceReview | "new" | null>(null);
  const byId = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          No numeric rating, on purpose. A number invites ranking people
          against each other rather than against what the job asks.
        </p>
        <PermissionGate>
          <Button size="sm" onClick={() => setEditing("new")}>New review</Button>
        </PermissionGate>
      </div>

      {reviews.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No reviews yet.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Who</TableHead>
                <TableHead>Period</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-px" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {reviews.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">
                    {byId.has(r.employeeId) ? fullName(byId.get(r.employeeId)!) : "Unknown"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {r.periodStart} to {r.periodEnd}
                  </TableCell>
                  <TableCell className="text-xs">{r.kind.toLowerCase().replace(/_/g, " ")}</TableCell>
                  <TableCell className="text-sm">
                    {r.status.toLowerCase().replace(/_/g, " ")}
                  </TableCell>
                  <TableCell>
                    <PermissionGate>
                      <Button size="sm" variant="ghost" onClick={() => setEditing(r)}>
                        Open
                      </Button>
                    </PermissionGate>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {editing && (
        <ReviewDialog review={editing === "new" ? null : editing} employees={employees}
          onClose={() => setEditing(null)}
          onDone={async () => { setEditing(null); await onDone(); }} />
      )}
    </div>
  );
}

function ReviewDialog({ review, employees, onClose, onDone }: {
  review: PerformanceReview | null; employees: Employee[];
  onClose: () => void; onDone: () => void | Promise<void>;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({
    employeeId: review?.employeeId ?? employees[0]?.id ?? "",
    periodStart: review?.periodStart ?? `${new Date().getFullYear()}-01-01`,
    periodEnd: review?.periodEnd ?? today,
    kind: review?.kind ?? "ANNUAL",
    status: review?.status ?? "DRAFT",
    selfComments: review?.selfComments ?? "",
    managerComments: review?.managerComments ?? "",
    agreedActions: review?.agreedActions ?? "",
  });
  const [busy, setBusy] = useState(false);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{review ? "Review" : "New review"}</DialogTitle>
          <DialogDescription>
            A completed review cannot be signed off by the person it is about.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="r-who">Who</Label>
              <select id="r-who" className="h-9 w-full rounded-md border bg-transparent px-2 text-sm"
                value={f.employeeId} disabled={Boolean(review)}
                onChange={(e) => setF({ ...f, employeeId: e.target.value })}>
                {employees.map((e) => <option key={e.id} value={e.id}>{fullName(e)}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="r-kind">Kind</Label>
              <select id="r-kind" className="h-9 w-full rounded-md border bg-transparent px-2 text-sm"
                value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
                {["PROBATION", "30_60_90", "QUARTERLY", "ANNUAL"].map((k) => (
                  <option key={k} value={k}>{k.toLowerCase().replace(/_/g, " ")}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="r-from">From</Label>
              <Input id="r-from" type="date" value={f.periodStart}
                onChange={(e) => setF({ ...f, periodStart: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="r-to">To</Label>
              <Input id="r-to" type="date" value={f.periodEnd}
                onChange={(e) => setF({ ...f, periodEnd: e.target.value })} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="r-self">What they said</Label>
            <Textarea id="r-self" rows={2} value={f.selfComments}
              onChange={(e) => setF({ ...f, selfComments: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="r-mgr">What the manager said</Label>
            <Textarea id="r-mgr" rows={2} value={f.managerComments}
              onChange={(e) => setF({ ...f, managerComments: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="r-act">Agreed actions</Label>
            <Textarea id="r-act" rows={2} value={f.agreedActions}
              onChange={(e) => setF({ ...f, agreedActions: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="r-status">Status</Label>
            <select id="r-status" className="h-9 w-full rounded-md border bg-transparent px-2 text-sm"
              value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
              {["DRAFT", "SELF_REVIEW", "MANAGER_REVIEW", "COMPLETE"].map((s) => (
                <option key={s} value={s}>{s.toLowerCase().replace(/_/g, " ")}</option>
              ))}
            </select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button disabled={busy} onClick={async () => {
            setBusy(true);
            try {
              await saveReview({ id: review?.id, ...f,
                selfComments: f.selfComments || null,
                managerComments: f.managerComments || null,
                agreedActions: f.agreedActions || null });
              toast.success("Saved"); await onDone();
            } catch (err) {
              // The segregation-of-duties refusal arrives here.
              toast.error("Refused", {
                description: err instanceof Error ? err.message : String(err),
              });
            } finally { setBusy(false); }
          }}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CasesTab({ cases, employees, onDone }: {
  cases: HrCase[]; employees: Employee[]; onDone: () => void | Promise<void>;
}) {
  const [opening, setOpening] = useState(false);
  const byId = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees]);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <p className="flex gap-2 text-sm text-muted-foreground">
          <Lock className="mt-0.5 size-4 shrink-0" />
          Only the people named on a case can see it. A case somebody else
          opened is not hidden from this list — it was never fetched.
        </p>
        <PermissionGate>
          <Button size="sm" onClick={() => setOpening(true)}>Open a case</Button>
        </PermissionGate>
      </div>

      {cases.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No cases you are named on.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Reference</TableHead>
                <TableHead>About</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Summary</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-px" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {cases.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-mono text-xs">{c.reference}</TableCell>
                  <TableCell className="font-medium">
                    {byId.has(c.employeeId) ? fullName(byId.get(c.employeeId)!) : "—"}
                  </TableCell>
                  <TableCell className="text-xs">{c.kind.toLowerCase()}</TableCell>
                  <TableCell className="max-w-md whitespace-normal text-sm">
                    {c.summary}
                  </TableCell>
                  <TableCell className="text-sm">{c.status.toLowerCase().replace("_", " ")}</TableCell>
                  <TableCell>
                    <PermissionGate>
                      <select className="h-8 rounded-md border bg-transparent px-2 text-xs"
                        aria-label={`Status for ${c.reference}`}
                        value={c.status}
                        onChange={async (e) => {
                          await updateHrCase(c.id, e.target.value, c.outcome);
                          toast.success("Updated"); await onDone();
                        }}>
                        {["OPEN", "IN_PROGRESS", "RESOLVED", "WITHDRAWN", "ESCALATED"].map((s) => (
                          <option key={s} value={s}>{s.toLowerCase().replace("_", " ")}</option>
                        ))}
                      </select>
                    </PermissionGate>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {opening && (
        <CaseDialog employees={employees} existing={cases.map((c) => c.reference)}
          onClose={() => setOpening(false)}
          onDone={async () => { setOpening(false); await onDone(); }} />
      )}
    </div>
  );
}

function CaseDialog({ employees, existing, onClose, onDone }: {
  employees: Employee[]; existing: string[];
  onClose: () => void; onDone: () => void | Promise<void>;
}) {
  const year = new Date().getFullYear();
  const next = `HR-${year}-${String(existing.length + 1).padStart(3, "0")}`;
  const [f, setF] = useState({
    employeeId: employees[0]?.id ?? "", reference: next, kind: "CONDUCT",
    summary: "", detail: "", participants: "",
  });
  const [busy, setBusy] = useState(false);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Open a case</DialogTitle>
          <DialogDescription>
            Restricted to the people you name. You are added automatically —
            otherwise you would not be able to see it yourself.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="hc-who">About</Label>
              <select id="hc-who" className="h-9 w-full rounded-md border bg-transparent px-2 text-sm"
                value={f.employeeId} onChange={(e) => setF({ ...f, employeeId: e.target.value })}>
                {employees.map((e) => <option key={e.id} value={e.id}>{fullName(e)}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="hc-kind">Kind</Label>
              <select id="hc-kind" className="h-9 w-full rounded-md border bg-transparent px-2 text-sm"
                value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
                {["CONDUCT", "PERFORMANCE", "GRIEVANCE", "INVESTIGATION", "RECOGNITION"].map((k) => (
                  <option key={k} value={k}>{k.toLowerCase()}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="hc-sum">Summary</Label>
            <Input id="hc-sum" value={f.summary}
              onChange={(e) => setF({ ...f, summary: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="hc-det">Detail</Label>
            <Textarea id="hc-det" rows={3} value={f.detail}
              onChange={(e) => setF({ ...f, detail: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="hc-part">Who else may see it</Label>
            <Input id="hc-part" value={f.participants}
              placeholder="comma-separated email addresses"
              onChange={(e) => setF({ ...f, participants: e.target.value })} />
            <p className="text-xs text-muted-foreground">
              Nobody else will, apart from an organisation owner.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button disabled={busy || !f.summary.trim()} onClick={async () => {
            setBusy(true);
            try {
              await openHrCase({
                employeeId: f.employeeId, reference: f.reference.trim(),
                kind: f.kind, summary: f.summary.trim(),
                detail: f.detail.trim() || null,
                participants: f.participants.split(",").map((s) => s.trim()).filter(Boolean),
              });
              toast.success("Case opened"); await onDone();
            } catch (err) {
              toast.error("Could not open it", {
                description: err instanceof Error ? err.message : String(err),
              });
            } finally { setBusy(false); }
          }}>Open</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
