// ---------------------------------------------------------------------------
// Production planning — SRS 4.11, PRO-FUNC-001
// ---------------------------------------------------------------------------
// Turns "we expect 40 covers of the burger and 25 of the squid" into what the
// kitchen actually has to make and pull from the store.
//
// Two outputs, because they are two different jobs done by two different
// people: a prep list of preparations to produce, deepest first, and a pull
// list of raw ingredients with what is already on the shelf subtracted.
//
// Quantities are scaled by whole batches, not by exact need. A preparation
// that yields a 2 kg batch cannot be made 1.2 times, so a kitchen that needs
// 2.4 kg makes two batches and consumes two batches' worth of ingredients.
// Pulling for the exact figure would leave every prep cook short.
// ---------------------------------------------------------------------------

import type { Product, SubRecipe, Recipe, IngredientLine } from "@ccos/shared";
import { toDecimal, calculateGrossQty } from "./cost-engine";

export interface CoverPlan {
  recipeId: string;
  covers: number;
}

export interface PrepTask {
  subRecipe: SubRecipe;
  /** What the dishes actually require, before rounding to whole batches. */
  quantityNeeded: number;
  /** What gets made: whole batches. */
  quantityMade: number;
  unit: string;
  batches: number;
  batchYield: number;
  /** Names of the dishes and preparations that drove this, for the sheet. */
  drivenBy: string[];
  /**
   * How deep in the chain: 0 is used straight by a dish, higher is nested
   * inside another preparation. Deeper things get made first.
   */
  depth: number;
}

export interface PullLine {
  product: Product;
  /** Gross quantity, so trim is included — you buy what you cut away. */
  grossQty: number;
  unit: string;
  onHand: number;
  /** What is missing after counting the shelf. Never negative. */
  shortfall: number;
  estimatedCost: string;
}

export interface ProductionPlan {
  prep: PrepTask[];
  pull: PullLine[];
  /**
   * Things the plan could not resolve. Surfaced rather than swallowed: a
   * silently dropped ingredient is a prep cook standing at an empty shelf.
   */
  problems: string[];
  /** Cost of everything to be pulled, at current prices. */
  totalCost: string;
}

interface SubDemand {
  qty: number;
  unit: string;
  depth: number;
  drivenBy: Set<string>;
}

interface ProductDemand {
  qty: number;
  unit: string;
  /** Every unit seen for this product, to catch g being added to kg. */
  units: Set<string>;
}

/**
 * Explode a set of expected covers into prep and pull lists.
 *
 * `levels` is optional: without it the pull list still says what is needed,
 * just not what is missing.
 */
export function planProduction(
  covers: CoverPlan[],
  state: { products: Product[]; subRecipes: SubRecipe[]; recipes: Recipe[] },
  levels: Map<string, { onHand: number }> = new Map(),
): ProductionPlan {
  const productById = new Map(state.products.map((p) => [p.id, p]));
  const subById = new Map(state.subRecipes.map((s) => [s.id, s]));
  const recipeById = new Map(state.recipes.map((r) => [r.id, r]));

  const subDemand = new Map<string, SubDemand>();
  const productDemand = new Map<string, ProductDemand>();
  const problems: string[] = [];

  function addProduct(line: IngredientLine, grossQty: number, driver: string) {
    const product = productById.get(line.productId!);
    if (!product) {
      problems.push(`${driver} uses an ingredient that no longer exists.`);
      return;
    }
    const existing = productDemand.get(product.id);
    if (existing) {
      existing.qty += grossQty;
      existing.units.add(line.grossUnit);
    } else {
      productDemand.set(product.id, {
        qty: grossQty,
        unit: line.grossUnit,
        units: new Set([line.grossUnit]),
      });
    }
  }

  /**
   * Walk one entity's lines at a given scale.
   *
   * `path` carries the chain being expanded so a preparation that references
   * itself, directly or through others, stops rather than recursing forever.
   */
  function expand(
    lines: IngredientLine[],
    multiplier: number,
    driver: string,
    depth: number,
    path: Set<string>,
  ) {
    for (const line of lines) {
      const nett = line.nettQty * multiplier;
      // Back to a plain number: quantities are measured, not money, and a
      // Decimal here would silently concatenate under `+=` further down.
      const gross = calculateGrossQty(nett, line.refPercent).toNumber();

      if (line.productId) {
        addProduct(line, gross, driver);
        continue;
      }
      if (!line.subRecipeId) continue;

      const sub = subById.get(line.subRecipeId);
      if (!sub) {
        problems.push(`${driver} uses a preparation that no longer exists.`);
        continue;
      }
      if (path.has(sub.id)) {
        problems.push(
          `${sub.name} is used inside itself, so its quantity could not be worked out.`,
        );
        continue;
      }

      const existing = subDemand.get(sub.id);
      if (existing) {
        existing.qty += gross;
        existing.drivenBy.add(driver);
        // Something needed deeper down must be made earlier, so the deepest
        // position a preparation appears at is the one that decides its slot.
        existing.depth = Math.max(existing.depth, depth);
      } else {
        subDemand.set(sub.id, {
          qty: gross,
          unit: line.grossUnit || sub.batchYield.unit,
          depth,
          drivenBy: new Set([driver]),
        });
      }
    }
  }

  // Pass one: the dishes themselves.
  for (const { recipeId, covers: n } of covers) {
    if (!n || n <= 0) continue;
    const recipe = recipeById.get(recipeId);
    if (!recipe) {
      problems.push("A dish on the plan no longer exists.");
      continue;
    }
    // Recipe lines are per the recipe's stated portion yield, not per cover.
    const perPortion = recipe.portion.yieldQty > 0 ? recipe.portion.yieldQty : 1;
    expand(recipe.ingredientLines, n / perPortion, recipe.name, 0, new Set());
  }

  /*
   * Pass two: expand preparations, shallowest first.
   *
   * The order matters and is not the order they were discovered in. A
   * preparation can be reached straight from one dish and nested inside
   * another preparation from a second dish. Expanding it when first seen
   * would use a total that had not finished accumulating, and pull
   * ingredients for a fraction of the real quantity.
   *
   * `levels` below is structural — how deep a preparation can sit in the
   * chain, regardless of what is being cooked today. Processing in that order
   * guarantees every preparation that could feed this one already has.
   */
  const depthOf = structuralLevels(state.recipes, state.subRecipes, subById);
  const order = [...subById.keys()].sort(
    (a, b) => (depthOf.get(a) ?? 0) - (depthOf.get(b) ?? 0),
  );

  /*
   * A cycle has no shallowest member, so no order exists that expands every
   * preparation after everything feeding it. The expansion below still
   * terminates — each preparation is expanded once — but the quantities for
   * whatever is caught in the loop are understated, so say so rather than
   * printing a confident sheet nobody can trust.
   */
  for (const id of cyclicSubRecipes(state.subRecipes, subById)) {
    if (subDemand.has(id)) {
      problems.push(
        `${subById.get(id)!.name} is used inside itself, so its quantity could not be worked out.`,
      );
    }
  }

  for (const id of order) {
    const demand = subDemand.get(id);
    if (!demand) continue;
    const sub = subById.get(id)!;
    const yieldQty = sub.batchYield.qty;
    if (!yieldQty || yieldQty <= 0) {
      problems.push(
        `${sub.name} has no batch yield, so its ingredients could not be worked out.`,
      );
      continue;
    }
    // Scale by what is made, not what is needed — see the file header. Making
    // `batches` batches means running the ingredient list `batches` times.
    const batches = Math.ceil(demand.qty / yieldQty);
    expand(
      sub.ingredientLines,
      batches,
      sub.name,
      demand.depth + 1,
      new Set([id]),
    );
  }

  const prep: PrepTask[] = [];
  for (const [id, demand] of subDemand) {
    const sub = subById.get(id)!;
    const yieldQty = sub.batchYield.qty > 0 ? sub.batchYield.qty : 0;
    const batches = yieldQty > 0 ? Math.ceil(demand.qty / yieldQty) : 0;
    prep.push({
      subRecipe: sub,
      quantityNeeded: round(demand.qty),
      quantityMade: round(batches * yieldQty),
      unit: sub.batchYield.unit,
      batches,
      batchYield: yieldQty,
      drivenBy: [...demand.drivenBy].sort(),
      depth: demand.depth,
    });
  }
  // Deepest first: you cannot make the sauce before the stock it is built on.
  prep.sort(
    (a, b) => b.depth - a.depth || a.subRecipe.name.localeCompare(b.subRecipe.name),
  );

  const pull: PullLine[] = [];
  for (const [id, demand] of productDemand) {
    const product = productById.get(id)!;
    if (demand.units.size > 1) {
      // Adding grams to kilograms silently would understate an order by a
      // factor of a thousand, which is the kind of mistake nobody catches
      // until the delivery arrives.
      problems.push(
        `${product.name} is measured in ${[...demand.units].join(" and ")} ` +
          `across different recipes, so its total cannot be added up.`,
      );
      continue;
    }
    const onHand = levels.get(id)?.onHand ?? 0;
    const grossQty = round(demand.qty);
    pull.push({
      product,
      grossQty,
      unit: demand.unit,
      onHand,
      shortfall: round(Math.max(0, grossQty - onHand)),
      estimatedCost: toDecimal(product.cost.grossPricePerUnit)
        .times(grossQty)
        .toFixed(2),
    });
  }
  // What is missing matters more than what is merely needed.
  pull.sort(
    (a, b) =>
      (b.shortfall > 0 ? 1 : 0) - (a.shortfall > 0 ? 1 : 0) ||
      a.product.name.localeCompare(b.product.name),
  );

  return {
    prep,
    pull,
    problems,
    totalCost: pull
      .reduce((acc, l) => acc.plus(toDecimal(l.estimatedCost)), toDecimal(0))
      .toFixed(2),
  };
}

/** Kitchen quantities to three decimals — a scale does not do more. */
function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * How deep each preparation can sit beneath a dish.
 *
 * Relaxation rather than recursion, because the graph is user-built and can
 * contain a preparation that reaches itself. A cycle would make the true
 * longest path infinite, so the pass count is capped: the levels stop rising
 * and the cycle is reported separately when it is expanded.
 */
function structuralLevels(
  recipes: Recipe[],
  subRecipes: SubRecipe[],
  subById: Map<string, SubRecipe>,
): Map<string, number> {
  const level = new Map<string, number>();

  for (const recipe of recipes) {
    for (const line of recipe.ingredientLines) {
      if (line.subRecipeId && subById.has(line.subRecipeId)) {
        level.set(line.subRecipeId, Math.max(level.get(line.subRecipeId) ?? 0, 0));
      }
    }
  }
  // Anything never used by a dish still needs a level so the sort is total.
  for (const sub of subRecipes) if (!level.has(sub.id)) level.set(sub.id, 0);

  for (let pass = 0; pass < subRecipes.length; pass++) {
    let changed = false;
    for (const sub of subRecipes) {
      const here = level.get(sub.id)!;
      for (const line of sub.ingredientLines) {
        if (!line.subRecipeId || !subById.has(line.subRecipeId)) continue;
        if ((level.get(line.subRecipeId) ?? 0) < here + 1) {
          level.set(line.subRecipeId, here + 1);
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  return level;
}

/**
 * Preparations that can reach themselves, directly or through others.
 *
 * Depth-first with a colour marking, because the graph is built by users and
 * nothing in the editor stops somebody putting a sauce inside the stock it is
 * made from.
 */
function cyclicSubRecipes(
  subRecipes: SubRecipe[],
  subById: Map<string, SubRecipe>,
): Set<string> {
  const cyclic = new Set<string>();
  const done = new Set<string>();
  const onPath = new Set<string>();

  function walk(id: string) {
    if (done.has(id)) return;
    if (onPath.has(id)) {
      // Everything currently on the path is part of the loop.
      for (const member of onPath) cyclic.add(member);
      return;
    }
    onPath.add(id);
    for (const line of subById.get(id)?.ingredientLines ?? []) {
      if (line.subRecipeId && subById.has(line.subRecipeId)) walk(line.subRecipeId);
    }
    onPath.delete(id);
    done.add(id);
  }

  for (const sub of subRecipes) walk(sub.id);
  return cyclic;
}
