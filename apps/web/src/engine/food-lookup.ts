// ---------------------------------------------------------------------------
// Looking up what an ingredient is made of
// ---------------------------------------------------------------------------
// Typing "Butter, unsalted" into a new product and then typing nine nutrition
// figures out of a reference book is the kind of work nobody does, which is why
// most of the catalogue has zeroes in it. This matches the name against a table
// of food composition data and offers the numbers.
//
// The line this module will not cross: it proposes, it never asserts.
//
// Nutrition is a number that is roughly right or roughly wrong, and a rough
// figure beats the zero that is there now. Allergens are not like that. Under
// Regulation 1169/2011 an allergen declaration is a legal statement, and the
// dangerous failure is not a missing allergen — it is a *confident* one. A
// lookup that said "contains: milk" and stopped there would let somebody serve
// a dish believing the question had been answered by a computer.
//
// So every allergen this module suggests arrives with allergensNeedReview set.
// The product type already says why, and it was written before this file
// existed:
//
//     a list that was inferred from a name is a prompt to go and read a
//     label, not an answer
//
// It also never proposes an empty allergen list as a finding. "No allergens
// found" and "this food contains no allergens" are different statements and
// only the first one is true here — a free-from claim is something a person
// makes after reading a label, not something a name match produces.
//
// Local rather than a web service, deliberately. A kitchen putting a delivery
// away at six in the morning does not want this to depend on somebody else's
// uptime, an API key, or a rate limit, and a food-safety-adjacent number should
// be reproducible: the same name gives the same answer today and at an audit
// in two years.
// ---------------------------------------------------------------------------

import type { NutritionPer100g } from "@ccos/shared";

export interface ReferenceFood {
  /** Canonical name, as it would appear in a composition table. */
  name: string;
  /** Other names the same food goes by, including common misspellings. */
  aliases: string[];
  /** Coarse grouping, shown so a wrong match is obvious at a glance. */
  group: string;
  nutrition: NutritionPer100g;
  /**
   * Allergens inherent to the food itself — milk in butter, gluten in wheat
   * flour. Never a claim about a particular brand or jar, which is where
   * cross-contamination and "may contain" live.
   */
  allergens: string[];
  /**
   * Typical trim loss as a percentage, where the food has one. A whole
   * pineapple is roughly half skin and core, and costing it as though it were
   * not is how a dish looks cheaper than it is.
   */
  refPercent?: number;
  /**
   * Most of the energy is ethanol, which is 7 kcal a gram and is not a
   * macronutrient. Declared so the table's own consistency check knows the
   * energy figure is not meant to equal protein + carbs + fat.
   */
  alcoholic?: boolean;
}

const n = (
  kcal: number, protein: number, fat: number, carbs: number,
  sodium = 0, calcium = 0, iron = 0, vitA = 0, vitC = 0,
): NutritionPer100g => ({
  kcal, proteinG: protein, fatG: fat, carbsG: carbs,
  sodiumMg: sodium, calciumMg: calcium, ironMg: iron, vitAMg: vitA, vitCMg: vitC,
});

/*
 * The reference table.
 *
 * Per 100 g of the edible portion, from standard food composition values. It
 * is not exhaustive and is not meant to be — it covers the foods a kitchen
 * actually buys by the kilo, which is where the missing data is. Anything
 * unmatched is left for a person, which is the honest outcome.
 */
export const REFERENCE_FOODS: ReferenceFood[] = [
  // ── Dairy and eggs ────────────────────────────────────────────────────────
  { name: "Butter", aliases: ["unsalted butter", "salted butter", "mentega"], group: "Dairy",
    nutrition: n(717, 0.9, 81, 0.1, 11, 24, 0, 684, 0), allergens: ["EU14_MILK"] },
  { name: "Milk, whole", aliases: ["milk", "fresh milk", "susu"], group: "Dairy",
    nutrition: n(61, 3.2, 3.3, 4.8, 43, 113, 0, 46, 0), allergens: ["EU14_MILK"] },
  { name: "Cream, double", aliases: ["cream", "heavy cream", "whipping cream", "cooking cream"], group: "Dairy",
    nutrition: n(340, 2.1, 36, 2.8, 27, 66, 0, 411, 0.6), allergens: ["EU14_MILK"] },
  { name: "Cheese, cheddar", aliases: ["cheddar", "cheese"], group: "Dairy",
    nutrition: n(403, 25, 33, 1.3, 621, 721, 0.7, 330, 0), allergens: ["EU14_MILK"] },
  { name: "Cheese, parmesan", aliases: ["parmesan", "parmigiano", "grana padano", "pecorino"], group: "Dairy",
    nutrition: n(392, 36, 26, 3.2, 1529, 1184, 0.8, 207, 0), allergens: ["EU14_MILK"] },
  { name: "Cheese, mozzarella", aliases: ["mozzarella", "burrata"], group: "Dairy",
    nutrition: n(280, 28, 17, 3.1, 627, 731, 0.4, 179, 0), allergens: ["EU14_MILK"] },
  { name: "Cheese, blue", aliases: ["gorgonzola", "blue cheese", "danish blue", "roquefort", "cambazolla"], group: "Dairy",
    nutrition: n(353, 21, 29, 2.3, 1395, 528, 0.3, 198, 0), allergens: ["EU14_MILK"] },
  { name: "Cheese, goat", aliases: ["chevre", "goat cheese"], group: "Dairy",
    nutrition: n(364, 22, 30, 2.5, 515, 298, 1.9, 288, 0), allergens: ["EU14_MILK"] },
  { name: "Mascarpone", aliases: ["mascarpone cheese"], group: "Dairy",
    nutrition: n(429, 4.8, 44, 4.1, 30, 100, 0.1, 400, 0), allergens: ["EU14_MILK"] },
  { name: "Yoghurt, plain", aliases: ["yogurt", "yoghurt", "greek yoghurt"], group: "Dairy",
    nutrition: n(61, 3.5, 3.3, 4.7, 46, 121, 0, 27, 0.5), allergens: ["EU14_MILK"] },
  { name: "Egg, hen", aliases: ["egg", "eggs", "telur", "whole egg"], group: "Eggs",
    nutrition: n(143, 13, 9.5, 0.7, 142, 56, 1.8, 160, 0), allergens: ["EU14_EGGS"] },

  // ── Meat and poultry ──────────────────────────────────────────────────────
  { name: "Beef, sirloin", aliases: ["sirloin", "beef striploin", "striploin", "angus sirloin"], group: "Meat",
    nutrition: n(206, 26, 11, 0, 55, 17, 2.2, 0, 0), allergens: [], refPercent: 12 },
  { name: "Beef, tenderloin", aliases: ["tenderloin", "beef fillet", "filet mignon"], group: "Meat",
    nutrition: n(190, 27, 8.8, 0, 52, 15, 2.5, 0, 0), allergens: [], refPercent: 15 },
  { name: "Beef, ribeye", aliases: ["ribeye", "rib eye", "cube roll", "tomahawk", "wagyu"], group: "Meat",
    nutrition: n(291, 24, 21, 0, 54, 14, 2.1, 0, 0), allergens: [], refPercent: 15 },
  { name: "Chicken breast", aliases: ["chicken", "chicken fillet", "ayam"], group: "Meat",
    nutrition: n(165, 31, 3.6, 0, 74, 15, 1, 9, 0), allergens: [], refPercent: 5 },
  { name: "Duck breast", aliases: ["duck", "bebek", "magret"], group: "Meat",
    nutrition: n(201, 24, 11, 0, 74, 12, 2.7, 24, 5.8), allergens: [], refPercent: 10 },
  { name: "Pork belly", aliases: ["pork", "babi", "guanciale", "pancetta"], group: "Meat",
    nutrition: n(518, 9.3, 53, 0, 32, 5, 0.4, 0, 0), allergens: [], refPercent: 8 },
  { name: "Lamb rack", aliases: ["lamb", "domba", "lamb loin"], group: "Meat",
    nutrition: n(294, 25, 21, 0, 72, 17, 1.9, 0, 0), allergens: [], refPercent: 18 },
  { name: "Ham, cured", aliases: ["jamon", "iberico", "prosciutto", "serrano"], group: "Meat",
    nutrition: n(241, 26, 15, 0.6, 2340, 12, 1.2, 0, 0), allergens: [] },
  { name: "Foie gras", aliases: ["fois gras", "duck liver"], group: "Meat",
    nutrition: n(462, 11, 44, 4.7, 697, 45, 5.5, 1000, 4), allergens: [] },

  // ── Fish and shellfish ────────────────────────────────────────────────────
  { name: "Tuna", aliases: ["tuna belly", "otoro", "akami", "yellowfin", "maguro"], group: "Seafood",
    nutrition: n(144, 23, 4.9, 0, 39, 8, 1, 655, 0), allergens: ["EU14_FISH"], refPercent: 10 },
  { name: "Salmon", aliases: ["salmon fillet", "sake", "salmon trout"], group: "Seafood",
    nutrition: n(208, 20, 13, 0, 59, 9, 0.3, 58, 3.9), allergens: ["EU14_FISH"], refPercent: 12 },
  { name: "Sea bass", aliases: ["barramundi", "seabass", "kakap"], group: "Seafood",
    nutrition: n(97, 18, 2, 0, 68, 10, 0.3, 54, 0), allergens: ["EU14_FISH"], refPercent: 45 },
  { name: "Snapper", aliases: ["red snapper", "kakap merah"], group: "Seafood",
    nutrition: n(100, 21, 1.3, 0, 64, 32, 0.2, 30, 1.6), allergens: ["EU14_FISH"], refPercent: 45 },
  { name: "Prawn", aliases: ["prawns", "shrimp", "udang", "tiger prawn"], group: "Seafood",
    nutrition: n(99, 24, 0.3, 0.2, 111, 70, 0.5, 54, 0), allergens: ["EU14_CRUSTACEANS"], refPercent: 45 },
  { name: "Lobster", aliases: ["rock lobster", "langoustine"], group: "Seafood",
    nutrition: n(89, 19, 0.9, 0, 486, 96, 0.3, 22, 0), allergens: ["EU14_CRUSTACEANS"], refPercent: 60 },
  { name: "Crab", aliases: ["king crab", "crab meat", "kepiting"], group: "Seafood",
    nutrition: n(97, 19, 1.5, 0, 836, 59, 0.8, 2, 3.3), allergens: ["EU14_CRUSTACEANS"], refPercent: 70 },
  { name: "Scallop", aliases: ["scallops", "hotate"], group: "Seafood",
    nutrition: n(69, 12, 0.5, 3.2, 392, 6, 0.4, 2, 0), allergens: ["EU14_MOLLUSCS"], refPercent: 20 },
  { name: "Squid", aliases: ["calamari", "cumi", "octopus", "gurita"], group: "Seafood",
    nutrition: n(92, 16, 1.4, 3.1, 44, 32, 0.7, 10, 4.7), allergens: ["EU14_MOLLUSCS"], refPercent: 25 },
  { name: "Oyster", aliases: ["oysters", "tiram"], group: "Seafood",
    nutrition: n(81, 9.5, 2.3, 4.9, 106, 45, 5.1, 24, 3.7), allergens: ["EU14_MOLLUSCS"], refPercent: 85 },
  { name: "Caviar", aliases: ["oscietra", "roe", "ikura", "tobiko", "flying fish roe"], group: "Seafood",
    nutrition: n(264, 25, 18, 4, 1500, 275, 11.9, 271, 0), allergens: ["EU14_FISH"] },
  { name: "Anchovy", aliases: ["anchovies", "ikan teri"], group: "Seafood",
    nutrition: n(210, 29, 9.7, 0, 3668, 232, 4.6, 21, 0), allergens: ["EU14_FISH"] },

  // ── Vegetables ────────────────────────────────────────────────────────────
  { name: "Tomato", aliases: ["tomatoes", "tomat", "cherry tomato", "heirloom tomato", "roma"], group: "Vegetables",
    nutrition: n(18, 0.9, 0.2, 3.9, 5, 10, 0.3, 42, 14), allergens: [], refPercent: 8 },
  { name: "Onion", aliases: ["onions", "bawang bombay", "red onion", "shallot", "bawang merah"], group: "Vegetables",
    nutrition: n(40, 1.1, 0.1, 9.3, 4, 23, 0.2, 0, 7.4), allergens: [], refPercent: 12 },
  { name: "Garlic", aliases: ["bawang putih"], group: "Vegetables",
    nutrition: n(149, 6.4, 0.5, 33, 17, 181, 1.7, 0, 31), allergens: [], refPercent: 13 },
  { name: "Carrot", aliases: ["carrots", "wortel"], group: "Vegetables",
    nutrition: n(41, 0.9, 0.2, 9.6, 69, 33, 0.3, 835, 5.9), allergens: [], refPercent: 12 },
  { name: "Potato", aliases: ["potatoes", "kentang"], group: "Vegetables",
    nutrition: n(77, 2, 0.1, 17, 6, 12, 0.8, 0, 19.7), allergens: [], refPercent: 20 },
  { name: "Sweet potato", aliases: ["ubi", "kumara"], group: "Vegetables",
    nutrition: n(86, 1.6, 0.1, 20, 55, 30, 0.6, 709, 2.4), allergens: [], refPercent: 20 },
  { name: "Cucumber", aliases: ["timun", "cucumber lokal"], group: "Vegetables",
    nutrition: n(15, 0.7, 0.1, 3.6, 2, 16, 0.3, 5, 2.8), allergens: [], refPercent: 10 },
  { name: "Capsicum", aliases: ["bell pepper", "paprika", "capsicum green", "capsicum red"], group: "Vegetables",
    nutrition: n(31, 1, 0.3, 6, 4, 7, 0.4, 157, 128), allergens: [], refPercent: 18 },
  { name: "Mushroom", aliases: ["mushrooms", "jamur", "button mushroom", "shiitake", "morel"], group: "Vegetables",
    nutrition: n(22, 3.1, 0.3, 3.3, 5, 3, 0.5, 0, 2.1), allergens: [], refPercent: 5 },
  { name: "Spinach", aliases: ["bayam", "baby spinach"], group: "Vegetables",
    nutrition: n(23, 2.9, 0.4, 3.6, 79, 99, 2.7, 469, 28), allergens: [], refPercent: 20 },
  { name: "Lettuce", aliases: ["salad leaves", "romaine", "baby gem", "radicchio", "selada"], group: "Vegetables",
    nutrition: n(15, 1.4, 0.2, 2.9, 28, 36, 0.9, 370, 9.2), allergens: [], refPercent: 20 },
  { name: "Avocado", aliases: ["alpukat"], group: "Vegetables",
    nutrition: n(160, 2, 15, 8.5, 7, 12, 0.6, 7, 10), allergens: [], refPercent: 27 },
  { name: "Aubergine", aliases: ["eggplant", "terong", "brinjal"], group: "Vegetables",
    nutrition: n(25, 1, 0.2, 5.9, 2, 9, 0.2, 1, 2.2), allergens: [], refPercent: 10 },
  { name: "Courgette", aliases: ["zucchini"], group: "Vegetables",
    nutrition: n(17, 1.2, 0.3, 3.1, 8, 16, 0.4, 10, 17.9), allergens: [], refPercent: 8 },
  { name: "Celery", aliases: ["seledri", "celeriac", "celery stick"], group: "Vegetables",
    nutrition: n(16, 0.7, 0.2, 3, 80, 40, 0.2, 22, 3.1), allergens: ["EU14_CELERY"], refPercent: 15 },
  { name: "Broccoli", aliases: ["brokoli"], group: "Vegetables",
    nutrition: n(34, 2.8, 0.4, 6.6, 33, 47, 0.7, 31, 89), allergens: [], refPercent: 25 },
  { name: "Cauliflower", aliases: ["kembang kol"], group: "Vegetables",
    nutrition: n(25, 1.9, 0.3, 5, 30, 22, 0.4, 0, 48), allergens: [], refPercent: 35 },
  { name: "Asparagus", aliases: ["asparagus spear"], group: "Vegetables",
    nutrition: n(20, 2.2, 0.1, 3.9, 2, 24, 2.1, 38, 5.6), allergens: [], refPercent: 35 },

  // ── Fruit ─────────────────────────────────────────────────────────────────
  { name: "Lemon", aliases: ["lemons", "jeruk lemon"], group: "Fruit",
    nutrition: n(29, 1.1, 0.3, 9.3, 2, 26, 0.6, 1, 53), allergens: [], refPercent: 40 },
  { name: "Lime", aliases: ["limes", "jeruk nipis", "kaffir lime"], group: "Fruit",
    nutrition: n(30, 0.7, 0.2, 11, 2, 33, 0.6, 2, 29), allergens: [], refPercent: 40 },
  { name: "Orange", aliases: ["oranges", "jeruk"], group: "Fruit",
    nutrition: n(47, 0.9, 0.1, 12, 0, 40, 0.1, 11, 53), allergens: [], refPercent: 35 },
  { name: "Mango", aliases: ["mangga"], group: "Fruit",
    nutrition: n(60, 0.8, 0.4, 15, 1, 11, 0.2, 54, 36), allergens: [], refPercent: 35 },
  { name: "Pineapple", aliases: ["nanas"], group: "Fruit",
    nutrition: n(50, 0.5, 0.1, 13, 1, 13, 0.3, 3, 48), allergens: [], refPercent: 48 },
  { name: "Banana", aliases: ["pisang"], group: "Fruit",
    nutrition: n(89, 1.1, 0.3, 23, 1, 5, 0.3, 3, 8.7), allergens: [], refPercent: 35 },
  { name: "Strawberry", aliases: ["strawberries", "stroberi"], group: "Fruit",
    nutrition: n(32, 0.7, 0.3, 7.7, 1, 16, 0.4, 1, 59), allergens: [], refPercent: 6 },
  { name: "Raspberry", aliases: ["raspberries"], group: "Fruit",
    nutrition: n(52, 1.2, 0.7, 12, 1, 25, 0.7, 2, 26), allergens: [] },
  { name: "Blueberry", aliases: ["blueberries"], group: "Fruit",
    nutrition: n(57, 0.7, 0.3, 14, 1, 6, 0.3, 3, 9.7), allergens: [] },
  { name: "Blackberry", aliases: ["blackberries"], group: "Fruit",
    nutrition: n(43, 1.4, 0.5, 9.6, 1, 29, 0.6, 11, 21), allergens: [] },
  { name: "Coconut", aliases: ["kelapa", "coconut meat"], group: "Fruit",
    nutrition: n(354, 3.3, 33, 15, 20, 14, 2.4, 0, 3.3), allergens: [] },

  // ── Dry goods, grains and pulses ──────────────────────────────────────────
  { name: "Flour, wheat", aliases: ["flour", "plain flour", "tepung terigu", "bread flour", "00 flour"], group: "Dry Goods",
    nutrition: n(364, 10, 1, 76, 2, 15, 1.2, 0, 0), allergens: ["EU14_GLUTEN_CEREALS"] },
  { name: "Pasta, dried", aliases: ["pasta", "spaghetti", "penne", "linguine"], group: "Dry Goods",
    nutrition: n(371, 13, 1.5, 75, 6, 21, 1.3, 0, 0), allergens: ["EU14_GLUTEN_CEREALS"] },
  { name: "Rice, white", aliases: ["rice", "beras", "nasi", "jasmine rice", "sushi rice"], group: "Dry Goods",
    nutrition: n(365, 7.1, 0.7, 80, 5, 28, 0.8, 0, 0), allergens: [] },
  { name: "Sugar, caster", aliases: ["sugar", "gula", "granulated sugar", "icing sugar"], group: "Dry Goods",
    nutrition: n(387, 0, 0, 100, 1, 1, 0, 0, 0), allergens: [] },
  { name: "Salt", aliases: ["sea salt", "garam", "table salt", "fleur de sel"], group: "Dry Goods",
    nutrition: n(0, 0, 0, 0, 38758, 24, 0.3, 0, 0), allergens: [] },
  { name: "Olive oil", aliases: ["extra virgin olive oil", "evoo", "minyak zaitun"], group: "Dry Goods",
    nutrition: n(884, 0, 100, 0, 2, 1, 0.6, 0, 0), allergens: [] },
  { name: "Vegetable oil", aliases: ["sunflower oil", "canola oil", "minyak goreng", "rice bran oil"], group: "Dry Goods",
    nutrition: n(884, 0, 100, 0, 0, 0, 0, 0, 0), allergens: [] },
  { name: "Soy sauce", aliases: ["kecap asin", "shoyu", "light soy sauce"], group: "Dry Goods",
    nutrition: n(53, 8.1, 0.6, 4.9, 5493, 33, 1.9, 0, 0),
    allergens: ["EU14_SOYBEANS", "EU14_GLUTEN_CEREALS"] },
  { name: "Fish sauce", aliases: ["kecap ikan", "nam pla"], group: "Dry Goods",
    nutrition: n(35, 5.1, 0, 3.6, 7851, 43, 0.8, 0, 0), allergens: ["EU14_FISH"] },
  { name: "Oyster sauce", aliases: ["saus tiram"], group: "Dry Goods",
    nutrition: n(51, 1.4, 0.3, 11, 2733, 32, 0.2, 0, 0), allergens: ["EU14_MOLLUSCS"] },
  { name: "Mustard", aliases: ["dijon mustard", "wholegrain mustard", "mustard seed"], group: "Dry Goods",
    nutrition: n(66, 4.4, 4, 5.8, 1104, 58, 1.5, 3, 1.5), allergens: ["EU14_MUSTARD"] },
  { name: "Sesame seed", aliases: ["sesame", "wijen", "tahini", "sesame oil"], group: "Dry Goods",
    nutrition: n(573, 18, 50, 23, 11, 975, 14.6, 0, 0), allergens: ["EU14_SESAME"] },
  { name: "Almond", aliases: ["almonds", "almond flour", "kacang almond"], group: "Dry Goods",
    nutrition: n(579, 21, 50, 22, 1, 269, 3.7, 0, 0), allergens: ["EU14_TREE_NUTS"] },
  { name: "Cashew", aliases: ["cashews", "kacang mete"], group: "Dry Goods",
    nutrition: n(553, 18, 44, 30, 12, 37, 6.7, 0, 0.5), allergens: ["EU14_TREE_NUTS"] },
  { name: "Walnut", aliases: ["walnuts", "pecan", "hazelnut", "pistachio", "macadamia"], group: "Dry Goods",
    nutrition: n(654, 15, 65, 14, 2, 98, 2.9, 1, 1.3), allergens: ["EU14_TREE_NUTS"] },
  { name: "Peanut", aliases: ["peanuts", "kacang tanah", "peanut butter"], group: "Dry Goods",
    nutrition: n(567, 26, 49, 16, 18, 92, 4.6, 0, 0), allergens: ["EU14_PEANUTS"] },
  { name: "Chocolate, dark", aliases: ["dark chocolate", "couverture", "cocoa", "valrhona", "chocolate"], group: "Pastry",
    nutrition: n(546, 4.9, 31, 61, 24, 56, 8, 2, 0), allergens: ["EU14_MILK", "EU14_SOYBEANS"] },
  { name: "Chocolate, white", aliases: ["white chocolate"], group: "Pastry",
    nutrition: n(539, 5.9, 32, 59, 90, 199, 0.2, 66, 0.5), allergens: ["EU14_MILK", "EU14_SOYBEANS"] },
  { name: "Wine, white", aliases: ["white wine", "cooking wine"], group: "Dry Goods",
    nutrition: n(82, 0.1, 0, 2.6, 5, 9, 0.3, 0, 0), allergens: ["EU14_SULPHITES"], alcoholic: true },
  { name: "Wine, red", aliases: ["red wine"], group: "Dry Goods",
    nutrition: n(85, 0.1, 0, 2.6, 4, 8, 0.5, 0, 0), allergens: ["EU14_SULPHITES"], alcoholic: true },
  { name: "Vinegar", aliases: ["balsamic vinegar", "white wine vinegar", "cuka"], group: "Dry Goods",
    nutrition: n(88, 0.5, 0, 17, 23, 27, 0.7, 0, 0), allergens: ["EU14_SULPHITES"] },
  { name: "Tofu", aliases: ["tahu", "bean curd"], group: "Dry Goods",
    nutrition: n(76, 8.1, 4.8, 1.9, 7, 350, 5.4, 0, 0.1), allergens: ["EU14_SOYBEANS"] },
  { name: "Tempeh", aliases: ["tempe"], group: "Dry Goods",
    nutrition: n(192, 20, 11, 7.6, 9, 111, 2.7, 0, 0), allergens: ["EU14_SOYBEANS"] },
];

// ── Matching ────────────────────────────────────────────────────────────────

export interface FoodMatch {
  food: ReferenceFood;
  /** 0–1. How much of the reference name the product name accounts for. */
  score: number;
  /** The alias or name that matched, so a wrong match is explainable. */
  matchedOn: string;
}

const STOP_WORDS = new Set([
  "fresh", "frozen", "dried", "organic", "local", "imported", "premium",
  "grade", "a", "b", "the", "of", "and", "with", "whole", "raw", "chilled",
  "large", "small", "medium", "baby", "wild", "farmed", "kg", "g", "gr", "ml",
  "l", "pcs", "pc", "pack", "box", "btl", "tin", "can",
]);

function tokenise(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t) && !/^\d+$/.test(t));
}

/**
 * Find reference foods that a product name might be.
 *
 * Scored on how much of the *reference* name the product accounts for, not the
 * other way round: "Heirloom Tomato Island Organic" should match "Tomato"
 * strongly even though most of its words are noise, whereas "Tomato Ketchup
 * Heinz" matching "Tomato" is a weaker claim and should rank lower than an
 * exact one. A product whose whole name is the food scores highest.
 *
 * Returns candidates rather than an answer. The caller shows them and a person
 * chooses, because a name is not enough to be sure and this module's whole
 * position is that it does not pretend otherwise.
 */
export function findFoodMatches(
  productName: string,
  limit = 4,
): FoodMatch[] {
  const tokens = tokenise(productName);
  if (tokens.length === 0) return [];
  const productSet = new Set(tokens);

  const results: FoodMatch[] = [];

  for (const food of REFERENCE_FOODS) {
    let best = 0;
    let bestOn = "";

    for (const candidate of [food.name, ...food.aliases]) {
      const candidateTokens = tokenise(candidate);
      if (candidateTokens.length === 0) continue;

      const hits = candidateTokens.filter((t) => productSet.has(t)).length;
      if (hits === 0) continue;

      // How much of the reference name is accounted for.
      let score = hits / candidateTokens.length;

      // A whole-name match is a much stronger claim than a partial one, and
      // "Tomato" as the entire product name should beat "Tomato Ketchup".
      if (hits === tokens.length && hits === candidateTokens.length) {
        score = 1;
      } else {
        // Otherwise discount by how much of the product name is unexplained,
        // gently — a kitchen's names carry brands and grades that mean nothing
        // here, and punishing them fully would match nothing.
        score *= 0.6 + 0.4 * (hits / tokens.length);
      }

      if (score > best) { best = score; bestOn = candidate; }
    }

    if (best > 0) results.push({ food, score: best, matchedOn: bestOn });
  }

  /*
   * A floor, because a candidate list is not free.
   *
   * "Blue Roll 2ply" matched "Cheese, blue" on the word blue. Offering that
   * to somebody entering cleaning supplies is not a helpful suggestion, it is
   * an invitation to click the wrong thing while distracted.
   */
  return results
    .filter((r) => r.score >= 0.4)
    .sort(
      (a, b) =>
        b.score - a.score ||
        /*
         * A tie goes to whichever food is named first in the product name.
         *
         * "Telur Ayam" is a chicken's egg, and both words match a different
         * reference food perfectly. Indonesian puts the head noun first, so
         * position resolves it — and in English the qualifier usually comes
         * first ("chicken egg"), where the same rule reads the wrong way, but
         * only for names where both words are foods in their own right.
         */
        productName.toLowerCase().indexOf(a.matchedOn.split(" ")[0]) -
          productName.toLowerCase().indexOf(b.matchedOn.split(" ")[0]) ||
        a.food.name.localeCompare(b.food.name),
    )
    .slice(0, limit);
}

export interface FoodSuggestion {
  nutrition: NutritionPer100g;
  /**
   * Allergens inherent to this food. Always accompanied by needsReview — see
   * the note at the top of this file.
   */
  allergens: string[];
  refPercent: number | null;
  source: string;
  confidence: number;
  /**
   * Always true. Present as a field rather than assumed so that a caller
   * writing `allergensNeedReview: suggestion.needsReview` reads correctly and
   * cannot accidentally store a lookup as a verified declaration.
   */
  needsReview: true;
}

/**
 * The best guess for a product name, or null when nothing is close enough.
 *
 * The threshold exists so that a weak match is no match. Offering "Salt" for
 * "Salted Caramel Sauce" with a shrug is worse than offering nothing: it
 * invites somebody to accept it, and then the sauce is recorded as containing
 * 38 g of sodium per 100 g.
 */
export function suggestForProduct(
  productName: string,
  minimumConfidence = 0.5,
): FoodSuggestion | null {
  const [top] = findFoodMatches(productName, 1);
  if (!top || top.score < minimumConfidence) return null;

  return {
    nutrition: { ...top.food.nutrition },
    allergens: [...top.food.allergens],
    refPercent: top.food.refPercent ?? null,
    source: top.food.name,
    confidence: top.score,
    needsReview: true,
  };
}
