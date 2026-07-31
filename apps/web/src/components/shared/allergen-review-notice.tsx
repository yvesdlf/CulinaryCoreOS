// ---------------------------------------------------------------------------
// Unverified allergen notice
// ---------------------------------------------------------------------------
// Shown wherever a dish depends on an ingredient whose allergen list nobody has
// checked against the product actually purchased.
//
// Written as an instruction, not a status. "Needs review" tells a chef nothing
// they can act on; "check Tom Yum Paste for shrimp paste" tells them which jar
// to pick up. Design Bible §4 and §12 both forbid meaning carried by colour, so
// the warning states itself in words and the icon is decorative.
// ---------------------------------------------------------------------------

import { Link } from "react-router-dom";
import { TriangleAlert } from "lucide-react";
import type { AllergenReview } from "@/engine/allergen-review";
import { cn } from "@/lib/utils";

interface Props {
  reviews: AllergenReview[];
  className?: string;
}

export function AllergenReviewNotice({ reviews, className }: Props) {
  if (reviews.length === 0) return null;

  return (
    <div
      // `alert` rather than `status`: an unverified allergen on a plate is not
      // ambient information, and a screen-reader user should hear it without
      // having to go looking.
      role="alert"
      className={cn(
        "rounded-lg border border-status-warning/40 bg-status-warning-soft p-4",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <TriangleAlert
          className="mt-0.5 size-4 shrink-0 text-status-warning"
          aria-hidden="true"
        />
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-status-warning">
            {reviews.length === 1
              ? "1 ingredient needs an allergen check"
              : `${reviews.length} ingredients need an allergen check`}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            These allergen lists were inferred from the ingredient name, not
            read from the product. Confirm them against the brand in the store
            before serving to a guest with an allergy.
          </p>

          <ul className="mt-3 space-y-2">
            {reviews.map((r) => (
              <li key={r.productId} className="text-sm">
                <Link
                  to={`/products/${r.productId}`}
                  className="font-medium underline underline-offset-4"
                >
                  {r.productName}
                </Link>
                {r.via.length > 0 && (
                  <span className="text-muted-foreground">
                    {" "}
                    — via {r.via.join(" › ")}
                  </span>
                )}
                {r.note && (
                  <p className="mt-0.5 text-xs text-muted-foreground">{r.note}</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

/**
 * Compact marker for list rows, where the full notice would not fit.
 *
 * Carries its own accessible text rather than relying on the icon, which a
 * screen reader would otherwise skip entirely.
 */
export function AllergenReviewFlag({ count }: { count: number }) {
  if (count === 0) return null;
  const label =
    count === 1
      ? "1 ingredient needs an allergen check"
      : `${count} ingredients need an allergen check`;

  return (
    <span
      className="inline-flex items-center gap-1 rounded-md bg-status-warning-soft px-1.5 py-0.5 text-[0.7rem] font-medium text-status-warning"
      title={label}
    >
      <TriangleAlert className="size-3" aria-hidden="true" />
      <span className="sr-only">{label}</span>
      <span aria-hidden="true">Check</span>
    </span>
  );
}
