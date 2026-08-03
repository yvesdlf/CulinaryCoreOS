// ---------------------------------------------------------------------------
// Rota and attendance
// ---------------------------------------------------------------------------
// A week of shifts, and who actually turned up.
//
// Working-time warnings are shown, not enforced: a manager sometimes has to
// break a rest rule and record why, and a system that simply refused would be
// worked around with a paper rota — after which nothing is visible at all.
// The database refuses only what is unlawful regardless of intent, which is
// rostering somebody uncertified or on approved leave.
// ---------------------------------------------------------------------------

import { useMemo, useState } from "react";
import { CalendarRange, Clock, TriangleAlert, Plus, Play, Square } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PermissionGate } from "@/components/shared/permission-gate";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  checkSchedule, shiftVariance, weeklyHours, shiftHours, isoWeekKey,
  type Shift, type AttendanceRecord,
} from "@/engine/scheduling";
import { fullName, isWorking, type Employee } from "@/engine/people";
import { saveShift, deleteShift, clockIn, clockOut, type JobRole, type Department } from "@/data/repository";

const DAY_MS = 86_400_000;

/** Monday of the week containing this date. */
function weekStart(d: Date): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x;
}

const hhmm = (iso: string) => new Date(iso).toISOString().slice(11, 16);

export function RotaTab({
  weekOf, onWeek, shifts, employees, roles, departments, openEntries, onDone,
}: {
  weekOf: Date;
  onWeek: (d: Date) => void;
  shifts: Shift[];
  employees: Employee[];
  roles: JobRole[];
  departments: Department[];
  openEntries: { id: string; employeeId: string; clockInAt: string; shiftId: string | null }[];
  onDone: () => void | Promise<void>;
}) {
  const [editing, setEditing] = useState<Shift | "new" | null>(null);

  const start = weekStart(weekOf);
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => new Date(start.getTime() + i * DAY_MS)),
    [start],
  );
  const warnings = useMemo(() => checkSchedule(shifts), [shifts]);
  const totals = useMemo(() => weeklyHours(shifts), [shifts]);
  const empById = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees]);
  const roleById = useMemo(() => new Map(roles.map((r) => [r.id, r])), [roles]);
  const onClock = useMemo(
    () => new Set(openEntries.map((o) => o.employeeId)), [openEntries],
  );

  const byDay = (d: Date) =>
    shifts.filter((s) => new Date(s.startsAt).toISOString().slice(0, 10) === d.toISOString().slice(0, 10));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm"
            onClick={() => onWeek(new Date(start.getTime() - 7 * DAY_MS))}>
            Previous
          </Button>
          <span className="text-sm font-medium">
            {isoWeekKey(start)} · {start.toISOString().slice(0, 10)}
          </span>
          <Button variant="outline" size="sm"
            onClick={() => onWeek(new Date(start.getTime() + 7 * DAY_MS))}>
            Next
          </Button>
        </div>
        <PermissionGate>
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus className="size-4" />Add a shift
          </Button>
        </PermissionGate>
      </div>

      {warnings.length > 0 && (
        <div className="rounded-lg border border-status-warning bg-status-warning-soft p-4">
          <div className="flex items-center gap-2 font-medium text-status-warning">
            <TriangleAlert className="size-4" />
            {warnings.length} thing{warnings.length === 1 ? "" : "s"} to look at
          </div>
          <ul className="mt-2 space-y-1 text-sm">
            {warnings.slice(0, 8).map((w, i) => (
              <li key={i}>
                {w.employeeId && empById.has(w.employeeId) && (
                  <span className="font-medium">
                    {fullName(empById.get(w.employeeId)!)}:{" "}
                  </span>
                )}
                {w.message}
                {w.reference && (
                  <span className="text-muted-foreground"> ({w.reference})</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-4 lg:grid-cols-7">
        {days.map((d) => {
          const dayShifts = byDay(d);
          return (
            <div key={d.toISOString()} className="rounded-lg border p-2">
              <div className="mb-2 text-xs font-medium">
                {d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })}
              </div>
              {dayShifts.length === 0 ? (
                <p className="text-xs text-muted-foreground">—</p>
              ) : (
                <ul className="space-y-2">
                  {dayShifts.map((s) => {
                    const emp = s.employeeId ? empById.get(s.employeeId) : null;
                    return (
                      <li key={s.id}>
                        <button type="button"
                          onClick={() => setEditing(s)}
                          className={`w-full rounded-md border p-2 text-left text-xs hover:bg-muted ${
                            s.status === "DRAFT" ? "border-dashed opacity-70" : ""
                          } ${s.status === "CANCELLED" ? "line-through opacity-50" : ""}`}>
                          <div className="font-medium">
                            {emp ? fullName(emp) : "Open shift"}
                            {emp && onClock.has(emp.id) && (
                              <span className="ml-1 text-status-success">•</span>
                            )}
                          </div>
                          <div className="text-muted-foreground">
                            {hhmm(s.startsAt)}–{hhmm(s.endsAt)} · {shiftHours(s).toFixed(1)}h
                          </div>
                          {s.jobRoleId && (
                            <div className="text-muted-foreground">
                              {roleById.get(s.jobRoleId)?.title}
                            </div>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      {totals.length > 0 && (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Rostered this week</TableHead>
                <TableHead className="text-right">Hours</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {totals.map((t) => (
                <TableRow key={`${t.employeeId}-${t.week}`}>
                  <TableCell className="font-medium">
                    {empById.has(t.employeeId) ? fullName(empById.get(t.employeeId)!) : "Unknown"}
                  </TableCell>
                  <TableCell className={`text-right tabular-nums ${t.hours > 48 ? "text-status-warning" : ""}`}>
                    {t.hours}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {editing && (
        <ShiftDialog
          shift={editing === "new" ? null : editing}
          defaultDate={start}
          employees={employees}
          roles={roles}
          departments={departments}
          onClose={() => setEditing(null)}
          onDone={async () => { setEditing(null); await onDone(); }}
        />
      )}
    </div>
  );
}

function ShiftDialog({
  shift, defaultDate, employees, roles, departments, onClose, onDone,
}: {
  shift: Shift | null;
  defaultDate: Date;
  employees: Employee[];
  roles: JobRole[];
  departments: Department[];
  onClose: () => void;
  onDone: () => void | Promise<void>;
}) {
  const working = employees.filter(isWorking);
  const [employeeId, setEmployeeId] = useState(shift?.employeeId ?? "");
  const [jobRoleId, setJobRoleId] = useState(shift?.jobRoleId ?? "");
  const [departmentId, setDepartmentId] = useState(shift?.departmentId ?? "");
  const [date, setDate] = useState(
    (shift?.startsAt ?? defaultDate.toISOString()).slice(0, 10),
  );
  const [from, setFrom] = useState(shift ? hhmm(shift.startsAt) : "09:00");
  const [to, setTo] = useState(shift ? hhmm(shift.endsAt) : "17:00");
  const [breakMinutes, setBreakMinutes] = useState(String(shift?.breakMinutes ?? 30));
  const [busy, setBusy] = useState(false);

  const valid = date && from && to && to > from;

  async function submit(status: "DRAFT" | "PUBLISHED" | "CANCELLED") {
    setBusy(true);
    try {
      await saveShift({
        id: shift?.id,
        employeeId: employeeId || null,
        departmentId: departmentId || null,
        jobRoleId: jobRoleId || null,
        startsAt: `${date}T${from}:00Z`,
        endsAt: `${date}T${to}:00Z`,
        breakMinutes: Number(breakMinutes) || 0,
        status,
      });
      toast.success(status === "PUBLISHED" ? "Shift published" : "Shift saved");
      await onDone();
    } catch (err) {
      // Certification and leave refusals arrive here, worded by the database.
      toast.error("Could not save the shift", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally { setBusy(false); }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{shift ? "Edit shift" : "Add a shift"}</DialogTitle>
          <DialogDescription>
            Publishing checks the person is certified for the role and not on
            leave. A draft is not checked, so a rota can be sketched first.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="sh-emp">Who</Label>
            <select id="sh-emp" className="h-9 w-full rounded-md border bg-transparent px-2 text-sm"
              value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
              <option value="">Open shift</option>
              {working.map((e) => <option key={e.id} value={e.id}>{fullName(e)}</option>)}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="sh-role">Role</Label>
            <select id="sh-role" className="h-9 w-full rounded-md border bg-transparent px-2 text-sm"
              value={jobRoleId} onChange={(e) => {
                setJobRoleId(e.target.value);
                const r = roles.find((x) => x.id === e.target.value);
                if (r?.departmentId) setDepartmentId(r.departmentId);
              }}>
              <option value="">—</option>
              {roles.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="sh-date">Date</Label>
            <Input id="sh-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sh-dept">Department</Label>
            <select id="sh-dept" className="h-9 w-full rounded-md border bg-transparent px-2 text-sm"
              value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
              <option value="">—</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="sh-from">From</Label>
            <Input id="sh-from" type="time" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sh-to">To</Label>
            <Input id="sh-to" type="time" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sh-break">Unpaid break (minutes)</Label>
            <Input id="sh-break" type="number" min="0" value={breakMinutes}
              onChange={(e) => setBreakMinutes(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          {shift && (
            <Button variant="outline" disabled={busy}
              onClick={async () => {
                await deleteShift(shift.id);
                toast.success("Shift removed");
                await onDone();
              }}>Remove</Button>
          )}
          <Button variant="outline" disabled={!valid || busy}
            onClick={() => void submit("DRAFT")}>Save as draft</Button>
          <Button disabled={!valid || busy}
            onClick={() => void submit("PUBLISHED")}>Publish</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AttendanceTab({
  shifts, attendance, employees, openEntries, onDone,
}: {
  shifts: Shift[];
  attendance: AttendanceRecord[];
  employees: Employee[];
  openEntries: { id: string; employeeId: string; clockInAt: string; shiftId: string | null }[];
  onDone: () => void | Promise<void>;
}) {
  const empById = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees]);
  const variance = useMemo(() => shiftVariance(shifts, attendance), [shifts, attendance]);
  const [clockingIn, setClockingIn] = useState("");

  const working = employees.filter(isWorking);
  const onClock = new Map(openEntries.map((o) => [o.employeeId, o]));

  return (
    <div className="space-y-6">
      <div className="rounded-lg border p-4">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-medium">
          <Clock className="size-4" />On the clock ({openEntries.length})
        </h2>
        <PermissionGate>
          <div className="mb-3 flex gap-2">
            <select className="h-9 rounded-md border bg-transparent px-2 text-sm"
              aria-label="Who is clocking in"
              value={clockingIn} onChange={(e) => setClockingIn(e.target.value)}>
              <option value="">Choose someone</option>
              {working.filter((e) => !onClock.has(e.id))
                      .map((e) => <option key={e.id} value={e.id}>{fullName(e)}</option>)}
            </select>
            <Button size="sm" disabled={!clockingIn}
              onClick={async () => {
                try {
                  // Attach the shift they are due on today, where there is one.
                  const today = new Date().toISOString().slice(0, 10);
                  const due = shifts.find(
                    (s) => s.employeeId === clockingIn && s.startsAt.slice(0, 10) === today,
                  );
                  await clockIn(clockingIn, due?.id ?? null);
                  toast.success("Clocked in");
                  setClockingIn("");
                  await onDone();
                } catch (err) {
                  toast.error("Could not clock in", {
                    description: err instanceof Error ? err.message : String(err),
                  });
                }
              }}>
              <Play className="size-4" />Clock in
            </Button>
          </div>
        </PermissionGate>
        {openEntries.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nobody is clocked in.</p>
        ) : (
          <ul className="space-y-2">
            {openEntries.map((o) => (
              <li key={o.id} className="flex items-center justify-between text-sm">
                <span>
                  <span className="font-medium">
                    {empById.has(o.employeeId) ? fullName(empById.get(o.employeeId)!) : "Unknown"}
                  </span>{" "}
                  <span className="text-muted-foreground">since {hhmm(o.clockInAt)}</span>
                </span>
                <PermissionGate>
                  <Button size="sm" variant="outline"
                    onClick={async () => {
                      await clockOut(o.id, 30);
                      toast.success("Clocked out", { description: "30 minutes recorded as break." });
                      await onDone();
                    }}>
                    <Square className="size-4" />Clock out
                  </Button>
                </PermissionGate>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h2 className="mb-2 text-sm font-medium">Rostered against worked</h2>
        {variance.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No shifts this week.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Who</TableHead>
                  <TableHead>Shift</TableHead>
                  <TableHead className="text-right">Rostered</TableHead>
                  <TableHead className="text-right">Worked</TableHead>
                  <TableHead className="text-right">Difference</TableHead>
                  <TableHead className="text-right">Late</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {variance.map((v) => (
                  <TableRow key={v.shift.id}>
                    <TableCell className="font-medium">
                      {v.shift.employeeId && empById.has(v.shift.employeeId)
                        ? fullName(empById.get(v.shift.employeeId)!) : "Open shift"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {v.shift.startsAt.slice(0, 10)} {hhmm(v.shift.startsAt)}–{hhmm(v.shift.endsAt)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {v.scheduledHours.toFixed(1)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {v.state === "not-worked" ? (
                        <span className="text-status-warning">not worked</span>
                      ) : v.state === "in-progress" ? (
                        <span className="text-status-info">on the clock</span>
                      ) : (
                        v.actualHours!.toFixed(1)
                      )}
                    </TableCell>
                    <TableCell className={`text-right tabular-nums ${
                      v.varianceHours && Math.abs(v.varianceHours) > 0.5 ? "text-status-warning" : ""}`}>
                      {v.varianceHours === null ? "—"
                        : `${v.varianceHours > 0 ? "+" : ""}${v.varianceHours.toFixed(2)}`}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {v.minutesLate === null ? "—" : `${v.minutesLate > 0 ? "+" : ""}${v.minutesLate}m`}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
