import { describe, it, expect } from "vitest";
import type { Recipe, RecipeStatus } from "@ccos/shared";
import { EMPTY_PREPARATION } from "@ccos/shared";
import { canTransition, actualRequirements, nextStatuses, label } from "./status-workflow";

/**
 * Status workflow.
 *
 * The failure this prevents is specific: a dish marked live with no price
 * reports 0% food cost, which reads as perfectly profitable. So the cases
 * below are mostly about refusing, and about refusing in an order that sends
 * someone to fix the right thing.
 */

const recipe = (over: Partial<Recipe> = {}): Recipe =>
  ({
    id: "r1", name: "Dish", category: "T", status: "NEW" as RecipeStatus,
    ingredientLines: [
      { id: "l1", lineNumber: 1, productId: "p", subRecipeId: null, nettQty: 1,
        nettUnit: "kg", refPercent: 0, grossQty: 1, grossUnit: "kg",
        costPerUnit: "1", lineCost: "1" },
    ],
    portion: { yieldQty: 1, yieldUnit: "por" },
    pricing: { menuPrice: "50000", priceInclTax: "0", totalCost: "0", wasteAmount: "0",
      inflationAmount: "0", totalCog: "0", grossProfit: "0", grossProfitPercent: 0,
      foodCostPercent: 0, currency: "IDR" },
    wastePercent: 0, inflationPercent: 0, taxPercent: 21,
    nutritionPerPortion: { fatG: 0, carbsG: 0, proteinG: 0, vitAMg: 0, vitCMg: 0, calciumMg: 0, ironMg: 0, sodiumMg: 0, kcal: 0 },
    allergens: [],
    preparation: { ...EMPTY_PREPARATION, method: ["Cook it."] },
    dietaryFlags: { glutenFree: true, dairyFree: true, vegetarian: false, vegan: false, nutsFree: true, soyFree: true, sulfitesFree: true },
    version: 1, createdAt: "", updatedAt: "",
    ...over,
  }) as Recipe;

describe("the workflow itself", () => {
  it("refuses draft straight to live — RCP-BR-010", () => {
    const c = canTransition(recipe({ status: "NEW" }), "ACTUAL", "OWNER");
    expect(c.allowed).toBe(false);
    expect(c.reason).toMatch(/reviewed first/);
  });

  it("allows draft to pending", () => {
    expect(canTransition(recipe({ status: "NEW" }), "PENDING", "CHEF").allowed).toBe(true);
  });

  it("allows pending to live for an approver", () => {
    expect(canTransition(recipe({ status: "PENDING" }), "ACTUAL", "ADMIN").allowed).toBe(true);
  });

  it("allows sending a pending recipe back to draft", () => {
    // Rejection has to go somewhere, or a reviewer's only option is approval.
    expect(canTransition(recipe({ status: "PENDING" }), "NEW", "ADMIN").allowed).toBe(true);
  });

  it("lets an archived dish come back, because seasons repeat", () => {
    expect(nextStatuses("DISCONTINUED")).toContain("NEW");
  });

  it("refuses a move to the status it is already in", () => {
    expect(canTransition(recipe({ status: "NEW" }), "NEW", "OWNER").allowed).toBe(false);
  });

  it("refuses a transition that is not in the table at all", () => {
    expect(canTransition(recipe({ status: "NEW" }), "UPDATE", "OWNER").allowed).toBe(false);
  });
});

describe("what going live requires", () => {
  it("refuses without a selling price — RCP-BR-009", () => {
    // The reason this rule exists: no price means food cost reports 0%, which
    // reads as a perfectly profitable dish.
    const r = recipe({ status: "PENDING", pricing: { ...recipe().pricing, menuPrice: "0" } });
    const c = canTransition(r, "ACTUAL", "OWNER");
    expect(c.allowed).toBe(false);
    expect(c.reason).toMatch(/selling price/);
  });

  it("refuses without ingredients", () => {
    const r = recipe({ status: "PENDING", ingredientLines: [] });
    expect(canTransition(r, "ACTUAL", "OWNER").reason).toMatch(/at least one ingredient/);
  });

  it("refuses without a method", () => {
    const r = recipe({ status: "PENDING", preparation: EMPTY_PREPARATION });
    expect(canTransition(r, "ACTUAL", "OWNER").reason).toMatch(/a method/);
  });

  it("lists everything missing at once, not one thing at a time", () => {
    const r = recipe({
      status: "PENDING",
      ingredientLines: [],
      preparation: EMPTY_PREPARATION,
      pricing: { ...recipe().pricing, menuPrice: "0" },
    });
    expect(actualRequirements(r)).toHaveLength(3);
  });

  it("asks for nothing when the recipe is ready", () => {
    expect(actualRequirements(recipe())).toEqual([]);
  });
});

describe("who may approve", () => {
  it("refuses a chef approving onto the menu — AC3", () => {
    const c = canTransition(recipe({ status: "PENDING" }), "ACTUAL", "CHEF");
    expect(c.allowed).toBe(false);
    expect(c.needsApprover).toBe(true);
  });

  it("refuses a viewer, and someone with no role at all", () => {
    expect(canTransition(recipe({ status: "PENDING" }), "ACTUAL", "VIEWER").allowed).toBe(false);
    expect(canTransition(recipe({ status: "PENDING" }), "ACTUAL", undefined).allowed).toBe(false);
  });

  it("reports missing content before missing permission", () => {
    // Telling a chef they need an admin, for a recipe the admin will bounce
    // for having no price, wastes two people's time instead of one's.
    const r = recipe({ status: "PENDING", pricing: { ...recipe().pricing, menuPrice: "0" } });
    const c = canTransition(r, "ACTUAL", "CHEF");
    expect(c.needsApprover).toBe(false);
    expect(c.reason).toMatch(/selling price/);
  });

  it("does not gate the other transitions on approval", () => {
    expect(canTransition(recipe({ status: "ACTUAL" }), "UPDATE", "CHEF").allowed).toBe(true);
    expect(canTransition(recipe({ status: "NEW" }), "DISCONTINUED", "CHEF").allowed).toBe(true);
  });
});

describe("wording", () => {
  it("uses the SRS names, which are what a user recognises", () => {
    expect(label("NEW")).toBe("Draft");
    expect(label("ACTUAL")).toBe("On the menu");
    expect(label("DISCONTINUED")).toBe("Archived");
  });
});
