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
import { Users, CalendarDays, BadgeCheck, Plus, Check, X, TriangleAlert,
  UserPlus, CalendarRange, Clock, GraduationCap, Target, ClipboardCheck, Lock,
} from "lucide-react";
import { toast } from "sonner";

import { Send } from "lucide-react";
import { StaffCommsTab } from "@/components/people/staff-comms-tab";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { PermissionGate } from "@/components/shared/permission-gate";
import { StatusChip, type StatusTone } from "@/components/shared/status-chip";
import { PersonCell } from "@/components/shared/person-avatar";
import { RowAction, RowActions } from "@/components/shared/row-actions";
import {
  DensityToggle,
  useTableDensity,
} from "@/components/shared/table-density";
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
  fetchEmployees, fetchBusinessUnits, fetchJobRoles, fetchCertifications,
  fetchLeaveTypes, fetchLeaveRequests, upsertEmployee, requestLeave, decideLeave,
  type BusinessUnit, type JobRole,
} from "@/data/repository";
import { isSupabaseConfigured } from "@/lib/supabase";
import { RotaTab, AttendanceTab, LifecycleTab } from "@/components/people/rota-tabs";
import {
  TrainingTab, CompetencyTab, ReviewsTab, CasesTab,
} from "@/components/people/development-tabs";
import {
  fetchShifts, fetchAttendance, fetchOpenEntries, fetchTaskBoard,
  fetchTrainingCourses, fetchTrainingAssignments, fetchCompetencies,
  fetchCompetencyAssessments, fetchReviews, fetchHrCases,
  type EmployeeTask, type TrainingCourse, type TrainingAssignmentRow,
  type Competency, type CompetencyAssessment, type PerformanceReview,
  type HrCase,
} from "@/data/repository";
import type { Shift, AttendanceRecord } from "@/engine/scheduling";

const STATUS_TONE: Record<string, StatusTone> = {
  ACTIVE: "success",
  PROBATION: "info",
  NOTICE: "warning",
  SUSPENDED: "danger",
};

/*
 * A leave request is not an employment status, so it gets its own map rather
 * than being squeezed into the one above. REQUESTED is warning because it is
 * somebody waiting on a manager, which is the only one of the four that is
 * anybody's job to clear.
 */
const LEAVE_TONE: Record<string, StatusTone> = {
  REQUESTED: "warning",
  APPROVED: "success",
  REJECTED: "danger",
  CANCELLED: "neutral",
};

export function PeoplePage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [businessUnits, setBusinessUnits] = useState<BusinessUnit[]>([]);
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
  const [courses, setCourses] = useState<TrainingCourse[]>([]);
  const [trainingAssignments, setTrainingAssignments] = useState<TrainingAssignmentRow[]>([]);
  const [competencies, setCompetencies] = useState<Competency[]>([]);
  const [assessments, setAssessments] = useState<CompetencyAssessment[]>([]);
  const [reviews, setReviews] = useState<PerformanceReview[]>([]);
  const [cases, setCases] = useState<HrCase[]>([]);
  const [weekOf, setWeekOf] = useState(() => new Date());
  const [adding, setAdding] = useState(false);
  const [requesting, setRequesting] = useState(false);
  // One call for the page, handed to both tables: two toggles disagreeing with
  // each other across tabs would read as two settings rather than one.
  const [density, setDensity] = useTableDensity();

  const today = useMemo(() => new Date(), []);
  const yearStart = useMemo(() => new Date(Date.UTC(today.getFullYear(), 0, 1)), [today]);
  const yearEnd = useMemo(() => new Date(Date.UTC(today.getFullYear(), 11, 31)), [today]);

  async function load() {
    if (!isSupabaseConfigured) { setLoading(false); return; }
    setLoading(true);
    try {
      const [e, d, r, c, lt, lr] = await Promise.all([
        fetchEmployees(), fetchBusinessUnits(), fetchJobRoles(),
        fetchCertifications(), fetchLeaveTypes(), fetchLeaveRequests(),
      ]);
      setTasks(await fetchTaskBoard());
      const [tc, ta, cp, ca, rv, hc] = await Promise.all([
        fetchTrainingCourses(), fetchTrainingAssignments(), fetchCompetencies(),
        fetchCompetencyAssessments(), fetchReviews(), fetchHrCases(),
      ]);
      setCourses(tc); setTrainingAssignments(ta); setCompetencies(cp);
      setAssessments(ca); setReviews(rv); setCases(hc);
      setEmployees(e); setBusinessUnits(d); setRoles(r);
      setCertifications(c); setLeaveTypes(lt); setLeave(lr);
    } catch (err) {
      toast.error("Could not load people", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally { setLoading(false); }
  }

  useEffect(() => { void load();   }, []);

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

  useEffect(() => { void loadWeek(weekOf);   }, [weekOf]);

  const counts = useMemo(() => headcount(employees), [employees]);
  const lapsing = useMemo(
    () => lapsingCertifications(certifications, employees, today),
    [certifications, employees, today],
  );
  const pending = leave.filter((l) => l.status === "REQUESTED");
  const deptName = useMemo(
    () => new Map(businessUnits.map((d) => [d.id, d.name])), [businessUnits],
  );
  const roleById = useMemo(() => new Map(roles.map((r) => [r.id, r])), [roles]);
  const empById = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees]);

  return (
    <div>
      <PageHeader
        title="Human Resources"
        description="Who works here, what they are qualified to do, what they have been sent, and what leave they have. Payroll is not calculated here — that belongs with a specialist provider."
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

      {/*
        * Eleven tabs is past what a tab row carries.
        *
        * Vertical, and grouped by what somebody came to do: who works here,
        * when they work, how they are developing, what is confidential, and
        * what is sent out. The groups are the reviewer's, and they match how
        * an HR screen is asked about.
        *
        * Still one tablist, so arrow-key navigation still walks every tab in
        * order. The group headings are presentational and hidden from
        * assistive technology — a screen reader gets the same eleven tabs it
        * got before, in the same order, which is why this is a layout change
        * rather than a restructuring.
        */}
      <Tabs defaultValue="team" orientation="vertical" className="mt-6 items-start">
        <TabsList variant="line" className="w-56 shrink-0 items-stretch gap-0.5">
          <div aria-hidden="true" className="px-2 pt-1 pb-1.5 text-xs font-medium text-muted-foreground">
            People
          </div>
          <TabsTrigger value="team" className="justify-start">
            <Users className="size-4" />Team ({employees.length})
          </TabsTrigger>
          <TabsTrigger value="lifecycle" className="justify-start">
            <UserPlus className="size-4" />Joining &amp; leaving ({tasks.length})
          </TabsTrigger>

          <div aria-hidden="true" className="px-2 pt-3 pb-1.5 text-xs font-medium text-muted-foreground">
            Time &amp; attendance
          </div>
          <TabsTrigger value="rota" className="justify-start">
            <CalendarRange className="size-4" />Rota
          </TabsTrigger>
          <TabsTrigger value="attendance" className="justify-start">
            <Clock className="size-4" />Attendance
          </TabsTrigger>
          <TabsTrigger value="leave" className="justify-start">
            <CalendarDays className="size-4" />Leave ({leave.length})
          </TabsTrigger>

          <div aria-hidden="true" className="px-2 pt-3 pb-1.5 text-xs font-medium text-muted-foreground">
            Development
          </div>
          <TabsTrigger value="certifications" className="justify-start">
            <BadgeCheck className="size-4" />Certifications ({certifications.length})
          </TabsTrigger>
          <TabsTrigger value="training" className="justify-start">
            <GraduationCap className="size-4" />Training ({courses.length})
          </TabsTrigger>
          <TabsTrigger value="competency" className="justify-start">
            <Target className="size-4" />Competency
          </TabsTrigger>
          <TabsTrigger value="reviews" className="justify-start">
            <ClipboardCheck className="size-4" />Reviews ({reviews.length})
          </TabsTrigger>

          <div aria-hidden="true" className="px-2 pt-3 pb-1.5 text-xs font-medium text-muted-foreground">
            Private
          </div>
          <TabsTrigger value="cases" className="justify-start">
            <Lock className="size-4" />Cases ({cases.length})
          </TabsTrigger>

          <div aria-hidden="true" className="px-2 pt-3 pb-1.5 text-xs font-medium text-muted-foreground">
            Communication
          </div>
          <TabsTrigger value="comms" className="justify-start">
            <Send className="size-4" />Send to staff
          </TabsTrigger>
        </TabsList>

        <TabsContent value="lifecycle" className="mt-4">
          <LifecycleTab employees={employees} tasks={tasks} onDone={load} />
        </TabsContent>

        <TabsContent value="rota" className="mt-4">
          <RotaTab weekOf={weekOf} onWeek={setWeekOf} shifts={shifts}
            employees={employees} roles={roles} businessUnits={businessUnits}
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
            <EmptyState icon={Users} title="Nobody on the books yet">
              An employee record does not need a login; most kitchen staff will not
              have one. What it does need is a job role, because that is what says
              which certificates the work requires.
            </EmptyState>
          ) : (
            <div className="rounded-lg border">
              {/* The toggle sits inside the frame, above the scroll region, so
                  it stays put while the rows it governs move. */}
              <div className="flex justify-end border-b p-2">
                <DensityToggle value={density} onChange={setDensity} />
              </div>
              {/* The team list is the longest table on the page and nobody
                  pages it, so the column names go with the rows otherwise. */}
              <Table stickyHeader density={density}>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Number</TableHead>
                    <TableHead>Business unit</TableHead>
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
                        <TableCell>
                          <PersonCell name={fullName(e)} />
                        </TableCell>
                        <TableCell className="font-mono text-xs">{e.employeeNumber}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {e.businessUnitId ? deptName.get(e.businessUnitId) ?? "—" : "—"}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {role?.title ?? "—"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {e.employmentType.toLowerCase().replace("_", " ")}
                        </TableCell>
                        <TableCell>
                          <StatusChip tone={STATUS_TONE[e.employmentStatus]}>
                            {e.employmentStatus.toLowerCase()}
                          </StatusChip>
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
            <EmptyState icon={CalendarDays} title="No leave recorded yet">
              Requests appear here whether they came from a manager or from the staff
              portal. Nobody decides their own, whatever their role.
            </EmptyState>
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
                        <TableCell>
                          <PersonCell name={emp ? fullName(emp) : "Unknown"} />
                        </TableCell>
                        <TableCell className="text-muted-foreground">{type?.name ?? "—"}</TableCell>
                        <TableCell className="text-muted-foreground">{l.startsOn}</TableCell>
                        <TableCell className="text-muted-foreground">{l.endsOn}</TableCell>
                        <TableCell className="text-right tabular-nums">{l.days}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {balance && type?.annualEntitlementDays ? balance.remaining : "—"}
                        </TableCell>
                        <TableCell>
                          <StatusChip tone={LEAVE_TONE[l.status]}>
                            {l.status.toLowerCase()}
                          </StatusChip>
                        </TableCell>
                        <TableCell>
                          {l.status === "REQUESTED" && (
                            <PermissionGate>
                              <RowActions>
                                <RowAction
                                  icon={Check}
                                  label="Approve"
                                  context={`leave for ${emp ? fullName(emp) : "unknown"}`}
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
                                  }}
                                />
                                <RowAction
                                  icon={X}
                                  label="Reject"
                                  context={`leave for ${emp ? fullName(emp) : "unknown"}`}
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
                                  }}
                                />
                              </RowActions>
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
            <EmptyState icon={BadgeCheck} title="No certificates recorded">
              A job role lists what it requires, and the rota refuses to publish a shift
              for anybody without a current one. The same list decides who can be sent a
              maintenance job.
            </EmptyState>
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
                        <TableCell>
                          <PersonCell name={emp ? fullName(emp) : "Unknown"} />
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

        <TabsContent value="training" className="mt-4">
          <TrainingTab courses={courses} assignments={trainingAssignments}
            employees={employees} onDone={load} />
        </TabsContent>

        <TabsContent value="competency" className="mt-4">
          <CompetencyTab competencies={competencies} assessments={assessments}
            employees={employees} roles={roles} onDone={load} />
        </TabsContent>

        <TabsContent value="reviews" className="mt-4">
          <ReviewsTab reviews={reviews} employees={employees} onDone={load} />
        </TabsContent>

        <TabsContent value="cases" className="mt-4">
          <CasesTab cases={cases} employees={employees} onDone={load} />
        </TabsContent>

        <TabsContent value="comms" className="mt-4">
          <StaffCommsTab
            employees={employees}
            businessUnits={businessUnits}
            courses={courses}
            onDone={load}
          />
        </TabsContent>
      </Tabs>

      {adding && (
        <AddEmployeeDialog businessUnits={businessUnits} roles={roles} employees={employees}
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

function AddEmployeeDialog({ businessUnits, roles, employees, onClose, onDone }: {
  businessUnits: BusinessUnit[]; roles: JobRole[]; employees: Employee[];
  onClose: () => void; onDone: () => void | Promise<void>;
}) {
  // Nobody joins a closed unit, though one still has to be nameable on the
  // record of somebody who worked in it.
  const liveUnits = businessUnits.filter((u) => u.active);
  const [form, setForm] = useState({
    employeeNumber: `E-${String(employees.length + 1).padStart(3, "0")}`,
    firstName: "", lastName: "", workEmail: "",
    businessUnitId: liveUnits[0]?.id ?? "", jobRoleId: "", managerId: "",
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
          <Field label="Business unit" id="emp-dept">
            <select id="emp-dept" className="h-9 w-full rounded-md border bg-transparent px-2 text-sm"
              value={form.businessUnitId}
              onChange={(e) => setForm({ ...form, businessUnitId: e.target.value })}>
              <option value="">—</option>
              {liveUnits.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
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
                businessUnitId: form.businessUnitId || null,
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
    ? overlappingLeave({ employeeId, startsOn, endsOn }, leave, employees, employee.businessUnitId)
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
              Already off in the same business unit:
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
