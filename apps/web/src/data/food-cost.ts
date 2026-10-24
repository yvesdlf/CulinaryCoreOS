// ---------------------------------------------------------------------------
// Theoretical against actual
// ---------------------------------------------------------------------------
// One query, against the view built in 0092 and given its value and its
// caveats in 0097.
//
// The flags come from the view rather than being worked out here. A screen
// that decided for itself what "never counted" means would be a second
// definition, and the first thing to drift when somebody adds an export.
// ---------------------------------------------------------------------------

import { requireSupabase } from "@/lib/supabase";
import { fail } from "./_shared";

export interface FoodCostRow {
  productId: string;
  productName: string;
  category: string | null;
  theoreticalUsed: number;
  theoreticalValue: number;
  countAdjustment: number;
  countsBehindIt: number;
  adjustmentValue: number;
  lastCountedAt: string | null;
  /** Used but never counted: the variance is unknown, not zero. */
  neverCounted: boolean;
  /** Some sales are on unmapped till codes, so theoretical is understated. */
  salesPartlyUnmapped: boolean;
}

export async function fetchFoodCostVariance(): Promise<FoodCostRow[]> {
  const { data, error } = await requireSupabase()
    .from("food_cost_variance")
    .select("*");
  if (error) fail("fetchFoodCostVariance", error);
  return (data ?? []).map((r: any) => ({
    productId: r.product_id,
    productName: r.product_name,
    category: r.category,
    theoreticalUsed: Number(r.theoretical_used ?? 0),
    theoreticalValue: Number(r.theoretical_value ?? 0),
    countAdjustment: Number(r.count_adjustment ?? 0),
    countsBehindIt: Number(r.counts_behind_it ?? 0),
    adjustmentValue: Number(r.adjustment_value ?? 0),
    lastCountedAt: r.last_counted_at ?? null,
    neverCounted: Boolean(r.never_counted),
    salesPartlyUnmapped: Boolean(r.sales_partly_unmapped),
  }));
}
