// ---------------------------------------------------------------------------
// Administration — accounts, access, the numbers, and who signs a hire
// ---------------------------------------------------------------------------
// One page for the person who runs the system rather than the kitchen. Four
// things belong together here because they are the same question asked four
// ways: who is allowed to do what.
//
//   Access    which sections a person can open, and whether they may change
//             anything in them.
//   Accounts  bringing somebody in. By invitation, never by typing a password
//             on their behalf — see the note on the invite dialog.
//   Numbers   the settings that decide what everything costs, and the spend
//             above which an order needs a signature.
//   Hiring    which department head signs off a hire, and the requests waiting
//             for them.
//
// None of it is enforced by this screen. Every control here has a trigger
// behind it, and the screen's job is to make the rule visible and its refusal
// legible — not to be the rule. A page that hides a button is a page anybody
// can bypass with a URL.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from "react";
import {
  ShieldCheck, UserPlus, SlidersHorizontal, BriefcaseBusiness, Lock,
  Eye, PencilLine, Check, X, TriangleAlert, History, Users, Mail, MapPin,
} from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CurrencyDisplay } from "@/components/shared/currency-display";
import {
  fetchAppSections, fetchAccessGrid, setSectionAccess,
  fetchVenueParameters, saveVenueParameter, fetchParameterChanges,
  fetchDepartments, fetchDepartmentApprovers, saveDepartmentApprover,
  fetchHiringRequests, decideHiringRequest, fetchJobRoles, createHiringRequest,
  inviteToOrg, fetchInvitations, revokeInvitation,
  fetchGeofences, saveGeofence, type Geofence,
  type AppSection, type AccessRow, type AccessLevel, type VenueParameter,
  type ParameterChange, type Department, type DepartmentApprover,
  type HiringRequest, type JobRole, type Invitation,
} from "@/data/repository";
import { useAccessStore, useCanWriteSection } from "@/stores/access-store";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import type { OrgRole } from "@/engine/purchasing";

const LEVELS: { value: AccessLevel; label: string; hint: string; icon: typeof Lock }[] = [
  { value: "NONE",  label: "No access",  hint: "Cannot open the section at all.", icon: Lock },
  { value: "READ",  label: "Read only",  hint: "Can look, and can change nothing.", icon: Eye },
  { value: "WRITE", label: "Full edit",  hint: "Can create, change and delete.", icon: PencilLine },
];

const ROLES: { value: OrgRole; label: string; note: string }[] = [
  { value: "ADMIN",  label: "Administrator", note: "Manages people and access." },
  { value: "CHEF",   label: "Staff",         note: "Normal user. Access is set per section." },
  { value: "VIEWER", label: "Viewer",        note: "Starts read-only everywhere." },
  { value: "OWNER",  label: "Owner",         note: "Everything, always. Cannot be restricted." },
];

/*
 * Three buttons rather than a dropdown: the choice is the information, and a
 * grid of twelve dropdowns hides exactly what an administrator came to read.
 *
 * The selected option is filled and the rest are transparent on a recessed
 * track — the first attempt used the "secondary" variant, which renders white
 * on a white card, so all three looked identical and the screen silently
 * failed to answer its only question.
 */
// The hover colours are restated because the ghost variant's own hover would
// otherwise repaint the selected button as if it were not selected.
const LEVEL_ACTIVE: Record<AccessLevel, string> = {
  NONE: "bg-background text-muted-foreground shadow-sm hover:bg-background hover:text-muted-foreground",
  READ: "bg-background text-foreground shadow-sm hover:bg-background",
  WRITE: "bg-primary text-primary-foreground shadow-sm hover:bg-primary hover:text-primary-foreground",
};

function LevelPicker({
  value, disabled, onChange,
}: {
  value: AccessLevel;
  disabled: boolean;
  onChange: (level: AccessLevel) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Access level"
      className="inline-flex rounded-lg bg-muted p-0.5"
    >
      {LEVELS.map((l) => {
        const active = l.value === value;
        return (
          <Tooltip key={l.value}>
            <TooltipTrigger
              render={
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={disabled}
                  aria-pressed={active}
                  onClick={() => onChange(l.value)}
                  className={
                    active ? `${LEVEL_ACTIVE[l.value]} font-medium` : "text-muted-foreground"
                  }
                />
              }
            >
              <l.icon aria-hidden="true" />
              {l.label}
            </TooltipTrigger>
            <TooltipContent>
              <p className="max-w-52">{l.hint}</p>
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}

export function AdministrationPage() {
  const [sections, setSections] = useState<AppSection[]>([]);
  const [grid, setGrid] = useState<AccessRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [parameters, setParameters] = useState<VenueParameter[]>([]);
  const [changes, setChanges] = useState<ParameterChange[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [approvers, setApprovers] = useState<DepartmentApprover[]>([]);
  const [hiring, setHiring] = useState<HiringRequest[]>([]);
  const [jobRoles, setJobRoles] = useState<JobRole[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [geofences, setGeofences] = useState<Geofence[]>([]);
  const [myEmail, setMyEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [inviting, setInviting] = useState(false);
  const [deciding, setDeciding] = useState<HiringRequest | null>(null);
  const [raising, setRaising] = useState(false);

  const canAdminister = useCanWriteSection("ADMIN");
  const canSetParameters = useCanWriteSection("PARAMETERS");
  const canHire = useCanWriteSection("PEOPLE");
  const reloadMyAccess = useAccessStore((s) => s.load);

  async function load() {
    if (!isSupabaseConfigured) { setLoading(false); return; }
    setLoading(true);
    try {
      const [s, g, p, c, d, a, h, j, i] = await Promise.all([
        fetchAppSections(), fetchAccessGrid(), fetchVenueParameters(),
        fetchParameterChanges(), fetchDepartments(), fetchDepartmentApprovers(),
        fetchHiringRequests(), fetchJobRoles(), fetchInvitations(),
      ]);
      setSections(s); setGrid(g); setParameters(p); setChanges(c);
      setDepartments(d); setApprovers(a); setHiring(h); setJobRoles(j);
      setInvitations(i);
      setGeofences(await fetchGeofences());
      setSelected((cur) => cur ?? g[0]?.userId ?? null);
      const { data } = await supabase!.auth.getUser();
      setMyEmail(data.user?.email ?? null);
    } catch (err) {
      toast.error("Could not load administration", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally { setLoading(false); }
  }

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const person = useMemo(
    () => grid.find((g) => g.userId === selected) ?? null,
    [grid, selected],
  );

  const pendingHires = hiring.filter((h) => h.status === "SUBMITTED");
  const liveInvitations = invitations.filter((i) => !i.acceptedAt && !i.revokedAt);
  const departmentsWithoutApprover = departments.filter(
    (d) => !approvers.some((a) => a.departmentId === d.id),
  );

  async function changeLevel(userId: string, code: string, level: AccessLevel) {
    // Optimistic: the grid is a lot of small edits and a round trip per click
    // makes it feel broken. Reverted below if the database disagrees.
    const before = grid;
    setGrid((rows) =>
      rows.map((r) => (r.userId === userId
        ? { ...r, sections: { ...r.sections, [code]: level } } : r)));
    try {
      await setSectionAccess(userId, code, level);
      if (userId === grid.find((g) => g.email === myEmail)?.userId) {
        // Changing your own access must change your own menus immediately.
        await reloadMyAccess();
      }
    } catch (err) {
      setGrid(before);
      toast.error("Could not change access", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Administration"
        description="Accounts and access, the venue's protected numbers, and who signs off a hire."
      />

      {/* What needs attention, before anything that merely can be changed. */}
      {(pendingHires.length > 0 || departmentsWithoutApprover.length > 0) && (
        <div className="grid gap-3 sm:grid-cols-2">
          {pendingHires.length > 0 && (
            <Card className="border-amber-500/40">
              <CardContent className="flex items-center gap-3 py-4">
                <BriefcaseBusiness className="size-5 text-amber-600" aria-hidden="true" />
                <div className="text-sm">
                  <p className="font-medium">
                    {pendingHires.length} hiring {pendingHires.length === 1 ? "request" : "requests"} waiting
                  </p>
                  <p className="text-muted-foreground">
                    Each goes to the head of the department that pays for it.
                  </p>
                </div>
              </CardContent>
            </Card>
          )}
          {departmentsWithoutApprover.length > 0 && (
            <Card className="border-destructive/40">
              <CardContent className="flex items-center gap-3 py-4">
                <TriangleAlert className="size-5 text-destructive" aria-hidden="true" />
                <div className="text-sm">
                  <p className="font-medium">
                    No approver set for{" "}
                    {departmentsWithoutApprover.map((d) => d.name).join(", ")}
                  </p>
                  <p className="text-muted-foreground">
                    Hiring for those departments cannot be approved until one is.
                  </p>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      <Tabs defaultValue="access">
        <TabsList>
          <TabsTrigger value="access">
            <ShieldCheck aria-hidden="true" /> Access
          </TabsTrigger>
          <TabsTrigger value="accounts">
            <Users aria-hidden="true" /> Accounts
          </TabsTrigger>
          <TabsTrigger value="parameters">
            <SlidersHorizontal aria-hidden="true" /> Numbers
          </TabsTrigger>
          <TabsTrigger value="hiring">
            <BriefcaseBusiness aria-hidden="true" /> Hiring
          </TabsTrigger>
        </TabsList>

        {/* ── Access ───────────────────────────────────────────────────────── */}
        <TabsContent value="access" className="pt-4">
          {!canAdminister && (
            <p className="mb-4 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
              <Lock aria-hidden="true" className="mr-1.5 inline size-3.5" />
              You can see who has what, and cannot change it. Ask an administrator.
            </p>
          )}

          <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">People</CardTitle>
              </CardHeader>
              <CardContent className="px-2 pb-2">
                <ul className="space-y-0.5">
                  {grid.map((row) => {
                    const writes = sections.filter(
                      (s) => row.sections[s.code] === "WRITE").length;
                    return (
                      <li key={row.userId}>
                        <button
                          type="button"
                          onClick={() => setSelected(row.userId)}
                          aria-current={row.userId === selected}
                          className={`w-full rounded-lg px-2.5 py-2 text-left text-sm transition-colors ${
                            row.userId === selected
                              ? "bg-muted font-medium"
                              : "hover:bg-muted/50"
                          }`}
                        >
                          <span className="block truncate">{row.email}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {row.role === "OWNER"
                              ? "Owner — full access"
                              : `${writes} of ${sections.length} editable`}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                  {grid.length === 0 && !loading && (
                    <li className="px-2.5 py-4 text-sm text-muted-foreground">
                      Nobody yet.
                    </li>
                  )}
                </ul>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">
                  {person ? person.email : "Select somebody"}
                </CardTitle>
                {person?.role === "OWNER" && (
                  <p className="text-sm text-muted-foreground">
                    An owner has every section and cannot be restricted. Somebody
                    has to be able to grant the first rights back, so this is
                    deliberate rather than an oversight.
                  </p>
                )}
              </CardHeader>
              <CardContent className="space-y-1">
                {person && sections.map((s) => (
                  <div
                    key={s.code}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg px-2 py-2 hover:bg-muted/40"
                  >
                    <div className="min-w-48 flex-1">
                      <p className="text-sm font-medium">{s.name}</p>
                      <p className="text-xs text-muted-foreground">{s.description}</p>
                    </div>
                    <LevelPicker
                      value={person.sections[s.code] ?? "NONE"}
                      disabled={!canAdminister || person.role === "OWNER"}
                      onChange={(level) => void changeLevel(person.userId, s.code, level)}
                    />
                  </div>
                ))}
                {!person && (
                  <p className="py-6 text-sm text-muted-foreground">
                    Choose a person on the left to see what they can reach.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── Accounts ─────────────────────────────────────────────────────── */}
        <TabsContent value="accounts" className="space-y-4 pt-4">
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">
              A new person is invited by email and chooses their own password.
              Nobody, including an administrator, ever sets or sees it.
            </p>
            <Button onClick={() => setInviting(true)} disabled={!canAdminister}>
              <UserPlus aria-hidden="true" /> Add a person
            </Button>
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Invitations not yet accepted</CardTitle>
            </CardHeader>
            <CardContent>
              {liveInvitations.length === 0 ? (
                <p className="py-3 text-sm text-muted-foreground">None outstanding.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Email</TableHead>
                      <TableHead>Starting role</TableHead>
                      <TableHead>Expires</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {liveInvitations.map((i) => (
                      <TableRow key={i.id}>
                        <TableCell>{i.email}</TableCell>
                        <TableCell>
                          <Badge variant="secondary">{i.role}</Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {new Date(i.expiresAt).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="xs"
                            variant="ghost"
                            disabled={!canAdminister}
                            onClick={async () => {
                              try {
                                await revokeInvitation(i.id);
                                toast.success("Invitation revoked");
                                await load();
                              } catch (err) {
                                toast.error("Could not revoke", {
                                  description: err instanceof Error ? err.message : String(err),
                                });
                              }
                            }}
                          >
                            <X aria-hidden="true" /> Revoke
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Accounts</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Sections they can edit</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {grid.map((row) => {
                    const editable = sections.filter((s) => row.sections[s.code] === "WRITE");
                    const readable = sections.filter((s) => row.sections[s.code] === "READ");
                    return (
                      <TableRow key={row.userId}>
                        <TableCell className="font-medium">
                          {row.email}
                          {row.email === myEmail && (
                            <span className="ml-2 text-xs text-muted-foreground">you</span>
                          )}
                        </TableCell>
                        <TableCell><Badge variant="outline">{row.role}</Badge></TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {row.role === "OWNER"
                            ? "Everything"
                            : editable.length === 0
                              ? readable.length === 0
                                ? "Nothing yet"
                                : `Read only — ${readable.length} sections`
                              : editable.map((s) => s.name).join(", ")}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Numbers ──────────────────────────────────────────────────────── */}
        <TabsContent value="parameters" className="space-y-4 pt-4">
          {!canSetParameters && (
            <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
              <Lock aria-hidden="true" className="mr-1.5 inline size-3.5" />
              These are the settings that decide what everything costs. Changing
              them is limited to the general manager and the executive chef.
            </p>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            {parameters.map((p) => (
              <ParameterCard
                key={p.id}
                parameter={p}
                disabled={!canSetParameters}
                onSaved={load}
              />
            ))}
          </div>

          <ClockingCard
            fences={geofences}
            disabled={!canSetParameters}
            onSaved={load}
          />

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <History aria-hidden="true" className="size-4" /> Every change
              </CardTitle>
            </CardHeader>
            <CardContent>
              {changes.length === 0 ? (
                <p className="py-3 text-sm text-muted-foreground">
                  Nothing has been changed from the defaults.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>When</TableHead>
                      <TableHead>Setting</TableHead>
                      <TableHead className="text-right">From</TableHead>
                      <TableHead className="text-right">To</TableHead>
                      <TableHead>Who</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {changes.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {new Date(c.changedAt).toLocaleString()}
                        </TableCell>
                        <TableCell>
                          {parameters.find((p) => p.code === c.parameterCode)?.name ?? c.parameterCode}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {c.oldValue ?? "—"}
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums">
                          {c.newValue}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {c.changedByEmail ?? "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Hiring ───────────────────────────────────────────────────────── */}
        <TabsContent value="hiring" className="space-y-4 pt-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Who approves a hire</CardTitle>
              <p className="text-sm text-muted-foreground">
                The head of the department that will pay for the person, not
                whoever happens to hold an admin role. A deputy stands in when
                the first is away, or hiring stops every time somebody takes a
                holiday.
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              {departments.map((d) => (
                <ApproverRow
                  key={d.id}
                  department={d}
                  approver={approvers.find((a) => a.departmentId === d.id) ?? null}
                  disabled={!canAdminister}
                  onSaved={load}
                />
              ))}
              {departments.length === 0 && (
                <p className="py-3 text-sm text-muted-foreground">
                  No departments yet. Add them under People first.
                </p>
              )}
            </CardContent>
          </Card>

          <div className="flex items-center justify-between gap-4">
            <h2 className="text-sm font-medium">Requests</h2>
            <Button variant="outline" onClick={() => setRaising(true)} disabled={!canHire}>
              <BriefcaseBusiness aria-hidden="true" /> Request a hire
            </Button>
          </div>

          <Card>
            <CardContent className="pt-4">
              {hiring.length === 0 ? (
                <p className="py-3 text-sm text-muted-foreground">
                  No hiring requests.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Reference</TableHead>
                      <TableHead>Department</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead className="text-right">Heads</TableHead>
                      <TableHead className="text-right">Monthly cost</TableHead>
                      <TableHead>Asked by</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {hiring.map((h) => {
                      const dept = departments.find((d) => d.id === h.departmentId);
                      const approver = approvers.find((a) => a.departmentId === h.departmentId);
                      const mine = myEmail && (
                        approver?.approverEmail === myEmail ||
                        approver?.deputyEmail === myEmail);
                      return (
                        <TableRow key={h.id}>
                          <TableCell className="font-mono text-xs">{h.reference}</TableCell>
                          <TableCell>{dept?.name ?? "—"}</TableCell>
                          <TableCell>
                            {jobRoles.find((j) => j.id === h.jobRoleId)?.title ?? "—"}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{h.headcount}</TableCell>
                          <TableCell className="text-right">
                            {h.estimatedMonthlyCost === null
                              ? "—"
                              : <CurrencyDisplay value={h.estimatedMonthlyCost} />}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {h.requestedByEmail ?? "—"}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={
                                h.status === "APPROVED" ? "default"
                                : h.status === "REJECTED" ? "destructive"
                                : h.status === "SUBMITTED" ? "secondary" : "outline"}
                            >
                              {h.status.toLowerCase()}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            {h.status === "SUBMITTED" && (
                              <Button
                                size="xs"
                                variant={mine ? "default" : "ghost"}
                                onClick={() => setDeciding(h)}
                              >
                                {mine ? "Decide" : "Open"}
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <InviteDialog open={inviting} onOpenChange={setInviting} onDone={load} />
      <RaiseHireDialog
        open={raising}
        onOpenChange={setRaising}
        departments={departments}
        jobRoles={jobRoles}
        onDone={load}
      />
      <DecideHireDialog
        request={deciding}
        department={departments.find((d) => d.id === deciding?.departmentId) ?? null}
        approver={approvers.find((a) => a.departmentId === deciding?.departmentId) ?? null}
        onClose={() => setDeciding(null)}
        onDone={load}
      />
    </div>
  );
}

/*
 * One parameter, editable in place.
 *
 * The bounds are shown rather than merely enforced. "Between 5 and 60" turns a
 * refusal into something the person could have avoided, and the trigger checks
 * it again regardless of what this input allows.
 */
function ParameterCard({
  parameter, disabled, onSaved,
}: {
  parameter: VenueParameter;
  disabled: boolean;
  onSaved: () => Promise<void>;
}) {
  const [value, setValue] = useState(String(parameter.value));
  const [saving, setSaving] = useState(false);
  const dirty = Number(value) !== parameter.value;

  useEffect(() => { setValue(String(parameter.value)); }, [parameter.value]);

  const bounds = [
    parameter.minValue === null ? null : `at least ${parameter.minValue}`,
    parameter.maxValue === null ? null : `at most ${parameter.maxValue}`,
  ].filter(Boolean).join(", ");

  async function save() {
    setSaving(true);
    try {
      await saveVenueParameter(parameter.id, Number(value));
      toast.success(`${parameter.name} updated`);
      await onSaved();
    } catch (err) {
      // The trigger's own message names the bound that was broken.
      toast.error("Not changed", {
        description: err instanceof Error ? err.message : String(err),
      });
      setValue(String(parameter.value));
    } finally { setSaving(false); }
  }

  return (
    <Card>
      <CardContent className="space-y-3 pt-5">
        <div>
          <p className="font-medium">{parameter.name}</p>
          {parameter.description && (
            <p className="text-sm text-muted-foreground">{parameter.description}</p>
          )}
        </div>
        <div className="flex items-end gap-2">
          <div className="flex-1 space-y-1">
            <Label htmlFor={`param-${parameter.code}`} className="text-xs text-muted-foreground">
              {parameter.unit === "percent" ? "Percent"
                : parameter.unit === "days" ? "Days" : "Rupiah"}
              {bounds && ` — ${bounds}`}
            </Label>
            <Input
              id={`param-${parameter.code}`}
              type="number"
              inputMode="decimal"
              value={value}
              disabled={disabled}
              onChange={(e) => setValue(e.target.value)}
            />
          </div>
          <Button onClick={() => void save()} disabled={disabled || !dirty || saving}>
            <Check aria-hidden="true" /> Save
          </Button>
        </div>
        {parameter.unit === "currency" && (
          <p className="text-xs text-muted-foreground">
            Currently <CurrencyDisplay value={parameter.value} />
          </p>
        )}
        {parameter.updatedByEmail && (
          <p className="text-xs text-muted-foreground">
            Last changed by {parameter.updatedByEmail}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function ApproverRow({
  department, approver, disabled, onSaved,
}: {
  department: Department;
  approver: DepartmentApprover | null;
  disabled: boolean;
  onSaved: () => Promise<void>;
}) {
  const [main, setMain] = useState(approver?.approverEmail ?? "");
  const [deputy, setDeputy] = useState(approver?.deputyEmail ?? "");
  const [saving, setSaving] = useState(false);
  const dirty = main !== (approver?.approverEmail ?? "")
    || deputy !== (approver?.deputyEmail ?? "");

  async function save() {
    setSaving(true);
    try {
      await saveDepartmentApprover({
        departmentId: department.id,
        approverEmail: main,
        deputyEmail: deputy || null,
      });
      toast.success(`${department.name} approver saved`);
      await onSaved();
    } catch (err) {
      toast.error("Could not save the approver", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally { setSaving(false); }
  }

  return (
    <div className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-[8rem_1fr_1fr_auto] sm:items-end">
      <p className="text-sm font-medium">{department.name}</p>
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground" htmlFor={`app-${department.id}`}>
          Approver
        </Label>
        <Input
          id={`app-${department.id}`}
          type="email"
          placeholder="head@venue"
          value={main}
          disabled={disabled}
          onChange={(e) => setMain(e.target.value)}
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground" htmlFor={`dep-${department.id}`}>
          Deputy
        </Label>
        <Input
          id={`dep-${department.id}`}
          type="email"
          placeholder="optional"
          value={deputy}
          disabled={disabled}
          onChange={(e) => setDeputy(e.target.value)}
        />
      </div>
      <Button
        variant="outline"
        disabled={disabled || !dirty || saving || !main.trim()}
        onClick={() => void save()}
      >
        Save
      </Button>
    </div>
  );
}

/*
 * Adding a person.
 *
 * By invitation, and only by invitation. An administrator typing a colleague's
 * password would know it, which makes every action that colleague takes
 * deniable — and this system records who approved what. The invited person
 * sets their own, so an approval is evidence.
 */
function InviteDialog({
  open, onOpenChange, onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onDone: () => Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<OrgRole>("CHEF");
  const [sending, setSending] = useState(false);

  async function send() {
    setSending(true);
    try {
      await inviteToOrg(email.trim(), role);
      toast.success("Invitation sent", {
        description: `${email} can now sign up and join this venue.`,
      });
      setEmail("");
      onOpenChange(false);
      await onDone();
    } catch (err) {
      toast.error("Could not invite", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally { setSending(false); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add a person</DialogTitle>
          <DialogDescription>
            They receive an invitation, choose their own password, and join this
            venue. You then set what they can reach on the Access tab.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="invite-email">Work email</Label>
            <Input
              id="invite-email"
              type="email"
              placeholder="name@venue"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label>Starting role</Label>
            <Select value={role} onValueChange={(v) => setRole(v as OrgRole)}>
              <SelectTrigger className="w-full" aria-label="Starting role">
                {/* ROLES carries friendly names — "Staff", not "CHEF". */}
                <SelectValue>
                  {(v: unknown) => ROLES.find((r) => r.value === v)?.label ?? String(v)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => (
                  <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {ROLES.find((r) => r.value === role)?.note}
            </p>
          </div>
          <Separator />
          <p className="flex gap-2 text-xs text-muted-foreground">
            <Mail aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
            Nobody here can set or read somebody else's password. That is what
            makes an approval in this system attributable to a person.
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => void send()} disabled={!email.trim() || sending}>
            <UserPlus aria-hidden="true" /> Send invitation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RaiseHireDialog({
  open, onOpenChange, departments, jobRoles, onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  departments: Department[];
  jobRoles: JobRole[];
  onDone: () => Promise<void>;
}) {
  const [departmentId, setDepartmentId] = useState("");
  const [jobRoleId, setJobRoleId] = useState("");
  const [headcount, setHeadcount] = useState("1");
  const [reason, setReason] = useState("");
  const [neededBy, setNeededBy] = useState("");
  const [cost, setCost] = useState("");
  const [saving, setSaving] = useState(false);

  const rolesHere = jobRoles.filter((j) => j.departmentId === departmentId);

  async function submit() {
    setSaving(true);
    try {
      await createHiringRequest({
        departmentId,
        jobRoleId: jobRoleId || null,
        headcount: Number(headcount) || 1,
        employmentType: "FULL_TIME",
        reason: reason.trim(),
        neededBy: neededBy || null,
        estimatedMonthlyCost: cost ? Number(cost) : null,
      });
      toast.success("Request submitted", {
        description: "It now waits for the head of that department.",
      });
      onOpenChange(false);
      setReason(""); setCost(""); setNeededBy("");
      await onDone();
    } catch (err) {
      toast.error("Could not submit", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally { setSaving(false); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Request a hire</DialogTitle>
          <DialogDescription>
            This goes to the head of the department that will pay for the
            person. You cannot approve your own request.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label>Department</Label>
            <Select
              value={departmentId}
              onValueChange={(v) => { setDepartmentId(v ?? ""); setJobRoleId(""); }}
            >
              <SelectTrigger className="w-full" aria-label="Department">
                <SelectValue placeholder="Choose">
                  {(v: unknown) =>
                    departments.find((d) => d.id === v)?.name ?? "Choose"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {departments.map((d) => (
                  <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Role</Label>
            <Select value={jobRoleId} onValueChange={(v) => setJobRoleId(v ?? "")}>
              <SelectTrigger className="w-full" aria-label="Role">
                <SelectValue placeholder={departmentId ? "Choose" : "Pick a department first"}>
                  {(v: unknown) => jobRoles.find((j) => j.id === v)?.title ?? "Choose"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {rolesHere.map((j) => (
                  <SelectItem key={j.id} value={j.id}>{j.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="hire-heads">How many</Label>
            <Input
              id="hire-heads" type="number" min="1"
              value={headcount} onChange={(e) => setHeadcount(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="hire-by">Needed by</Label>
            <Input
              id="hire-by" type="date"
              value={neededBy} onChange={(e) => setNeededBy(e.target.value)}
            />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="hire-cost">Estimated monthly cost</Label>
            <Input
              id="hire-cost" type="number" inputMode="decimal" placeholder="IDR"
              value={cost} onChange={(e) => setCost(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              This is the budget conversation the request is really about.
            </p>
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="hire-reason">Why</Label>
            <Textarea
              id="hire-reason" rows={3}
              placeholder="What is not getting done without this person."
              value={reason} onChange={(e) => setReason(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={() => void submit()}
            disabled={!departmentId || !reason.trim() || saving}
          >
            Submit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DecideHireDialog({
  request, department, approver, onClose, onDone,
}: {
  request: HiringRequest | null;
  department: Department | null;
  approver: DepartmentApprover | null;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  async function decide(status: "APPROVED" | "REJECTED") {
    if (!request) return;
    setSaving(true);
    try {
      await decideHiringRequest(request.id, status, note.trim() || null);
      toast.success(status === "APPROVED" ? "Hire approved" : "Request rejected");
      setNote("");
      onClose();
      await onDone();
    } catch (err) {
      // The trigger names who may decide. Passing that through is the whole
      // value of the message — "permission denied" would teach nobody anything.
      toast.error("Not recorded", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally { setSaving(false); }
  }

  return (
    <Dialog open={Boolean(request)} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{request?.reference}</DialogTitle>
          <DialogDescription>
            {department?.name}
            {approver
              ? ` — approved by ${approver.approverEmail}${
                  approver.deputyEmail ? ` or ${approver.deputyEmail}` : ""}`
              : " — no approver set for this department"}
          </DialogDescription>
        </DialogHeader>
        {request && (
          <div className="space-y-3 text-sm">
            <p>{request.reason}</p>
            <dl className="grid grid-cols-2 gap-2 text-muted-foreground">
              <div>
                <dt className="text-xs">Headcount</dt>
                <dd className="text-foreground">{request.headcount}</dd>
              </div>
              <div>
                <dt className="text-xs">Needed by</dt>
                <dd className="text-foreground">{request.neededBy ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs">Monthly cost</dt>
                <dd className="text-foreground">
                  {request.estimatedMonthlyCost === null
                    ? "—" : <CurrencyDisplay value={request.estimatedMonthlyCost} />}
                </dd>
              </div>
              <div>
                <dt className="text-xs">Asked by</dt>
                <dd className="text-foreground">{request.requestedByEmail ?? "—"}</dd>
              </div>
            </dl>
            <div className="space-y-1">
              <Label htmlFor="decision-note">Note</Label>
              <Textarea
                id="decision-note" rows={2}
                placeholder="Optional — recorded with the decision."
                value={note} onChange={(e) => setNote(e.target.value)}
              />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Button
            variant="destructive"
            disabled={saving}
            onClick={() => void decide("REJECTED")}
          >
            <X aria-hidden="true" /> Reject
          </Button>
          <Button disabled={saving} onClick={() => void decide("APPROVED")}>
            <Check aria-hidden="true" /> Approve
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/*
 * Where staff may clock in from.
 *
 * Off until a fence exists, and that is deliberate: a venue that has not drawn
 * one should not discover that nobody can clock in. Once one is enabled, a
 * punch from outside is refused by a trigger whose message carries the
 * distance — the browser is never asked to decide, because a check made in the
 * client is a check anybody can pass.
 *
 * "Use where I am" fills the coordinates from the device, which is the only
 * practical way to get them: nobody knows their venue's latitude, and typing
 * one off a map is where the digit gets dropped.
 */
function ClockingCard({ fences, disabled, onSaved }: {
  fences: Geofence[];
  disabled: boolean;
  onSaved: () => Promise<void>;
}) {
  const existing = fences[0] ?? null;
  const [name, setName] = useState(existing?.name ?? "");
  const [lat, setLat] = useState(existing ? String(existing.latitude) : "");
  const [lng, setLng] = useState(existing ? String(existing.longitude) : "");
  const [radius, setRadius] = useState(String(existing?.radiusM ?? 150));
  const [enabled, setEnabled] = useState(existing?.enabled ?? true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!existing) return;
    setName(existing.name);
    setLat(String(existing.latitude));
    setLng(String(existing.longitude));
    setRadius(String(existing.radiusM));
    setEnabled(existing.enabled);
  }, [existing?.id]);

  function useMyPosition() {
    if (!("geolocation" in navigator)) {
      toast.error("This device cannot report a location");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLat(p.coords.latitude.toFixed(7));
        setLng(p.coords.longitude.toFixed(7));
        toast.success("Filled in from this device", {
          description: `Accurate to about ${Math.round(p.coords.accuracy)} m.`,
        });
      },
      () => toast.error("This device would not share its location"),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  async function save() {
    setSaving(true);
    try {
      await saveGeofence({
        id: existing?.id,
        name: name.trim(),
        latitude: Number(lat),
        longitude: Number(lng),
        radiusM: Number(radius),
        enabled,
      });
      toast.success("Clocking area saved");
      await onSaved();
    } catch (err) {
      toast.error("Not saved", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally { setSaving(false); }
  }

  const valid = name.trim() !== "" && lat !== "" && lng !== "" && Number(radius) >= 20;

  return (
    <Card className="lg:col-span-2">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <MapPin aria-hidden="true" className="size-4" /> Where staff can clock in
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          {fences.length === 0
            ? "No area set, so a punch is accepted from anywhere. Draw one to require staff to be at the venue."
            : enabled
              ? "A punch from outside this area is refused, and the person is told how far away they are."
              : "Turned off. Punches are accepted from anywhere."}
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="fence-name">Name</Label>
            <Input id="fence-name" value={name} disabled={disabled}
              placeholder="Manuza Beach Club"
              onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="fence-radius">Radius in metres</Label>
            <Input id="fence-radius" type="number" min="20" max="5000"
              value={radius} disabled={disabled}
              onChange={(e) => setRadius(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="fence-lat">Latitude</Label>
            <Input id="fence-lat" value={lat} disabled={disabled}
              onChange={(e) => setLat(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="fence-lng">Longitude</Label>
            <Input id="fence-lng" value={lng} disabled={disabled}
              onChange={(e) => setLng(e.target.value)} />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={enabled} disabled={disabled}
            onChange={(e) => setEnabled(e.target.checked)} />
          Require staff to be at the venue to clock in
        </label>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={disabled} onClick={useMyPosition}>
            <MapPin aria-hidden="true" /> Use where I am
          </Button>
          <Button disabled={disabled || !valid || saving} onClick={() => void save()}>
            <Check aria-hidden="true" /> Save
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
