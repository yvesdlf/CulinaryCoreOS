// ---------------------------------------------------------------------------
// Recipe status workflow
// ---------------------------------------------------------------------------
// Statuses existed as labels on a dropdown, so any dish could be set to any
// state: an unpriced, unreviewed recipe could be marked live on the menu, and
// the food cost it reported would be 0% because there was no price to divide
// by. SRS RCP-FUNC-006 and RCP-BR-009/010 describe the workflow that stops
// that; this is it, as rules rather than as a form.
//
// Mapping the SRS names onto the stored enum:
//
//   Draft    -> NEW           being written, not for the kitchen
//   Pending  -> PENDING       finished, waiting on someone to approve it
//   Actual   -> ACTUAL        approved and on the menu
//   Update   -> UPDATE        live, with a revision in progress
//   Archived -> DISCONTINUED  withdrawn, kept for reference
//
// Two things deliberately kept apart: whether a transition is *allowed* at all
// (the workflow), and whether this *person* may make it (the role). Conflating
// them produces the failure where an admin can push a recipe live without a
// price because the check that mattered was the permission one.
// ---------------------------------------------------------------------------

import type { Recipe, RecipeStatus } from "@ccos/shared";
import type { OrgRole } from "@/stores/auth-store";
import { toDecimal } from "./cost-engine";

/** Where a status can go next. Anything not listed is refused. */
const TRANSITIONS: Record<RecipeStatus, RecipeStatus[]> = {
  // RCP-BR-010: no direct Draft -> Actual.
  NEW: ["PENDING", "DISCONTINUED"],
  PENDING: ["ACTUAL", "NEW", "DISCONTINUED"],
  ACTUAL: ["UPDATE", "DISCONTINUED"],
  // A revision either lands or is abandoned back to the live version.
  UPDATE: ["ACTUAL", "DISCONTINUED"],
  // Archived is not a dead end: a seasonal dish comes back.
  DISCONTINUED: ["NEW", "ACTUAL"],
};

/** Approving is the one transition a chef cannot make for their own work. */
const APPROVER_ROLES: OrgRole[] = ["OWNER", "ADMIN"];

export interface TransitionCheck {
  allowed: boolean;
  /** Why not, in words meant for the person holding the mouse. */
  reason: string;
  /** True when only the role is missing — the work itself is ready. */
  needsApprover: boolean;
}

/**
 * Everything that must be true before a dish can go live.
 *
 * Returned as a list rather than a boolean so the UI can show what is missing
 * instead of disabling a control and leaving the user to guess. SRS AC4.
 */
export function actualRequirements(recipe: Recipe): string[] {
  const missing: string[] = [];

  // RCP-BR-009. Without a price the food cost is not merely unknown, it is
  // reported as 0% — a dish that looks perfectly profitable.
  if (!toDecimal(recipe.pricing.menuPrice).greaterThan(0)) {
    missing.push("a selling price");
  }
  if (recipe.ingredientLines.length === 0) {
    missing.push("at least one ingredient");
  }
  if (!recipe.name.trim()) {
    missing.push("a name");
  }
  // Not in the SRS, and included because a live dish with no method is the
  // gap this app just spent a release closing.
  if (recipe.preparation.method.length === 0) {
    missing.push("a method");
  }
  return missing;
}

/**
 * Whether this person can move this recipe to this status, now.
 */
export function canTransition(
  recipe: Recipe,
  to: RecipeStatus,
  role: OrgRole | undefined,
): TransitionCheck {
  const from = recipe.status;

  if (from === to) {
    return { allowed: false, reason: "Already in this status.", needsApprover: false };
  }

  if (!TRANSITIONS[from]?.includes(to)) {
    return {
      allowed: false,
      reason:
        from === "NEW" && to === "ACTUAL"
          ? "A draft has to be reviewed first — send it for approval, then approve it."
          : `A ${label(from).toLowerCase()} recipe cannot go straight to ${label(to).toLowerCase()}.`,
      needsApprover: false,
    };
  }

  if (to === "ACTUAL") {
    const missing = actualRequirements(recipe);
    if (missing.length > 0) {
      return {
        allowed: false,
        reason: `Needs ${missing.join(", ")} before it can go on the menu.`,
        needsApprover: false,
      };
    }
    // SRS AC3. Checked after the content requirements on purpose: telling
    // someone they lack permission for a recipe that is not ready anyway
    // sends them to find an admin who will then find the same gaps.
    if (!role || !APPROVER_ROLES.includes(role)) {
      return {
        allowed: false,
        reason: "Only an owner or admin can approve a recipe onto the menu.",
        needsApprover: true,
      };
    }
  }

  return { allowed: true, reason: "", needsApprover: false };
}

/** The statuses worth offering from here, whether or not they are reachable yet. */
export function nextStatuses(from: RecipeStatus): RecipeStatus[] {
  return TRANSITIONS[from] ?? [];
}

/** SRS wording, which is what a user recognises. */
export function label(status: RecipeStatus): string {
  return (
    {
      NEW: "Draft",
      PENDING: "Pending approval",
      ACTUAL: "On the menu",
      UPDATE: "Revision in progress",
      DISCONTINUED: "Archived",
    } as Record<RecipeStatus, string>
  )[status] ?? status;
}
