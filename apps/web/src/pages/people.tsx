// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------
// Who works here, what they are qualified to do, and what leave they have.
//
// Deliberately not here: payroll. The brief is explicit that tax, statutory
// filing and payment belong to a specialist provider, and a half-built payroll
// engine is worse than none because it produces numbers people believe.
//
// Also deliberately not here: restricted personal data. Bank details, national
// identifiers and dates of birth live in a separate table with a narrower
// policy, and this page never reads it. A chef with write access to recipes
// has no business reaching a colleague's bank account by widening a select.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from "react";
import { Users, CalendarDays, BadgeCheck, Plus, Check, X, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/layout/page-header";
import { PermissionGate } from "@/components/shared/permission-gate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  fullName, isWorking, headcount, leaveBalance, overlappingLeave,
  checkEligibility, lapsingCertifications,
  type Employee, type Certification, type LeaveRequest, type LeaveType,
} from "@/engine/people";
import {
  fetchEmployees, fetchDepartments, fetchJobRoles, fetchCertifications,
  fetchLeaveTypes, fetchLeaveRequests, upsertEmployee, requestLeave, decideLeave,
  type Department, type JobRole,
} from "@/data/repository";
import { isSupabaseConfigured } from "@/lib/supabase";
import { RotaTab, AttendanceTab, LifecycleTab } from "@/components/people/rota-tabs";
import {
  fetchShifts, fetchAttendance, fetchOpenEntries, fetchTaskBoard,
  type EmployeeTask,
} from "@/data/repository";
import type { Shift, AttendanceRecord } from "@/engine/scheduling";

const STATUS_STYLE: Record<string, string> = {
  ACTIVE: "bg-status-success-soft text-status-success",
  PROBATION: "bg-status-info-soft text-status-info",
  NOTICE: "bg-status-warning-soft text-status-warning",
  SUSPENDED: "bg-status-danger-soft text-status-danger",
};

export function PeoplePage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [roles, setRoles] = useState<JobRole[]>([]);
  const [certifications, setCertifications] = useState<Certification[]>([]);
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [leave, setLeave] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [openEntries, setOpenEntries] = useState<
    { id: string; employeeId: string; clockInAt: string; shiftId: string | null }[]
  >([]);
  const [tasks, setTasks] = useState<EmployeeTask[]>([]);
  const [weekOf, setWeekOf] = useState(() => new Date());
  const [adding, setAdding] = useState(false);
  const [requesting, setRequesting] = useState(false);

  const today = useMemo(() => new Date(), []);
  const yearStart = useMemo(() => new Date(Date.UTC(today.getFullYear(), 0, 1)), [today]);
  const yearEnd = useMemo(() => new Date(Date.UTC(today.getFullYear(), 11, 31)), [today]);

  async function load() {
    if (!isSupabaseConfigured) { setLoading(false); return; }
    setLoading(true);
    try {
      const [e, d, r, c, lt, lr] = await Promise.all([
        fetchEmployees(), fetchDepartments(), fetchJobRoles(),
        fetchCertifications(), fetchLeaveTypes(), fetchLeaveRequests(),
      ]);
      setTasks(await fetchTaskBoard());
      setEmployees(e); setDepartments(d); setRoles(r);
      setCertifications(c); setLeaveTypes(lt); setLeave(lr);
    } catch (err) {
      toast.error("Could not load people", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally { setLoading(false); }
  }

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  /*
   * The rota is read a week at a time rather than all at once. A year of
   * shifts for thirty people is tens of thousands of rows and nobody looks at
   * more than one week.
   */
  async function loadWeek(when: Date) {
    if (!isSupabaseConfigured) return;
    const monday = new Date(Date.UTC(when.getUTCFullYear(), when.getUTCMonth(), when.getUTCDate()));
    monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
    const next = new Date(monday.getTime() + 7 * 86_400_000);
    try {
      const [sh, att, open] = await Promise.all([
        fetchShifts(monday.toISOString(), next.toISOString()),
        fetchAttendance(monday.toISOString(), next.toISOString()),
        fetchOpenEntries(),
      ]);
      setShifts(sh); setAttendance(att); setOpenEntries(open);
    } catch (err) {
      toast.error("Could not load the rota", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }

  useEffect(() => { void loadWeek(weekOf); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [weekOf]);

  const counts = useMemo(() => headcount(employees), [employees]);
  const lapsing = useMemo(
    () => lapsingCertifications(certifications, employees, today),
    [certifications, employees, today],
  );
  const pending = leave.filter((l) => l.status === "REQUESTED");
  const deptName = useMemo(
    () => new Map(departments.map((d) => [d.id, d.name])), [departments],
  );
  const roleById = useMemo(() => new Map(roles.map((r) => [r.id, r])), [roles]);
  const empById = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees]);

  return (
    <div>
      <PageHeader
        title="People"
        description="Who works here, what they are qualified to do, and what leave they have. Payroll is not calculated here — that belongs with a specialist provider."
      >
        <PermissionGate>
          <Button onClick={() => setAdding(true)}>
            <Plus />
            Add someone
          </Button>
        </PermissionGate>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-4">
        <Stat title="On the books" value={String(counts.total)} hint={`${counts.working} currently working`} />
        <Stat title="Full-time equivalent" value={counts.fte} hint="From contracted hours" />
        <Stat title="Leave to decide" value={String(pending.length)} hint="Awaiting a manager"
              danger={pending.length > 0} />
        <Stat title="Certificates lapsing" value={String(lapsing.length)}
              hint="Expired or within 30 days" danger={lapsing.some((l) => l.daysLeft < 0)} />
      </div>

      <Tabs defaultValue="team" className="mt-6">
        <TabsList>
          <TabsTrigger value="team"><Users className="size-4" />Team ({employees.length})</TabsTrigger>
          <TabsTrigger value="leave"><CalendarDays className="size-4" />Leave ({leave.length})</TabsTrigger>
          <TabsTrigger value="rota">Rota</TabsTrigger>
          <TabsTrigger value="lifecycle">Joining &amp; leaving ({tasks.length})</TabsTrigger>
          <TabsTrigger value="attendance">Attendance</TabsTrigger>
          <TabsTrigger value="certifications">
            <BadgeCheck className="size-4" />Certifications ({certifications.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="lifecycle" className="mt-4">
          <LifecycleTab employees={employees} tasks={tasks} onDone={load} />
        </TabsContent>

        <TabsContent value="rota" className="mt-4">
          <RotaTab weekOf={weekOf} onWeek={setWeekOf} shifts={shifts}
            employees={employees} roles={roles} departments={departments}
            openEntries={openEntries} onDone={() => loadWeek(weekOf)} />
        </TabsContent>

        <TabsContent value="attendance" className="mt-4">
          <AttendanceTab shifts={shifts} attendance={attendance}
            employees={employees} openEntries={openEntries}
            onDone={() => loadWeek(weekOf)} />
        </TabsContent>

        <TabsContent value="team" className="mt-4">
          {loading ? (
            <p className="py-12 text-center text-sm text-muted-foreground">Loading…</p>
          ) : employees.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              Nobody on the books yet. An employee record does not need a login —
              most kitchen staff will not have one.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Number</TableHead>
                    <TableHead>Department</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Qualified</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {employees.map((e) => {
                    const role = e.jobRoleId ? roleById.get(e.jobRoleId) : undefined;
                    const verdict = checkEligibility(
                      e, role?.requiredCertifications ?? [], certifications, today,
                    );
                    return (
                      <TableRow key={e.id}>
                        <TableCell className="font-medium">{fullName(e)}</TableCell>
                        <TableCell className="font-mono text-xs">{e.employeeNumber}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {e.departmentId ? deptName.get(e.departmentId) ?? "—" : "—"}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {role?.title ?? "—"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {e.employmentType.toLowerCase().replace("_", " ")}
                        </TableCell>
                        <TableCell>
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                            STATUS_STYLE[e.employmentStatus] ?? "bg-muted text-muted-foreground"}`}>
                            {e.employmentStatus.toLowerCase()}
                          </span>
                        </TableCell>
                        <TableCell className="max-w-xs whitespace-normal text-xs">
                          {!isWorking(e) ? (
                            <span className="text-muted-foreground">—</span>
                          ) : verdict.eligible ? (
                            <span className="inline-flex items-center gap-1 text-status-success">
                              <Check className="size-3" />
                              {(role?.requiredCertifications ?? []).length === 0
                                ? "no requirement set" : "current"}
                            </span>
                          ) : (
                            <span className="text-status-danger">{verdict.reason}</span>
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

        <TabsContent value="leave" className="mt-4 space-y-4">
          <div className="flex justify-between">
            <p className="text-sm text-muted-foreground">
              Nobody may approve their own leave, whatever their role.
            </p>
            <PermissionGate>
              <Button variant="outline" onClick={() => setRequesting(true)}
                disabled={employees.length === 0}>
                Request leave
              </Button>
            </PermissionGate>
          </div>

          {leave.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              No leave recorded yet.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Who</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>From</TableHead>
                    <TableHead>To</TableHead>
                    <TableHead className="text-right">Days</TableHead>
                    <TableHead className="text-right">Left after</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-px" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {leave.map((l) => {
                    const emp = empById.get(l.employeeId);
                    const type = leaveTypes.find((t) => t.id === l.leaveTypeId);
                    const balance = emp && type
                      ? leaveBalance(emp, type, leave, yearStart, yearEnd) : null;
                    return (
                      <TableRow key={l.id}>
                        <TableCell className="font-medium">
                          {emp ? fullName(emp) : "Unknown"}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{type?.name ?? "—"}</TableCell>
                        <TableCell className="text-muted-foreground">{l.startsOn}</TableCell>
                        <TableCell className="text-muted-foreground">{l.endsOn}</TableCell>
                        <TableCell className="text-right tabular-nums">{l.days}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {balance && type?.annualEntitlementDays ? balance.remaining : "—"}
                        </TableCell>
                        <TableCell className="text-xs">{l.status.toLowerCase()}</TableCell>
                        <TableCell>
                          {l.status === "REQUESTED" && (
                            <PermissionGate>
                              <div className="flex gap-1">
                                <Button size="sm" variant="ghost"
                                  onClick={async () => {
                                    try {
                                      await decideLeave(l.id, "APPROVED", null);
                                      toast.success("Leave approved");
                                      await load();
                                    } catch (err) {
                                      toast.error("Refused", {
                                        description: err instanceof Error ? err.message : String(err),
                                      });
                                    }
                                  }}>
                                  <Check className="size-4" />
                                  <span className="sr-only">Approve</span>
                                </Button>
                                <Button size="sm" variant="ghost"
                                  onClick={async () => {
                                    try {
                                      await decideLeave(l.id, "REJECTED", null);
                                      toast.success("Leave rejected");
                                      await load();
                                    } catch (err) {
                                      toast.error("Refused", {
                                        description: err instanceof Error ? err.message : String(err),
                                      });
                                    }
                                  }}>
                                  <X className="size-4" />
                                  <span className="sr-only">Reject</span>
                                </Button>
                              </div>
                            </PermissionGate>
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

        <TabsContent value="certifications" className="mt-4 space-y-4">
          {lapsing.length > 0 && (
            <div className="rounded-lg border border-status-warning bg-status-warning-soft p-4">
              <div className="flex items-center gap-2 font-medium text-status-warning">
                <TriangleAlert className="size-4" />
                {lapsing.length} certificate{lapsing.length === 1 ? "" : "s"} lapsed or lapsing
              </div>
              <p className="mt-1 text-sm">
                Food-safety training is a legal requirement under Regulation
                852/2004. An expired certificate stops somebody being rostered.
              </p>
            </div>
          )}
          {certifications.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              No certificates recorded. A job role lists what it requires, and
              anyone without a current one cannot be rostered to it.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Who</TableHead>
                    <TableHead>Certificate</TableHead>
                    <TableHead>Expires</TableHead>
                    <TableHead className="text-right">Days left</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {certifications.map((c) => {
                    const emp = empById.get(c.employeeId);
                    const lapse = lapsing.find((l) => l.certification.id === c.id);
                    return (
                      <TableRow key={c.id}>
                        <TableCell className="font-medium">
                          {emp ? fullName(emp) : "Unknown"}
                        </TableCell>
                        <TableCell>{c.kind}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {c.expiresOn ?? "Does not expire"}
                        </TableCell>
                        <TableCell className={`text-right tabular-nums ${
                          lapse ? (lapse.daysLeft < 0 ? "text-status-danger" : "text-status-warning") : ""}`}>
                          {lapse ? (lapse.daysLeft < 0 ? `${Math.abs(lapse.daysLeft)} overdue` : lapse.daysLeft) : "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {adding && (
        <AddEmployeeDialog departments={departments} roles={roles} employees={employees}
          onClose={() => setAdding(false)}
          onDone={async () => { setAdding(false); await load(); }} />
      )}

      {requesting && (
        <RequestLeaveDialog employees={employees} leaveTypes={leaveTypes} leave={leave}
          yearStart={yearStart} yearEnd={yearEnd}
          onClose={() => setRequesting(false)}
          onDone={async () => { setRequesting(false); await load(); }} />
      )}
    </div>
  );
}

function Stat({ title, value, hint, danger }: {
  title: string; value: string; hint: string; danger?: boolean;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className={`text-2xl font-semibold ${danger ? "text-status-danger" : ""}`}>{value}</div>
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
}

function AddEmployeeDialog({ departments, roles, employees, onClose, onDone }: {
  departments: Department[]; roles: JobRole[]; employees: Employee[];
  onClose: () => void; onDone: () => void | Promise<void>;
}) {
  const [form, setForm] = useState({
    employeeNumber: `E-${String(employees.length + 1).padStart(3, "0")}`,
    firstName: "", lastName: "", workEmail: "",
    departmentId: departments[0]?.id ?? "", jobRoleId: "", managerId: "",
    employmentStatus: "PROBATION", employmentType: "FULL_TIME",
    startedOn: new Date().toISOString().slice(0, 10), hours: "40",
  });
  const [busy, setBusy] = useState(false);
  const valid = form.firstName.trim() && form.lastName.trim() && form.employeeNumber.trim();

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add someone to the team</DialogTitle>
          <DialogDescription>
            Work details only. Personal and bank details are restricted and are
            entered separately by an owner or administrator.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First name" id="emp-first">
            <Input id="emp-first" value={form.firstName}
              onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
          </Field>
          <Field label="Last name" id="emp-last">
            <Input id="emp-last" value={form.lastName}
              onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
          </Field>
          <Field label="Employee number" id="emp-num">
            <Input id="emp-num" value={form.employeeNumber}
              onChange={(e) => setForm({ ...form, employeeNumber: e.target.value })} />
          </Field>
          <Field label="Work email" id="emp-email">
            <Input id="emp-email" type="email" value={form.workEmail}
              onChange={(e) => setForm({ ...form, workEmail: e.target.value })} />
          </Field>
          <Field label="Department" id="emp-dept">
            <select id="emp-dept" className="h-9 w-full rounded-md border bg-transparent px-2 text-sm"
              value={form.departmentId}
              onChange={(e) => setForm({ ...form, departmentId: e.target.value })}>
              <option value="">—</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </Field>
          <Field label="Role" id="emp-role">
            <select id="emp-role" className="h-9 w-full rounded-md border bg-transparent px-2 text-sm"
              value={form.jobRoleId}
              onChange={(e) => setForm({ ...form, jobRoleId: e.target.value })}>
              <option value="">—</option>
              {roles.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
            </select>
          </Field>
          <Field label="Employment type" id="emp-type">
            <select id="emp-type" className="h-9 w-full rounded-md border bg-transparent px-2 text-sm"
              value={form.employmentType}
              onChange={(e) => setForm({ ...form, employmentType: e.target.value })}>
              {["FULL_TIME","PART_TIME","CASUAL","FIXED_TERM","CONTRACTOR","INTERN"].map((t) => (
                <option key={t} value={t}>{t.toLowerCase().replace("_", " ")}</option>
              ))}
            </select>
          </Field>
          <Field label="Contracted hours a week" id="emp-hours">
            <Input id="emp-hours" type="number" min="0" step="any" value={form.hours}
              onChange={(e) => setForm({ ...form, hours: e.target.value })} />
          </Field>
          <Field label="Started on" id="emp-start">
            <Input id="emp-start" type="date" value={form.startedOn}
              onChange={(e) => setForm({ ...form, startedOn: e.target.value })} />
          </Field>
          <Field label="Reports to" id="emp-mgr">
            <select id="emp-mgr" className="h-9 w-full rounded-md border bg-transparent px-2 text-sm"
              value={form.managerId}
              onChange={(e) => setForm({ ...form, managerId: e.target.value })}>
              <option value="">—</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{fullName(e)}</option>)}
            </select>
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button disabled={!valid || busy} onClick={async () => {
            setBusy(true);
            try {
              await upsertEmployee({
                employeeNumber: form.employeeNumber.trim(),
                firstName: form.firstName.trim(),
                lastName: form.lastName.trim(),
                workEmail: form.workEmail.trim() || null,
                departmentId: form.departmentId || null,
                jobRoleId: form.jobRoleId || null,
                managerId: form.managerId || null,
                employmentStatus: form.employmentStatus,
                employmentType: form.employmentType,
                startedOn: form.startedOn || null,
                contractedHoursPerWeek: form.hours === "" ? null : Number(form.hours),
              });
              toast.success(`${form.firstName} ${form.lastName} added`);
              await onDone();
            } catch (err) {
              toast.error("Could not add them", {
                description: err instanceof Error ? err.message : String(err),
              });
            } finally { setBusy(false); }
          }}>Add</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

function RequestLeaveDialog({
  employees, leaveTypes, leave, yearStart, yearEnd, onClose, onDone,
}: {
  employees: Employee[]; leaveTypes: LeaveType[]; leave: LeaveRequest[];
  yearStart: Date; yearEnd: Date;
  onClose: () => void; onDone: () => void | Promise<void>;
}) {
  const working = employees.filter(isWorking);
  const [employeeId, setEmployeeId] = useState(working[0]?.id ?? "");
  const [leaveTypeId, setLeaveTypeId] = useState(leaveTypes[0]?.id ?? "");
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const employee = employees.find((e) => e.id === employeeId) ?? null;
  const type = leaveTypes.find((t) => t.id === leaveTypeId) ?? null;

  // Whole days inclusive of both ends. Half days and public holidays are a
  // policy decision this does not pretend to make.
  const days = useMemo(() => {
    if (!startsOn || !endsOn || endsOn < startsOn) return 0;
    return Math.round(
      (Date.parse(`${endsOn}T00:00:00Z`) - Date.parse(`${startsOn}T00:00:00Z`)) / 86_400_000,
    ) + 1;
  }, [startsOn, endsOn]);

  const balance = employee && type
    ? leaveBalance(employee, type, leave, yearStart, yearEnd) : null;

  const conflicts = employee && startsOn && endsOn
    ? overlappingLeave({ employeeId, startsOn, endsOn }, leave, employees, employee.departmentId)
    : [];

  const wouldExceed =
    balance && type?.annualEntitlementDays !== null && days > (balance?.remaining ?? 0);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Request leave</DialogTitle>
          <DialogDescription>
            It goes to a manager to decide. Nobody may approve their own.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Who" id="lv-emp">
              <select id="lv-emp" className="h-9 w-full rounded-md border bg-transparent px-2 text-sm"
                value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
                {working.map((e) => <option key={e.id} value={e.id}>{fullName(e)}</option>)}
              </select>
            </Field>
            <Field label="Type" id="lv-type">
              <select id="lv-type" className="h-9 w-full rounded-md border bg-transparent px-2 text-sm"
                value={leaveTypeId} onChange={(e) => setLeaveTypeId(e.target.value)}>
                {leaveTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </Field>
            <Field label="From" id="lv-from">
              <Input id="lv-from" type="date" value={startsOn}
                onChange={(e) => setStartsOn(e.target.value)} />
            </Field>
            <Field label="To" id="lv-to">
              <Input id="lv-to" type="date" value={endsOn}
                onChange={(e) => setEndsOn(e.target.value)} />
            </Field>
          </div>

          {days > 0 && (
            <p className="text-sm">
              {days} day{days === 1 ? "" : "s"}
              {balance && type?.annualEntitlementDays !== null && (
                <span className="text-muted-foreground">
                  {" "}· {balance.remaining} left of {balance.entitlement}
                </span>
              )}
            </p>
          )}

          {wouldExceed && (
            <p className="rounded-lg border border-status-warning bg-status-warning-soft p-3 text-sm">
              This is more than the balance left. It can still be requested — a
              manager decides whether to allow it.
            </p>
          )}

          {conflicts.length > 0 && (
            <div className="rounded-lg border border-status-info bg-status-info-soft p-3 text-sm">
              Already off in the same department:
              <ul className="mt-1">
                {conflicts.map((c, i) => (
                  <li key={i}>{c.employeeName}, {c.startsOn} to {c.endsOn}</li>
                ))}
              </ul>
            </div>
          )}

          <Field label="Note" id="lv-note">
            <Textarea id="lv-note" rows={2} value={note}
              onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button disabled={busy || days <= 0 || !employeeId || !leaveTypeId}
            onClick={async () => {
              setBusy(true);
              try {
                await requestLeave({
                  employeeId, leaveTypeId, startsOn, endsOn, days,
                  note: note.trim() || null,
                });
                toast.success("Leave requested");
                await onDone();
              } catch (err) {
                toast.error("Could not request leave", {
                  description: err instanceof Error ? err.message : String(err),
                });
              } finally { setBusy(false); }
            }}>Request</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
