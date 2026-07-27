import { cn } from "@/lib/utils";
import { formatPercent } from "@/lib/format";

interface FoodCostIndicatorProps {
  value: number;
  className?: string;
}

export function FoodCostIndicator({
  value,
  className,
}: FoodCostIndicatorProps) {
  const level =
    value < 25 ? "good" : value <= 32 ? "acceptable" : "high";

  const styles = {
    good: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400",
    acceptable:
      "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-400",
    high: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium",
        styles[level],
        className
      )}
    >
      {formatPercent(value)}
    </span>
  );
}
