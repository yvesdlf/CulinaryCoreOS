import { useMemo } from "react";
import type { IngredientLine } from "@ccos/shared";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { CurrencyDisplay } from "@/components/shared/currency-display";
import {
  calculateRecipeTotalCost,
  calculateCostWithMargin,
  calculateSubRecipeCostPerUnit,
} from "@/engine/cost-engine";
import { DEFAULT_CURRENCY } from "@/lib/constants";
import { formatPercent, formatWeight } from "@/lib/format";
import { Calculator } from "lucide-react";

interface BatchCostPanelProps {
  lines: IngredientLine[];
  batchYieldQty: number;
  batchYieldUnit: string;
  securityMarginPercent: number;
  currency?: string;
}

export function BatchCostPanel({
  lines,
  batchYieldQty,
  batchYieldUnit,
  securityMarginPercent,
  currency = DEFAULT_CURRENCY,
}: BatchCostPanelProps) {
  const summary = useMemo(() => {
    // Stored strings go straight to the engine, which parses exact decimals.
    const totalCost = calculateRecipeTotalCost(lines);
    const totalWithMargin = calculateCostWithMargin(
      totalCost,
      securityMarginPercent,
    );
    const costPerUnit = calculateSubRecipeCostPerUnit(
      totalCost,
      batchYieldQty,
    );
    const costPerUnitWithMargin = calculateSubRecipeCostPerUnit(
      totalWithMargin,
      batchYieldQty,
    );

    return {
      totalCost,
      marginAmount: totalWithMargin.minus(totalCost),
      totalWithMargin,
      costPerUnit,
      costPerUnitWithMargin,
    };
  }, [lines, batchYieldQty, securityMarginPercent]);

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calculator className="size-4" />
          Batch Cost
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <Row label="Total cost">
          <CurrencyDisplay value={summary.totalCost} currency={currency} />
        </Row>
        <Row
          label={`+ Security margin (${formatPercent(securityMarginPercent)})`}
          subtle
        >
          <CurrencyDisplay value={summary.marginAmount} currency={currency} />
        </Row>
        <Separator />
        <Row label="Total with margin" bold>
          <CurrencyDisplay
            value={summary.totalWithMargin}
            currency={currency}
            className="font-semibold"
          />
        </Row>
        <Separator />
        <Row label="Batch yield">
          <span className="tabular-nums">
            {formatWeight(batchYieldQty, batchYieldUnit)}
          </span>
        </Row>
        <Row label="Cost per unit">
          <CurrencyDisplay
            value={summary.costPerUnit}
            currency={currency}
            decimals={4}
          />
        </Row>
        <Row label="Cost per unit + margin" bold>
          <CurrencyDisplay
            value={summary.costPerUnitWithMargin}
            currency={currency}
            decimals={4}
            className="font-semibold"
          />
        </Row>
      </CardContent>
    </Card>
  );
}

function Row({
  label,
  children,
  bold = false,
  subtle = false,
}: {
  label: string;
  children: React.ReactNode;
  bold?: boolean;
  subtle?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span
        className={
          bold
            ? "font-semibold"
            : subtle
              ? "text-muted-foreground"
              : "text-foreground"
        }
      >
        {label}
      </span>
      <span>{children}</span>
    </div>
  );
}
