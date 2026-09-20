import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/**
 * What a screen says when it has nothing to show.
 *
 * There were forty-eight of these, each a single centred sentence in a large
 * empty area. The sentences were mostly good — "Nothing requested yet. A
 * requisition is how a kitchen asks for something" explains the feature to
 * somebody who has never used it, which is exactly what an empty screen is
 * for. What they lacked was shape: nothing to look at, and no way to act.
 *
 * Three parts, and the second is the one that matters:
 *
 *   `title`   what is not here
 *   `children` why, and how it gets filled — keep the explanation
 *   `action`  the thing that fills it, where such a thing exists
 *
 * An empty screen with no action is not a failure. Most of these fill as a
 * consequence of work done elsewhere — orders arrive because somebody
 * ordered, certificates expire because time passed — and inventing a button
 * that does not lead anywhere useful is worse than admitting the screen is
 * waiting on something.
 */
export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      {Icon && (
        <div
          className="mb-4 flex size-11 items-center justify-center rounded-full bg-muted"
          aria-hidden="true"
        >
          <Icon className="size-5 text-muted-foreground" />
        </div>
      )}
      <p className="text-sm font-medium">{title}</p>
      {children && (
        <p className="mt-1.5 max-w-md text-sm text-muted-foreground">{children}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
