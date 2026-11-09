// ---------------------------------------------------------------------------
// What this venue is on
// ---------------------------------------------------------------------------
// The entitlement gate went in with 0121 and had nothing to show for itself.
// A venue could be refused a write with "Pay is not part of this venue's
// plan" and have nowhere to go and read what its plan actually was.
//
// Three things this screen is careful about, all of which it would be easier
// to get wrong than right.
//
//   An unmetered venue is told it is unmetered. Billing is opt-in per
//   organisation — no subscription row means no limits — and every venue that
//   existed before 0121 is in that state. Inventing a plan name for them, or
//   showing an empty billing page, would both be lies.
//
//   A lapsed module says its records are still there. That is the promise the
//   schema keeps by ending pack rows rather than deleting them, and it is the
//   thing somebody needs to hear at the moment they discover they cannot
//   save. Saying only "not included" would be true of a module never bought
//   and false of this one.
//
//   Nothing here can change anything. There are no write policies on the
//   subscription tables for `authenticated` at all — a venue that could grant
//   itself the People pack is not a billing system — so this screen reads and
//   says who to talk to. A disabled upgrade button would imply the button
//   exists.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, CircleSlash, Loader2, Lock, PauseCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  fetchEntitlements, fetchVenueSubscription,
  type SectionEntitlement, type VenueSubscription,
} from "@/data/operations";

const STATUS_WORDS: Record<VenueSubscription["status"], string> = {
  TRIALING: "On trial",
  ACTIVE: "Active",
  PAST_DUE: "Payment overdue",
  CANCELLED: "Cancelled",
};

/*
 * Said in words, not only in colour, and said from the venue's point of view
 * rather than the biller's. "Payment overdue" matters to a kitchen only
 * insofar as it tells them what still works — which is everything.
 */
const STATUS_MEANS: Record<VenueSubscription["status"], string> = {
  TRIALING: "Everything in your packs is editable during the trial.",
  ACTIVE: "Everything in your packs is editable.",
  PAST_DUE:
    "A payment has not gone through. Nothing has been switched off — a failed "
    + "card does not stop a service — but it needs sorting out.",
  CANCELLED:
    "Editing has stopped. Every record you have ever written is still here, "
    + "still readable and still exportable; renewing makes it editable again.",
};

function LevelCell({ level }: { level: SectionEntitlement["level"] }) {
  if (level === "WRITE") {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm">
        <CheckCircle2 className="size-4 text-status-success" aria-hidden="true" />
        Included
      </span>
    );
  }
  if (level === "READ") {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm">
        <PauseCircle className="size-4 text-status-warning" aria-hidden="true" />
        Read-only — lapsed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
      <CircleSlash className="size-4" aria-hidden="true" />
      Not in your plan
    </span>
  );
}

export function PlanPanel() {
  const [sub, setSub] = useState<VenueSubscription | null | undefined>(undefined);
  const [rows, setRows] = useState<SectionEntitlement[] | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [s, e] = await Promise.all([
          fetchVenueSubscription(), fetchEntitlements(),
        ]);
        setSub(s); setRows(e);
      } catch {
        setSub(null); setRows([]);
      }
    })();
  }, []);

  /*
   * Grouped by pack, because that is the thing that is bought. A list of 19
   * sections is the shape of the access model, not the shape of the invoice.
   */
  const packs = useMemo(() => {
    const by = new Map<string, { name: string; sections: SectionEntitlement[] }>();
    for (const r of rows ?? []) {
      const key = r.planCode ?? "—";
      const name = r.planName ?? "Not sold separately";
      if (!by.has(key)) by.set(key, { name, sections: [] });
      by.get(key)!.sections.push(r);
    }
    return [...by.entries()].map(([code, v]) => ({ code, ...v }));
  }, [rows]);

  if (rows === null) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        Loading your plan…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {sub === null ? (
        <div className="rounded-lg border border-border bg-muted/30 p-4">
          <h3 className="text-sm font-medium">This venue is not metered</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            There is no subscription on this venue, so nothing is withheld and
            every section is editable. Billing is switched on per venue; until
            it is, this page is telling you that it is off rather than that you
            are on a plan.
          </p>
        </div>
      ) : sub === undefined ? null : (
        <div className="rounded-lg border border-border p-4">
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="text-sm font-medium">{STATUS_WORDS[sub.status]}</h3>
            {sub.currentPeriodEnd && (
              <Badge variant="outline">
                Period ends {new Date(sub.currentPeriodEnd).toLocaleDateString()}
              </Badge>
            )}
            {sub.status === "TRIALING" && sub.trialEndsOn && (
              <Badge variant="outline">
                Trial ends {new Date(sub.trialEndsOn).toLocaleDateString()}
              </Badge>
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {STATUS_MEANS[sub.status]}
          </p>
        </div>
      )}

      {packs.map((pack) => (
        <section key={pack.code}>
          <h3 className="mb-2 text-sm font-medium">{pack.name}</h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Section</TableHead>
                <TableHead>In your plan</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pack.sections.map((s) => (
                <TableRow key={s.sectionCode}>
                  <TableCell>{s.sectionName}</TableCell>
                  <TableCell><LevelCell level={s.level} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      ))}

      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        <span>
          Your plan is not editable from inside the application, by anybody
          here including an owner. That is deliberate: a venue that could grant
          itself a module would not be a subscription. To change it, talk to
          whoever you buy this from.
        </span>
      </p>
    </div>
  );
}
