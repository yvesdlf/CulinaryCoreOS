// ---------------------------------------------------------------------------
// Which venue you are working in
// ---------------------------------------------------------------------------
// Shown only to somebody who belongs to more than one. A switcher offering a
// single choice is a control that teaches people to ignore controls, and the
// header is already crowded.
//
// The thing this is careful about is that switching is not a filter. Every
// table is scoped by row-level security and new rows are stamped with
// `auth_default_org_id()`, so the choice has to reach the database or writes
// land in the venue it picked while the screen shows the other one. The store
// action calls the RPC and re-reads everything; this component does not touch
// local state at all.
//
// It is deliberately a native `select`. A styled menu here would be a custom
// listbox in the one corner of the app where getting it wrong means somebody
// books a delivery into the wrong restaurant.
// ---------------------------------------------------------------------------

import { useState } from "react";
import { Building2 } from "lucide-react";
import { toast } from "sonner";

import { useAuthStore } from "@/stores/auth-store";

export function VenuePicker() {
  const organizations = useAuthStore((s) => s.organizations);
  const activeOrg = useAuthStore((s) => s.activeOrg);
  const switchVenue = useAuthStore((s) => s.switchVenue);
  const [busy, setBusy] = useState(false);

  if (organizations.length < 2 || !activeOrg) return null;

  return (
    <span className="mr-2 inline-flex items-center gap-1.5">
      <Building2 className="size-3.5 text-muted-foreground" aria-hidden="true" />
      <select
        aria-label="Which venue you are working in"
        className="h-8 max-w-[11rem] rounded-md border bg-transparent px-2 text-xs"
        value={activeOrg.id}
        disabled={busy}
        onChange={async (e) => {
          const to = e.target.value;
          setBusy(true);
          try {
            await switchVenue(to);
            const name = organizations.find((o) => o.id === to)?.name;
            // Said out loud, because every figure on screen just changed
            // underneath the person and nothing else announces it.
            toast.success(`Now working in ${name ?? "the other venue"}`);
          } catch (err) {
            toast.error("Could not switch venue", {
              description: err instanceof Error ? err.message : String(err),
            });
          } finally {
            setBusy(false);
          }
        }}
      >
        {organizations.map((o) => (
          <option key={o.id} value={o.id}>{o.name}</option>
        ))}
      </select>
    </span>
  );
}
