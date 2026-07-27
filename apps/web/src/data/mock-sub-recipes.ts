// ---------------------------------------------------------------------------
// Mock sub-recipe data — 5 reusable components
// ---------------------------------------------------------------------------

import type { SubRecipe } from "@ccos/shared";

const now = new Date().toISOString();

export const MOCK_SUB_RECIPES: SubRecipe[] = [
  // 1. Chimichurri Base — Sauce, batch 2000 g
  {
    id: "sub-001",
    name: "Chimichurri Base",
    category: "Sauce",
    status: "ACTUAL",
    ingredientLines: [
      { id: "sl-001-1", lineNumber: 1, productId: "prod-013", subRecipeId: null, nettQty: 50, nettUnit: "g", refPercent: 15, grossQty: 58.82, grossUnit: "g", costPerUnit: "0.015", lineCost: "0.88" },
      { id: "sl-001-2", lineNumber: 2, productId: "prod-018", subRecipeId: null, nettQty: 800, nettUnit: "ml", refPercent: 0, grossQty: 800, grossUnit: "ml", costPerUnit: "0.0178", lineCost: "14.24" },
      { id: "sl-001-3", lineNumber: 3, productId: "prod-014", subRecipeId: null, nettQty: 200, nettUnit: "g", refPercent: 20, grossQty: 250, grossUnit: "g", costPerUnit: "0.006", lineCost: "1.50" },
    ],
    batchYield: { qty: 2000, unit: "g" },
    totalCost: "16.62",
    costPerUnit: "0.00831",
    securityMarginPercent: 5,
    nutritionPer100g: { fatG: 40, carbsG: 2.5, proteinG: 0.8, vitAMg: 0, vitCMg: 12, calciumMg: 8, ironMg: 0.4, sodiumMg: 3, kcal: 370 },
    allergens: [],
    version: 1,
    createdAt: now,
    updatedAt: now,
  },

  // 2. Pizza Dough — Bakery, batch 3000 g
  {
    id: "sub-002",
    name: "Pizza Dough",
    category: "Bakery",
    status: "ACTUAL",
    ingredientLines: [
      { id: "sl-002-1", lineNumber: 1, productId: "prod-016", subRecipeId: null, nettQty: 1500, nettUnit: "g", refPercent: 0, grossQty: 1500, grossUnit: "g", costPerUnit: "0.00168", lineCost: "2.52" },
      { id: "sl-002-2", lineNumber: 2, productId: "prod-017", subRecipeId: null, nettQty: 30, nettUnit: "g", refPercent: 0, grossQty: 30, grossUnit: "g", costPerUnit: "0.0055", lineCost: "0.17" },
      { id: "sl-002-3", lineNumber: 3, productId: "prod-018", subRecipeId: null, nettQty: 60, nettUnit: "ml", refPercent: 0, grossQty: 60, grossUnit: "ml", costPerUnit: "0.0178", lineCost: "1.07" },
    ],
    batchYield: { qty: 3000, unit: "g" },
    totalCost: "3.76",
    costPerUnit: "0.00125",
    securityMarginPercent: 5,
    nutritionPer100g: { fatG: 2.5, carbsG: 50, proteinG: 8, vitAMg: 0, vitCMg: 0, calciumMg: 12, ironMg: 3.2, sodiumMg: 380, kcal: 260 },
    allergens: ["gluten"],
    version: 1,
    createdAt: now,
    updatedAt: now,
  },

  // 3. Mashed Potato — Sides, batch 2000 g
  {
    id: "sub-003",
    name: "Mashed Potato",
    category: "Sides",
    status: "ACTUAL",
    ingredientLines: [
      { id: "sl-003-1", lineNumber: 1, productId: "prod-001", subRecipeId: null, nettQty: 200, nettUnit: "g", refPercent: 0, grossQty: 200, grossUnit: "g", costPerUnit: "0.01757", lineCost: "3.51" },
      { id: "sl-003-2", lineNumber: 2, productId: "prod-002", subRecipeId: null, nettQty: 300, nettUnit: "ml", refPercent: 0, grossQty: 300, grossUnit: "ml", costPerUnit: "0.0185", lineCost: "5.55" },
      { id: "sl-003-3", lineNumber: 3, productId: "prod-017", subRecipeId: null, nettQty: 15, nettUnit: "g", refPercent: 0, grossQty: 15, grossUnit: "g", costPerUnit: "0.0055", lineCost: "0.08" },
    ],
    batchYield: { qty: 2000, unit: "g" },
    totalCost: "9.14",
    costPerUnit: "0.00457",
    securityMarginPercent: 5,
    nutritionPer100g: { fatG: 8, carbsG: 15, proteinG: 2, vitAMg: 0.1, vitCMg: 8, calciumMg: 20, ironMg: 0.3, sodiumMg: 250, kcal: 140 },
    allergens: ["dairy"],
    version: 1,
    createdAt: now,
    updatedAt: now,
  },

  // 4. Chocolate Ganache — Pastry, batch 1000 g
  {
    id: "sub-004",
    name: "Chocolate Ganache",
    category: "Pastry",
    status: "ACTUAL",
    ingredientLines: [
      { id: "sl-004-1", lineNumber: 1, productId: "prod-002", subRecipeId: null, nettQty: 500, nettUnit: "ml", refPercent: 0, grossQty: 500, grossUnit: "ml", costPerUnit: "0.0185", lineCost: "9.25" },
      { id: "sl-004-2", lineNumber: 2, productId: "prod-001", subRecipeId: null, nettQty: 50, nettUnit: "g", refPercent: 0, grossQty: 50, grossUnit: "g", costPerUnit: "0.01757", lineCost: "0.88" },
      { id: "sl-004-3", lineNumber: 3, productId: "prod-017", subRecipeId: null, nettQty: 5, nettUnit: "g", refPercent: 0, grossQty: 5, grossUnit: "g", costPerUnit: "0.0055", lineCost: "0.03" },
    ],
    batchYield: { qty: 1000, unit: "g" },
    totalCost: "10.16",
    costPerUnit: "0.01016",
    securityMarginPercent: 5,
    nutritionPer100g: { fatG: 22, carbsG: 35, proteinG: 4, vitAMg: 0.05, vitCMg: 0, calciumMg: 40, ironMg: 2.5, sodiumMg: 15, kcal: 360 },
    allergens: ["dairy"],
    version: 1,
    createdAt: now,
    updatedAt: now,
  },

  // 5. Burger Sauce — Sauce, batch 500 g
  {
    id: "sub-005",
    name: "Burger Sauce",
    category: "Sauce",
    status: "ACTUAL",
    ingredientLines: [
      { id: "sl-005-1", lineNumber: 1, productId: "prod-012", subRecipeId: null, nettQty: 50, nettUnit: "g", refPercent: 10, grossQty: 55.56, grossUnit: "g", costPerUnit: "0.0024", lineCost: "0.13" },
      { id: "sl-005-2", lineNumber: 2, productId: "prod-013", subRecipeId: null, nettQty: 20, nettUnit: "g", refPercent: 15, grossQty: 23.53, grossUnit: "g", costPerUnit: "0.015", lineCost: "0.35" },
      { id: "sl-005-3", lineNumber: 3, productId: "prod-014", subRecipeId: null, nettQty: 30, nettUnit: "g", refPercent: 20, grossQty: 37.5, grossUnit: "g", costPerUnit: "0.006", lineCost: "0.23" },
    ],
    batchYield: { qty: 500, unit: "g" },
    totalCost: "0.71",
    costPerUnit: "0.00142",
    securityMarginPercent: 5,
    nutritionPer100g: { fatG: 18, carbsG: 12, proteinG: 1.5, vitAMg: 0, vitCMg: 4, calciumMg: 15, ironMg: 0.2, sodiumMg: 520, kcal: 220 },
    allergens: ["egg"],
    version: 1,
    createdAt: now,
    updatedAt: now,
  },
];
