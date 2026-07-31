/**
 * Product (raw ingredient) — modeled directly from the "Product List" sheet
 * columns found in the source workbook (2_-_Sub_Rec.xlsm).
 *
 * Money fields use `Decimal` (string-backed) per docs/DECISIONS.md:
 * "DECIMAL for financial calculations — floating point rounding errors are
 * unacceptable for money." Convert to a real decimal type (e.g. decimal.js)
 * at the boundary; never use `number` for currency in business logic.
 */

/** String-backed decimal placeholder — swap for decimal.js Decimal in implementation. */
export type Decimal = string;

export type ProductStatus = "ACTIVE" | "INACTIVE" | "PENDING" | "DISCONTINUED";

export interface Product {
  id: string;
  category: string; // e.g. "Dairy" — workbook: Category
  supplier: string | null;
  name: string; // workbook: Product
  brand: string | null;

  /** Packing / purchase unit info — e.g. "1 blk = 10000 g" */
  packing: {
    packQty: number; // workbook: PPC
    packUnit: string; // workbook: U
    unitsPerPack: number; // workbook: UPP
    unitsPerPackUnit: string; // workbook: U2
    totalQty: number; // workbook: Total
    totalUnit: string; // workbook: U3
  };

  cost: {
    buyingPricePerPack: Decimal; // raw purchase price
    buyingPricePerUnit: Decimal; // workbook: Buying/U
    grossPricePerUnit: Decimal; // workbook: Gross/U (after supplier markup/VAT handling)
    nettPricePerUnit: Decimal; // workbook: Nett/U
  };

  yield_: {
    grossQty: number; // workbook: Gross
    grossUnit: string; // workbook: U4
    wasteQty: number; // workbook: Waste
    wasteUnit: string; // workbook: U5
    nettQty: number; // workbook: Nett
    nettUnit: string; // workbook: U6
    refPercent: number; // workbook: Ref % — waste/trim reference %
    yieldPercent: number; // workbook: Yield % — usable %, should be 100 - refPercent
  };

  status: ProductStatus;

  nutrition: NutritionPer100g;

  allergens: string[]; // allergen tag ids — see allergen module (not yet scaffolded)

  /**
   * The allergen list has not been checked against the product in the store.
   *
   * Declarations imported from a costing sheet describe a generic ingredient,
   * not the jar the kitchen actually buys. Whether a tom yum paste contains
   * shrimp, or a soy sauce is brewed with wheat, is a property of the brand and
   * batch — so a list that was inferred from a name is a prompt to go and read
   * a label, not an answer.
   *
   * Kept separate from `status` on purpose. A product can be perfectly ACTIVE
   * and still have an unverified allergen list, and collapsing the two would
   * mean clearing one silently clears the other.
   */
  allergensNeedReview: boolean;

  /** What to check and why, e.g. "verify the brand for shrimp paste". */
  allergenReviewNote: string | null;

  createdAt: string;
  updatedAt: string;
}

/** Nutrition values as stored per 100g in the workbook's "NUTRIENTS (100G)" block. */
export interface NutritionPer100g {
  fatG: number;
  carbsG: number;
  proteinG: number;
  vitAMg: number;
  vitCMg: number;
  calciumMg: number;
  ironMg: number;
  sodiumMg: number;
  kcal: number;
}
