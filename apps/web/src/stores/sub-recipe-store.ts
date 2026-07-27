// ---------------------------------------------------------------------------
// Sub-recipe store — Zustand, in-memory
// ---------------------------------------------------------------------------

import { create } from "zustand";
import type { SubRecipe } from "@ccos/shared";
import { MOCK_SUB_RECIPES } from "@/data/mock-sub-recipes";

export interface SubRecipeState {
  subRecipes: SubRecipe[];
  getById: (id: string) => SubRecipe | undefined;
  search: (query: string) => SubRecipe[];
  create: (subRecipe: Omit<SubRecipe, "id" | "createdAt" | "updatedAt">) => SubRecipe;
  update: (id: string, changes: Partial<SubRecipe>) => void;
  remove: (id: string) => void;
}

export const useSubRecipeStore = create<SubRecipeState>((set, get) => ({
  subRecipes: [...MOCK_SUB_RECIPES],

  getById: (id) => get().subRecipes.find((s) => s.id === id),

  search: (query) => {
    const q = query.toLowerCase();
    return get().subRecipes.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.category.toLowerCase().includes(q),
    );
  },

  create: (data) => {
    const now = new Date().toISOString();
    const subRecipe: SubRecipe = {
      ...data,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    set((state) => ({ subRecipes: [...state.subRecipes, subRecipe] }));
    return subRecipe;
  },

  update: (id, changes) => {
    set((state) => ({
      subRecipes: state.subRecipes.map((s) =>
        s.id === id ? { ...s, ...changes, updatedAt: new Date().toISOString() } : s,
      ),
    }));
  },

  remove: (id) => {
    set((state) => ({
      subRecipes: state.subRecipes.filter((s) => s.id !== id),
    }));
  },
}));
