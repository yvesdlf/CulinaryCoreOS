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
      { id: "sl-001-1", lineNumber: 1, productId: "prod-013", subRecipeId: null, nettQty: 50, nettUnit: "g", refPercent: 15, grossQty: 58.82, grossUnit: "g", costPerUnit: "64.50000", lineCost: "3794" },
      { id: "sl-001-2", lineNumber: 2, productId: "prod-018", subRecipeId: null, nettQty: 800, nettUnit: "ml", refPercent: 0, grossQty: 800.00, grossUnit: "ml", costPerUnit: "76.54000", lineCost: "61232" },
      { id: "sl-001-3", lineNumber: 3, productId: "prod-014", subRecipeId: null, nettQty: 200, nettUnit: "g", refPercent: 20, grossQty: 250.00, grossUnit: "g", costPerUnit: "25.80000", lineCost: "6450" },
    ],
    batchYield: { qty: 2000, unit: "g" },
    totalCost: "71476",
    costPerUnit: "35.73806",
    wastePercent: 5,
    inflationPercent: 0,
    taxPercent: 21,
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
      { id: "sl-002-1", lineNumber: 1, productId: "prod-016", subRecipeId: null, nettQty: 1500, nettUnit: "g", refPercent: 0, grossQty: 1500.00, grossUnit: "g", costPerUnit: "7.22400", lineCost: "10836" },
      { id: "sl-002-2", lineNumber: 2, productId: "prod-017", subRecipeId: null, nettQty: 30, nettUnit: "g", refPercent: 0, grossQty: 30.00, grossUnit: "g", costPerUnit: "23.65000", lineCost: "710" },
      { id: "sl-002-3", lineNumber: 3, productId: "prod-018", subRecipeId: null, nettQty: 60, nettUnit: "ml", refPercent: 0, grossQty: 60.00, grossUnit: "ml", costPerUnit: "76.54000", lineCost: "4592" },
    ],
    batchYield: { qty: 3000, unit: "g" },
    totalCost: "16138",
    costPerUnit: "5.37930",
    wastePercent: 5,
    inflationPercent: 0,
    taxPercent: 21,
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
      { id: "sl-003-1", lineNumber: 1, productId: "prod-001", subRecipeId: null, nettQty: 200, nettUnit: "g", refPercent: 0, grossQty: 200.00, grossUnit: "g", costPerUnit: "75.55100", lineCost: "15110" },
      { id: "sl-003-2", lineNumber: 2, productId: "prod-002", subRecipeId: null, nettQty: 300, nettUnit: "ml", refPercent: 0, grossQty: 300.00, grossUnit: "ml", costPerUnit: "79.55000", lineCost: "23865" },
      { id: "sl-003-3", lineNumber: 3, productId: "prod-017", subRecipeId: null, nettQty: 15, nettUnit: "g", refPercent: 0, grossQty: 15.00, grossUnit: "g", costPerUnit: "23.65000", lineCost: "355" },
    ],
    batchYield: { qty: 2000, unit: "g" },
    totalCost: "39330",
    costPerUnit: "19.66498",
    wastePercent: 5,
    inflationPercent: 0,
    taxPercent: 21,
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
      { id: "sl-004-1", lineNumber: 1, productId: "prod-002", subRecipeId: null, nettQty: 500, nettUnit: "ml", refPercent: 0, grossQty: 500.00, grossUnit: "ml", costPerUnit: "79.55000", lineCost: "39775" },
      { id: "sl-004-2", lineNumber: 2, productId: "prod-001", subRecipeId: null, nettQty: 50, nettUnit: "g", refPercent: 0, grossQty: 50.00, grossUnit: "g", costPerUnit: "75.55100", lineCost: "3778" },
      { id: "sl-004-3", lineNumber: 3, productId: "prod-017", subRecipeId: null, nettQty: 5, nettUnit: "g", refPercent: 0, grossQty: 5.00, grossUnit: "g", costPerUnit: "23.65000", lineCost: "118" },
    ],
    batchYield: { qty: 1000, unit: "g" },
    totalCost: "43671",
    costPerUnit: "43.67080",
    wastePercent: 5,
    inflationPercent: 0,
    taxPercent: 21,
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
      { id: "sl-005-1", lineNumber: 1, productId: "prod-012", subRecipeId: null, nettQty: 50, nettUnit: "g", refPercent: 10, grossQty: 55.56, grossUnit: "g", costPerUnit: "10.32000", lineCost: "573" },
      { id: "sl-005-2", lineNumber: 2, productId: "prod-013", subRecipeId: null, nettQty: 20, nettUnit: "g", refPercent: 15, grossQty: 23.53, grossUnit: "g", costPerUnit: "64.50000", lineCost: "1518" },
      { id: "sl-005-3", lineNumber: 3, productId: "prod-014", subRecipeId: null, nettQty: 30, nettUnit: "g", refPercent: 20, grossQty: 37.50, grossUnit: "g", costPerUnit: "25.80000", lineCost: "968" },
    ],
    batchYield: { qty: 500, unit: "g" },
    totalCost: "3058",
    costPerUnit: "6.11696",
    wastePercent: 5,
    inflationPercent: 0,
    taxPercent: 21,
    nutritionPer100g: { fatG: 18, carbsG: 12, proteinG: 1.5, vitAMg: 0, vitCMg: 4, calciumMg: 15, ironMg: 0.2, sodiumMg: 520, kcal: 220 },
    allergens: ["egg"],
    version: 1,
    createdAt: now,
    updatedAt: now,
  },
];
