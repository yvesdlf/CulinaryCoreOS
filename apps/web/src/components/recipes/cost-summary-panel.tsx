import { useMemo } from "react";
import type { IngredientLine } from "@ccos/shared";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { CurrencyDisplay } from "@/components/shared/currency-display";
import { FoodCostIndicator } from "@/components/shared/food-cost-indicator";
import {
  calculateRecipeTotalCost,
  calculateCostWithMargin,
  calculatePriceExclVat,
  calculateFoodCostPercent,
  calculateContributionMargin,
  calculateRecommendedPrice,
} from "@/engine/cost-engine";
import { DEFAULT_VAT_RATE, DEFAULT_CURRENCY } from "@/lib/constants";
import { formatPercent } from "@/lib/format";
import { Calculator } from "lucide-react";

interface CostSummaryPanelProps {
  lines: IngredientLine[];
  priceInclVat: number;
  securityMarginPercent: number;
  currency?: string;
}

export function CostSummaryPanel({
  lines,
  priceInclVat,
  securityMarginPercent,
  currency = DEFAULT_CURRENCY,
}: CostSummaryPanelProps) {
  const summary = useMemo(() => {
    const lineCosts = lines.map((l) => ({ lineCost: parseFloat(l.lineCost) }));
    const totalCost = calculateRecipeTotalCost(lineCosts);
    const marginAmount = totalCost * (securityMarginPercent / 100);
    const totalWithMargin = calculateCostWithMargin(
      totalCost,
      securityMarginPercent,
    );
    const priceExclVat = calculatePriceExclVat(priceInclVat, DEFAULT_VAT_RATE);
    const foodCostPercent = calculateFoodCostPercent(
      totalWithMargin,
      priceExclVat,
    );
    const contributionMargin = calculateContributionMargin(
      priceExclVat,
      totalWithMargin,
    );
    const recommended25 = calculateRecommendedPrice(totalWithMargin, 25);
    const recommended30 = calculateRecommendedPrice(totalWithMargin, 30);

    return {
      totalCost,
      marginAmount,
      totalWithMargin,
      priceExclVat,
      foodCostPercent,
      contributionMargin,
      recommended25,
      recommended30,
    };
  }, [lines, priceInclVat, securityMarginPercent]);

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calculator className="size-4" />
          Cost Summary
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <Row label="Total ingredient cost">
          <CurrencyDisplay value={summary.totalCost} currency={currency} />
        </Row>
        <Row
          label={`+ Security margin (${formatPercent(securityMarginPercent)})`}
          subtle
        >
          <CurrencyDisplay value={summary.marginAmount} currency={currency} />
        </Row>
        <Separator />
        <Row label="Total cost with margin" bold>
          <CurrencyDisplay
            value={summary.totalWithMargin}
            currency={currency}
            className="font-semibold"
          />
        </Row>
        <Separator />
        <Row label="Selling price excl. VAT">
          <CurrencyDisplay value={summary.priceExclVat} currency={currency} />
        </Row>
        <Row label="Food cost %">
          <FoodCostIndicator value={summary.foodCostPercent} />
        </Row>
        <Row label="Gross contribution margin">
          <CurrencyDisplay
            value={summary.contributionMargin}
            currency={currency}
          />
        </Row>
        <Separator />
        <Row label="Recommended @ 25% FC" subtle>
          <CurrencyDisplay
            value={summary.recommended25}
            currency={currency}
            className="text-muted-foreground"
          />
        </Row>
        <Row label="Recommended @ 30% FC" subtle>
          <CurrencyDisplay
            value={summary.recommended30}
            currency={currency}
            className="text-muted-foreground"
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
