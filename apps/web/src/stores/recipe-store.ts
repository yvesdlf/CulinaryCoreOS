// ---------------------------------------------------------------------------
// Recipe store — Zustand, in-memory
// ---------------------------------------------------------------------------

import { create } from "zustand";
import type { Recipe } from "@ccos/shared";
import { MOCK_RECIPES } from "@/data/mock-recipes";
import { recalculateRecipe } from "@/engine/cascade";
import { useProductStore } from "@/stores/product-store";
import { useSubRecipeStore } from "@/stores/sub-recipe-store";

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

  /**
   * Re-cost one recipe against current product and sub-recipe prices.
   *
   * Delegates to the cascade engine rather than repeating the pricing formulas,
   * so there is a single definition of how a recipe is costed.
   */
  recalculate: (id) => {
    const recipe = get().getById(id);
    if (!recipe) return;

    const productById = new Map(
      useProductStore.getState().products.map((p) => [p.id, p]),
    );
    const subRecipeById = new Map(
      useSubRecipeStore.getState().subRecipes.map((s) => [s.id, s]),
    );
    const next = recalculateRecipe(recipe, productById, subRecipeById);

    set((state) => ({
      recipes: state.recipes.map((r) =>
        r.id === id ? { ...next, updatedAt: new Date().toISOString() } : r,
      ),
    }));
  },
}));
