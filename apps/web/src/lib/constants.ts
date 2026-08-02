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
 * VAT applied on top of the menu price, as a percentage.
 *
 * 21% is the EU standard rate. The menu price is held EXCLUDING it; the
 * guest-facing price is derived as menuPrice * (1 + tax/100).
 *
 * This used to read "11% Indonesian PPN + 10% service charge". The arithmetic
 * is the same and the meaning is not: a service charge is the venue's own
 * revenue and is itself taxable, while VAT is collected for the state. The two
 * are now separate fields on the organisation, and only the tax part belongs
 * here.
 *
 * Note that most EU member states put restaurant food on a REDUCED rate and
 * alcohol on the standard rate, so 21% is right for a drinks list and usually
 * too high for a food menu. The per-recipe `taxPercent` exists for exactly
 * that: set the food categories to the member state's reduced rate once it is
 * known. See `organizations.reduced_vat_percent`, deliberately left null until
 * the member state is chosen.
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

/**
 * Suggested menu prices are rounded to this step.
 *
 * A menu is quoted in round numbers, so a suggested price of Rp 133.919
 * is shown as Rp 134.000. Applies only to suggestions — computed figures
 * such as the guest price keep their exact value.
 */
export const PRICE_ROUNDING_STEP = 1000;

/** Target food cost and the variance treated as acceptable (%). */
export const TARGET_FOOD_COST_PERCENT = 25;
export const FOOD_COST_VARIANCE_PERCENT = 2;

/** @deprecated Superseded by the per-entity fields above. */
export const DEFAULT_SECURITY_MARGIN = 5;
/** @deprecated Use the per-entity `taxPercent` instead. */
export const DEFAULT_VAT_RATE = 21;

/**
 * Food information law followed for allergens and labelling.
 *
 * EU Regulation 1169/2011 — the fourteen declarable allergens already in the
 * registry, and the rule that a code or icon never replaces the written name.
 */
export const FOOD_REGIME = "EU_1169_2011";

/**
 * Default currency code.
 *
 * Still Rupiah while the catalogue is priced in it. The jurisdiction is set to
 * the EU for tax and food law, which does not by itself change what the venue
 * invoices in — moving to euro means repricing 1.100 ingredients, not editing
 * this line.
 */
export const DEFAULT_CURRENCY = "IDR";

/** Locale for money/number formatting: "Rp 795.000" (dot groups, comma decimal). */
export const CURRENCY_LOCALE = "id-ID";
