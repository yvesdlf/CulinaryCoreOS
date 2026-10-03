import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * What you can do to this row.
 *
 * The row actions were icon-only ghost buttons with the words in `sr-only`:
 * a paper plane for submit, a tick for decide, a document for raise orders.
 * That is a glossary a sighted user has to build by clicking, and on the
 * requisitions table two of those three icons appear in the same column on
 * different rows depending on status — so there is not even a stable position
 * to learn. The label is visible now, and the icon is what it always should
 * have been: a second cue, not the only one.
 *
 * `context` is still needed. Eight rows each offering "Submit" give a screen
 * reader eight identical buttons, so the accessible name carries the
 * reference: "Submit REQ-0007". It is built by prefixing the visible label,
 * never replacing it — WCAG 2.5.3 requires the spoken name to contain the
 * written one, and an `aria-label` that drops it breaks voice control.
 */
export function RowActions({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center justify-end gap-1", className)}>
      {children}
    </div>
  );
}

export function RowAction({
  icon: Icon,
  label,
  context,
  disabled,
  title,
  onClick,
}: {
  icon: LucideIcon;
  /** The visible words. Short: this sits in a table cell. */
  label: string;
  /** Which row — a reference, a name. Appended to the accessible name. */
  context?: string;
  disabled?: boolean;
  /** Why it is disabled, for a pointer. Pair it with visible text too. */
  title?: string;
  onClick: () => void;
}) {
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={disabled}
      title={title}
      aria-label={context ? `${label} ${context}` : undefined}
      onClick={onClick}
    >
      <Icon aria-hidden="true" />
      {label}
    </Button>
  );
}
