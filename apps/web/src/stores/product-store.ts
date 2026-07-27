// ---------------------------------------------------------------------------
// Product store — Zustand, in-memory
// ---------------------------------------------------------------------------

import { create } from "zustand";
import type { Product } from "@ccos/shared";
import { MOCK_PRODUCTS } from "@/data/mock-products";

export interface ProductState {
  products: Product[];
  getById: (id: string) => Product | undefined;
  search: (query: string) => Product[];
  create: (product: Omit<Product, "id" | "createdAt" | "updatedAt">) => Product;
  update: (id: string, changes: Partial<Product>) => void;
  remove: (id: string) => void;
}

export const useProductStore = create<ProductState>((set, get) => ({
  products: [...MOCK_PRODUCTS],

  getById: (id) => get().products.find((p) => p.id === id),

  search: (query) => {
    const q = query.toLowerCase();
    return get().products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.brand && p.brand.toLowerCase().includes(q)) ||
        (p.supplier && p.supplier.toLowerCase().includes(q)) ||
        p.category.toLowerCase().includes(q),
    );
  },

  create: (data) => {
    const now = new Date().toISOString();
    const product: Product = {
      ...data,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    set((state) => ({ products: [...state.products, product] }));
    return product;
  },

  update: (id, changes) => {
    set((state) => ({
      products: state.products.map((p) =>
        p.id === id ? { ...p, ...changes, updatedAt: new Date().toISOString() } : p,
      ),
    }));
  },

  remove: (id) => {
    set((state) => ({
      products: state.products.filter((p) => p.id !== id),
    }));
  },
}));
