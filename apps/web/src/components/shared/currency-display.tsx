import { formatCurrency, type Formattable } from "@/lib/format";
import { DEFAULT_CURRENCY } from "@/lib/constants";
import { cn } from "@/lib/utils";

interface CurrencyDisplayProps {
  /** Accepts a Decimal straight from the cost engine, or a stored string field. */
  value: Formattable;
  currency?: string;
  /**
   * Decimal places. Defaults to the currency's convention (0 for IDR); pass
   * 2-4 for per-unit costs, which would otherwise render as "Rp 0".
   */
  decimals?: number;
  className?: string;
}

export function CurrencyDisplay({
  value,
  currency = DEFAULT_CURRENCY,
  decimals,
  className,
}: CurrencyDisplayProps) {
  return (
    <span className={cn("tabular-nums", className)}>
      {formatCurrency(value, currency, decimals)}
    </span>
  );
}
