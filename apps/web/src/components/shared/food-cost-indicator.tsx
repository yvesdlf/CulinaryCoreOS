import { cn } from "@/lib/utils";
import { formatPercent, type Formattable } from "@/lib/format";
import { TARGET_FOOD_COST_PERCENT, FOOD_COST_VARIANCE_PERCENT } from "@/lib/constants";

interface FoodCostIndicatorProps {
  /** Accepts a Decimal from the cost engine or a plain number from stored data. */
  value: Formattable;
  className?: string;
}

/**
 * Food cost against target, using semantic status tokens (Design Bible §3.1).
 *
 * Bands come from the venue's own thresholds rather than invented numbers:
 * target 25% with ±2% acceptable variance, so on-target is 23–27%, above
 * variance is a warning, and well over is a danger.
 *
 * The percentage is always written out, so colour is supplementary — §4 and
 * §12 both forbid status carried by colour alone. `title` names the band for
 * anyone who cannot distinguish the fills.
 */
export function FoodCostIndicator({ value, className }: FoodCostIndicatorProps) {
  const pct = typeof value === "number" ? value : Number(value);

  const upper = TARGET_FOOD_COST_PERCENT + FOOD_COST_VARIANCE_PERCENT;
  const band =
    !Number.isFinite(pct) || pct <= upper
      ? "on-target"
      : pct <= upper + 5
        ? "over"
        : "well-over";

  const styles = {
    "on-target": "bg-status-success-soft text-status-success",
    over: "bg-status-warning-soft text-status-warning",
    "well-over": "bg-status-danger-soft text-status-danger",
  } as const;

  const description = {
    "on-target": `On target (at or below ${upper}%)`,
    over: `Above target of ${TARGET_FOOD_COST_PERCENT}%`,
    "well-over": `Well above target of ${TARGET_FOOD_COST_PERCENT}%`,
  } as const;

  return (
    <span
      title={description[band]}
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium tabular-nums",
        styles[band],
        className,
      )}
    >
      {formatPercent(value)}
    </span>
  );
}
