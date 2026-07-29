import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface StatusBadgeProps {
  status: string;
}

/**
 * Status as a semantic token, not a palette colour (Design Bible §3.1, §14.5).
 *
 * No `dark:` variants: the status tokens are re-derived per theme, so one class
 * is correct in both. The badge always renders its label, so colour is
 * supplementary — §4 forbids communicating status by colour alone.
 *
 * NEW and UPDATE share the informational token deliberately. The Bible's status
 * set is success/warning/danger/info; inventing a fifth colour to separate two
 * states the text already distinguishes would breach §18.2.
 */
const statusStyles: Record<string, string> = {
  ACTIVE:
    "border-status-success-border bg-status-success-soft text-status-success",
  ACTUAL:
    "border-status-success-border bg-status-success-soft text-status-success",
  NEW: "border-status-info-border bg-status-info-soft text-status-info",
  UPDATE: "border-status-info-border bg-status-info-soft text-status-info",
  PENDING:
    "border-status-warning-border bg-status-warning-soft text-status-warning",
  INACTIVE:
    "border-status-neutral-border bg-status-neutral-soft text-status-neutral",
  DISCONTINUED:
    "border-status-danger-border bg-status-danger-soft text-status-danger",
};

export function StatusBadge({ status }: StatusBadgeProps) {
  const upperStatus = status.toUpperCase();
  const style = statusStyles[upperStatus] ?? statusStyles.INACTIVE;

  return (
    <Badge variant="outline" className={cn("font-medium", style)}>
      {status}
    </Badge>
  );
}
