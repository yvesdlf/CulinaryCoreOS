// ---------------------------------------------------------------------------
// Menu engineering — SRS 4.8, Phase 6
// ---------------------------------------------------------------------------
// Sorts dishes into Stars, Plowhorses, Puzzles and Dogs by crossing how often
// they sell against what each sale contributes.
//
// Two decisions worth stating, because both are conventions rather than
// arithmetic:
//
// Profitability is compared on contribution in money, not on food cost
// percentage. A dish at 32% food cost on a high price usually contributes more
// per plate than one at 22% on a low price, and it is the money that pays the
// rent. Ranking by percentage quietly promotes cheap dishes.
//
// Popularity uses the Kasavana & Smith 70% rule: a dish is popular if it takes
// at least 70% of an equal share of the menu. With ten dishes an equal share is
// 10%, so the line sits at 7%. A plain average would put almost half of any
// menu below the line by construction.
// ---------------------------------------------------------------------------

import type { Recipe } from "@ccos/shared";
import { toDecimal } from "./cost-engine";

export type MenuClass = "star" | "plowhorse" | "puzzle" | "dog";

export interface EngineeredDish {
  recipe: Recipe;
  unitsSold: number;
  /** Share of all units sold, as a percentage. */
  menuMixPercent: number;
  /** Menu price less cost, per portion. */
  contributionMargin: string;
  /** Contribution margin times units sold. */
  totalContribution: string;
  foodCostPercent: number;
  classification: MenuClass;
  popular: boolean;
  profitable: boolean;
}

export interface MenuEngineering {
  dishes: EngineeredDish[];
  /** The line each dish is measured against. */
  averageContribution: string;
  popularityThresholdPercent: number;
  totalUnits: number;
  totalContribution: string;
  counts: Record<MenuClass, number>;
}

export const CLASS_LABEL: Record<MenuClass, string> = {
  star: "Star",
  plowhorse: "Plowhorse",
  puzzle: "Puzzle",
  dog: "Dog",
};

/** What to actually do about each, which is the point of the exercise. */
export const CLASS_ADVICE: Record<MenuClass, string> = {
  star: "Sells well and pays well. Keep it exactly as it is, and give it the best position on the menu.",
  plowhorse:
    "Popular but thin. Raise the price a little, or take cost out of the plate — the volume is already there.",
  puzzle:
    "Pays well but nobody orders it. Move it up the menu, rename it, or let the staff recommend it before you cut it.",
  dog: "Neither sells nor pays. Take it off, unless it is there for a reason the numbers do not show.",
};

/** The share of an equal slice a dish must reach to count as popular. */
const POPULARITY_RULE = 0.7;

export function engineerMenu(
  sales: { recipe: Recipe; unitsSold: number }[],
): MenuEngineering {
  const selling = sales.filter((s) => s.unitsSold > 0);
  const totalUnits = selling.reduce((n, s) => n + s.unitsSold, 0);

  if (selling.length === 0 || totalUnits === 0) {
    return {
      dishes: [],
      averageContribution: "0.00",
      popularityThresholdPercent: 0,
      totalUnits: 0,
      totalContribution: "0.00",
      counts: { star: 0, plowhorse: 0, puzzle: 0, dog: 0 },
    };
  }

  const measured = selling.map((s) => {
    const price = toDecimal(s.recipe.pricing.menuPrice);
    const cost = toDecimal(s.recipe.pricing.totalCog);
    const margin = price.minus(cost);
    return {
      ...s,
      margin,
      total: margin.times(s.unitsSold),
      price,
      cost,
    };
  });

  const totalContribution = measured.reduce(
    (acc, m) => acc.plus(m.total),
    toDecimal(0),
  );
  /*
   * Weighted by units, not a plain average of the margins. A dish selling
   * three a month should not pull the line the same distance as one selling
   * three hundred.
   */
  const averageContribution = totalContribution.dividedBy(totalUnits);
  const thresholdPercent = (POPULARITY_RULE / selling.length) * 100;

  const dishes: EngineeredDish[] = measured.map((m) => {
    const mixPercent = (m.unitsSold / totalUnits) * 100;
    const popular = mixPercent >= thresholdPercent;
    // At or above the line counts as profitable, so a menu of identical
    // margins reads as all-Star rather than all-Dog.
    const profitable = m.margin.gte(averageContribution);
    return {
      recipe: m.recipe,
      unitsSold: m.unitsSold,
      menuMixPercent: mixPercent,
      contributionMargin: m.margin.toFixed(2),
      totalContribution: m.total.toFixed(2),
      foodCostPercent: m.price.gt(0)
        ? m.cost.dividedBy(m.price).times(100).toNumber()
        : 0,
      classification: popular
        ? profitable
          ? "star"
          : "plowhorse"
        : profitable
          ? "puzzle"
          : "dog",
      popular,
      profitable,
    };
  });

  // Biggest total contribution first — the dishes that pay for the building.
  dishes.sort(
    (a, b) =>
      Number(b.totalContribution) - Number(a.totalContribution) ||
      a.recipe.name.localeCompare(b.recipe.name),
  );

  const counts: Record<MenuClass, number> = {
    star: 0,
    plowhorse: 0,
    puzzle: 0,
    dog: 0,
  };
  for (const d of dishes) counts[d.classification]++;

  return {
    dishes,
    averageContribution: averageContribution.toFixed(2),
    popularityThresholdPercent: thresholdPercent,
    totalUnits,
    totalContribution: totalContribution.toFixed(2),
    counts,
  };
}
