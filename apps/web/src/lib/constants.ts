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

/** UAE standard VAT rate (%) */
export const DEFAULT_VAT_RATE = 5;

/** Default currency code */
export const DEFAULT_CURRENCY = "AED";
