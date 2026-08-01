// ---------------------------------------------------------------------------
// Deletion guards
// ---------------------------------------------------------------------------
// Nothing could be removed through the UI at all, which is tidy and useless: a
// catalogue accumulates mistakes, discontinued lines and things ordered once
// for a tasting, and with no way to remove them the list people search becomes
// the list people stop trusting.
//
// The rule is dependency, not permission. Deleting a product that recipes use
// does not tidy anything — it leaves dishes costing from a row that is gone,
// which is the failure the cascade exists to prevent. So:
//
//   * nothing depends on it        -> deleting is safe, ask once and do it
//   * something depends on it      -> refuse, and offer to archive instead
//
// Archiving is a status change, not a deletion. It takes the thing out of the
// working list while every dish built on it keeps costing correctly, which is
// what "we do not buy this any more" actually means in a kitchen.
// ---------------------------------------------------------------------------

import type { Product, SubRecipe, Recipe, Collection } from "@ccos/shared";
import { getDependents } from "./cascade";

export interface Blocker {
  kind: "sub-recipe" | "recipe" | "collection";
  id: string;
  name: string;
}

export interface DeletionVerdict {
  /** Safe to remove outright. */
  canDelete: boolean;
  /** What stands in the way, most useful first. */
  blockers: Blocker[];
  /** Plain sentence for the dialog. */
  reason: string;
}

interface Catalogue {
  subRecipes: SubRecipe[];
  recipes: Recipe[];
  collections?: Collection[];
}

function summarise(blockers: Blocker[]): string {
  if (blockers.length === 0) return "Nothing depends on this.";
  const subs = blockers.filter((b) => b.kind === "sub-recipe").length;
  const dishes = blockers.filter((b) => b.kind === "recipe").length;
  const packs = blockers.filter((b) => b.kind === "collection").length;
  const parts = [
    subs && `${subs} ${subs === 1 ? "preparation" : "preparations"}`,
    dishes && `${dishes} ${dishes === 1 ? "dish" : "dishes"}`,
    packs && `${packs} ${packs === 1 ? "collection" : "collections"}`,
  ].filter(Boolean);
  return `Used by ${parts.join(" and ")}.`;
}

/**
 * Whether a product or preparation can be removed.
 *
 * Transitive, because the harm is: deleting flour breaks the dough, and the
 * pizza built on the dough, and only the pizza is on a menu.
 */
export function canDeleteIngredient(
  id: string,
  catalogue: Catalogue,
): DeletionVerdict {
  const dep = getDependents(id, catalogue);
  const subById = new Map(catalogue.subRecipes.map((s) => [s.id, s]));
  const recipeById = new Map(catalogue.recipes.map((r) => [r.id, r]));

  const blockers: Blocker[] = [
    // A preparation is not its own blocker; the walk includes it when asked
    // about a sub-recipe, and "this is used by itself" helps nobody.
    ...dep.subRecipeIds
      .filter((sid) => sid !== id)
      .map((sid) => ({
        kind: "sub-recipe" as const,
        id: sid,
        name: subById.get(sid)?.name ?? "Unknown preparation",
      })),
    ...dep.recipeIds.map((rid) => ({
      kind: "recipe" as const,
      id: rid,
      name: recipeById.get(rid)?.name ?? "Unknown dish",
    })),
  ];

  return {
    canDelete: blockers.length === 0,
    blockers,
    reason: summarise(blockers),
  };
}

/**
 * Whether a dish can be removed.
 *
 * Nothing costs from a dish, so the only thing holding one is a collection
 * that prints it. That is a softer blocker than a costing dependency — a pack
 * with a hole in it is a nuisance, not a wrong number — but it is still
 * someone's printed pack, so it is surfaced rather than silently emptied.
 */
export function canDeleteRecipe(
  id: string,
  collections: Collection[],
): DeletionVerdict {
  const blockers: Blocker[] = collections
    .filter((c) => c.recipeIds.includes(id))
    .map((c) => ({ kind: "collection" as const, id: c.id, name: c.name }));

  return {
    canDelete: blockers.length === 0,
    blockers,
    reason: summarise(blockers),
  };
}
