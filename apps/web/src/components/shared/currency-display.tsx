import { formatCurrency } from "@/lib/format";
import { DEFAULT_CURRENCY } from "@/lib/constants";
import { cn } from "@/lib/utils";

interface CurrencyDisplayProps {
  value: number | string;
  currency?: string;
  /** Decimal places — pass 4 for per-unit costs, which round to 0.00 at 2dp. */
  decimals?: number;
  className?: string;
}

export function CurrencyDisplay({
  value,
  currency = DEFAULT_CURRENCY,
  decimals,
  className,
}: CurrencyDisplayProps) {
  const numericValue = typeof value === "string" ? parseFloat(value) : value;

  if (isNaN(numericValue)) {
    return <span className={cn("tabular-nums", className)}>--</span>;
  }

  return (
    <span className={cn("tabular-nums", className)}>
      {formatCurrency(numericValue, currency, decimals)}
    </span>
  );
}
