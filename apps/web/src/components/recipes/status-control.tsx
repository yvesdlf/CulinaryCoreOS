// ---------------------------------------------------------------------------
// Recipe status control
// ---------------------------------------------------------------------------
// Replaces a dropdown that offered every status to everyone. That let an
// unpriced, unreviewed dish be marked live — and a dish with no price reports
// 0% food cost, which reads as perfectly profitable rather than as broken.
//
// Only reachable transitions are offered, and a blocked one is shown with the
// reason rather than hidden: "why can I not put this on the menu" is a
// question the interface should answer, and a missing button answers nothing.
// ---------------------------------------------------------------------------

import { useState } from "react";
import { Check, Lock, TriangleAlert } from "lucide-react";
import type { Recipe, RecipeStatus } from "@ccos/shared";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useAuthStore } from "@/stores/auth-store";
import { canTransition, nextStatuses, label } from "@/engine/status-workflow";

interface Props {
  recipe: Recipe;
  /** Called with the new status once the workflow has allowed it. */
  onChange: (to: RecipeStatus) => void;
}

export function StatusControl({ recipe, onChange }: Props) {
  const activeOrg = useAuthStore((s) => s.activeOrg);
  const session = useAuthStore((s) => s.session);
  // With no database there are no roles to enforce; treat the local user as an
  // owner rather than blocking the workflow on a signed-out mock catalogue.
  const role = session ? activeOrg?.role : "OWNER";
  const [expanded, setExpanded] = useState(false);

  const options = nextStatuses(recipe.status).map((to) => ({
    to,
    check: canTransition(recipe, to, role),
  }));

  const blocked = options.filter((o) => !o.check.allowed);

  return (
    <section className="space-y-2" aria-labelledby="status-heading">
      <div className="flex items-baseline justify-between gap-2">
        <Label id="status-heading">Status</Label>
        <span className="text-sm font-medium">{label(recipe.status)}</span>
      </div>

      <div className="flex flex-wrap gap-2">
        {options
          .filter((o) => o.check.allowed)
          .map(({ to }) => (
            <Button
              key={to}
              variant={to === "ACTUAL" ? "default" : "outline"}
              size="sm"
              onClick={() => onChange(to)}
            >
              {to === "ACTUAL" && <Check className="mr-1 size-4" aria-hidden="true" />}
              {/* The action, not the destination: "Approve" is what someone
                  thinks they are doing; "On the menu" is where it ends up. */}
              {actionLabel(recipe.status, to)}
            </Button>
          ))}
      </div>

      {blocked.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-xs text-muted-foreground underline underline-offset-4"
            aria-expanded={expanded}
          >
            {expanded ? "Hide" : `Why can't I do more? (${blocked.length})`}
          </button>

          {expanded && (
            <ul className="mt-2 space-y-1.5">
              {blocked.map(({ to, check }) => (
                <li key={to} className="flex items-start gap-2 text-xs">
                  {check.needsApprover ? (
                    <Lock className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  ) : (
                    <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-status-warning" aria-hidden="true" />
                  )}
                  <span>
                    <strong className="font-medium">{actionLabel(recipe.status, to)}</strong>{" "}
                    <span className="text-muted-foreground">{check.reason}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

/** What the person is doing, rather than where the record lands. */
function actionLabel(from: RecipeStatus, to: RecipeStatus): string {
  if (to === "PENDING") return "Send for approval";
  if (to === "ACTUAL") return from === "UPDATE" ? "Publish revision" : "Approve onto menu";
  if (to === "UPDATE") return "Start a revision";
  if (to === "DISCONTINUED") return "Archive";
  if (to === "NEW") return from === "PENDING" ? "Send back to draft" : "Reinstate as draft";
  return label(to);
}
