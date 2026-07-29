import type { ReactNode } from "react";
import { Lock } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { useAuthStore, canWrite } from "@/stores/auth-store";

/**
 * Whether the signed-in user may write in the active organisation.
 *
 * Mirrors the RLS policy in migration 0004: OWNER, ADMIN and CHEF may write;
 * VIEWER is read-only. With no database configured the app runs on the mock
 * catalogue and everything is editable, since there is no tenancy to enforce.
 */
export function useCanWrite(): boolean {
  const activeOrg = useAuthStore((s) => s.activeOrg);
  const session = useAuthStore((s) => s.session);
  if (!session) return true; // mock mode — no roles to enforce
  return canWrite(activeOrg?.role);
}

/**
 * Renders `children` for users who may write, and a disabled explanation for
 * those who may not.
 *
 * This is an honesty affordance, not a security control. The Design Bible is
 * explicit (§14.7): "hiding an action is not authorisation" — the database
 * refuses the write regardless. What this fixes is a UI that offered Save and
 * then failed, which §8 calls out as a permission state that must be shown.
 *
 * The action is disabled rather than hidden, per §5: never remove a required
 * action without explanation. A viewer should understand why they cannot save,
 * not wonder where the button went.
 */
export function PermissionGate({
  children,
  fallbackLabel = "Read-only access",
  reason = "Your role in this kitchen is view-only. Ask an owner or admin to change it.",
}: {
  children: ReactNode;
  fallbackLabel?: string;
  reason?: string;
}) {
  const allowed = useCanWrite();
  if (allowed) return <>{children}</>;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className="inline-flex h-8 cursor-not-allowed items-center gap-1.5 rounded-lg border border-border px-2.5 text-sm text-muted-foreground"
            aria-disabled="true"
          />
        }
      >
        <Lock aria-hidden="true" className="size-3.5" />
        {fallbackLabel}
      </TooltipTrigger>
      <TooltipContent>
        <p className="max-w-56">{reason}</p>
      </TooltipContent>
    </Tooltip>
  );
}
