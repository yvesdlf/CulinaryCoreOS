import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * One chip, five tones.
 *
 * There were twenty-two of these written out by hand — `inline-flex
 * rounded-full px-2 py-0.5 text-xs font-medium` plus a pair of status tokens —
 * across eleven files, and they had already drifted. Purchasing, people,
 * inventory and traceability shaped theirs as a pill; duplicates used a
 * rounded rectangle; maintenance and housekeeping reached for `Badge` and
 * overrode its fill, which gave them a different height and radius from the
 * others. None of those differences meant anything, and a reader looking at
 * one screen cannot know that.
 *
 * `tone` rather than a status lookup, deliberately. Each page already knows
 * what DIRTY or PARTIALLY_RECEIVED means and which of the five it is; a shared
 * map would have to learn every module's vocabulary. StatusBadge shows where
 * that ends — it carries ACTIVE, ACTUAL, NEW and UPDATE together because two
 * unrelated workflows were pushed through one table.
 *
 * The label is a required child, not an option. §4 forbids colour as the only
 * carrier of state, so there is no way to render this with nothing in it.
 */
export type StatusTone = "success" | "warning" | "danger" | "info" | "neutral";

/*
 * `neutral` resolves to the same two values the hand-written chips used for
 * DRAFT and CANCELLED (`bg-muted text-muted-foreground`) — the status-neutral
 * tokens alias the muted surface and secondary text. Named as a status so the
 * five read as one set rather than four plus an exception.
 */
const toneStyles: Record<StatusTone, string> = {
  success: "bg-status-success-soft text-status-success",
  warning: "bg-status-warning-soft text-status-warning",
  danger: "bg-status-danger-soft text-status-danger",
  info: "bg-status-info-soft text-status-info",
  neutral: "bg-status-neutral-soft text-status-neutral",
};

export function StatusChip({
  tone = "neutral",
  className,
  children,
}: {
  tone?: StatusTone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        toneStyles[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
