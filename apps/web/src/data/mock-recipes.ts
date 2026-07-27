// ---------------------------------------------------------------------------
// Mock recipe data — 5 sellable menu items
// ---------------------------------------------------------------------------

import type { Recipe } from "@ccos/shared";

const now = new Date().toISOString();

export const MOCK_RECIPES: Recipe[] = [
  // 1. Tenderloin Pepper — 05.MAINS, AED 185
  //    Food cost: ~33.50 / 176.19 excl-VAT => ~19%  (bumped ingredient qty for ~28%)
  {
    id: "rec-001",
    name: "Tenderloin Pepper",
    category: "05.MAINS",
    status: "ACTUAL",
    ingredientLines: [
      { id: "rl-001-1", lineNumber: 1, productId: "prod-005", subRecipeId: null, nettQty: 220, nettUnit: "g", refPercent: 20, grossQty: 275, grossUnit: "g", costPerUnit: "0.15", lineCost: "41.25" },
      { id: "rl-001-2", lineNumber: 2, productId: "prod-001", subRecipeId: null, nettQty: 30, nettUnit: "g", refPercent: 0, grossQty: 30, grossUnit: "g", costPerUnit: "0.01757", lineCost: "0.53" },
      { id: "rl-001-3", lineNumber: 3, productId: "prod-019", subRecipeId: null, nettQty: 5, nettUnit: "g", refPercent: 0, grossQty: 5, grossUnit: "g", costPerUnit: "0.07", lineCost: "0.35" },
      { id: "rl-001-4", lineNumber: 4, productId: "prod-002", subRecipeId: null, nettQty: 80, nettUnit: "ml", refPercent: 0, grossQty: 80, grossUnit: "ml", costPerUnit: "0.0185", lineCost: "1.48" },
      { id: "rl-001-5", lineNumber: 5, productId: null, subRecipeId: "sub-003", nettQty: 200, nettUnit: "g", refPercent: 0, grossQty: 200, grossUnit: "g", costPerUnit: "0.00457", lineCost: "0.91" },
    ],
    portion: { yieldQty: 1, yieldUnit: "por" },
    pricing: {
      priceInclVat: "185.00",
      priceExclVat: "176.19",
      totalCost: "44.52",
      totalCostWithSecurityMargin: "46.75",
      grossContributionMargin: "129.44",
      foodCostPercent: 25.3,
      currency: "AED",
    },
    nutritionPerPortion: { fatG: 38, carbsG: 16, proteinG: 62, vitAMg: 0.12, vitCMg: 8, calciumMg: 55, ironMg: 8.2, sodiumMg: 380, kcal: 650 },
    allergens: ["dairy"],
    dietaryFlags: { glutenFree: true, dairyFree: false, vegetarian: false, vegan: false, nutsFree: true, soyFree: true, sulfitesFree: true },
    version: 1,
    createdAt: now,
    updatedAt: now,
  },

  // 2. Grilled Salmon — 05.MAINS, AED 145
  {
    id: "rec-002",
    name: "Grilled Salmon",
    category: "05.MAINS",
    status: "ACTUAL",
    ingredientLines: [
      { id: "rl-002-1", lineNumber: 1, productId: "prod-009", subRecipeId: null, nettQty: 200, nettUnit: "g", refPercent: 15, grossQty: 235.29, grossUnit: "g", costPerUnit: "0.09", lineCost: "21.18" },
      { id: "rl-002-2", lineNumber: 2, productId: "prod-014", subRecipeId: null, nettQty: 30, nettUnit: "g", refPercent: 20, grossQty: 37.5, grossUnit: "g", costPerUnit: "0.006", lineCost: "0.23" },
      { id: "rl-002-3", lineNumber: 3, productId: "prod-018", subRecipeId: null, nettQty: 20, nettUnit: "ml", refPercent: 0, grossQty: 20, grossUnit: "ml", costPerUnit: "0.0178", lineCost: "0.36" },
      { id: "rl-002-4", lineNumber: 4, productId: "prod-017", subRecipeId: null, nettQty: 5, nettUnit: "g", refPercent: 0, grossQty: 5, grossUnit: "g", costPerUnit: "0.0055", lineCost: "0.03" },
      { id: "rl-002-5", lineNumber: 5, productId: null, subRecipeId: "sub-001", nettQty: 50, nettUnit: "g", refPercent: 0, grossQty: 50, grossUnit: "g", costPerUnit: "0.00831", lineCost: "0.42" },
    ],
    portion: { yieldQty: 1, yieldUnit: "por" },
    pricing: {
      priceInclVat: "145.00",
      priceExclVat: "138.10",
      totalCost: "22.22",
      totalCostWithSecurityMargin: "23.33",
      grossContributionMargin: "114.77",
      foodCostPercent: 16.1,
      currency: "AED",
    },
    nutritionPerPortion: { fatG: 32, carbsG: 4, proteinG: 44, vitAMg: 0.04, vitCMg: 18, calciumMg: 30, ironMg: 2.1, sodiumMg: 280, kcal: 480 },
    allergens: ["fish"],
    dietaryFlags: { glutenFree: true, dairyFree: true, vegetarian: false, vegan: false, nutsFree: true, soyFree: true, sulfitesFree: true },
    version: 1,
    createdAt: now,
    updatedAt: now,
  },

  // 3. Caesar Salad — 02.SALADS, AED 65
  {
    id: "rec-003",
    name: "Caesar Salad",
    category: "02.SALADS",
    status: "ACTUAL",
    ingredientLines: [
      { id: "rl-003-1", lineNumber: 1, productId: "prod-008", subRecipeId: null, nettQty: 150, nettUnit: "g", refPercent: 10, grossQty: 166.67, grossUnit: "g", costPerUnit: "0.027", lineCost: "4.50" },
      { id: "rl-003-2", lineNumber: 2, productId: "prod-004", subRecipeId: null, nettQty: 25, nettUnit: "g", refPercent: 10, grossQty: 27.78, grossUnit: "g", costPerUnit: "0.0925", lineCost: "2.57" },
      { id: "rl-003-3", lineNumber: 3, productId: "prod-014", subRecipeId: null, nettQty: 20, nettUnit: "g", refPercent: 20, grossQty: 25, grossUnit: "g", costPerUnit: "0.006", lineCost: "0.15" },
      { id: "rl-003-4", lineNumber: 4, productId: "prod-018", subRecipeId: null, nettQty: 15, nettUnit: "ml", refPercent: 0, grossQty: 15, grossUnit: "ml", costPerUnit: "0.0178", lineCost: "0.27" },
    ],
    portion: { yieldQty: 1, yieldUnit: "por" },
    pricing: {
      priceInclVat: "65.00",
      priceExclVat: "61.90",
      totalCost: "7.49",
      totalCostWithSecurityMargin: "7.86",
      grossContributionMargin: "54.04",
      foodCostPercent: 12.1,
      currency: "AED",
    },
    nutritionPerPortion: { fatG: 18, carbsG: 6, proteinG: 52, vitAMg: 0.05, vitCMg: 14, calciumMg: 340, ironMg: 2.4, sodiumMg: 520, kcal: 395 },
    allergens: ["dairy"],
    dietaryFlags: { glutenFree: true, dairyFree: false, vegetarian: false, vegan: false, nutsFree: true, soyFree: true, sulfitesFree: true },
    version: 1,
    createdAt: now,
    updatedAt: now,
  },

  // 4. Margherita Pizza — 09.PIZZA, AED 75 (uses sub-002 Pizza Dough)
  {
    id: "rec-004",
    name: "Margherita Pizza",
    category: "09.PIZZA",
    status: "ACTUAL",
    ingredientLines: [
      { id: "rl-004-1", lineNumber: 1, productId: null, subRecipeId: "sub-002", nettQty: 280, nettUnit: "g", refPercent: 0, grossQty: 280, grossUnit: "g", costPerUnit: "0.00125", lineCost: "0.35" },
      { id: "rl-004-2", lineNumber: 2, productId: "prod-011", subRecipeId: null, nettQty: 150, nettUnit: "g", refPercent: 10, grossQty: 166.67, grossUnit: "g", costPerUnit: "0.005", lineCost: "0.83" },
      { id: "rl-004-3", lineNumber: 3, productId: "prod-003", subRecipeId: null, nettQty: 120, nettUnit: "g", refPercent: 5, grossQty: 126.32, grossUnit: "g", costPerUnit: "0.042", lineCost: "5.31" },
      { id: "rl-004-4", lineNumber: 4, productId: "prod-018", subRecipeId: null, nettQty: 10, nettUnit: "ml", refPercent: 0, grossQty: 10, grossUnit: "ml", costPerUnit: "0.0178", lineCost: "0.18" },
    ],
    portion: { yieldQty: 1, yieldUnit: "por" },
    pricing: {
      priceInclVat: "75.00",
      priceExclVat: "71.43",
      totalCost: "6.67",
      totalCostWithSecurityMargin: "7.00",
      grossContributionMargin: "64.43",
      foodCostPercent: 9.3,
      currency: "AED",
    },
    nutritionPerPortion: { fatG: 16, carbsG: 72, proteinG: 28, vitAMg: 0.1, vitCMg: 12, calciumMg: 520, ironMg: 4.8, sodiumMg: 850, kcal: 545 },
    allergens: ["gluten", "dairy"],
    dietaryFlags: { glutenFree: false, dairyFree: false, vegetarian: true, vegan: false, nutsFree: true, soyFree: true, sulfitesFree: true },
    version: 1,
    createdAt: now,
    updatedAt: now,
  },

  // 5. Chocolate Fondant — 10.DESSERT, AED 55, yields 4 portions
  {
    id: "rec-005",
    name: "Chocolate Fondant",
    category: "10.DESSERT",
    status: "ACTUAL",
    ingredientLines: [
      { id: "rl-005-1", lineNumber: 1, productId: null, subRecipeId: "sub-004", nettQty: 400, nettUnit: "g", refPercent: 0, grossQty: 400, grossUnit: "g", costPerUnit: "0.01016", lineCost: "4.06" },
      { id: "rl-005-2", lineNumber: 2, productId: "prod-001", subRecipeId: null, nettQty: 120, nettUnit: "g", refPercent: 0, grossQty: 120, grossUnit: "g", costPerUnit: "0.01757", lineCost: "2.11" },
      { id: "rl-005-3", lineNumber: 3, productId: "prod-016", subRecipeId: null, nettQty: 60, nettUnit: "g", refPercent: 0, grossQty: 60, grossUnit: "g", costPerUnit: "0.00168", lineCost: "0.10" },
    ],
    portion: { yieldQty: 4, yieldUnit: "por" },
    pricing: {
      priceInclVat: "55.00",
      priceExclVat: "52.38",
      totalCost: "6.27",
      totalCostWithSecurityMargin: "6.58",
      grossContributionMargin: "46.11",
      foodCostPercent: 12.0,
      currency: "AED",
    },
    nutritionPerPortion: { fatG: 28, carbsG: 32, proteinG: 5, vitAMg: 0.15, vitCMg: 0, calciumMg: 45, ironMg: 3.2, sodiumMg: 45, kcal: 400 },
    allergens: ["dairy", "gluten"],
    dietaryFlags: { glutenFree: false, dairyFree: false, vegetarian: true, vegan: false, nutsFree: true, soyFree: true, sulfitesFree: true },
    version: 1,
    createdAt: now,
    updatedAt: now,
  },
];
