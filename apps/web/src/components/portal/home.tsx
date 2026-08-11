// ---------------------------------------------------------------------------
// The HR home screen
// ---------------------------------------------------------------------------
// What somebody sees when they sign in: their name, whether they are clocked
// in, what needs doing, and what has been sent to them.
//
// The order on the page is the order of the questions people actually arrive
// with. Am I clocked in — because that is the thing done in a hurry, twice a
// day, and everything else can wait behind it. Then what needs my attention.
// Then what has been sent. Leave balances and who is off sit to the side: they
// are looked up rather than acted on.
//
// The shortcut row is deliberately four buttons and not a menu. A menu is a
// question about where something is; a button is the thing itself. These four
// are what a member of staff opens the app to do.
//
// Managers get the same screen with one section added rather than a different
// screen. A head chef is a member of staff who also approves things, and
// splitting that into two applications means checking two places.
// ---------------------------------------------------------------------------

import { useMemo, useState } from "react";
import {
  Clock, CalendarDays, FileText, Plus, Cake, CalendarOff, Loader2,
  CircleCheck, Inbox, GraduationCap, Store, ClipboardList, Users,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { CurrencyDisplay } from "@/components/shared/currency-display";
import { leaveBalances, headlineBalance } from "@/engine/leave-balance";
import type { LeaveType } from "@/engine/people";
import type {
  MyProfile, MyDocument, MyTraining, MyShift, MyLeave,
  CalendarEntry, StaffRequest, BoardPost,
} from "@/data/repository";

/** Local-date key, so "today" is the day the person is having. */
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function greeting(now: Date): string {
  const h = now.getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

/** Days until a date this year, wrapping to next year once it has passed. */
function daysAway(iso: string, today: Date): number {
  const target = new Date(iso);
  if (Number.isNaN(target.getTime())) return Number.POSITIVE_INFINITY;
  const t = new Date(today.getFullYear(), target.getMonth(), target.getDate());
  const base = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (t < base) t.setFullYear(t.getFullYear() + 1);
  return Math.round((t.getTime() - base.getTime()) / 86400000);
}

export interface HomeProps {
  profile: MyProfile;
  documents: MyDocument[];
  training: MyTraining[];
  shifts: MyShift[];
  leave: MyLeave[];
  leaveTypes: LeaveType[];
  calendar: CalendarEntry[];
  requests: StaffRequest[];
  board: BoardPost[];
  openPunch: { id: string; clockInAt: string } | null;
  punching: boolean;
  /** Things waiting on this person as a manager. Empty for most people. */
  toApprove: { id: string; label: string; detail: string }[];
  onPunch: () => void;
  onOpenTab: (tab: string) => void;
  onRequestLeave: () => void;
  onNewRequest: () => void;
  onOpenDocument: (doc: MyDocument) => void;
}

export function PortalHome(p: HomeProps) {
  const now = useMemo(() => new Date(), []);
  const today = dayKey(now);
  const [announcementsTab, setAnnouncementsTab] = useState<"announcements" | "tasks">(
    "announcements",
  );

  const balances = useMemo(
    () =>
      leaveBalances(
        leaveTypes(p.leaveTypes),
        p.leave.map((l) => ({
          leaveTypeId: l.leaveTypeId, days: l.days,
          status: l.status, startsOn: l.startsOn,
        })),
        new Date(now.getFullYear(), 0, 1),
        new Date(now.getFullYear(), 11, 31),
      ),
    [p.leaveTypes, p.leave, now],
  );
  const headline = headlineBalance(balances);

  const nextShift = p.shifts.find((s) => new Date(s.endsAt) > now);
  const unread = p.documents.filter((d) => !d.readAt);
  const toAcknowledge = p.documents.filter(
    (d) => d.requiresAcknowledgement && !d.acknowledgedAt,
  );
  const outstandingTraining = p.training.filter((t) => !t.completedOn);
  const openRequests = p.requests.filter((r) => r.status === "SUBMITTED");
  const myPendingPosts = p.board.filter(
    (b) => b.status === "PENDING" && b.employeeId === p.profile.employeeId,
  );

  // What is on today, and what is coming.
  const offToday = p.calendar.filter((c) => c.kind === "LEAVE" && c.onDate === today);
  const upcoming = p.calendar
    .filter((c) => c.kind === "BIRTHDAY" || c.kind === "HOLIDAY")
    .map((c) => ({ ...c, away: daysAway(c.onDate, now) }))
    .filter((c) => c.away <= 45)
    .sort((a, b) => a.away - b.away)
    .slice(0, 5);

  /*
   * Mine to do. Not a notification list — every row is something that will not
   * happen unless this person does it.
   */
  const tasks: { label: string; detail: string; go: () => void }[] = [
    ...toAcknowledge.map((d) => ({
      label: `Acknowledge "${d.title}"`,
      detail: "You have to confirm you have read and understood this.",
      go: () => p.onOpenDocument(d),
    })),
    ...outstandingTraining.filter((t) => t.hasExam).map((t) => ({
      label: `Sit the exam for ${t.courseTitle}`,
      detail: t.dueOn ? `Due ${t.dueOn}` : "No due date set.",
      go: () => p.onOpenTab("training"),
    })),
    ...p.toApprove.map((a) => ({
      label: a.label,
      detail: a.detail,
      go: () => p.onOpenTab("approvals"),
    })),
  ];

  return (
    <div className="space-y-5">
      {/* ── Greeting ─────────────────────────────────────────────────────── */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {greeting(now)}, {p.profile.firstName}
        </h1>
        <p className="text-sm text-muted-foreground">
          It&apos;s{" "}
          {now.toLocaleDateString(undefined, {
            weekday: "long", day: "numeric", month: "long",
          })}
          {p.profile.jobTitle && ` · ${p.profile.jobTitle}`}
        </p>
      </div>

      {/* ── The four things people open the app to do ────────────────────── */}
      <div className="flex flex-wrap gap-2">
        <Button
          size="lg"
          variant={p.openPunch ? "outline" : "default"}
          disabled={p.punching}
          onClick={p.onPunch}
        >
          {p.punching
            ? <Loader2 aria-hidden="true" className="animate-spin" />
            : <Clock aria-hidden="true" />}
          {p.openPunch ? "Clock out" : "Clock in"}
        </Button>
        <Button size="lg" variant="outline" onClick={p.onRequestLeave}>
          <CalendarDays aria-hidden="true" /> Request time off
        </Button>
        <Button size="lg" variant="outline" onClick={p.onNewRequest}>
          <FileText aria-hidden="true" /> Other request
        </Button>
        <Button size="lg" variant="outline" onClick={() => p.onOpenTab("board")}>
          <Store aria-hidden="true" /> Staff board
        </Button>
      </div>

      {/* Clocked-in state reads as a status line rather than a card, because it
          is true or false and a card gives it more weight than it needs. */}
      <p className="flex flex-wrap items-center gap-2 text-sm">
        {p.openPunch ? (
          <>
            <CircleCheck aria-hidden="true" className="size-4 text-status-success" />
            <span className="font-medium">You are clocked in</span>
            <span className="text-muted-foreground">
              since {new Date(p.openPunch.clockInAt).toLocaleTimeString([], {
                hour: "2-digit", minute: "2-digit",
              })}
            </span>
          </>
        ) : (
          <>
            <Clock aria-hidden="true" className="size-4 text-muted-foreground" />
            <span className="text-muted-foreground">
              {nextShift
                ? `Not clocked in. Next shift ${new Date(nextShift.startsAt).toLocaleString([], {
                    weekday: "short", hour: "2-digit", minute: "2-digit",
                  })}.`
                : "Not clocked in. Nothing on your rota yet."}
            </span>
          </>
        )}
      </p>

      <div className="grid gap-4 lg:grid-cols-[1fr_18rem]">
        <div className="space-y-4">
          {/* ── Announcements and tasks ───────────────────────────────────── */}
          <Card>
            <CardContent className="pt-4">
              <div className="mb-3 flex gap-1 border-b border-border">
                {(["announcements", "tasks"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setAnnouncementsTab(t)}
                    className={`-mb-px border-b-2 px-3 py-2 text-sm capitalize ${
                      announcementsTab === t
                        ? "border-primary font-medium"
                        : "border-transparent text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {t === "tasks" ? `Tasks (${tasks.length})` : `Announcements (${p.documents.length})`}
                  </button>
                ))}
              </div>

              {announcementsTab === "announcements" ? (
                p.documents.length === 0 ? (
                  <p className="py-6 text-sm text-muted-foreground">
                    Nothing has been sent to you yet.
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {p.documents.slice(0, 6).map((d) => (
                      <li key={d.recipientId}>
                        <button
                          type="button"
                          onClick={() => p.onOpenDocument(d)}
                          className={`flex w-full flex-wrap items-center gap-2 rounded-lg border p-2.5 text-left text-sm hover:bg-muted/40 ${
                            d.readAt ? "border-border" : "border-primary/40 bg-primary/5"
                          }`}
                        >
                          <Badge variant={d.readAt ? "outline" : "default"}>
                            {d.kind.toLowerCase()}
                          </Badge>
                          <span className="flex-1 font-medium">{d.title}</span>
                          <span className="text-xs text-muted-foreground">
                            {d.publishedAt
                              ? new Date(d.publishedAt).toLocaleDateString()
                              : ""}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )
              ) : tasks.length === 0 ? (
                <p className="py-6 text-sm text-muted-foreground">
                  Nothing needs you right now.
                </p>
              ) : (
                <ul className="space-y-1">
                  {tasks.map((t, i) => (
                    <li key={i}>
                      <button
                        type="button"
                        onClick={t.go}
                        className="flex w-full items-start gap-2 rounded-lg border border-status-warning/40 bg-status-warning-soft p-2.5 text-left text-sm hover:bg-status-warning-soft/70"
                      >
                        <ClipboardList aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-status-warning" />
                        <span>
                          <span className="block font-medium">{t.label}</span>
                          <span className="block text-xs text-muted-foreground">{t.detail}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* ── Where everything else lives ───────────────────────────────── */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { key: "inbox", label: "Inbox", icon: Inbox, count: unread.length },
              { key: "training", label: "Training", icon: GraduationCap, count: outstandingTraining.length },
              { key: "rota", label: "My rota", icon: CalendarDays, count: 0 },
              { key: "leave", label: "Leave", icon: CalendarOff, count: openRequests.length },
            ].map((x) => (
              <button
                key={x.key}
                type="button"
                onClick={() => p.onOpenTab(x.key)}
                className="flex flex-col items-start gap-1 rounded-lg border border-border p-3 text-left hover:bg-muted/40"
              >
                <x.icon aria-hidden="true" className="size-5 text-muted-foreground" />
                <span className="text-sm font-medium">{x.label}</span>
                {x.count > 0 && (
                  <span className="text-xs text-status-warning">{x.count} waiting</span>
                )}
              </button>
            ))}
          </div>

          {myPendingPosts.length > 0 && (
            <p className="rounded-lg border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
              {myPendingPosts.length} of your board{" "}
              {myPendingPosts.length === 1 ? "post is" : "posts are"} waiting for
              your manager to approve before anybody else can see{" "}
              {myPendingPosts.length === 1 ? "it" : "them"}.
            </p>
          )}
        </div>

        {/* ── The side column: looked up, not acted on ──────────────────── */}
        <div className="space-y-4">
          {headline && (
            <Card>
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground">{headline.type.name}</p>
                <p className="text-3xl font-semibold tabular-nums">
                  {headline.remaining}
                  <span className="ml-1 text-sm font-normal text-muted-foreground">
                    days left
                  </span>
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {headline.taken} taken
                  {headline.pending > 0 && `, ${headline.pending} awaiting a decision`}
                  {headline.entitlement !== null && ` of ${headline.entitlement}`}
                </p>
                {balances
                  .filter((b) => b.entitlement === null && b.taken > 0)
                  .map((b) => (
                    <p key={b.type.id} className="mt-2 text-xs text-muted-foreground">
                      {b.type.name}: {b.taken} days used
                    </p>
                  ))}
                <Button
                  size="xs"
                  variant="ghost"
                  className="mt-2 px-0"
                  onClick={() => p.onOpenTab("leave")}
                >
                  See all leave
                </Button>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="pt-4">
              <p className="flex items-center gap-1.5 text-sm font-medium">
                <Users aria-hidden="true" className="size-4" /> Who&apos;s off today
              </p>
              {offToday.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">Everybody is in.</p>
              ) : (
                <ul className="mt-2 space-y-1 text-sm">
                  {offToday.map((c, i) => (
                    <li key={i} className="flex justify-between gap-2">
                      <span>{c.title}</span>
                      <span className="text-xs text-muted-foreground">{c.detail}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-4">
              <p className="text-sm font-medium">Coming up</p>
              {upcoming.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  Nothing in the next six weeks.
                </p>
              ) : (
                <ul className="mt-2 space-y-1.5 text-sm">
                  {upcoming.map((c, i) => (
                    <li key={i} className="flex items-start gap-2">
                      {c.kind === "BIRTHDAY" ? (
                        <Cake aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <CalendarOff aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      )}
                      <span className="flex-1">
                        <span className="block">{c.title}</span>
                        <span className="block text-xs text-muted-foreground">
                          {c.away === 0 ? "today" : c.away === 1 ? "tomorrow" : `in ${c.away} days`}
                          {c.detail && ` · ${c.detail}`}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

/** The portal fetches a trimmed leave type; the engine wants the full shape. */
function leaveTypes(types: LeaveType[]) {
  return types.map((t) => ({
    id: t.id,
    code: t.code,
    name: t.name,
    paid: t.paid,
    annualEntitlementDays: t.annualEntitlementDays ?? null,
    maxCarryoverDays: t.maxCarryoverDays ?? null,
  }));
}
