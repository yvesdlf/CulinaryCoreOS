import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  description?: string;
  children?: ReactNode;
}

/*
 * One header for every page, so this is the only place the treatment exists.
 *
 * It was a 24 px heading with nothing under it, which left the title reading as
 * the first item in the content rather than the name of the screen — on a list
 * page it sat the same distance from the table as the table's own toolbar. The
 * rule is what separates the two; the larger size is what makes the title the
 * thing you land on. Both are here rather than on any page, because the review
 * that asked for this also asked for it not to be done twenty times.
 *
 * The description is width-capped: a one-line explanation stretched to 1440 px
 * is harder to read than the same sentence wrapped.
 */
export function PageHeader({ title, description, children }: PageHeaderProps) {
  return (
    <div className="mb-6 flex items-start justify-between gap-4 border-b border-border pb-5">
      <div className="space-y-1.5">
        <h1 className="font-heading text-3xl leading-tight font-semibold tracking-tight">
          {title}
        </h1>
        {description && (
          <p className="max-w-prose text-sm text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {children && (
        <div className="flex shrink-0 items-center gap-2">{children}</div>
      )}
    </div>
  );
}
