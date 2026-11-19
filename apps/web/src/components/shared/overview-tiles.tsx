// ---------------------------------------------------------------------------
// The overview: one tile per department, one line for the venue
// ---------------------------------------------------------------------------
// Gap 33 said "an owner, a finance manager and a head chef all get the same
// food-cost page", and the obvious fix — three dashboards — is the wrong one.
// Three hand-written layouts are three screens that drift, and the fourth role
// the venue invents gets whichever of the three somebody guesses at.
//
// So there is one component, reading one view, and what it shows differs
// because the caller's grants differ. The owner sees everything, the head chef
// sees the kitchen's work and none of its wages, the finance manager sees money
// across every department and no rotas — with nothing role-shaped anywhere.
//
// **"Hidden" is drawn, and a zero is never drawn in its place.** That is the
// cost of the design and the one thing that must not be got wrong: a null
// column means either nothing happened or you may not look, and a dashboard
// that renders the second as 0 is worse than one that renders nothing, because
// somebody will act on the zero. The view answers it with `maySeeMoney` and
// `maySeePay`, and this reads them.
// ---------------------------------------------------------------------------

import { Link } from "react-router-dom";
import { TriangleAlert, Lock } from "lucide-react";

import { CurrencyDisplay } from "@/components/shared/currency-display";
import { Card, CardContent } from "@/components/ui/card";
import type { UnitOverview, VenueOverview } from "@/data/repository";

/** A figure, or the reason there isn't one. Never a zero standing in for either. */
function Figure({
  value, allowed, suffix,
}: {
  value: string | number | null;
  allowed: boolean;
  suffix?: string;
}) {
  if (!allowed) {
    return (
      <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
        <Lock aria-hidden="true" className="size-3" />hidden
      </span>
    );
  }
  if (value === null) {
    return <span className="text-sm text-muted-foreground">nothing yet</span>;
  }
  return (
    <span className="text-xl font-semibold tabular-nums">
      {typeof value === "string"
        ? <CurrencyDisplay value={value} />
        : value}
      {suffix}
    </span>
  );
}

export function VenueLine({ venue }: { venue: VenueOverview }) {
  /*
   * What needs somebody now, before anything that is merely a number. An
   * emergency job and a request nobody has answered are the two things on this
   * screen that mean a person is waiting; the money is the thing somebody
   * reads afterwards.
   */
  const alerts: string[] = [];
  if (venue.jobsEmergency > 0) {
    alerts.push(`${venue.jobsEmergency} emergency ${venue.jobsEmergency === 1 ? "job" : "jobs"}`);
  }
  if (venue.requestsOverdue > 0) {
    alerts.push(`${venue.requestsOverdue} past the time somebody promised`);
  }
  if (venue.handoversUnread > 0) {
    alerts.push(`${venue.handoversUnread} unread ${venue.handoversUnread === 1 ? "handover" : "handovers"}`);
  }
  if (venue.messagesWaiting > 0) {
    // Not an operational figure. It says every other number here assumes
    // somebody was told, and nobody was.
    alerts.push(`${venue.messagesWaiting} waiting to be sent`);
  }

  return (
    <div className="space-y-3">
      {alerts.length > 0 && (
        <Card className="border-destructive/40">
          <CardContent className="flex items-center gap-3 py-4">
            <TriangleAlert className="size-5 text-destructive" aria-hidden="true" />
            <p className="text-sm">{alerts.join(" · ")}</p>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="py-4">
            <p className="text-xs text-muted-foreground">Taken today</p>
            <Figure value={venue.revenueToday} allowed={venue.maySeeMoney} />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className="text-xs text-muted-foreground">Gross profit today</p>
            <Figure value={venue.profitToday} allowed={venue.maySeePay} />
            <p className="pt-1 text-xs text-muted-foreground">
              {/*
                * Said on the tile, not only in a migration comment. Rent,
                * utilities and tax are not in this platform, and a figure
                * labelled "profit" with nothing qualifying it is a figure
                * somebody will take to a bank.
                */}
              Before rent, utilities and tax
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className="text-xs text-muted-foreground">Nobody has looked at</p>
            <span className="text-xl font-semibold tabular-nums">
              {venue.requestsUnanswered}
            </span>
            <p className="pt-1 text-xs text-muted-foreground">
              <Link to="/requests" className="underline">requests</Link>
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className="text-xs text-muted-foreground">Unread handovers</p>
            <span className="text-xl font-semibold tabular-nums">
              {venue.handoversUnread}
            </span>
            <p className="pt-1 text-xs text-muted-foreground">
              <Link to="/handover" className="underline">handover</Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export function UnitTiles({ units }: { units: UnitOverview[] }) {
  if (units.length === 0) return null;
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {units.map((u) => {
        const needsSomebody =
          u.jobsEmergency > 0 || u.requestsOverdue > 0 || u.hygieneBreachesUntold > 0;
        return (
          <Card key={u.businessUnitId} className={needsSomebody ? "border-destructive/40" : undefined}>
            <CardContent className="space-y-2 py-4">
              <div className="flex items-baseline justify-between gap-2">
                <p className="font-medium">{u.unitName}</p>
                <p className="font-mono text-xs text-muted-foreground">{u.unitCode}</p>
              </div>

              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="text-xs text-muted-foreground">Taken today</p>
                  <Figure value={u.revenueToday} allowed={u.maySeeMoney} />
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Gross profit</p>
                  <Figure value={u.profitToday} allowed={u.maySeePay} />
                </div>
              </div>

              {/*
                * Only what is true. A department with nothing waiting shows
                * nothing rather than four zeroes, because a wall of zeroes is
                * where the eye stops going.
                */}
              <ul className="space-y-0.5 text-xs text-muted-foreground">
                {u.requestsOverdue > 0 && (
                  <li className="text-destructive">
                    {u.requestsOverdue} request{u.requestsOverdue === 1 ? "" : "s"} past the promise
                  </li>
                )}
                {u.requestsUnanswered > 0 && u.requestsOverdue === 0 && (
                  <li>{u.requestsUnanswered} request{u.requestsUnanswered === 1 ? "" : "s"} nobody has looked at</li>
                )}
                {u.jobsEmergency > 0 && (
                  <li className="text-destructive">
                    {u.jobsEmergency} emergency job{u.jobsEmergency === 1 ? "" : "s"}
                  </li>
                )}
                {u.jobsOpen > 0 && u.jobsEmergency === 0 && (
                  <li>{u.jobsOpen} job{u.jobsOpen === 1 ? "" : "s"} open</li>
                )}
                {u.hygieneBreachesUntold > 0 && (
                  <li className="text-destructive">
                    {u.hygieneBreachesUntold} hygiene breach{u.hygieneBreachesUntold === 1 ? "" : "es"} nobody was told about
                  </li>
                )}
                {u.shiftsToday > 0 && <li>{u.shiftsToday} on today</li>}
                {u.lastHandoverStatus === null
                  ? <li>no handover written</li>
                  : u.lastHandoverOn && <li>last handover {u.lastHandoverOn}</li>}
              </ul>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
