// ---------------------------------------------------------------------------
// Application constants
// ---------------------------------------------------------------------------

export const RECIPE_CATEGORIES = [
  { value: "01.BITES", label: "01.BITES" },
  { value: "02.SALADS", label: "02.SALADS" },
  { value: "03.COLD", label: "03.COLD" },
  { value: "04.HOT", label: "04.HOT" },
  { value: "05.MAINS", label: "05.MAINS" },
  { value: "06.GRILL", label: "06.GRILL" },
  { value: "07.SIDES", label: "07.SIDES" },
  { value: "08.BREAD", label: "08.BREAD" },
  { value: "09.PIZZA", label: "09.PIZZA" },
  { value: "10.DESSERT", label: "10.DESSERT" },
  { value: "11.KIDS MENU", label: "11.KIDS MENU" },
  { value: "12.HAPPY HOUR", label: "12.HAPPY HOUR" },
] as const;

export const PRODUCT_CATEGORIES = [
  "Dairy",
  "Meat",
  "Poultry",
  "Seafood",
  "Produce",
  "Dry Goods",
  "Spices",
  "Oils & Vinegars",
  "Bakery",
  "Beverages",
  "Frozen",
  "Other",
] as const;

export const PRODUCT_STATUSES = [
  "ACTIVE",
  "INACTIVE",
  "PENDING",
  "DISCONTINUED",
] as const;

export const RECIPE_STATUSES = [
  "NEW",
  "ACTUAL",
  "PENDING",
  "UPDATE",
  "DISCONTINUED",
] as const;

export const UNITS = [
  "g",
  "kg",
  "ml",
  "l",
  "pc",
  "btc",
  "por",
  "ea",
  "bunch",
  "leaf",
  "slice",
  "sheet",
] as const;

// ── Costing defaults ────────────────────────────────────────────────────────
// Taken from the venue's own costing workbook (COGS V5). Every one of these is
// editable per sub-recipe and per recipe — these are only the starting values
// for a newly created record.

/**
 * Tax and service charge applied on top of the menu price, as a percentage.
 *
 * 21% = 11% Indonesian PPN + 10% service. The menu price is held EXCLUDING
 * this; the guest-facing price is derived as menuPrice * (1 + tax/100).
 */
export const DEFAULT_TAX_PERCENT = 21;

/**
 * Inflation buffer on cost of sales, as a percentage.
 *
 * The workbook applies this at dish level, so recipes default to 4% and
 * sub-recipes to 0 — otherwise the buffer would be counted twice on anything
 * built from a sub-recipe.
 */
export const DEFAULT_RECIPE_INFLATION_PERCENT = 4;
export const DEFAULT_SUB_RECIPE_INFLATION_PERCENT = 0;

/**
 * Waste allowance, as a percentage.
 *
 * The workbook applies waste when costing a batch, so sub-recipes default to
 * 5% and recipes to 0. Both remain editable: a venue that trims at plating
 * rather than prep can move it the other way.
 */
export const DEFAULT_SUB_RECIPE_WASTE_PERCENT = 5;
export const DEFAULT_RECIPE_WASTE_PERCENT = 0;

/** Target food cost and the variance treated as acceptable (%). */
export const TARGET_FOOD_COST_PERCENT = 25;
export const FOOD_COST_VARIANCE_PERCENT = 2;

/** @deprecated Superseded by the per-entity fields above. */
export const DEFAULT_SECURITY_MARGIN = 5;
/** @deprecated Use the per-entity `taxPercent` instead. */
export const DEFAULT_VAT_RATE = 21;

/** Default currency code — Indonesian Rupiah. */
export const DEFAULT_CURRENCY = "IDR";

/** Locale for money/number formatting: "Rp 795.000" (dot groups, comma decimal). */
export const CURRENCY_LOCALE = "id-ID";
