import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { resolveAllergens, allergenNames } from "@/lib/allergens";

interface AllergenBadgesProps {
  /** Stored allergen values; mapped onto the EU/UK 14 registry for display. */
  allergens: string[];
  /** `compact` suits table cells; `full` adds the name beside the code. */
  variant?: "compact" | "full";
  /** Cap the number shown, with a "+N" overflow. Table cells want this. */
  max?: number;
  className?: string;
  /** Text when there are none. Absence is not a free-from claim. */
  emptyLabel?: string;
}

/**
 * Compact allergen display: code plus assistive icon.
 *
 * Per the standards manual's allergen registry, a code or icon must never
 * stand in for the written name, so every badge carries the full name as its
 * accessible label and in a tooltip. Icons are decorative here — marked
 * aria-hidden — because the code beside them already carries the meaning, and
 * nothing depends on colour.
 *
 * An empty list renders "No allergens recorded", not "allergen free": the
 * registry is explicit that absence of a declaration is not verification.
 */
export function AllergenBadges({
  allergens,
  variant = "compact",
  max,
  className,
  emptyLabel = "No allergens recorded",
}: AllergenBadgesProps) {
  const resolved = resolveAllergens(allergens);

  if (resolved.length === 0) {
    return (
      <span className={cn("text-xs text-muted-foreground", className)}>
        {emptyLabel}
      </span>
    );
  }

  const shown = max ? resolved.slice(0, max) : resolved;
  const hiddenCount = resolved.length - shown.length;

  return (
    <span
      className={cn("inline-flex flex-wrap items-center gap-1", className)}
      // One label carrying every full name, so a screen reader announces the
      // set in words rather than reading a row of three-letter codes.
      role="list"
      aria-label={`Allergens: ${allergenNames(allergens).join(", ")}`}
    >
      {shown.map((item) => {
        const key = item.known ? item.definition.id : `unknown:${item.raw}`;
        const label = item.known ? item.definition.name : item.raw;
        const code = item.known ? item.definition.code : "?";
        const Icon = item.known ? item.definition.icon : TriangleAlert;
        const note = item.known ? item.definition.note : undefined;

        return (
          <Tooltip key={key}>
            <TooltipTrigger
              render={
                <span
                  role="listitem"
                  className={cn(
                    "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5",
                    "text-[11px] font-medium leading-none tabular-nums",
                    item.known
                      ? "border-status-warning-border bg-status-warning-soft text-status-warning"
                      : // Unmapped values look different on purpose: they need
                        // correcting, not trusting.
                        "border-dashed border-border-strong text-text-muted",
                  )}
                />
              }
            >
              <Icon aria-hidden="true" className="size-3 shrink-0" />
              <span>{code}</span>
              {variant === "full" && <span className="font-normal">{label}</span>}
            </TooltipTrigger>
            <TooltipContent>
              <p className="font-medium">{label}</p>
              {note && <p className="max-w-52 text-xs opacity-80">{note}</p>}
              {!item.known && (
                <p className="max-w-52 text-xs opacity-80">
                  Not recognised in the EU/UK 14 profile — review this entry.
                </p>
              )}
            </TooltipContent>
          </Tooltip>
        );
      })}

      {hiddenCount > 0 && (
        <span className="text-[11px] text-muted-foreground">
          +{hiddenCount}
        </span>
      )}
    </span>
  );
}

/**
 * Named list of allergens for a detail page.
 *
 * Shows the full legal wording rather than codes alone, which is what the
 * registry requires wherever the declaration is the point of the view.
 */
export function AllergenPanelList({ allergens }: { allergens: string[] }) {
  const resolved = resolveAllergens(allergens);

  if (resolved.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No allergens recorded. This is not a free-from claim — it means nothing
        has been declared on the ingredients used.
      </p>
    );
  }

  return (
    <ul className="space-y-1.5">
      {resolved.map((item) => {
        const key = item.known ? item.definition.id : `unknown:${item.raw}`;
        const ItemIcon = item.known ? item.definition.icon : TriangleAlert;
        return (
          <li key={key} className="flex items-start gap-2 text-sm">
            <ItemIcon aria-hidden="true" className="mt-1 size-4 shrink-0" />
            <span className="w-9 shrink-0 font-medium tabular-nums leading-6">
              {item.known ? item.definition.code : "?"}
            </span>
            <span className="leading-6">
              {item.known ? item.definition.name : item.raw}
              {!item.known && (
                <span className="ml-1 text-xs text-muted-foreground">
                  (unrecognised — review)
                </span>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
