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

/** Default security margin applied to sub-recipe / recipe costs (%) */
export const DEFAULT_SECURITY_MARGIN = 5;

/**
 * Indonesian PPN (Pajak Pertambahan Nilai), the local equivalent of VAT.
 *
 * This is the denominator for every food-cost %, since selling prices are
 * entered tax-inclusive and stripped back before costing. Confirmed at 11%;
 * revisit if the venue falls under the higher bracket.
 */
export const DEFAULT_VAT_RATE = 11;

/** Default currency code — Indonesian Rupiah. */
export const DEFAULT_CURRENCY = "IDR";

/** Locale for money/number formatting: "Rp 795.000" (dot groups, comma decimal). */
export const CURRENCY_LOCALE = "id-ID";
