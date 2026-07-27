// ---------------------------------------------------------------------------
// Recipe store — Zustand, in-memory
// ---------------------------------------------------------------------------

import { create } from "zustand";
import type { Recipe } from "@ccos/shared";
import { MOCK_RECIPES } from "@/data/mock-recipes";
import {
  calculateRecipeTotalCost,
  calculateCostWithMargin,
  calculatePriceExclVat,
  calculateFoodCostPercent,
  calculateContributionMargin,
} from "@/engine/cost-engine";
import { DEFAULT_SECURITY_MARGIN, DEFAULT_VAT_RATE } from "@/lib/constants";

export interface RecipeState {
  recipes: Recipe[];
  getById: (id: string) => Recipe | undefined;
  search: (query: string) => Recipe[];
  create: (recipe: Omit<Recipe, "id" | "createdAt" | "updatedAt">) => Recipe;
  update: (id: string, changes: Partial<Recipe>) => void;
  remove: (id: string) => void;
  recalculate: (id: string) => void;
}

export const useRecipeStore = create<RecipeState>((set, get) => ({
  recipes: [...MOCK_RECIPES],

  getById: (id) => get().recipes.find((r) => r.id === id),

  search: (query) => {
    const q = query.toLowerCase();
    return get().recipes.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.category.toLowerCase().includes(q),
    );
  },

  create: (data) => {
    const now = new Date().toISOString();
    const recipe: Recipe = {
      ...data,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    set((state) => ({ recipes: [...state.recipes, recipe] }));
    return recipe;
  },

  update: (id, changes) => {
    set((state) => ({
      recipes: state.recipes.map((r) =>
        r.id === id ? { ...r, ...changes, updatedAt: new Date().toISOString() } : r,
      ),
    }));
  },

  remove: (id) => {
    set((state) => ({
      recipes: state.recipes.filter((r) => r.id !== id),
    }));
  },

  recalculate: (id) => {
    const recipe = get().getById(id);
    if (!recipe) return;

    const lines = recipe.ingredientLines.map((line) => ({
      lineCost: parseFloat(line.lineCost),
    }));

    const totalCost = calculateRecipeTotalCost(lines);
    const priceInclVat = parseFloat(recipe.pricing.priceInclVat);
    const priceExclVat = calculatePriceExclVat(priceInclVat, DEFAULT_VAT_RATE);
    const totalCostWithMargin = calculateCostWithMargin(totalCost, DEFAULT_SECURITY_MARGIN);
    const foodCostPercent = calculateFoodCostPercent(totalCostWithMargin, priceExclVat);
    const contributionMargin = calculateContributionMargin(priceExclVat, totalCostWithMargin);

    set((state) => ({
      recipes: state.recipes.map((r) =>
        r.id === id
          ? {
              ...r,
              pricing: {
                ...r.pricing,
                priceExclVat: priceExclVat.toFixed(2),
                totalCost: totalCost.toFixed(2),
                totalCostWithSecurityMargin: totalCostWithMargin.toFixed(2),
                grossContributionMargin: contributionMargin.toFixed(2),
                foodCostPercent: parseFloat(foodCostPercent.toFixed(1)),
              },
              updatedAt: new Date().toISOString(),
            }
          : r,
      ),
    }));
  },
}));
