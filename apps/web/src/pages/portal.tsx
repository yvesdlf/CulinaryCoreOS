// ---------------------------------------------------------------------------
// The staff portal
// ---------------------------------------------------------------------------
// What somebody who works here sees when they sign in. Not a cut-down version
// of the management app — a different application, showing one person's
// working life: what has been sent to them, the training they owe, their rota,
// their hours and their leave.
//
// It is a separate screen rather than a filtered dashboard because the two
// have almost nothing in common. A commis chef does not want a food cost
// percentage with the numbers removed; they want to know whether they are on
// tomorrow and whether their food safety certificate has run out.
//
// Nothing here is a security boundary. A portal account is not an organisation
// member, so every table in the database already refuses it by default and the
// only rows it can reach are the ones migration 0041 opened, each keyed to its
// own employee record. This screen decides what is worth showing, not what is
// allowed.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from "react";
import {
  Clock, CalendarDays, GraduationCap, Inbox, LogOut, MapPin,
  Check, TriangleAlert, Paperclip, FileText, Loader2,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  fetchMyProfile, fetchMyDocuments, markDocumentRead, fetchMyTraining,
  fetchMyExam, submitExam, fetchMyShifts, fetchMyOpenPunch, clockIn, clockOut,
  fetchMyLeave, fetchLeaveTypes, requestLeave, signedFileUrl,
  type MyProfile, type MyDocument, type MyTraining, type MyExamQuestion,
  type MyShift, type MyLeave, type ExamResult,
} from "@/data/repository";
import type { LeaveType } from "@/engine/people";
import { useAuthStore } from "@/stores/auth-store";

const KIND_LABEL: Record<string, string> = {
  NEWSLETTER: "Newsletter", ROTA: "Rota", TRAINING: "Training",
  POLICY: "Policy", PAYSLIP: "Payslip", OTHER: "Notice",
};

/** Ask the browser where we are. Resolves to null rather than throwing. */
function currentPosition(): Promise<
  { latitude: number; longitude: number; accuracy: number } | null
> {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) =>
        resolve({
          latitude: p.coords.latitude,
          longitude: p.coords.longitude,
          accuracy: p.coords.accuracy,
        }),
      // A refusal is not an error to report: the database decides what to do
      // with a punch that has no location, and it records that it had none.
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  });
}

export function StaffPortalPage({ profile }: { profile: MyProfile }) {
  const signOut = useAuthStore((s) => s.signOut);
  const [documents, setDocuments] = useState<MyDocument[]>([]);
  const [training, setTraining] = useState<MyTraining[]>([]);
  const [shifts, setShifts] = useState<MyShift[]>([]);
  const [leave, setLeave] = useState<MyLeave[]>([]);
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [openPunch, setOpenPunch] = useState<{ id: string; clockInAt: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [punching, setPunching] = useState(false);
  const [reading, setReading] = useState<MyDocument | null>(null);
  const [sitting, setSitting] = useState<MyTraining | null>(null);
  const [applying, setApplying] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [d, t, s, l, lt, p] = await Promise.all([
        fetchMyDocuments(), fetchMyTraining(), fetchMyShifts(),
        fetchMyLeave(), fetchLeaveTypes(), fetchMyOpenPunch(),
      ]);
      setDocuments(d); setTraining(t); setShifts(s);
      setLeave(l); setLeaveTypes(lt); setOpenPunch(p);
    } catch (err) {
      toast.error("Could not load your details", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally { setLoading(false); }
  }

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const unread = documents.filter((d) => !d.readAt);
  const toAcknowledge = documents.filter((d) => d.requiresAcknowledgement && !d.acknowledgedAt);
  const outstanding = training.filter((t) => !t.completedOn);
  const nextShift = shifts.find((s) => new Date(s.endsAt) > new Date());

  async function punch() {
    setPunching(true);
    try {
      if (openPunch) {
        await clockOut(openPunch.id, 0);
        toast.success("Clocked out");
      } else {
        const position = await currentPosition();
        await clockIn(profile.employeeId, null, position);
        toast.success("Clocked in", {
          description: position
            ? "Recorded at the venue."
            : "Your device did not share a location, so this punch is flagged.",
        });
      }
      setOpenPunch(await fetchMyOpenPunch());
    } catch (err) {
      // The geofence message names the distance and the area, which is the
      // only useful thing to say to somebody standing in the wrong place.
      toast.error("Not recorded", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally { setPunching(false); }
  }

  return (
    <div className="mx-auto min-h-svh w-full max-w-4xl px-4 py-6 sm:px-6">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">{profile.venueName}</p>
          <h1 className="text-2xl font-semibold tracking-tight">
            {profile.firstName} {profile.lastName}
          </h1>
          <p className="text-sm text-muted-foreground">
            {[profile.jobTitle, profile.department].filter(Boolean).join(" · ")}
            {profile.managerName && ` · reports to ${profile.managerName}`}
          </p>
        </div>
        <Button variant="ghost" onClick={() => void signOut()}>
          <LogOut aria-hidden="true" /> Sign out
        </Button>
      </header>

      {/* Clocking leads, because it is the thing done most and the thing done
          in a hurry. */}
      <Card className={openPunch ? "border-primary" : undefined}>
        <CardContent className="flex flex-wrap items-center justify-between gap-4 py-5">
          <div>
            <p className="font-medium">
              {openPunch ? "You are clocked in" : "You are not clocked in"}
            </p>
            <p className="text-sm text-muted-foreground">
              {openPunch
                ? `Since ${new Date(openPunch.clockInAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                : nextShift
                  ? `Next shift ${new Date(nextShift.startsAt).toLocaleString([], {
                      weekday: "short", hour: "2-digit", minute: "2-digit",
                    })}`
                  : "No shift scheduled."}
            </p>
          </div>
          <Button size="lg" disabled={punching} onClick={() => void punch()}>
            {punching ? <Loader2 className="animate-spin" aria-hidden="true" />
              : <Clock aria-hidden="true" />}
            {openPunch ? "Clock out" : "Clock in"}
          </Button>
        </CardContent>
      </Card>

      {(unread.length > 0 || toAcknowledge.length > 0 || outstanding.length > 0) && (
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Stat label="Unread" value={unread.length} icon={Inbox} />
          <Stat label="To acknowledge" value={toAcknowledge.length} icon={Check}
            warn={toAcknowledge.length > 0} />
          <Stat label="Training outstanding" value={outstanding.length} icon={GraduationCap}
            warn={outstanding.length > 0} />
        </div>
      )}

      <Tabs defaultValue="inbox" className="mt-6">
        <TabsList>
          <TabsTrigger value="inbox">
            <Inbox aria-hidden="true" /> Inbox ({documents.length})
          </TabsTrigger>
          <TabsTrigger value="training">
            <GraduationCap aria-hidden="true" /> Training ({training.length})
          </TabsTrigger>
          <TabsTrigger value="rota">
            <CalendarDays aria-hidden="true" /> My rota
          </TabsTrigger>
          <TabsTrigger value="leave">Leave ({leave.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="inbox" className="mt-4 space-y-2">
          {loading ? (
            <p className="py-12 text-center text-sm text-muted-foreground">Loading…</p>
          ) : documents.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              Nothing has been sent to you yet.
            </p>
          ) : documents.map((d) => (
            <button
              key={d.recipientId}
              type="button"
              onClick={() => setReading(d)}
              className={`flex w-full flex-wrap items-center gap-3 rounded-lg border p-3 text-left hover:bg-muted/40 ${
                d.readAt ? "border-border" : "border-primary/40 bg-primary/5"
              }`}
            >
              <Badge variant={d.readAt ? "outline" : "default"}>
                {KIND_LABEL[d.kind] ?? d.kind}
              </Badge>
              <span className="flex-1 font-medium">{d.title}</span>
              {d.filePath && <Paperclip className="size-4 text-muted-foreground" aria-hidden="true" />}
              {d.requiresAcknowledgement && !d.acknowledgedAt && (
                <span className="text-xs text-status-warning">needs acknowledgement</span>
              )}
              <span className="text-xs text-muted-foreground">
                {d.publishedAt ? new Date(d.publishedAt).toLocaleDateString() : ""}
              </span>
            </button>
          ))}
        </TabsContent>

        <TabsContent value="training" className="mt-4 space-y-2">
          {training.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              No training has been assigned to you.
            </p>
          ) : training.map((t) => (
            <div key={t.assignmentId} className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
              <div className="min-w-48 flex-1">
                <p className="font-medium">{t.courseTitle}</p>
                <p className="text-sm text-muted-foreground">
                  {t.completedOn
                    ? `Completed ${t.completedOn}${t.score !== null ? ` — ${t.score}%` : ""}`
                    : t.dueOn
                      ? `Due ${t.dueOn}`
                      : "No due date"}
                </p>
              </div>
              {t.completedOn ? (
                <Badge variant={t.passed ? "default" : "destructive"}>
                  {t.passed ? "passed" : "not passed"}
                </Badge>
              ) : t.hasExam ? (
                <Button size="sm" onClick={() => setSitting(t)}>Sit the exam</Button>
              ) : (
                <Badge variant="outline">no exam</Badge>
              )}
            </div>
          ))}
        </TabsContent>

        <TabsContent value="rota" className="mt-4 space-y-2">
          {shifts.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              Nothing published for you yet. A rota appears here once it is
              published — a draft is not a promise.
            </p>
          ) : shifts.map((s) => (
            <div key={s.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
              <div>
                <p className="font-medium">
                  {new Date(s.startsAt).toLocaleDateString([], {
                    weekday: "long", day: "numeric", month: "short",
                  })}
                </p>
                {s.notes && <p className="text-sm text-muted-foreground">{s.notes}</p>}
              </div>
              <p className="tabular-nums">
                {new Date(s.startsAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                {" – "}
                {new Date(s.endsAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                {s.breakMinutes > 0 && (
                  <span className="ml-2 text-xs text-muted-foreground">
                    {s.breakMinutes} min break
                  </span>
                )}
              </p>
            </div>
          ))}
        </TabsContent>

        <TabsContent value="leave" className="mt-4 space-y-3">
          <div className="flex justify-end">
            <Button onClick={() => setApplying(true)}>
              <CalendarDays aria-hidden="true" /> Apply for leave
            </Button>
          </div>
          {leave.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              You have not applied for any leave.
            </p>
          ) : leave.map((l) => (
            <div key={l.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
              <div>
                <p className="font-medium">
                  {leaveTypes.find((t) => t.id === l.leaveTypeId)?.name ?? "Leave"}
                </p>
                <p className="text-sm text-muted-foreground">
                  {l.startsOn} → {l.endsOn} · {l.days} days
                  {l.attachments > 0 && ` · ${l.attachments} attachment${l.attachments === 1 ? "" : "s"}`}
                </p>
                {l.decisionNote && (
                  <p className="text-sm text-muted-foreground">{l.decisionNote}</p>
                )}
              </div>
              <Badge
                variant={
                  l.status === "APPROVED" || l.status === "TAKEN" ? "default"
                  : l.status === "REJECTED" ? "destructive" : "secondary"}
              >
                {l.status.toLowerCase()}
              </Badge>
            </div>
          ))}
        </TabsContent>
      </Tabs>

      <ReadDialog document={reading} onClose={() => setReading(null)} onDone={load} />
      {sitting && (
        <ExamDialog
          course={sitting}
          employeeId={profile.employeeId}
          onClose={() => setSitting(null)}
          onDone={load}
        />
      )}
      <ApplyLeaveDialog
        open={applying}
        profile={profile}
        leaveTypes={leaveTypes}
        onOpenChange={setApplying}
        onDone={load}
      />
    </div>
  );
}

function Stat({ label, value, icon: Icon, warn }: {
  label: string; value: number; icon: typeof Inbox; warn?: boolean;
}) {
  return (
    <Card className={warn && value > 0 ? "border-status-warning/50" : undefined}>
      <CardContent className="flex items-center gap-3 py-4">
        <Icon className="size-5 text-muted-foreground" aria-hidden="true" />
        <div>
          <p className="text-xl font-semibold tabular-nums">{value}</p>
          <p className="text-xs text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

/*
 * Reading a document marks it read.
 *
 * Acknowledgement is a separate, deliberate press. "I opened this" and "I have
 * read and understood this" are different claims, and an inspector asking
 * whether the allergen policy was acknowledged is asking about the second one.
 */
function ReadDialog({ document: doc, onClose, onDone }: {
  document: MyDocument | null;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (doc && !doc.readAt) {
      void markDocumentRead(doc.recipientId, false).then(onDone).catch(() => {});
    }
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [doc?.recipientId]);

  async function open() {
    if (!doc?.filePath) return;
    try {
      const url = await signedFileUrl("staff-documents", doc.filePath);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      toast.error("Could not open the file", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function acknowledge() {
    if (!doc) return;
    setBusy(true);
    try {
      await markDocumentRead(doc.recipientId, true);
      toast.success("Acknowledged");
      onClose();
      await onDone();
    } catch (err) {
      toast.error("Could not record it", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally { setBusy(false); }
  }

  return (
    <Dialog open={Boolean(doc)} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{doc?.title}</DialogTitle>
          <DialogDescription>
            {doc && KIND_LABEL[doc.kind]}
            {doc?.publishedAt && ` · ${new Date(doc.publishedAt).toLocaleDateString()}`}
            {doc?.publishedByEmail && ` · from ${doc.publishedByEmail}`}
          </DialogDescription>
        </DialogHeader>
        {doc?.body && <p className="whitespace-pre-wrap text-sm">{doc.body}</p>}
        {doc?.filePath && (
          <Button variant="outline" onClick={() => void open()}>
            <FileText aria-hidden="true" /> Open {doc.fileName ?? "the attachment"}
          </Button>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Close</Button>
          {doc?.requiresAcknowledgement && !doc.acknowledgedAt && (
            <Button disabled={busy} onClick={() => void acknowledge()}>
              <Check aria-hidden="true" /> I have read and understood this
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/*
 * The exam.
 *
 * Marked in the database. The questions arrive from a view that does not carry
 * the answers, so there is nothing in this component to inspect — which is the
 * point, and why the result comes back from the server rather than being
 * worked out here.
 */
function ExamDialog({ course, employeeId, onClose, onDone }: {
  course: MyTraining;
  employeeId: string;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [questions, setQuestions] = useState<MyExamQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [result, setResult] = useState<ExamResult | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void fetchMyExam(course.courseId).then(setQuestions).catch((err) =>
      toast.error("Could not load the exam", {
        description: err instanceof Error ? err.message : String(err),
      }));
  }, [course.courseId]);

  const answered = Object.keys(answers).length;

  async function submit() {
    setBusy(true);
    try {
      const r = await submitExam(course.courseId, employeeId, answers);
      setResult(r);
      await onDone();
    } catch (err) {
      toast.error("Could not submit", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally { setBusy(false); }
  }

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{course.courseTitle}</DialogTitle>
          <DialogDescription>
            {result
              ? "Your result has been recorded and sent to HR and your manager."
              : `${questions.length} questions. The pass mark is 80%.`}
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-3 py-4 text-center">
            <p className={`text-4xl font-semibold ${result.passed ? "text-status-success" : "text-status-danger"}`}>
              {result.score}%
            </p>
            <p className="text-sm">
              {result.correct} of {result.total} correct —{" "}
              {result.passed ? "passed" : "not passed"}
            </p>
            {!result.passed && (
              <p className="text-sm text-muted-foreground">
                Speak to your manager about sitting it again.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-5">
            {questions.map((q, i) => (
              <fieldset key={q.id} className="space-y-2">
                <legend className="text-sm font-medium">
                  {i + 1}. {q.prompt}
                </legend>
                {(q.options ?? []).map((option, index) => (
                  <label
                    key={option}
                    className={`flex cursor-pointer items-center gap-2 rounded-lg border p-2 text-sm ${
                      answers[q.id] === index ? "border-primary bg-primary/5" : "border-border"
                    }`}
                  >
                    <input
                      type="radio"
                      name={q.id}
                      checked={answers[q.id] === index}
                      onChange={() => setAnswers((a) => ({ ...a, [q.id]: index }))}
                    />
                    {option}
                  </label>
                ))}
              </fieldset>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {result ? "Close" : "Cancel"}
          </Button>
          {!result && (
            <Button
              disabled={busy || answered < questions.length || questions.length === 0}
              onClick={() => void submit()}
            >
              {answered < questions.length
                ? `${questions.length - answered} left`
                : "Submit"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ApplyLeaveDialog({ open, profile, leaveTypes, onOpenChange, onDone }: {
  open: boolean;
  profile: MyProfile;
  leaveTypes: LeaveType[];
  onOpenChange: (v: boolean) => void;
  onDone: () => Promise<void>;
}) {
  const [leaveTypeId, setLeaveTypeId] = useState("");
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [note, setNote] = useState("");
  const [sickNote, setSickNote] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  const isSick = leaveTypes.find((t) => t.id === leaveTypeId)?.code === "SICK";

  // Inclusive of both ends: a day off on Monday to Monday is one day, not zero.
  const days = useMemo(() => {
    if (!startsOn || !endsOn) return 0;
    const from = new Date(startsOn);
    const to = new Date(endsOn);
    if (to < from) return 0;
    return Math.round((to.getTime() - from.getTime()) / 86400000) + 1;
  }, [startsOn, endsOn]);

  async function submit() {
    setBusy(true);
    try {
      await requestLeave({
        employeeId: profile.employeeId,
        orgId: profile.orgId,
        leaveTypeId,
        startsOn,
        endsOn,
        days,
        note: note.trim() || null,
        sickNote,
      });
      toast.success("Applied", { description: "Your manager decides it." });
      onOpenChange(false);
      setStartsOn(""); setEndsOn(""); setNote(""); setSickNote(null);
      await onDone();
    } catch (err) {
      toast.error("Could not apply", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Apply for leave</DialogTitle>
          <DialogDescription>
            This goes to your manager. You will see the decision here.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label>Type</Label>
            <Select value={leaveTypeId} onValueChange={(v) => setLeaveTypeId(v ?? "")}>
              <SelectTrigger className="w-full" aria-label="Leave type">
                {/* The value is an id, so the trigger has to be told how to
                    name it — otherwise it renders the raw UUID. */}
                <SelectValue placeholder="Choose">
                  {(v: unknown) =>
                    leaveTypes.find((t) => t.id === v)?.name ?? "Choose"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {leaveTypes.map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="leave-from">From</Label>
              <Input id="leave-from" type="date" value={startsOn}
                onChange={(e) => setStartsOn(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="leave-to">To</Label>
              <Input id="leave-to" type="date" value={endsOn}
                onChange={(e) => setEndsOn(e.target.value)} />
            </div>
          </div>
          {days > 0 && (
            <p className="text-sm text-muted-foreground">{days} days.</p>
          )}
          {isSick && (
            <div className="space-y-1">
              <Label htmlFor="sick-note">Doctor's note</Label>
              <Input
                id="sick-note"
                type="file"
                accept="image/jpeg,image/png,image/heic,image/webp,application/pdf,capture=environment"
                onChange={(e) => setSickNote(e.target.files?.[0] ?? null)}
              />
              <p className="text-xs text-muted-foreground">
                A photograph is fine. Only you and HR can see it — not your
                colleagues.
              </p>
            </div>
          )}
          <div className="space-y-1">
            <Label htmlFor="leave-note">Note</Label>
            <Textarea id="leave-note" rows={2} value={note}
              onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={busy || !leaveTypeId || days <= 0}
            onClick={() => void submit()}
          >
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
