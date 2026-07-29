# DOCUMENT 3: BUSINESS RULES & CALCULATIONS

> **Status: original design intent, captured 2026-07-26.**
> Written before implementation began and not revised since. The build has
> since diverged in places — currency is IDR with Indonesian PPN rather than
> AED with VAT, and the schema has gained multi-tenancy and row level security.
> Treat this as the reasoning behind the design, not a description of what
> currently exists. `docs/PROGRESS.md` is the living record of what is built.


## CulinaryCore -- Commercial Recipe & Hospitality Management Platform

**Version:** 1.0.0
**Classification:** Internal -- Technical Specification
**Last Updated:** 2026-07-25

---

## Table of Contents

1. [Cost Engine Architecture](#1-cost-engine-architecture)
2. [Product Cost Calculations](#2-product-cost-calculations)
3. [Sub Recipe Costing](#3-sub-recipe-costing)
4. [Recipe Costing](#4-recipe-costing)
5. [Pricing Calculations](#5-pricing-calculations)
6. [Target Food Cost](#6-target-food-cost)
7. [Nutrition Calculations](#7-nutrition-calculations)
8. [Allergen Inheritance](#8-allergen-inheritance)
9. [Yield & Waste](#9-yield--waste)
10. [Unit Conversion](#10-unit-conversion)
11. [Scaling](#11-scaling)
12. [Tax Calculations](#12-tax-calculations)
13. [Currency & Exchange](#13-currency--exchange)
14. [Labour Cost](#14-labour-cost)
15. [Overhead Calculations](#15-overhead-calculations)
16. [Inventory Valuation](#16-inventory-valuation)
17. [Menu Engineering](#17-menu-engineering)
18. [Price History & Inflation](#18-price-history--inflation)
19. [Supplier Analytics](#19-supplier-analytics)
20. [Formula Builder](#20-formula-builder)

---

## Design Principles

All business rules in CulinaryCore adhere to these non-negotiable principles:

1. **Nothing Hardcoded.** Every constant, percentage, threshold, tax rate, RDA value, conversion factor, and default is stored in a configuration table and editable by authorized users. The application code references configuration keys, never literal values.

2. **Global Defaults with Granular Overrides.** Every configurable value follows an inheritance chain: `System Default -> Organization -> Property/Outlet -> Menu -> Recipe -> Line Item`. A value set at any level overrides the level above it. Absence of an override means the parent value applies.

3. **Audit Trail.** Every calculation that produces a monetary value, a nutrition figure, or a compliance flag is logged with its inputs, formula version, timestamp, and the user or system process that triggered it. Recalculation history is preserved, not overwritten.

4. **Reproducibility.** Given the same inputs and the same formula version, the system must produce the same outputs. Formula changes are versioned; historical records reference the formula version that produced them.

5. **Precision.** All monetary calculations use decimal(19,6) internally. Rounding to display precision occurs only at the presentation layer. Rounding mode is configurable per organization (HALF_UP, HALF_EVEN, CEILING, FLOOR).

6. **Currency Awareness.** All monetary values are stored with their ISO 4217 currency code. Cross-currency arithmetic is prohibited without explicit conversion through the exchange rate engine.

---

## 1. Cost Engine Architecture

### 1.1 Overview

The Cost Engine is the central calculation service that drives all costing, pricing, nutrition, and analytics computations in CulinaryCore. It is designed as a configurable formula pipeline where each calculation step is a discrete, testable unit that can be reordered, replaced, or extended without modifying application code.

### 1.2 Calculation Pipeline

Every cost calculation flows through a standardized pipeline:

```
Input Validation -> Unit Normalization -> Waste Adjustment -> Cost Lookup ->
Line Cost Computation -> Aggregation -> Margin Application -> Tax Application ->
Price Derivation -> Nutrition Computation -> Allergen Propagation -> Output
```

Each stage is a registered **Calculation Step** with:
- A unique step identifier
- An execution order (integer, supports gaps for insertion)
- Input parameter declarations (name, type, source, required/optional)
- Output declarations (name, type, precision)
- A formula expression (see Formula Builder, section 20)
- Pre-conditions (what must be true before this step runs)
- Post-conditions (what must be true after this step runs)
- Error handling strategy (HALT, SKIP_LINE, USE_DEFAULT, PROPAGATE_ERROR)

### 1.3 Calculation Contexts

Every calculation executes within a **Calculation Context** that carries:

| Property | Type | Description |
|---|---|---|
| organization_id | UUID | The owning organization |
| property_id | UUID | nullable; the specific property/outlet |
| currency_code | VARCHAR(3) | ISO 4217 code for the calculation |
| tax_profile_id | UUID | Which tax rules to apply |
| rounding_mode | ENUM | HALF_UP, HALF_EVEN, CEILING, FLOOR |
| precision_monetary | INTEGER | Decimal places for money (default: 6 internal, 2 display) |
| precision_weight | INTEGER | Decimal places for weight (default: 4) |
| precision_percentage | INTEGER | Decimal places for percentages (default: 2) |
| formula_version_id | UUID | Which version of formulas to use |
| effective_date | DATE | Date for which prices/rates apply |
| recalculation_reason | ENUM | PRICE_CHANGE, FORMULA_CHANGE, MANUAL, SCHEDULED, IMPORT |

### 1.4 Recalculation Triggers

The engine supports both on-demand and event-driven recalculation:

| Trigger | Scope | Description |
|---|---|---|
| Product price change | All recipes/sub recipes using the product | Cascade recalculation upward |
| Waste percentage change | All recipes using the product | Recalculate with new yield |
| Tax rate change | All recipes in the tax jurisdiction | Recalculate pricing |
| Exchange rate update | All cross-currency references | Recalculate converted values |
| Formula version change | All entities using the formula | Full recalculation |
| Manual trigger | Single recipe or batch | User-initiated recalculation |
| Scheduled | Organization-wide | Nightly/weekly full recalculation |
| Supplier price import | Affected products and upstream | Cascade from new purchase prices |

### 1.5 Error Handling

When a calculation step fails (e.g., missing price, division by zero, missing conversion factor):

- **HALT:** Stop the entire calculation. Mark the entity as "Costing Error". Log the error with full context. Notify assigned users.
- **SKIP_LINE:** Exclude the failing ingredient line from the total. Mark the line as "Error -- Excluded". Continue with remaining lines. Flag the recipe total as "Incomplete".
- **USE_DEFAULT:** Substitute a configured default value (e.g., zero cost, last known cost). Mark the line as "Estimated". Continue calculation. Flag the recipe total as "Contains Estimates".
- **PROPAGATE_ERROR:** Carry the error marker through to the output. The recipe total displays as "Error" rather than a number. Dependent calculations (menu engineering, reports) exclude this recipe.

The error handling strategy is configurable per calculation step and per organization.

---

## 2. Product Cost Calculations

### 2.1 Purchase Unit Decomposition

**Purpose:** Convert a purchased case/pack into its base cost per smallest unit (gram, milliliter, each).

**Inputs:**

| Parameter | Type | Source | Required | Description |
|---|---|---|---|---|
| buying_cost | DECIMAL(19,6) | Supplier invoice / purchase order | Yes | Cost of one purchase unit (case, pack, bag) |
| buying_currency | VARCHAR(3) | Supplier record | Yes | ISO 4217 currency of the purchase price |
| pieces_per_case (PPC) | DECIMAL(12,4) | Product master | Yes | Number of individual packs/pieces in the case |
| units_per_piece (UPP) | DECIMAL(12,4) | Product master | Yes | Weight/volume per individual piece in base units |
| base_unit | ENUM | Product master | Yes | The base unit (g, kg, ml, L, each, etc.) |
| purchase_unit | VARCHAR(20) | Product master | Yes | Description of the purchase unit (case, bag, box, each) |

**Outputs:**

| Parameter | Type | Precision | Description |
|---|---|---|---|
| total_weight | DECIMAL(16,4) | 4 dp | Total content of one purchase unit in base units |
| gross_cost_per_unit | DECIMAL(19,6) | 6 dp | Cost per base unit before waste adjustment |

**Formulas:**

```
total_weight = PPC * UPP

gross_cost_per_unit = buying_cost / total_weight
```

**Validation Rules:**
- `buying_cost` must be > 0. A zero or negative buying cost is rejected.
- `PPC` must be >= 1.
- `UPP` must be > 0.
- `total_weight` must be > 0 (guaranteed by the above).
- If `total_weight` would result in `gross_cost_per_unit` < 0.000001, emit a warning ("Extremely low unit cost -- verify purchase unit configuration").

**Edge Cases:**
- **Product sold by "each":** PPC = number of items in the case, UPP = 1, base_unit = "each". The gross_cost_per_unit is the cost per individual item.
- **Bulk liquid:** PPC = 1 (single container), UPP = volume in ml, base_unit = "ml".
- **Product with no case:** PPC = 1, buying_cost is the price of the single unit.

**Dependencies:** None. This is a leaf calculation.

---

### 2.2 Waste-Adjusted Cost (Nett Cost per Unit)

**Purpose:** Adjust the gross cost per unit to account for preparation waste (peeling, trimming, bones, shells, etc.), yielding the true cost of usable product.

**Inputs:**

| Parameter | Type | Source | Required | Description |
|---|---|---|---|---|
| gross_cost_per_unit | DECIMAL(19,6) | Calculation 2.1 | Yes | Cost per base unit before waste |
| waste_percentage (Ref%) | DECIMAL(8,4) | Product master | Yes | Percentage of product lost to waste |

**Outputs:**

| Parameter | Type | Precision | Description |
|---|---|---|---|
| yield_percentage | DECIMAL(8,4) | 4 dp | Percentage of product that is usable |
| nett_cost_per_unit | DECIMAL(19,6) | 6 dp | Cost per base unit of usable product |

**Formulas:**

```
yield_percentage = 100 - waste_percentage

nett_cost_per_unit = gross_cost_per_unit * ((waste_percentage / 100) + 1)
```

Equivalently:
```
nett_cost_per_unit = gross_cost_per_unit / (yield_percentage / 100)
```

Note: Both formulations produce the same result. The first matches the Excel workbook convention (`Gross/U * ((Ref%/100) + 1)`). The second is the more intuitive "divide by yield fraction" form. The system stores the canonical formula; alternate forms are documented for developer reference.

**Validation:**

```
nett_cost_per_unit >= gross_cost_per_unit  (always true when waste_percentage >= 0)
```

**Validation Rules:**
- `waste_percentage` must be >= 0 and < 100. A waste of 100% means the entire product is unusable -- this is logically invalid and is rejected.
- `waste_percentage` = 0 is valid (no waste; nett = gross).
- If `waste_percentage` > 80, emit a warning ("Extremely high waste -- verify trim test data").
- `yield_percentage` must be > 0 (guaranteed by waste < 100).

**Edge Cases:**
- **No waste product (e.g., sugar, oil):** waste_percentage = 0, nett_cost_per_unit = gross_cost_per_unit.
- **High-waste product (e.g., whole fish):** waste_percentage can be 40-65%. The nett cost is significantly higher than gross.
- **Negative waste (weight gain during soaking/brining):** Supported if the organization enables it. waste_percentage can be negative (e.g., -15% for dried beans after soaking). nett_cost_per_unit < gross_cost_per_unit in this case.

**Dependencies:** Calculation 2.1 (gross_cost_per_unit).

---

### 2.3 Waste Percentage Derivation

**Purpose:** Calculate the waste percentage from trim test data (gross weight in vs. nett weight out).

**Inputs:**

| Parameter | Type | Source | Required | Description |
|---|---|---|---|---|
| gross_weight | DECIMAL(12,4) | Trim test record | Yes | Weight before preparation |
| nett_weight | DECIMAL(12,4) | Trim test record | Yes | Usable weight after preparation |

**Outputs:**

| Parameter | Type | Precision | Description |
|---|---|---|---|
| waste_weight | DECIMAL(12,4) | 4 dp | Weight lost to waste |
| waste_percentage | DECIMAL(8,4) | 4 dp | Ref% -- waste as percentage of gross |
| yield_percentage | DECIMAL(8,4) | 4 dp | Usable as percentage of gross |

**Formulas:**

```
waste_weight = gross_weight - nett_weight

waste_percentage = (waste_weight / gross_weight) * 100

yield_percentage = (nett_weight / gross_weight) * 100
```

**Validation Rules:**
- `gross_weight` must be > 0.
- `nett_weight` must be > 0 (some usable product must result).
- `nett_weight` must be <= `gross_weight` (unless the organization enables negative waste for products that gain weight).
- The system should support averaging multiple trim tests: `avg_waste_percentage = AVG(waste_percentage) over N tests`.

**Dependencies:** None. Feeds into Calculation 2.2.

---

### 2.4 Product Cost Summary

**Purpose:** Consolidate all product cost data into a single record that recipe costing can reference.

**Inputs:** All outputs from 2.1, 2.2, 2.3 plus product master data.

**Outputs (the Product Cost Record):**

| Field | Type | Description |
|---|---|---|
| product_id | UUID | Unique product identifier |
| product_name | VARCHAR(255) | Display name |
| supplier_id | UUID | Current primary supplier |
| buying_cost | DECIMAL(19,6) | Per purchase unit |
| buying_currency | VARCHAR(3) | ISO 4217 |
| purchase_unit | VARCHAR(20) | Case, bag, each, etc. |
| PPC | DECIMAL(12,4) | Pieces per case |
| UPP | DECIMAL(12,4) | Units per piece |
| base_unit | ENUM | g, kg, ml, L, each |
| total_weight | DECIMAL(16,4) | PPC * UPP |
| gross_cost_per_unit | DECIMAL(19,6) | buying_cost / total_weight |
| waste_percentage | DECIMAL(8,4) | From trim test or manual entry |
| yield_percentage | DECIMAL(8,4) | 100 - waste_percentage |
| nett_cost_per_unit | DECIMAL(19,6) | Waste-adjusted cost |
| cost_effective_date | DATE | When this cost became effective |
| cost_expiry_date | DATE | nullable; when this cost expires |
| is_estimated | BOOLEAN | True if cost is estimated/provisional |
| last_recalculated | TIMESTAMP | When the cost record was last computed |

**Validation Rules:**
- A product must have at least one valid cost record before it can be used in recipes.
- When a new cost is entered, the previous cost record is not deleted but marked with an expiry date.
- The system always uses the cost record whose effective_date <= calculation effective_date and whose expiry_date is null or > calculation effective_date.

---

## 3. Sub Recipe Costing

### 3.1 Sub Recipe Ingredient Line Cost

**Purpose:** Calculate the cost of a single ingredient line within a sub recipe.

**Inputs:**

| Parameter | Type | Source | Required | Description |
|---|---|---|---|---|
| ingredient_product_id | UUID | Recipe ingredient line | Yes | Reference to the product |
| nett_qty | DECIMAL(12,4) | Recipe ingredient line | Yes | Desired usable quantity in recipe units |
| recipe_unit | ENUM | Recipe ingredient line | Yes | Unit used in the recipe (g, kg, ml, L, each) |
| product_base_unit | ENUM | Product master | Looked up | Product's base unit |
| product_waste_pct | DECIMAL(8,4) | Product cost record | Looked up | Ref% from product |
| product_gross_cost_per_unit | DECIMAL(19,6) | Product cost record | Looked up | Gross/U from product |

**Outputs:**

| Parameter | Type | Precision | Description |
|---|---|---|---|
| unit_display | VARCHAR(10) | -- | The unit abbreviation (looked up from product, column U3) |
| ref_percentage | DECIMAL(8,4) | 4 dp | The product's Ref% (looked up) |
| gross_qty | DECIMAL(12,4) | 4 dp | Quantity needed before waste |
| cost_per_unit | DECIMAL(19,6) | 6 dp | Gross/U (looked up) |
| line_cost | DECIMAL(19,6) | 6 dp | Total cost for this ingredient line |

**Formulas:**

```
-- Unit and Ref% lookup (equivalent to Excel INDEX/MATCH)
unit_display = LOOKUP(ingredient_product_id -> product.unit_abbreviation)
ref_percentage = LOOKUP(ingredient_product_id -> product.waste_percentage)
cost_per_unit = LOOKUP(ingredient_product_id -> product.gross_cost_per_unit)

-- Unit conversion (if recipe_unit != product_base_unit)
nett_qty_in_base = convert(nett_qty, recipe_unit, product_base_unit)

-- Waste adjustment: convert nett (usable) quantity to gross (purchased) quantity
gross_qty = (100 * nett_qty_in_base) / (100 - ref_percentage)

-- Line cost
line_cost = gross_qty * cost_per_unit
```

**Validation Rules:**
- `nett_qty` must be > 0.
- `ingredient_product_id` must reference a valid product with an active cost record.
- If the product has no cost record, apply the error handling strategy (section 1.5).
- If `recipe_unit` is not convertible to `product_base_unit`, raise a unit conversion error (section 10).
- If `ref_percentage` = 100, division by zero occurs. This is prevented by the product validation rule (waste < 100).

**Edge Cases:**
- **Ingredient is a sub recipe (not a product):** The `cost_per_unit` is the sub recipe's `cost_per_unit` output (section 3.3). Waste percentage for sub recipe ingredients is typically 0 (waste was already accounted for in the sub recipe), but can be overridden at the line level.
- **Ingredient with zero cost:** Valid (e.g., water in some organizations). line_cost = 0.
- **Array formula behavior:** In the Excel workbook, line_cost uses an array formula. In CulinaryCore, this is a row-level calculation applied to each ingredient line independently.

**Dependencies:** Calculation 2.4 (Product Cost Record), Calculation 10 (Unit Conversion).

---

### 3.2 Sub Recipe Cost Aggregation

**Purpose:** Sum all ingredient line costs to produce the sub recipe's total cost, then apply the security margin.

**Inputs:**

| Parameter | Type | Source | Required | Description |
|---|---|---|---|---|
| line_costs[] | DECIMAL(19,6)[] | Calculation 3.1 for each line | Yes | Array of ingredient line costs |
| line_statuses[] | ENUM[] | Calculation 3.1 for each line | Yes | OK, ERROR, ESTIMATED |
| security_margin_pct | DECIMAL(8,4) | Organization config (override at recipe level) | Yes | Default: 5.0000 |

**Outputs:**

| Parameter | Type | Precision | Description |
|---|---|---|---|
| total_cost | DECIMAL(19,6) | 6 dp | Sum of all valid ingredient line costs |
| total_cost_with_margin | DECIMAL(19,6) | 6 dp | Total cost + security margin |
| cost_completeness | ENUM | -- | COMPLETE, INCOMPLETE (some lines skipped), ERROR (calculation failed) |
| excluded_line_count | INTEGER | -- | Number of lines excluded due to errors |

**Formulas:**

```
-- Sum only non-error lines (equivalent to Excel SUMIF(costs, "<>#VALUE!"))
total_cost = SUM(line_costs[i]) WHERE line_statuses[i] != ERROR

-- Security margin application
total_cost_with_margin = total_cost * (1 + (security_margin_pct / 100))

-- With default 5% margin:
-- total_cost_with_margin = total_cost * 1.05
```

**Validation Rules:**
- If all lines have ERROR status, the total_cost is NULL and cost_completeness = ERROR.
- If any lines have ERROR status but at least one is OK, cost_completeness = INCOMPLETE.
- If all lines are OK (or ESTIMATED), cost_completeness = COMPLETE (or CONTAINS_ESTIMATES).
- `security_margin_pct` must be >= 0. It can be 0 (no margin). There is no upper bound, but values > 50 emit a warning.

**Edge Cases:**
- **Empty sub recipe (no ingredients):** total_cost = 0. This is valid (placeholder sub recipe during development) but flagged as "No ingredients".
- **All ingredients in error:** total_cost = NULL. The sub recipe cannot be used in parent recipes until errors are resolved.

**Dependencies:** Calculation 3.1 (all ingredient lines).

---

### 3.3 Sub Recipe Cost Per Unit

**Purpose:** Derive the cost per base unit of a sub recipe, so it can be used as an ingredient in parent recipes.

**Inputs:**

| Parameter | Type | Source | Required | Description |
|---|---|---|---|---|
| total_cost_with_margin | DECIMAL(19,6) | Calculation 3.2 | Yes | Total cost including security margin |
| batch_weight | DECIMAL(12,4) | Sub recipe header (manual entry) | Yes | Total yield weight of the batch |
| batch_unit | ENUM | Sub recipe header | Yes | Unit of the batch weight (g, kg, ml, L, each) |

**Outputs:**

| Parameter | Type | Precision | Description |
|---|---|---|---|
| cost_per_unit | DECIMAL(19,6) | 6 dp | Cost per base unit of the sub recipe output |
| cost_per_unit_unit | ENUM | -- | The base unit for the cost (g, ml, each, etc.) |

**Formulas:**

```
cost_per_unit = total_cost_with_margin / batch_weight
```

When batch_unit is kg, cost_per_unit is per kg. If the system normalizes to g:
```
cost_per_unit_in_grams = total_cost_with_margin / convert(batch_weight, batch_unit, 'g')
```

**Validation Rules:**
- `batch_weight` must be > 0.
- `batch_unit` must be a valid unit.
- If `total_cost_with_margin` is NULL (all ingredients in error), `cost_per_unit` is NULL and the sub recipe cannot be used as an ingredient.

**Edge Cases:**
- **Sub recipe that produces items (e.g., bread rolls):** batch_weight is the count, batch_unit = "each".
- **Sub recipe used at multiple levels of nesting:** A sub recipe can be an ingredient in another sub recipe. The system must detect and prevent circular references.

**Dependencies:** Calculation 3.2.

**Circular Reference Detection:**
- Before saving a sub recipe ingredient line, the system must verify that adding this ingredient does not create a cycle.
- Algorithm: Traverse the ingredient graph from the candidate ingredient upward through all parent recipes/sub recipes. If the current sub recipe is found in the traversal, reject the addition.
- Maximum nesting depth is configurable (default: 10 levels). Exceeding this depth emits an error.

---

## 4. Recipe Costing

### 4.1 Recipe Ingredient Line Cost

**Purpose:** Calculate the cost of a single ingredient line within a main recipe.

This calculation is identical to Sub Recipe Ingredient Line Cost (section 3.1) with one addition: an ingredient in a main recipe can be either a **product** or a **sub recipe**.

**Inputs:** Same as 3.1, plus:

| Parameter | Type | Source | Required | Description |
|---|---|---|---|---|
| ingredient_type | ENUM | Recipe ingredient line | Yes | PRODUCT or SUB_RECIPE |
| sub_recipe_cost_per_unit | DECIMAL(19,6) | Calculation 3.3 | Conditional | Required when ingredient_type = SUB_RECIPE |
| sub_recipe_waste_pct | DECIMAL(8,4) | Recipe ingredient line (override) | No | Default: 0 for sub recipe ingredients |

**Formulas:**

```
IF ingredient_type = PRODUCT:
    -- Same as section 3.1
    cost_per_unit = LOOKUP(product_id -> product.gross_cost_per_unit)
    ref_percentage = LOOKUP(product_id -> product.waste_percentage)

ELSE IF ingredient_type = SUB_RECIPE:
    cost_per_unit = sub_recipe.cost_per_unit
    ref_percentage = sub_recipe_waste_pct  -- typically 0, overridable

gross_qty = (100 * nett_qty_in_base) / (100 - ref_percentage)
line_cost = gross_qty * cost_per_unit
```

**Dependencies:** Calculation 2.4 (for products), Calculation 3.3 (for sub recipes), Calculation 10 (unit conversion).

---

### 4.2 Recipe Cost Aggregation

**Purpose:** Sum all ingredient line costs to produce the recipe's total cost and apply the security margin.

This calculation is identical to Sub Recipe Cost Aggregation (section 3.2). The same formulas, validation rules, and edge cases apply.

**Additional Outputs for Recipes:**

| Parameter | Type | Precision | Description |
|---|---|---|---|
| cost_per_portion | DECIMAL(19,6) | 6 dp | Total cost divided by number of portions |
| cost_per_portion_with_margin | DECIMAL(19,6) | 6 dp | Total cost with margin divided by number of portions |

**Additional Inputs:**

| Parameter | Type | Source | Required | Description |
|---|---|---|---|---|
| portions | DECIMAL(8,2) | Recipe header | Yes | Number of portions the recipe yields |

**Formulas:**

```
total_cost = SUM(valid line costs)
total_cost_with_margin = total_cost * (1 + (security_margin_pct / 100))
cost_per_portion = total_cost / portions
cost_per_portion_with_margin = total_cost_with_margin / portions
```

**Validation Rules:**
- `portions` must be > 0.
- All rules from section 3.2 apply.

---

## 5. Pricing Calculations

### 5.1 Selling Price and VAT

**Purpose:** Record the selling price and separate the VAT component.

**Inputs:**

| Parameter | Type | Source | Required | Description |
|---|---|---|---|---|
| price_with_vat | DECIMAL(19,6) | Recipe header (manual entry or calculated) | Conditional | Selling price including VAT |
| price_without_vat | DECIMAL(19,6) | Recipe header (manual entry or calculated) | Conditional | Selling price excluding VAT |
| vat_rate | DECIMAL(8,4) | Tax profile (section 12) | Yes | VAT rate as percentage |
| price_entry_mode | ENUM | Organization config | Yes | INCLUSIVE (enter price with VAT, derive ex-VAT) or EXCLUSIVE (enter ex-VAT, derive inclusive) |

**Outputs:**

| Parameter | Type | Precision | Description |
|---|---|---|---|
| price_with_vat | DECIMAL(19,6) | 6 dp | Selling price including VAT |
| price_without_vat | DECIMAL(19,6) | 6 dp | Selling price excluding VAT |
| vat_amount | DECIMAL(19,6) | 6 dp | The VAT component |

**Formulas:**

```
IF price_entry_mode = INCLUSIVE:
    -- User enters price_with_vat
    price_without_vat = price_with_vat / (1 + (vat_rate / 100))
    vat_amount = price_with_vat - price_without_vat

ELSE IF price_entry_mode = EXCLUSIVE:
    -- User enters price_without_vat
    price_with_vat = price_without_vat * (1 + (vat_rate / 100))
    vat_amount = price_with_vat - price_without_vat
```

**Validation Rules:**
- At least one of price_with_vat or price_without_vat must be provided.
- `vat_rate` must be >= 0. A rate of 0 is valid (zero-rated or exempt items).
- If both prices are provided and they are inconsistent with the VAT rate (difference > configurable tolerance, default 0.01), emit a warning.

---

### 5.2 Gross Contribution Margin

**Purpose:** Calculate the monetary margin between selling price and food cost.

**Inputs:**

| Parameter | Type | Source | Required | Description |
|---|---|---|---|---|
| price_with_vat | DECIMAL(19,6) | Calculation 5.1 | Yes | Selling price including VAT |
| total_cost | DECIMAL(19,6) | Calculation 4.2 | Yes | Total recipe cost (before security margin) |

**Outputs:**

| Parameter | Type | Precision | Description |
|---|---|---|---|
| gross_contribution_margin | DECIMAL(19,6) | 6 dp | Monetary margin per recipe |
| gross_contribution_margin_per_portion | DECIMAL(19,6) | 6 dp | Monetary margin per portion |

**Formulas:**

```
gross_contribution_margin = price_with_vat - total_cost

gross_contribution_margin_per_portion = gross_contribution_margin / portions
```

**Validation Rules:**
- A negative margin is valid but triggers a warning ("Recipe is sold below cost").
- If total_cost is NULL or ERROR, gross_contribution_margin = NULL.

**Dependencies:** Calculations 4.2, 5.1.

---

### 5.3 Food Cost Percentage

**Purpose:** Express the food cost as a percentage of the selling price (ex-VAT). This is the primary metric for recipe profitability in hospitality.

**Inputs:**

| Parameter | Type | Source | Required | Description |
|---|---|---|---|---|
| total_cost | DECIMAL(19,6) | Calculation 4.2 | Yes | Total recipe cost |
| price_without_vat | DECIMAL(19,6) | Calculation 5.1 | Yes | Selling price excluding VAT |

**Outputs:**

| Parameter | Type | Precision | Description |
|---|---|---|---|
| food_cost_percentage | DECIMAL(8,4) | 4 dp | Food cost as % of revenue |

**Formulas:**

```
food_cost_percentage = (total_cost / price_without_vat) * 100
```

**Validation Rules:**
- `price_without_vat` must be > 0 (division by zero prevented).
- If `price_without_vat` is 0 or NULL, food_cost_percentage = NULL and the recipe is flagged as "Not priced".
- food_cost_percentage > 100 means the recipe costs more to make than it sells for. This is a valid (if alarming) result. The system flags it as "Loss-making".
- Compare food_cost_percentage against the target (section 6). If it exceeds the target, flag as "Above target".

**Dependencies:** Calculations 4.2, 5.1.

---

### 5.4 Gross Profit Percentage

**Purpose:** The complement of food cost percentage -- the percentage of revenue retained after food cost.

**Inputs:**

| Parameter | Type | Source | Required | Description |
|---|---|---|---|---|
| food_cost_percentage | DECIMAL(8,4) | Calculation 5.3 | Yes | Food cost % |

**Outputs:**

| Parameter | Type | Precision | Description |
|---|---|---|---|
| gross_profit_percentage | DECIMAL(8,4) | 4 dp | Gross profit as % of revenue |

**Formulas:**

```
gross_profit_percentage = 100 - food_cost_percentage
```

Or equivalently:
```
gross_profit_percentage = ((price_without_vat - total_cost) / price_without_vat) * 100
```

**Dependencies:** Calculation 5.3.

---

### 5.5 Markup Percentage

**Purpose:** Express the margin as a percentage of cost (markup), as opposed to food cost which expresses cost as a percentage of price.

**Inputs:**

| Parameter | Type | Source | Required | Description |
|---|---|---|---|---|
| price_without_vat | DECIMAL(19,6) | Calculation 5.1 | Yes | Revenue |
| total_cost | DECIMAL(19,6) | Calculation 4.2 | Yes | Cost |

**Outputs:**

| Parameter | Type | Precision | Description |
|---|---|---|---|
| markup_percentage | DECIMAL(12,4) | 4 dp | Markup as % of cost |

**Formulas:**

```
markup_percentage = ((price_without_vat - total_cost) / total_cost) * 100
```

**Validation Rules:**
- `total_cost` must be > 0 (division by zero prevented). If cost is 0, markup is undefined (flag as "Zero cost").
- Markup can be very large (e.g., beverages can be 400%+). No upper limit.

**Dependencies:** Calculations 4.2, 5.1.

---

### 5.6 Net Margin (After All Costs)

**Purpose:** Calculate the margin remaining after all cost components (food, labour, overhead) are deducted.

**Inputs:**

| Parameter | Type | Source | Required | Description |
|---|---|---|---|---|
| price_without_vat | DECIMAL(19,6) | Calculation 5.1 | Yes | Revenue |
| total_cost | DECIMAL(19,6) | Calculation 4.2 | Yes | Food cost |
| labour_cost | DECIMAL(19,6) | Calculation 14 | No | Labour cost (if calculated) |
| overhead_cost | DECIMAL(19,6) | Calculation 15 | No | Overhead cost (if calculated) |

**Outputs:**

| Parameter | Type | Precision | Description |
|---|---|---|---|
| net_margin | DECIMAL(19,6) | 6 dp | Monetary margin after all costs |
| net_margin_percentage | DECIMAL(8,4) | 4 dp | Net margin as % of revenue |
| prime_cost | DECIMAL(19,6) | 6 dp | Food cost + labour cost |
| prime_cost_percentage | DECIMAL(8,4) | 4 dp | Prime cost as % of revenue |

**Formulas:**

```
prime_cost = total_cost + COALESCE(labour_cost, 0)

prime_cost_percentage = (prime_cost / price_without_vat) * 100

net_margin = price_without_vat - total_cost - COALESCE(labour_cost, 0) - COALESCE(overhead_cost, 0)

net_margin_percentage = (net_margin / price_without_vat) * 100
```

**Validation Rules:**
- If labour and overhead are not calculated, net_margin = gross_margin. The system indicates which cost components are included.
- Net margin can be negative. Flag as "Loss after full costing".

**Dependencies:** Calculations 4.2, 5.1, 14 (optional), 15 (optional).

---

## 6. Target Food Cost

### 6.1 Target Configuration

**Purpose:** Define target food cost percentages against which actual recipe performance is measured.

**Configuration Structure:**

| Parameter | Type | Scope | Default | Description |
|---|---|---|---|---|
| target_food_cost_pct | DECIMAL(8,4) | Organization / Property / Menu / Recipe | (none -- must be set) | The target food cost % |
| target_tolerance_pct | DECIMAL(8,4) | Organization | 2.0000 | Allowed variance above target before warning |
| target_brackets | JSON | Organization | See below | Named target brackets for classification |

**Default Target Brackets:**

```json
{
  "brackets": [
    { "name": "Premium",    "min_pct": 0,     "max_pct": 22,    "color": "#00C853" },
    { "name": "Optimal",    "min_pct": 22,    "max_pct": 25,    "color": "#2196F3" },
    { "name": "Standard",   "min_pct": 25,    "max_pct": 27,    "color": "#4CAF50" },
    { "name": "Acceptable", "min_pct": 27,    "max_pct": 30,    "color": "#FF9800" },
    { "name": "High",       "min_pct": 30,    "max_pct": 35,    "color": "#FF5722" },
    { "name": "Critical",   "min_pct": 35,    "max_pct": null,  "color": "#F44336" }
  ]
}
```

These brackets, names, ranges, and colors are all configurable.

---

### 6.2 Recommended Selling Price from Target

**Purpose:** Calculate what the selling price should be to achieve the target food cost percentage.

**Inputs:**

| Parameter | Type | Source | Required | Description |
|---|---|---|---|---|
| total_cost | DECIMAL(19,6) | Calculation 4.2 | Yes | Recipe total cost |
| target_food_cost_pct | DECIMAL(8,4) | Configuration | Yes | Desired food cost % |
| vat_rate | DECIMAL(8,4) | Tax profile | Yes | VAT rate |

**Outputs:**

| Parameter | Type | Precision | Description |
|---|---|---|---|
| recommended_price_ex_vat | DECIMAL(19,6) | 6 dp | Recommended selling price excluding VAT |
| recommended_price_inc_vat | DECIMAL(19,6) | 6 dp | Recommended selling price including VAT |
| recommended_price_per_portion_ex_vat | DECIMAL(19,6) | 6 dp | Per-portion price ex VAT |
| recommended_price_per_portion_inc_vat | DECIMAL(19,6) | 6 dp | Per-portion price inc VAT |

**Formulas:**

```
recommended_price_ex_vat = total_cost / (target_food_cost_pct / 100)

recommended_price_inc_vat = recommended_price_ex_vat * (1 + (vat_rate / 100))

recommended_price_per_portion_ex_vat = recommended_price_ex_vat / portions

recommended_price_per_portion_inc_vat = recommended_price_inc_vat / portions
```

**Validation Rules:**
- `target_food_cost_pct` must be > 0 (division by zero).
- Output the recommended price for each configured target bracket so the user can compare (sensitivity table).

**Dependencies:** Calculation 4.2.

---

### 6.3 Sensitivity Analysis

**Purpose:** Show how the food cost % changes across a range of selling prices, and how the selling price changes across a range of food cost targets.

**Outputs (Price Sensitivity Table):**

Given the recipe's total_cost, generate a table:

| Selling Price (ex-VAT) | Food Cost % | Margin (monetary) | Markup % | Classification |
|---|---|---|---|---|
| price - 20% | ... | ... | ... | ... |
| price - 10% | ... | ... | ... | ... |
| price (current) | ... | ... | ... | ... |
| price + 10% | ... | ... | ... | ... |
| price + 20% | ... | ... | ... | ... |

**Outputs (Target Sensitivity Table):**

Given the recipe's total_cost, generate a table:

| Target Food Cost % | Required Price (ex-VAT) | Required Price (inc-VAT) | Margin (monetary) |
|---|---|---|---|
| 22% | ... | ... | ... |
| 25% | ... | ... | ... |
| 27% | ... | ... | ... |
| 30% | ... | ... | ... |
| 35% | ... | ... | ... |

The target percentages used are drawn from the configured brackets (section 6.1), not hardcoded.

---

## 7. Nutrition Calculations

### 7.1 Per-Ingredient Nutrition

**Purpose:** Calculate the nutritional contribution of each ingredient line in a recipe.

**Inputs:**

| Parameter | Type | Source | Required | Description |
|---|---|---|---|---|
| nett_qty | DECIMAL(12,4) | Recipe ingredient line | Yes | Usable quantity in recipe units |
| recipe_unit | ENUM | Recipe ingredient line | Yes | Unit of the nett_qty |
| nutrient_values_per_100g | JSON | Product nutrition record | Yes | Nutrition data per 100g of product |

**Nutrient Fields (per 100g of product):**

| Nutrient | Type | Unit |
|---|---|---|
| fat | DECIMAL(10,4) | g |
| saturated_fat | DECIMAL(10,4) | g |
| trans_fat | DECIMAL(10,4) | g |
| carbohydrates | DECIMAL(10,4) | g |
| sugars | DECIMAL(10,4) | g |
| fibre | DECIMAL(10,4) | g |
| protein | DECIMAL(10,4) | g |
| vitamin_a | DECIMAL(10,4) | mcg |
| vitamin_c | DECIMAL(10,4) | mg |
| calcium | DECIMAL(10,4) | mg |
| iron | DECIMAL(10,4) | mg |
| sodium | DECIMAL(10,4) | mg |

Note: The nutrient list is configurable. The system stores nutrient definitions in a configuration table. The above are the defaults derived from the Excel workbook. Organizations can add or remove nutrients (e.g., cholesterol, potassium, vitamin D, folate).

**Outputs:**

For each configured nutrient, the contribution from this ingredient line.

**Formulas:**

```
-- Convert nett_qty to grams for nutrition calculation
nett_qty_grams = convert(nett_qty, recipe_unit, 'g')

-- Per-ingredient nutrient contribution
nutrient_contribution = (nett_qty_grams / 100) * nutrient_value_per_100g
```

Applied to each nutrient:
```
fat_contribution       = (nett_qty_grams / 100) * fat_per_100g
carbs_contribution     = (nett_qty_grams / 100) * carbs_per_100g
protein_contribution   = (nett_qty_grams / 100) * protein_per_100g
vitamin_a_contribution = (nett_qty_grams / 100) * vitamin_a_per_100g
vitamin_c_contribution = (nett_qty_grams / 100) * vitamin_c_per_100g
calcium_contribution   = (nett_qty_grams / 100) * calcium_per_100g
iron_contribution      = (nett_qty_grams / 100) * iron_per_100g
sodium_contribution    = (nett_qty_grams / 100) * sodium_per_100g
```

**Per-Ingredient Calorie Calculation:**

```
kcal_from_fat     = fat_contribution * 9
kcal_from_carbs   = carbs_contribution * 4
kcal_from_protein = protein_contribution * 4

kcal_total = kcal_from_fat + kcal_from_carbs + kcal_from_protein
```

The caloric conversion factors (fat=9, carbs=4, protein=4 kcal/g) are configurable constants. These are the Atwater general factors. The system supports configuring alternate factor systems (e.g., Atwater specific factors, extended factors that include fibre at 2 kcal/g and alcohol at 7 kcal/g).

**Validation Rules:**
- All nutrient values must be >= 0.
- If a product has no nutrition data, the ingredient's nutrient contributions are all NULL. The recipe's nutrition totals are flagged as "Incomplete -- missing nutrition data for [product_name]".
- Nutrition is calculated on **nett quantity** (usable quantity), not gross quantity. The waste portion is not consumed.
- Unit conversion to grams is required. For volumetric ingredients (ml, L), a density factor must be configured on the product to convert volume to weight. If density is not set, nutrition calculation for that ingredient returns NULL with a warning.

**Dependencies:** Calculation 10 (unit conversion), product nutrition data.

---

### 7.2 Recipe Nutrition Totals

**Purpose:** Aggregate per-ingredient nutrition into recipe totals.

**Inputs:** All per-ingredient nutrient contributions from 7.1.

**Outputs:**

| Parameter | Type | Precision | Description |
|---|---|---|---|
| total_{nutrient} | DECIMAL(12,4) | 4 dp | Total of each nutrient across all ingredients |
| total_kcal | DECIMAL(12,4) | 4 dp | Total kilocalories for the recipe |
| nutrition_completeness | ENUM | -- | COMPLETE, INCOMPLETE, UNAVAILABLE |
| missing_nutrition_products | VARCHAR[] | -- | List of products without nutrition data |

**Formulas:**

```
-- Equivalent to Excel SUBTOTAL(9, column) -- sum function
total_{nutrient} = SUM(nutrient_contribution[i]) for all ingredients where value is not NULL

total_kcal = SUM(kcal_total[i]) for all ingredients
```

**Validation Rules:**
- If any ingredient has NULL nutrition, set nutrition_completeness = INCOMPLETE and list the products in missing_nutrition_products.
- If all ingredients have NULL nutrition, set nutrition_completeness = UNAVAILABLE.
- Totals are computed over available data regardless of completeness, with clear indication of what is missing.

**Dependencies:** Calculation 7.1 (all ingredient lines).

---

### 7.3 Per-Portion Nutrition

**Purpose:** Calculate nutrition per serving/portion.

**Inputs:**

| Parameter | Type | Source | Required | Description |
|---|---|---|---|---|
| total_{nutrient} | DECIMAL(12,4) | Calculation 7.2 | Yes | Recipe total for each nutrient |
| total_kcal | DECIMAL(12,4) | Calculation 7.2 | Yes | Recipe total kcal |
| portions | DECIMAL(8,2) | Recipe header | Yes | Number of portions |

**Outputs:**

| Parameter | Type | Precision | Description |
|---|---|---|---|
| per_portion_{nutrient} | DECIMAL(10,4) | 4 dp | Nutrient per portion |
| per_portion_kcal | DECIMAL(10,4) | 4 dp | Kcal per portion |

**Formulas:**

```
per_portion_{nutrient} = total_{nutrient} / portions

per_portion_kcal = total_kcal / portions
```

**Dependencies:** Calculations 7.2, recipe header (portions).

---

### 7.4 Per-100g Nutrition

**Purpose:** Calculate nutrition per 100g of the finished recipe, required for food labeling in many jurisdictions.

**Inputs:**

| Parameter | Type | Source | Required | Description |
|---|---|---|---|---|
| total_{nutrient} | DECIMAL(12,4) | Calculation 7.2 | Yes | Recipe total for each nutrient |
| total_recipe_weight | DECIMAL(12,4) | Recipe header or calculated | Yes | Total weight of the finished recipe in grams |

**Outputs:**

| Parameter | Type | Precision | Description |
|---|---|---|---|
| per_100g_{nutrient} | DECIMAL(10,4) | 4 dp | Nutrient per 100g |
| per_100g_kcal | DECIMAL(10,4) | 4 dp | Kcal per 100g |

**Formulas:**

```
per_100g_{nutrient} = (total_{nutrient} / total_recipe_weight) * 100

per_100g_kcal = (total_kcal / total_recipe_weight) * 100
```

**Validation Rules:**
- `total_recipe_weight` must be > 0.
- If not provided, it can be approximated as the sum of nett ingredient weights, but this ignores cooking loss (evaporation, reduction). The system flags this as "Estimated -- no cooking loss factor applied".

**Dependencies:** Calculations 7.2, recipe header.

---

### 7.5 RDA/UL Comparison

**Purpose:** Compare per-portion nutrition against recommended daily allowances (RDA) and tolerable upper intake levels (UL).

**Inputs:**

| Parameter | Type | Source | Required | Description |
|---|---|---|---|---|
| per_portion_{nutrient} | DECIMAL(10,4) | Calculation 7.3 | Yes | Nutrient per portion |
| rda_values | JSON | Configuration table | Yes | RDA values per nutrient |
| ul_values | JSON | Configuration table | Yes | Upper Limit values per nutrient |

**Default RDA/UL Configuration (from workbook):**

| Nutrient | RDA Value | RDA Unit | UL Value | UL Unit | Source |
|---|---|---|---|---|---|
| Vitamin A | 600 | mcg | 3000 | mcg | Configurable |
| Vitamin C | 45 | mg | 2000 | mg | Configurable |
| Calcium | 1000 | mg | 2500 | mg | Configurable |
| Iron | 18 | mg | 45 | mg | Configurable |
| Sodium | -- | -- | 2300 | mg | Configurable (UL only) |
| Total Fat | 65 | g | -- | -- | Configurable |
| Saturated Fat | 20 | g | -- | -- | Configurable |
| Carbohydrates | 300 | g | -- | -- | Configurable |
| Protein | 50 | g | -- | -- | Configurable |
| Fibre | 25 | g | -- | -- | Configurable |

All values are configurable per organization. Different regulatory frameworks (FDA, EFSA, Gulf Standards Authority, Codex Alimentarius) use different RDA values. The system supports multiple RDA profiles.

**Outputs:**

| Parameter | Type | Precision | Description |
|---|---|---|---|
| pct_rda_{nutrient} | DECIMAL(8,4) | 4 dp | Percentage of RDA provided by one portion |
| exceeds_ul_{nutrient} | BOOLEAN | -- | True if one portion exceeds the UL |
| pct_ul_{nutrient} | DECIMAL(8,4) | 4 dp | Percentage of UL consumed by one portion |

**Formulas:**

```
pct_rda_{nutrient} = (per_portion_{nutrient} / rda_value) * 100

pct_ul_{nutrient} = (per_portion_{nutrient} / ul_value) * 100

exceeds_ul_{nutrient} = per_portion_{nutrient} > ul_value
```

**Validation Rules:**
- RDA/UL values must be > 0 where defined.
- Not all nutrients have both RDA and UL. If a value is not defined, the comparison is skipped for that nutrient.
- Exceeding UL should trigger a visible warning on the recipe.

**Dependencies:** Calculations 7.3, configuration.

---

### 7.6 Macronutrient Energy Split

**Purpose:** Calculate the percentage of total calories contributed by each macronutrient.

**Inputs:**

| Parameter | Type | Source | Required | Description |
|---|---|---|---|---|
| total_fat | DECIMAL(12,4) | Calculation 7.2 (or per-portion from 7.3) | Yes | Fat in grams |
| total_carbs | DECIMAL(12,4) | Calculation 7.2 (or per-portion from 7.3) | Yes | Carbohydrates in grams |
| total_protein | DECIMAL(12,4) | Calculation 7.2 (or per-portion from 7.3) | Yes | Protein in grams |
| kcal_per_g_fat | DECIMAL(4,2) | Configuration | Yes | Default: 9 |
| kcal_per_g_carbs | DECIMAL(4,2) | Configuration | Yes | Default: 4 |
| kcal_per_g_protein | DECIMAL(4,2) | Configuration | Yes | Default: 4 |

**Outputs:**

| Parameter | Type | Precision | Description |
|---|---|---|---|
| kcal_from_fat | DECIMAL(12,4) | 4 dp | Calories from fat |
| kcal_from_carbs | DECIMAL(12,4) | 4 dp | Calories from carbohydrates |
| kcal_from_protein | DECIMAL(12,4) | 4 dp | Calories from protein |
| total_kcal | DECIMAL(12,4) | 4 dp | Sum of above |
| pct_calories_from_fat | DECIMAL(8,4) | 4 dp | % of calories from fat |
| pct_calories_from_carbs | DECIMAL(8,4) | 4 dp | % of calories from carbs |
| pct_calories_from_protein | DECIMAL(8,4) | 4 dp | % of calories from protein |

**Formulas:**

```
kcal_from_fat     = total_fat * kcal_per_g_fat
kcal_from_carbs   = total_carbs * kcal_per_g_carbs
kcal_from_protein = total_protein * kcal_per_g_protein

total_kcal = kcal_from_fat + kcal_from_carbs + kcal_from_protein

pct_calories_from_fat     = (kcal_from_fat / total_kcal) * 100
pct_calories_from_carbs   = (kcal_from_carbs / total_kcal) * 100
pct_calories_from_protein = (kcal_from_protein / total_kcal) * 100
```

**Validation Rules:**
- If total_kcal = 0 (all macros are 0), percentages are undefined. Set all to 0 and flag as "Zero calorie recipe".
- The three percentages must sum to 100 (within rounding tolerance). If they do not, adjust the largest value to force the sum to exactly 100 (rounding residual allocation).
- Conversion factors must be > 0.

**Dependencies:** Calculation 7.2 or 7.3.

---

## 8. Allergen Inheritance

### 8.1 Allergen Data Model

**Purpose:** Track allergens from raw products through the recipe hierarchy to menus, ensuring no allergen information is lost at any level.

**Allergen Status per Product/Ingredient:**

| Status | Code | Description |
|---|---|---|
| CONTAINS | C | Product definitively contains this allergen |
| MAY_CONTAIN | M | Cross-contamination risk (manufactured in facility that processes the allergen) |
| FREE_FROM | F | Product is verified free from this allergen |
| NOT_ASSESSED | N | Allergen status has not been evaluated |

**Default Allergen List (EU 14 + extensions):**

The allergen list is configurable per organization. The EU-14 are the default:

1. Celery
2. Cereals containing gluten (wheat, rye, barley, oats, spelt, kamut)
3. Crustaceans
4. Eggs
5. Fish
6. Lupin
7. Milk (including lactose)
8. Molluscs
9. Mustard
10. Tree nuts (almonds, hazelnuts, walnuts, cashews, pecans, brazils, pistachios, macadamia)
11. Peanuts
12. Sesame seeds
13. Soybeans
14. Sulphur dioxide / sulphites (> 10mg/kg or 10mg/L)

Additional allergens can be added (e.g., shellfish, corn, coconut per regional requirements).

---

### 8.2 Allergen Propagation Rules

**Purpose:** Automatically derive allergen status at each level of the recipe hierarchy.

**Propagation Chain:**

```
Product -> Sub Recipe -> Recipe -> Menu Item -> Menu
```

**Aggregation Rules (per allergen, at each level):**

```
IF ANY ingredient has status CONTAINS:
    parent status = CONTAINS

ELSE IF ANY ingredient has status MAY_CONTAIN:
    parent status = MAY_CONTAIN

ELSE IF ANY ingredient has status NOT_ASSESSED:
    parent status = NOT_ASSESSED

ELSE:
    -- All ingredients are FREE_FROM
    parent status = FREE_FROM
```

In priority order: `CONTAINS > MAY_CONTAIN > NOT_ASSESSED > FREE_FROM`.

**Manual Override:**

At any level, an authorized user can override the inherited status. Overrides are:

| Override | Valid From | Valid To | Allowed |
|---|---|---|---|
| Upgrade (F -> M, F -> C, M -> C) | Any | Any | Always allowed |
| Downgrade (C -> M, C -> F, M -> F) | Inherited | Manual | Allowed with mandatory justification and approval workflow |
| Set NOT_ASSESSED | Any | N | Allowed (resets to unknown) |

**Validation Rules:**
- A downgrade override requires a text justification and (optionally) approval by a second user with the allergen_manager role.
- Overrides are logged in the audit trail with the justification, override user, and approval user.
- When a product's allergen status changes, all sub recipes and recipes using that product are flagged for allergen review. The system does not automatically downgrade inherited statuses, but it does automatically upgrade them.
- Circular allergen references are prevented by the same mechanism as circular recipe references (section 3.3).

---

### 8.3 Allergen Completeness

**Purpose:** Ensure all products have been assessed for all configured allergens before a recipe is published.

**Formulas:**

```
allergen_completeness_pct = (assessed_count / total_allergen_count) * 100

WHERE assessed_count = COUNT of allergens with status != NOT_ASSESSED
      total_allergen_count = COUNT of all configured allergens
```

**Validation Rules:**
- A recipe cannot transition to "Published" or "Active" status if any ingredient product has NOT_ASSESSED allergens, unless the organization explicitly allows it (configurable flag: `allow_publish_with_unassessed_allergens`, default: false).
- A "completeness report" is available showing which products across which recipes have unassessed allergens.

**Dependencies:** Product allergen data, recipe ingredient list.

---

## 9. Yield & Waste

### 9.1 Reference Waste Percentage (Ref%)

This is the same calculation as section 2.3 but documented here for completeness as part of the yield/waste domain.

**Purpose:** Quantify the proportion of a product lost during preparation.

**Formulas:**

```
ref_percentage = (waste_weight / gross_weight) * 100
yield_percentage = 100 - ref_percentage
```

### 9.2 Multi-Stage Waste

**Purpose:** Support products that undergo multiple preparation stages, each with its own waste factor.

**Inputs:**

| Parameter | Type | Source | Required | Description |
|---|---|---|---|---|
| stages[] | ARRAY | Product waste configuration | Yes | Ordered array of preparation stages |
| stage.name | VARCHAR(100) | Configuration | Yes | E.g., "Cleaning", "Peeling", "Trimming", "De-boning" |
| stage.waste_pct | DECIMAL(8,4) | Trim test / configuration | Yes | Waste % at this stage |

**Outputs:**

| Parameter | Type | Precision | Description |
|---|---|---|---|
| cumulative_yield_pct | DECIMAL(8,4) | 4 dp | Overall yield after all stages |
| cumulative_waste_pct | DECIMAL(8,4) | 4 dp | Overall waste after all stages |
| effective_ref_pct | DECIMAL(8,4) | 4 dp | The single Ref% that produces the same result |

**Formulas:**

```
-- Each stage's yield applies to the remaining product
cumulative_yield_fraction = PRODUCT((100 - stage[i].waste_pct) / 100) for all stages

cumulative_yield_pct = cumulative_yield_fraction * 100

cumulative_waste_pct = 100 - cumulative_yield_pct

effective_ref_pct = cumulative_waste_pct
```

**Example:**

Stage 1: Cleaning (5% waste) -> Stage 2: Peeling (15% waste) -> Stage 3: Trimming (8% waste)

```
cumulative_yield = (95/100) * (85/100) * (92/100) = 0.7429
cumulative_yield_pct = 74.29%
cumulative_waste_pct = 25.71%
```

This is different from simply adding the waste percentages (5+15+8=28%), because each stage applies to the remaining product, not the original.

**Validation Rules:**
- Each stage's waste_pct must be >= 0 and < 100.
- The cumulative yield must be > 0 (i.e., at least some product must remain).
- Stages are ordered. The order affects the cumulative result only if stage waste percentages are interdependent (which they are in practice -- you peel before you trim).

---

### 9.3 Cooking Loss

**Purpose:** Account for weight change during cooking (evaporation, fat rendering, moisture absorption).

**Inputs:**

| Parameter | Type | Source | Required | Description |
|---|---|---|---|---|
| pre_cooking_weight | DECIMAL(12,4) | Calculated or manual | Yes | Weight before cooking |
| post_cooking_weight | DECIMAL(12,4) | Test or manual | Yes | Weight after cooking |

**Outputs:**

| Parameter | Type | Precision | Description |
|---|---|---|---|
| cooking_loss_pct | DECIMAL(8,4) | 4 dp | Weight loss percentage |
| cooking_yield_pct | DECIMAL(8,4) | 4 dp | Weight retained percentage |
| cooking_loss_factor | DECIMAL(8,4) | 4 dp | Multiplier (post/pre) |

**Formulas:**

```
cooking_loss_pct = ((pre_cooking_weight - post_cooking_weight) / pre_cooking_weight) * 100

cooking_yield_pct = (post_cooking_weight / pre_cooking_weight) * 100

cooking_loss_factor = post_cooking_weight / pre_cooking_weight
```

**Validation Rules:**
- Both weights must be > 0.
- `post_cooking_weight` can be > `pre_cooking_weight` (e.g., when absorbing liquid, like rice or pasta). In this case, cooking_loss_pct is negative (weight gain).
- Cooking loss is applied at the recipe level (not the ingredient level) for nutrition per-100g calculations.

**Dependencies:** Used by Calculation 7.4 (per-100g nutrition) to determine the actual finished weight.

---

### 9.4 Shrinkage and Portioning Loss

**Purpose:** Account for further losses during portioning, plating, and service.

**Inputs:**

| Parameter | Type | Source | Required | Description |
|---|---|---|---|---|
| portioning_loss_pct | DECIMAL(8,4) | Configuration (recipe level) | No | Default: 0 |

**Formulas:**

```
actual_portions = theoretical_portions * (1 - (portioning_loss_pct / 100))

adjusted_cost_per_portion = total_cost / actual_portions
```

**Validation Rules:**
- `portioning_loss_pct` must be >= 0 and < 100.
- If not configured, portioning loss is 0 (no adjustment).

---

## 10. Unit Conversion

### 10.1 Unit System

**Purpose:** Convert between different units of measure at every point where quantities are compared, aggregated, or costed.

**Unit Categories:**

| Category | Units | Base Unit |
|---|---|---|
| Weight | mg, g, kg, oz, lb, ton (metric), ton (imperial) | g |
| Volume | ml, cl, dl, L, fl oz, cup, pint, quart, gallon (US), gallon (UK) | ml |
| Count | each, dozen, score, hundred, thousand | each |
| Length | mm, cm, m, in, ft | mm |

**Conversion Factors (configurable):**

All conversion factors are stored in a `unit_conversions` table:

| from_unit | to_unit | factor | category |
|---|---|---|---|
| kg | g | 1000 | weight |
| lb | g | 453.5924 | weight |
| oz | g | 28.3495 | weight |
| L | ml | 1000 | volume |
| fl oz | ml | 29.5735 | volume |
| cup | ml | 236.5882 | volume |
| gallon_us | ml | 3785.4118 | volume |
| gallon_uk | ml | 4546.09 | volume |
| pint_us | ml | 473.1765 | volume |
| pint_uk | ml | 568.2613 | volume |
| dozen | each | 12 | count |
| ... | ... | ... | ... |

**Conversion Formula:**

```
converted_value = value * (factor_from / factor_to)

-- Where factor_from converts from_unit to base_unit
-- and factor_to converts to_unit to base_unit
-- Equivalently:
value_in_base = value * factor_to_base(from_unit)
converted_value = value_in_base / factor_to_base(to_unit)
```

---

### 10.2 Cross-Category Conversion (Volume to Weight)

**Purpose:** Convert between weight and volume using product-specific density.

**Inputs:**

| Parameter | Type | Source | Required | Description |
|---|---|---|---|---|
| value | DECIMAL(12,4) | Source quantity | Yes | The quantity to convert |
| from_unit | ENUM | Source | Yes | Original unit |
| to_unit | ENUM | Target | Yes | Desired unit |
| density | DECIMAL(10,6) | Product master | Conditional | g/ml -- required for weight<->volume conversion |

**Formulas:**

```
-- Volume to Weight:
weight_grams = volume_ml * density

-- Weight to Volume:
volume_ml = weight_grams / density
```

**Validation Rules:**
- Cross-category conversion (weight to volume or vice versa) requires a density value on the product.
- If density is not set and a cross-category conversion is attempted, the system raises an error: "Cannot convert [from_unit] to [to_unit] for [product_name] -- density not configured."
- Density must be > 0.
- Common densities: water = 1.0, milk = 1.03, olive oil = 0.92, flour = 0.53, sugar = 0.85. These are defaults that can be overridden per product.

---

### 10.3 Purchase Unit to Recipe Unit Chain

**Purpose:** Convert from the unit used on a purchase order to the unit used in a recipe.

**Conversion Chain:**

```
Purchase Unit -> Issue Unit -> Recipe Unit
```

- **Purchase Unit:** How the product is bought (case of 12 x 500g bags).
- **Issue Unit:** How the product is issued from stores (per kg, per bag).
- **Recipe Unit:** How the product is measured in a recipe (per g, per ml, per each).

Each conversion step uses the factors from section 10.1. The chain ensures that a recipe calling for "200g of flour" can be costed against a purchase of "25kg bags at AED 45 per bag."

**Formula:**

```
cost_in_recipe_unit = product.gross_cost_per_unit * convert(1, product.base_unit, recipe_unit)
```

---

## 11. Scaling

### 11.1 Scale by Portions

**Purpose:** Scale a recipe to produce a different number of portions.

**Inputs:**

| Parameter | Type | Source | Required | Description |
|---|---|---|---|---|
| original_portions | DECIMAL(8,2) | Recipe header | Yes | Original yield |
| target_portions | DECIMAL(8,2) | User input | Yes | Desired yield |
| ingredient_nett_qty[] | DECIMAL(12,4)[] | Recipe ingredient lines | Yes | Original quantities |

**Outputs:**

| Parameter | Type | Precision | Description |
|---|---|---|---|
| scaling_factor | DECIMAL(12,6) | 6 dp | Multiplier applied to all quantities |
| scaled_nett_qty[] | DECIMAL(12,4)[] | 4 dp | Adjusted ingredient quantities |
| scaled_total_cost | DECIMAL(19,6) | 6 dp | Recalculated total cost |

**Formulas:**

```
scaling_factor = target_portions / original_portions

scaled_nett_qty[i] = ingredient_nett_qty[i] * scaling_factor

-- Cost scales linearly (all ingredient costs recalculated with new quantities)
scaled_total_cost = SUM(calculate_line_cost(scaled_nett_qty[i])) for all ingredients
```

**Validation Rules:**
- `original_portions` must be > 0.
- `target_portions` must be > 0.
- The system should warn if the scaling factor is extreme (< 0.1 or > 100) as this may produce impractical quantities.

---

### 11.2 Scale by Total Weight

**Purpose:** Scale a recipe to produce a target total weight.

**Inputs:**

| Parameter | Type | Source | Required | Description |
|---|---|---|---|---|
| original_total_weight | DECIMAL(12,4) | Recipe (sum of nett weights or manual) | Yes | Original total weight |
| target_total_weight | DECIMAL(12,4) | User input | Yes | Desired total weight |
| target_weight_unit | ENUM | User input | Yes | Unit for the target weight |

**Formulas:**

```
-- Normalize to same unit
original_weight_normalized = convert(original_total_weight, original_unit, target_weight_unit)

scaling_factor = target_total_weight / original_weight_normalized

-- Apply scaling_factor to all ingredients as in 11.1
```

---

### 11.3 Scale by Percentage

**Purpose:** Scale a recipe by a percentage increase or decrease.

**Inputs:**

| Parameter | Type | Source | Required | Description |
|---|---|---|---|---|
| scale_percentage | DECIMAL(8,4) | User input | Yes | Percentage to scale by (e.g., 150 = 150% of original = 50% increase) |

**Formulas:**

```
scaling_factor = scale_percentage / 100

-- Apply scaling_factor to all ingredients as in 11.1
```

---

### 11.4 Scaling Constraints

**Purpose:** Handle non-linear scaling for certain ingredients (e.g., salt, spices, leavening agents).

**Configuration:**

Each ingredient line can have a scaling behavior:

| Behavior | Description | Formula |
|---|---|---|
| LINEAR (default) | Scales proportionally | scaled_qty = qty * factor |
| FIXED | Does not scale (e.g., a single vanilla pod regardless of batch size) | scaled_qty = qty |
| STEP | Scales in discrete steps (e.g., eggs) | scaled_qty = CEILING(qty * factor) |
| CAPPED_LINEAR | Scales linearly up to a cap, then fixed | scaled_qty = MIN(qty * factor, cap_value) |
| BAKER_PERCENTAGE | Scales relative to flour weight, not total recipe | scaled_qty = flour_weight * baker_pct |
| CUSTOM | Uses a custom formula expression | scaled_qty = EVALUATE(custom_formula, factor) |

**Validation Rules:**
- The default behavior is LINEAR for all ingredients.
- Non-linear behaviors are opt-in per ingredient line.
- When a recipe is scaled with non-linear ingredients, the total cost is recalculated using the actual scaled quantities, not by simply multiplying total_cost by the scaling factor.

---

## 12. Tax Calculations

### 12.1 Tax Profile

**Purpose:** Define the tax rules applicable to a jurisdiction, property, or menu category.

**Tax Profile Structure:**

| Field | Type | Description |
|---|---|---|
| tax_profile_id | UUID | Unique identifier |
| name | VARCHAR(100) | E.g., "UAE Standard", "UK Hospitality", "US California" |
| country_code | VARCHAR(2) | ISO 3166-1 alpha-2 |
| region_code | VARCHAR(10) | Nullable; state/emirate/province |
| effective_date | DATE | When this profile becomes active |
| expiry_date | DATE | Nullable; when it expires |

**Tax Components (per profile):**

| Field | Type | Description |
|---|---|---|
| component_id | UUID | Unique identifier |
| tax_type | ENUM | VAT, GST, SALES_TAX, IMPORT_DUTY, SERVICE_CHARGE, MUNICIPALITY_TAX, TOURISM_TAX |
| rate | DECIMAL(8,4) | Tax rate as percentage |
| applies_to | ENUM | SELLING_PRICE, COST_PRICE, SUBTOTAL_AFTER_OTHER_TAXES |
| is_inclusive | BOOLEAN | Whether the rate is included in or added to the price |
| is_recoverable | BOOLEAN | Whether the tax can be reclaimed (input tax credit) |
| category_filter | VARCHAR[] | Nullable; only applies to specific menu categories |
| min_threshold | DECIMAL(19,6) | Nullable; minimum value before tax applies |

### 12.2 Tax Calculation

**Purpose:** Calculate all applicable taxes for a priced recipe/menu item.

**Formulas:**

```
-- Simple VAT (inclusive):
price_ex_tax = price_inc_tax / (1 + (rate / 100))
tax_amount = price_inc_tax - price_ex_tax

-- Simple VAT (exclusive):
tax_amount = price_ex_tax * (rate / 100)
price_inc_tax = price_ex_tax + tax_amount

-- Compound taxes (tax on tax):
-- Applied in order of component sequence
running_subtotal = base_price
FOR EACH tax_component IN order:
    IF applies_to = SUBTOTAL_AFTER_OTHER_TAXES:
        tax_amount[i] = running_subtotal * (rate[i] / 100)
    ELSE:
        tax_amount[i] = base_price * (rate[i] / 100)
    running_subtotal = running_subtotal + tax_amount[i]

total_tax = SUM(tax_amount[i])
final_price = base_price + total_tax
```

**Example (UAE):**

```
VAT rate = 5%
Price with VAT = 110,000 AED (from workbook)
Price without VAT = 110,000 / 1.05 = 104,761.90 AED
VAT amount = 110,000 - 104,761.90 = 5,238.10 AED
```

**Validation Rules:**
- Tax rates must be >= 0 and <= 100.
- A tax profile must have at least one component.
- Tax is always computed; even in zero-tax jurisdictions, the profile exists with rate = 0.
- Rounding of tax amounts follows the organization's rounding mode.
- For recoverable taxes on purchases (input VAT), the system must track the tax component separately for reclaim purposes.

---

### 12.3 Import Tax on Ingredients

**Purpose:** Track import duty and customs taxes on imported products, which affect the true landed cost.

**Inputs:**

| Parameter | Type | Source | Required | Description |
|---|---|---|---|---|
| product_buying_cost | DECIMAL(19,6) | Product master | Yes | Base purchase cost |
| import_duty_pct | DECIMAL(8,4) | Product or supplier config | No | Import duty rate |
| customs_processing_fee | DECIMAL(19,6) | Product config | No | Fixed fee per import |
| freight_cost | DECIMAL(19,6) | Product or supplier config | No | Shipping cost per unit |

**Formulas:**

```
import_duty = product_buying_cost * (import_duty_pct / 100)

landed_cost = product_buying_cost + import_duty + COALESCE(customs_processing_fee, 0) + COALESCE(freight_cost, 0)
```

The `landed_cost` replaces `buying_cost` in Calculation 2.1 when import costs are configured.

**Validation Rules:**
- Import cost components are optional. If not configured, landed_cost = buying_cost.
- All cost components must be >= 0.

---

## 13. Currency & Exchange

### 13.1 Multi-Currency Architecture

**Purpose:** Support organizations that purchase ingredients in multiple currencies and sell in another.

**Core Rules:**

1. Every monetary value is stored with its currency code (ISO 4217).
2. Every organization has a **base currency** (the currency used for reporting and final recipe costs).
3. Products can have prices in any currency. The system converts to the base currency at the point of cost calculation.
4. Exchange rates are stored with an effective date and source.
5. Cross-currency arithmetic without explicit conversion is prohibited at the database level.

### 13.2 Exchange Rate Management

**Exchange Rate Record:**

| Field | Type | Description |
|---|---|---|
| from_currency | VARCHAR(3) | Source currency (ISO 4217) |
| to_currency | VARCHAR(3) | Target currency (ISO 4217) |
| rate | DECIMAL(19,10) | Units of to_currency per 1 unit of from_currency |
| effective_date | DATE | Date from which this rate applies |
| expiry_date | DATE | Nullable; date until which this rate applies |
| source | ENUM | MANUAL, API_FEED, BANK_RATE, CONTRACT_RATE |
| margin_pct | DECIMAL(8,4) | Optional margin/spread added to the base rate |

### 13.3 Currency Conversion

**Formulas:**

```
-- Direct conversion
converted_amount = original_amount * exchange_rate

-- With margin
effective_rate = exchange_rate * (1 + (margin_pct / 100))
converted_amount = original_amount * effective_rate

-- Inverse (when only the reverse rate is available)
converted_amount = original_amount / inverse_rate

-- Triangulation (no direct rate; convert through a third currency, typically USD or EUR)
amount_in_bridge = original_amount * rate_from_to_bridge
converted_amount = amount_in_bridge * rate_bridge_to_target
```

**Validation Rules:**
- Exchange rates must be > 0.
- The system must select the rate whose effective_date is the most recent date <= the calculation's effective_date.
- If no exchange rate is available for the required currency pair, the calculation halts with an error: "No exchange rate available for [FROM]->[TO] as of [DATE]."
- Stale rate warning: If the most recent rate is older than a configurable threshold (default: 7 days), emit a warning.
- Rate change impact: When a new exchange rate is entered, the system can (optionally) trigger recalculation of all recipes with ingredients in the affected currency.

---

## 14. Labour Cost

### 14.1 Labour Cost Model

**Purpose:** Calculate the labour cost component of a recipe based on preparation time, cooking time, and staff costs.

**Configuration:**

**Chef Grade Table (configurable):**

| Grade | Name | Hourly Rate | Currency | Effective Date |
|---|---|---|---|---|
| 1 | Executive Chef | (configurable) | (org currency) | (date) |
| 2 | Sous Chef | (configurable) | (org currency) | (date) |
| 3 | Chef de Partie | (configurable) | (org currency) | (date) |
| 4 | Demi Chef | (configurable) | (org currency) | (date) |
| 5 | Commis Chef | (configurable) | (org currency) | (date) |
| 6 | Kitchen Helper | (configurable) | (org currency) | (date) |

**Kitchen Section Table (configurable):**

| Section | Name | Default Grade | Overhead Multiplier |
|---|---|---|---|
| HOT | Hot Kitchen | 3 | 1.0 |
| COLD | Cold Kitchen / Garde Manger | 3 | 1.0 |
| PASTRY | Pastry | 3 | 1.0 |
| BAKERY | Bakery | 3 | 1.0 |
| BUTCHERY | Butchery | 3 | 1.0 |
| PREP | Preparation | 5 | 1.0 |

### 14.2 Recipe Labour Cost Calculation

**Inputs:**

| Parameter | Type | Source | Required | Description |
|---|---|---|---|---|
| prep_time_minutes | DECIMAL(8,2) | Recipe header | No | Preparation time |
| cooking_time_minutes | DECIMAL(8,2) | Recipe header | No | Active cooking time |
| finishing_time_minutes | DECIMAL(8,2) | Recipe header | No | Plating/finishing time |
| chef_grade | INTEGER | Recipe header or section default | No | Which grade of chef performs this recipe |
| hourly_rate | DECIMAL(19,6) | Chef grade table | Looked up | Hourly rate for the assigned grade |
| staff_count | DECIMAL(4,2) | Recipe header | No | Number of staff working on this recipe simultaneously (default: 1) |

**Outputs:**

| Parameter | Type | Precision | Description |
|---|---|---|---|
| total_time_minutes | DECIMAL(8,2) | 2 dp | Total labour minutes |
| labour_cost | DECIMAL(19,6) | 6 dp | Total labour cost |
| labour_cost_per_portion | DECIMAL(19,6) | 6 dp | Labour cost per portion |

**Formulas:**

```
total_time_minutes = COALESCE(prep_time_minutes, 0)
                   + COALESCE(cooking_time_minutes, 0)
                   + COALESCE(finishing_time_minutes, 0)

minute_rate = hourly_rate / 60

labour_cost = total_time_minutes * minute_rate * COALESCE(staff_count, 1)

labour_cost_per_portion = labour_cost / portions
```

**Validation Rules:**
- All time values must be >= 0.
- If no time values are provided, labour_cost = NULL (not zero). Zero implies it was measured and confirmed as zero labour; NULL means it was not measured.
- `staff_count` must be >= 0. A value of 0 means no labour (e.g., passive process like marinating overnight).
- `hourly_rate` must be > 0.

**Dependencies:** Chef grade configuration, recipe header data.

---

### 14.3 Labour Cost Allocation Methods

The system supports multiple methods for allocating labour cost to a recipe. The method is configurable per organization:

| Method | Description | Formula |
|---|---|---|
| DIRECT | Based on actual prep/cook time (section 14.2) | As above |
| PERCENTAGE_OF_FOOD_COST | Labour as a fixed % of food cost | labour_cost = total_food_cost * (labour_pct / 100) |
| PERCENTAGE_OF_REVENUE | Labour as a fixed % of selling price | labour_cost = price_without_vat * (labour_pct / 100) |
| FIXED_PER_PORTION | A fixed labour cost per portion | labour_cost = fixed_amount * portions |
| WEIGHTED_BY_COMPLEXITY | Based on a recipe complexity score (1-10) and a cost-per-complexity-point | labour_cost = complexity_score * cost_per_point |

---

## 15. Overhead Calculations

### 15.1 Overhead Cost Model

**Purpose:** Allocate indirect costs (rent, utilities, equipment depreciation, etc.) to individual recipes.

**Overhead Categories (configurable):**

| Category | Description | Allocation Method |
|---|---|---|
| KITCHEN_OVERHEAD | Rent, depreciation, maintenance | % of food cost or fixed per recipe |
| STORAGE | Cold storage, dry storage | % of food cost or per-unit-stored |
| TRANSPORTATION | Delivery, logistics | Per delivery or % of cost |
| PACKAGING | Takeaway containers, wrapping | Per portion (configurable per recipe) |
| UTILITIES | Gas, electricity, water | Per cooking minute or % of revenue |
| CLEANING | Cleaning supplies, sanitation | Per recipe or % of food cost |
| CONSUMABLES | Paper, disposable gloves, foil | Per recipe or % of food cost |
| ENERGY | Specific energy cost for cooking | Per cooking minute by equipment type |

### 15.2 Overhead Allocation Formulas

**Method: Percentage of Food Cost**

```
overhead_cost = total_food_cost * (overhead_pct / 100)
```

**Method: Percentage of Revenue**

```
overhead_cost = price_without_vat * (overhead_pct / 100)
```

**Method: Fixed per Portion**

```
overhead_cost = fixed_overhead_per_portion * portions
```

**Method: Per Cooking Minute**

```
overhead_cost = total_cooking_minutes * cost_per_minute
```

**Method: Equipment-Based Energy**

```
-- Each recipe can specify equipment used
equipment_energy_cost = SUM(
    equipment[i].power_kw * (usage_minutes[i] / 60) * energy_cost_per_kwh
) for all equipment

overhead_cost = equipment_energy_cost + other_overheads
```

### 15.3 Total Overhead for a Recipe

```
total_overhead = SUM(overhead_cost[category]) for all configured categories

overhead_per_portion = total_overhead / portions

overhead_pct_of_revenue = (total_overhead / price_without_vat) * 100
```

**Validation Rules:**
- All overhead rates and amounts must be >= 0.
- Overhead calculation is optional. If no overhead categories are configured, overhead_cost = NULL (not zero).
- The system supports both recipe-level overhead configuration and organization-wide defaults that apply to all recipes.

---

## 16. Inventory Valuation

### 16.1 Valuation Methods

**Purpose:** Determine the cost of inventory on hand using one of several standard accounting methods.

**Supported Methods:**

| Method | Description |
|---|---|
| FIFO | First In, First Out -- oldest stock is costed first |
| LIFO | Last In, First Out -- newest stock is costed first |
| WEIGHTED_AVERAGE | Average cost across all stock on hand |
| SPECIFIC_IDENTIFICATION | Each unit tracked individually |
| LAST_PURCHASE_PRICE | Most recent purchase price applied to all stock |

The method is configurable per organization. Some jurisdictions prohibit certain methods (e.g., IFRS does not permit LIFO).

### 16.2 FIFO Valuation

**Inputs:**

| Parameter | Type | Source | Required | Description |
|---|---|---|---|---|
| inventory_lots[] | ARRAY | Purchase records | Yes | Array of lots with qty and unit_cost, ordered by receipt date ASC |
| quantity_on_hand | DECIMAL(12,4) | Current stock | Yes | Total quantity available |

**Formulas:**

```
-- Consume lots starting from the oldest
remaining_to_value = quantity_on_hand
total_value = 0

FOR EACH lot IN lots (oldest first):
    qty_from_lot = MIN(lot.remaining_qty, remaining_to_value)
    total_value = total_value + (qty_from_lot * lot.unit_cost)
    remaining_to_value = remaining_to_value - qty_from_lot
    IF remaining_to_value <= 0: BREAK

average_cost = total_value / quantity_on_hand
```

### 16.3 LIFO Valuation

Same algorithm as FIFO but lots are consumed starting from the most recent (newest first).

### 16.4 Weighted Average Valuation

**Formulas:**

```
-- Recalculate after each purchase
weighted_avg_cost = (existing_value + new_purchase_value) / (existing_qty + new_purchase_qty)

-- Where:
existing_value = existing_qty * previous_weighted_avg_cost
new_purchase_value = new_qty * new_unit_cost
```

**Validation Rules:**
- Inventory quantities must be >= 0.
- Unit costs must be >= 0.
- The valuation method cannot be changed retroactively for closed accounting periods.
- When the valuation method is changed, the system recalculates opening balances using the new method from the effective date forward.

---

## 17. Menu Engineering

### 17.1 Menu Engineering Matrix

**Purpose:** Classify menu items into four quadrants based on popularity (sales volume) and profitability (contribution margin) to guide pricing and menu design decisions.

**Inputs:**

| Parameter | Type | Source | Required | Description |
|---|---|---|---|---|
| menu_items[] | ARRAY | Menu with sales data | Yes | Array of menu items with sales and cost data |
| item.name | VARCHAR | Menu item | Yes | Item name |
| item.quantity_sold | INTEGER | POS/sales data | Yes | Number of units sold in the analysis period |
| item.selling_price_ex_vat | DECIMAL(19,6) | Menu item | Yes | Selling price |
| item.food_cost | DECIMAL(19,6) | Recipe costing | Yes | Food cost per unit |
| item.contribution_margin | DECIMAL(19,6) | Calculation 5.2 | Yes | Margin per unit |
| analysis_period_start | DATE | User input | Yes | Start of analysis period |
| analysis_period_end | DATE | User input | Yes | End of analysis period |

**Outputs:**

| Parameter | Type | Description |
|---|---|---|
| avg_contribution_margin | DECIMAL(19,6) | Weighted average CM across all items |
| avg_popularity | DECIMAL(12,4) | Average sales volume |
| popularity_threshold | DECIMAL(12,4) | 70% of avg_popularity (configurable) |
| item.classification | ENUM | STAR, PLOWHORSE, PUZZLE, DOG |
| item.menu_mix_pct | DECIMAL(8,4) | % of total items sold |
| item.revenue_contribution | DECIMAL(19,6) | Total revenue from this item |
| item.margin_contribution | DECIMAL(19,6) | Total margin from this item |

**Formulas:**

```
-- Popularity metrics
total_items_sold = SUM(item.quantity_sold) for all items
menu_item_count = COUNT(items)
avg_items_sold = total_items_sold / menu_item_count
popularity_threshold = avg_items_sold * (popularity_factor / 100)
-- popularity_factor default = 70 (configurable)

item.menu_mix_pct = (item.quantity_sold / total_items_sold) * 100

-- Profitability metrics
avg_contribution_margin = SUM(item.contribution_margin * item.quantity_sold) / total_items_sold
-- This is the weighted average contribution margin

-- Classification
item.is_popular = item.quantity_sold >= popularity_threshold
item.is_profitable = item.contribution_margin >= avg_contribution_margin

IF item.is_popular AND item.is_profitable:
    item.classification = STAR        -- High popularity, high margin
ELSE IF item.is_popular AND NOT item.is_profitable:
    item.classification = PLOWHORSE   -- High popularity, low margin
ELSE IF NOT item.is_popular AND item.is_profitable:
    item.classification = PUZZLE      -- Low popularity, high margin
ELSE:
    item.classification = DOG         -- Low popularity, low margin

-- Contribution metrics
item.revenue_contribution = item.quantity_sold * item.selling_price_ex_vat
item.margin_contribution = item.quantity_sold * item.contribution_margin
```

**Validation Rules:**
- At least 2 items are required for meaningful classification.
- All items must have sales data for the same period.
- The popularity factor (default 70%) is configurable. Some methodologies use different thresholds.
- Items with zero sales are automatically classified as DOG.

### 17.2 Menu Engineering Recommendations

**Purpose:** Generate actionable recommendations based on the classification.

| Classification | Strategy | Actions |
|---|---|---|
| STAR | Maintain | Protect the recipe; maintain quality and price; feature prominently |
| PLOWHORSE | Re-engineer | Increase price cautiously; reduce portion size; substitute cheaper ingredients; reposition on menu |
| PUZZLE | Promote | Increase visibility; train staff to upsell; consider price reduction; improve description |
| DOG | Replace | Remove from menu; replace with new items; or re-engineer completely |

These recommendations are configurable text templates per organization.

---

## 18. Price History & Inflation

### 18.1 Price History Tracking

**Purpose:** Maintain a complete history of product purchase prices for trend analysis and cost forecasting.

**Price History Record:**

| Field | Type | Description |
|---|---|---|
| product_id | UUID | Product reference |
| supplier_id | UUID | Supplier reference |
| unit_cost | DECIMAL(19,6) | Cost per purchase unit |
| currency | VARCHAR(3) | Currency of the cost |
| effective_date | DATE | When this price became effective |
| source | ENUM | INVOICE, QUOTE, CONTRACT, IMPORT, MANUAL |
| purchase_order_id | UUID | Nullable; reference to the PO |

### 18.2 Inflation Analysis

**Purpose:** Calculate the rate of price change for a product over time.

**Inputs:**

| Parameter | Type | Source | Required | Description |
|---|---|---|---|---|
| product_id | UUID | Product master | Yes | Which product |
| period_start | DATE | User input | Yes | Start of analysis period |
| period_end | DATE | User input | Yes | End of analysis period |

**Outputs:**

| Parameter | Type | Precision | Description |
|---|---|---|---|
| price_at_start | DECIMAL(19,6) | 6 dp | Price at the beginning of the period |
| price_at_end | DECIMAL(19,6) | 6 dp | Price at the end of the period |
| absolute_change | DECIMAL(19,6) | 6 dp | Monetary change |
| percentage_change | DECIMAL(8,4) | 4 dp | Percentage change |
| annualized_change_pct | DECIMAL(8,4) | 4 dp | Annualized percentage change |
| price_volatility | DECIMAL(8,4) | 4 dp | Standard deviation of price changes |

**Formulas:**

```
absolute_change = price_at_end - price_at_start

percentage_change = (absolute_change / price_at_start) * 100

-- Annualized (compound annual growth rate)
period_years = days_between(period_start, period_end) / 365.25
annualized_change_pct = ((price_at_end / price_at_start) ^ (1 / period_years) - 1) * 100

-- Volatility (standard deviation of period-over-period % changes)
price_changes[] = for each consecutive pair of prices:
    ((price[i+1] - price[i]) / price[i]) * 100
price_volatility = STDDEV(price_changes)
```

**Validation Rules:**
- `price_at_start` must be > 0.
- The period must contain at least two price points for meaningful analysis.
- If no price history exists for the period, return NULL values with an appropriate message.

### 18.3 Inflation-Adjusted Recipe Costing

**Purpose:** Project future recipe costs based on ingredient price trends.

**Formulas:**

```
-- Simple projection using individual product inflation rates
projected_ingredient_cost[i] = current_cost[i] * (1 + (product_annual_inflation[i] / 100)) ^ years_forward

projected_total_cost = SUM(projected_ingredient_cost[i])

projected_food_cost_pct = (projected_total_cost / current_price_without_vat) * 100
```

### 18.4 Seasonal Price Adjustments

**Purpose:** Apply seasonal price multipliers to products whose costs vary predictably by season.

**Configuration:**

| Field | Type | Description |
|---|---|---|
| product_id | UUID | Product reference |
| month | INTEGER(1-12) | Calendar month |
| seasonal_factor | DECIMAL(8,4) | Multiplier (1.0 = base price; 1.3 = 30% above base) |

**Formula:**

```
seasonally_adjusted_cost = base_cost * seasonal_factor_for_month(effective_date)
```

---

## 19. Supplier Analytics

### 19.1 Discount Tiers

**Purpose:** Calculate the applicable discount based on order volume.

**Configuration:**

| Field | Type | Description |
|---|---|---|
| supplier_id | UUID | Supplier reference |
| product_id | UUID | Nullable; product-specific or supplier-wide |
| min_qty | DECIMAL(12,4) | Minimum order quantity for this tier |
| max_qty | DECIMAL(12,4) | Nullable; maximum qty (null = unlimited) |
| discount_pct | DECIMAL(8,4) | Discount percentage |
| discount_type | ENUM | PERCENTAGE, FIXED_AMOUNT, UNIT_PRICE_OVERRIDE |

**Formulas:**

```
-- Find applicable tier
applicable_tier = SELECT tier WHERE order_qty >= tier.min_qty
                  AND (tier.max_qty IS NULL OR order_qty <= tier.max_qty)
                  ORDER BY tier.min_qty DESC
                  LIMIT 1

-- Apply discount
IF discount_type = PERCENTAGE:
    discounted_cost = base_cost * (1 - (discount_pct / 100))
ELSE IF discount_type = FIXED_AMOUNT:
    discounted_cost = base_cost - discount_amount
ELSE IF discount_type = UNIT_PRICE_OVERRIDE:
    discounted_cost = override_unit_price
```

### 19.2 Minimum Order Quantities (MOQ)

**Configuration:**

| Field | Type | Description |
|---|---|---|
| supplier_id | UUID | Supplier |
| product_id | UUID | Product |
| min_order_qty | DECIMAL(12,4) | Minimum quantity per order |
| min_order_value | DECIMAL(19,6) | Nullable; minimum monetary value per order |
| order_multiple | DECIMAL(12,4) | Nullable; must order in multiples of this quantity |

**Formulas:**

```
-- Adjust order quantity to meet MOQ
adjusted_qty = MAX(required_qty, min_order_qty)

-- Adjust to order multiple
IF order_multiple IS NOT NULL:
    adjusted_qty = CEILING(adjusted_qty / order_multiple) * order_multiple
```

### 19.3 Contract Pricing

**Purpose:** Support fixed-price contracts with suppliers for specific periods.

**Configuration:**

| Field | Type | Description |
|---|---|---|
| contract_id | UUID | Contract reference |
| supplier_id | UUID | Supplier |
| product_id | UUID | Product |
| contracted_price | DECIMAL(19,6) | Fixed price per purchase unit |
| currency | VARCHAR(3) | Contract currency |
| start_date | DATE | Contract start |
| end_date | DATE | Contract end |
| price_escalation_pct | DECIMAL(8,4) | Nullable; annual price escalation clause |
| volume_commitment | DECIMAL(12,4) | Nullable; committed volume per period |

**Formulas:**

```
-- If within contract period, use contract price
IF effective_date >= contract.start_date AND effective_date <= contract.end_date:
    applicable_price = contracted_price

    -- Apply escalation if applicable
    IF price_escalation_pct IS NOT NULL:
        years_elapsed = days_between(contract.start_date, effective_date) / 365.25
        applicable_price = contracted_price * (1 + (price_escalation_pct / 100)) ^ years_elapsed

ELSE:
    applicable_price = current_market_price
```

### 19.4 Supplier Comparison

**Purpose:** Compare effective costs across suppliers for the same product.

**Outputs:**

| Parameter | Type | Description |
|---|---|---|
| supplier_comparison[] | ARRAY | Ranked list of suppliers for a product |
| comparison.supplier_id | UUID | Supplier |
| comparison.base_unit_cost | DECIMAL(19,6) | Cost per base unit (after all discounts, conversions) |
| comparison.landed_cost | DECIMAL(19,6) | Including import, freight |
| comparison.lead_time_days | INTEGER | Delivery lead time |
| comparison.quality_score | DECIMAL(4,2) | Quality rating (0-10) |
| comparison.reliability_score | DECIMAL(4,2) | On-time delivery rating (0-10) |
| comparison.total_score | DECIMAL(4,2) | Weighted composite score |

**Formulas:**

```
total_score = (cost_weight * cost_score) + (quality_weight * quality_score) +
              (reliability_weight * reliability_score) + (lead_time_weight * lead_time_score)

WHERE weights sum to 1.0 and are configurable per organization
```

---

## 20. Formula Builder

### 20.1 Concept

**Purpose:** The Formula Builder is the engine that makes all calculations in CulinaryCore configurable without code changes. It provides a domain-specific expression language for defining cost formulas, a versioning system for tracking changes, and an impact analysis tool for previewing the effect of formula modifications.

### 20.2 Formula Expression Language

**Supported Operations:**

| Category | Operations |
|---|---|
| Arithmetic | `+`, `-`, `*`, `/`, `^` (power), `%` (modulo) |
| Comparison | `=`, `!=`, `<`, `>`, `<=`, `>=` |
| Logical | `AND`, `OR`, `NOT`, `IF(condition, then, else)` |
| Aggregation | `SUM()`, `AVG()`, `MIN()`, `MAX()`, `COUNT()`, `STDDEV()` |
| Rounding | `ROUND(value, decimals)`, `CEILING(value)`, `FLOOR(value)`, `TRUNCATE(value, decimals)` |
| Lookup | `LOOKUP(entity, field)`, `COALESCE(value1, value2, ...)` |
| Conversion | `CONVERT(value, from_unit, to_unit)` |
| Date | `DAYS_BETWEEN(date1, date2)`, `MONTH(date)`, `YEAR(date)` |
| String | `CONCAT()`, `LEFT()`, `RIGHT()` (for code generation, not cost calculation) |
| Mathematical | `ABS()`, `LOG()`, `EXP()`, `SQRT()` |

**Variable References:**

Variables are referenced using dot notation within curly braces:

```
{product.gross_cost_per_unit}
{recipe.total_cost}
{config.security_margin_pct}
{tax_profile.vat_rate}
{ingredient.nett_qty}
```

**Example Formula Definitions:**

```
-- Nett cost per unit
FORMULA nett_cost_per_unit:
    {product.gross_cost_per_unit} * (({product.waste_percentage} / 100) + 1)

-- Line cost
FORMULA line_cost:
    ((100 * CONVERT({ingredient.nett_qty}, {ingredient.recipe_unit}, {product.base_unit}))
     / (100 - {product.waste_percentage}))
    * {product.gross_cost_per_unit}

-- Food cost percentage
FORMULA food_cost_pct:
    ({recipe.total_cost} / {recipe.price_without_vat}) * 100

-- Recommended selling price
FORMULA recommended_price:
    {recipe.total_cost} / ({config.target_food_cost_pct} / 100)

-- Kcal from macros
FORMULA kcal_total:
    ({nutrient.fat} * {config.kcal_per_g_fat})
    + ({nutrient.carbs} * {config.kcal_per_g_carbs})
    + ({nutrient.protein} * {config.kcal_per_g_protein})
```

### 20.3 Formula Versioning

**Purpose:** Track all changes to formulas over time, enabling audit, rollback, and historical accuracy.

**Formula Version Record:**

| Field | Type | Description |
|---|---|---|
| formula_id | UUID | Unique formula identifier |
| formula_name | VARCHAR(100) | Human-readable name |
| version | INTEGER | Auto-incrementing version number |
| expression | TEXT | The formula expression |
| created_by | UUID | User who created this version |
| created_at | TIMESTAMP | When this version was created |
| is_active | BOOLEAN | Whether this is the currently active version |
| change_reason | TEXT | Why this version was created |
| approved_by | UUID | Nullable; approval user |
| approved_at | TIMESTAMP | Nullable; approval timestamp |

**Rules:**
- Only one version of a formula can be active at a time.
- Activating a new version deactivates the previous one.
- Historical calculations reference the formula_version_id that produced them, so they can be reproduced.
- Deleting a formula version is not permitted; it can only be deactivated.
- Formula activation can require approval (configurable per organization).

### 20.4 Configurable Cost Components

**Purpose:** Allow organizations to define which cost components contribute to the "total cost" of a recipe.

**Default Cost Component Configuration:**

| Component | Included by Default | Configurable | Override Level |
|---|---|---|---|
| Food Cost (ingredients) | Yes | No (always included) | -- |
| Security Margin | Yes | Yes | Organization, Recipe |
| Labour Cost | No | Yes | Organization, Recipe |
| Kitchen Overhead | No | Yes | Organization, Recipe |
| Packaging Cost | No | Yes | Organization, Menu, Recipe |
| Energy Cost | No | Yes | Organization, Recipe |
| Storage Cost | No | Yes | Organization, Recipe |
| Transportation Cost | No | Yes | Organization, Recipe |
| Cleaning & Consumables | No | Yes | Organization, Recipe |

**Formula:**

```
total_cost = food_cost
           + IF(include_security_margin, food_cost * (security_margin_pct / 100), 0)
           + IF(include_labour, labour_cost, 0)
           + IF(include_overhead, overhead_cost, 0)
           + IF(include_packaging, packaging_cost, 0)
           + IF(include_energy, energy_cost, 0)
           + IF(include_storage, storage_cost, 0)
           + IF(include_transportation, transportation_cost, 0)
           + IF(include_cleaning, cleaning_cost, 0)
```

Each `include_*` flag and its associated cost value follows the override chain: Organization -> Property -> Menu -> Recipe.

### 20.5 Calculation Order

**Purpose:** Define the sequence in which calculations execute, ensuring dependencies are resolved before they are needed.

**Default Execution Order:**

| Order | Calculation | Dependencies |
|---|---|---|
| 100 | Unit Conversion | None |
| 200 | Product Cost (2.1, 2.2) | Unit Conversion |
| 300 | Sub Recipe Line Costs (3.1) | Product Cost, Unit Conversion |
| 400 | Sub Recipe Aggregation (3.2, 3.3) | Sub Recipe Line Costs |
| 500 | Recipe Line Costs (4.1) | Product Cost, Sub Recipe Cost, Unit Conversion |
| 600 | Recipe Cost Aggregation (4.2) | Recipe Line Costs |
| 700 | Labour Cost (14) | Recipe header |
| 800 | Overhead Costs (15) | Recipe Cost, Labour Cost |
| 900 | Total Cost Assembly (20.4) | All cost components |
| 1000 | Tax Calculation (12) | Configuration |
| 1100 | Pricing (5) | Total Cost, Tax |
| 1200 | Target Analysis (6) | Total Cost, Pricing |
| 1300 | Nutrition (7) | Ingredient quantities, Unit Conversion |
| 1400 | Allergen Propagation (8) | Ingredient list |
| 1500 | Menu Engineering (17) | Pricing, Sales data |

Orders use gaps of 100 to allow insertion of custom steps without renumbering.

**Rules:**
- The system validates the dependency graph before executing. If a step depends on another that has a higher (later) order number, the configuration is rejected.
- Custom steps can be inserted at any order number.
- Steps can be disabled (skipped) without removal.

### 20.6 Preview and Impact Analysis

**Purpose:** Before activating a formula change, show the user what would change and by how much.

**Process:**

1. User modifies a formula or configuration value.
2. System identifies all entities affected by the change (products, sub recipes, recipes, menu items).
3. System calculates both the current value (using active formulas) and the projected value (using the proposed change) for each affected entity.
4. System presents a comparison:

| Entity | Current Value | Projected Value | Change | Change % |
|---|---|---|---|---|
| Recipe A - Total Cost | 45.00 | 47.25 | +2.25 | +5.0% |
| Recipe A - Food Cost % | 28.5% | 30.0% | +1.5pp | -- |
| Recipe B - Total Cost | 120.00 | 126.00 | +6.00 | +5.0% |
| ... | ... | ... | ... | ... |

5. User reviews and either confirms (activates the new version) or cancels.

**Validation Rules:**
- Impact analysis is mandatory before activating a formula change that affects more than a configurable threshold of recipes (default: 10).
- The analysis results are stored as part of the formula version's audit trail.
- The analysis must complete within a configurable timeout (default: 300 seconds). If it times out, the system reports partial results and warns the user.

---

## Appendix A: Configuration Key Reference

All configurable values referenced in this document, with their default values and override levels.

| Key | Default Value | Type | Override Levels | Section |
|---|---|---|---|---|
| `cost.security_margin_pct` | 5.0000 | DECIMAL(8,4) | Org, Property, Menu, Recipe | 3.2, 4.2 |
| `cost.rounding_mode` | HALF_UP | ENUM | Org | 1.3 |
| `cost.precision_monetary_internal` | 6 | INTEGER | Org | 1.3 |
| `cost.precision_monetary_display` | 2 | INTEGER | Org | 1.3 |
| `cost.precision_weight` | 4 | INTEGER | Org | 1.3 |
| `cost.precision_percentage` | 2 | INTEGER | Org | 1.3 |
| `cost.error_handling_default` | SKIP_LINE | ENUM | Org, Recipe | 1.5 |
| `cost.allow_negative_waste` | false | BOOLEAN | Org | 2.2 |
| `cost.max_nesting_depth` | 10 | INTEGER | Org | 3.3 |
| `tax.price_entry_mode` | INCLUSIVE | ENUM | Org, Property | 5.1 |
| `target.food_cost_pct` | 30.0000 | DECIMAL(8,4) | Org, Property, Menu, Recipe | 6.1 |
| `target.tolerance_pct` | 2.0000 | DECIMAL(8,4) | Org | 6.1 |
| `target.popularity_factor` | 70 | DECIMAL(8,4) | Org | 17.1 |
| `nutrition.kcal_per_g_fat` | 9.00 | DECIMAL(4,2) | Org | 7.1 |
| `nutrition.kcal_per_g_carbs` | 4.00 | DECIMAL(4,2) | Org | 7.1 |
| `nutrition.kcal_per_g_protein` | 4.00 | DECIMAL(4,2) | Org | 7.1 |
| `nutrition.kcal_per_g_fibre` | 2.00 | DECIMAL(4,2) | Org | 7.1 |
| `nutrition.kcal_per_g_alcohol` | 7.00 | DECIMAL(4,2) | Org | 7.1 |
| `nutrition.rda_profile` | WHO_ADULT | VARCHAR | Org | 7.5 |
| `allergen.require_complete_before_publish` | true | BOOLEAN | Org | 8.3 |
| `allergen.downgrade_requires_approval` | true | BOOLEAN | Org | 8.2 |
| `currency.base_currency` | AED | VARCHAR(3) | Org | 13.1 |
| `currency.stale_rate_threshold_days` | 7 | INTEGER | Org | 13.3 |
| `labour.allocation_method` | DIRECT | ENUM | Org, Recipe | 14.3 |
| `inventory.valuation_method` | WEIGHTED_AVERAGE | ENUM | Org | 16.1 |
| `scaling.warn_factor_min` | 0.1 | DECIMAL(8,4) | Org | 11.1 |
| `scaling.warn_factor_max` | 100.0 | DECIMAL(8,4) | Org | 11.1 |
| `formula.require_approval` | true | BOOLEAN | Org | 20.3 |
| `formula.impact_analysis_threshold` | 10 | INTEGER | Org | 20.6 |
| `formula.impact_analysis_timeout_sec` | 300 | INTEGER | Org | 20.6 |

---

## Appendix B: Calculation Dependency Graph

```
Product Cost (2.1)
  |
  v
Waste-Adjusted Cost (2.2) <-- Waste % (2.3 / 9.1)
  |
  v
Product Cost Record (2.4) -------+----------+
  |                               |          |
  v                               v          |
Sub Recipe Line Cost (3.1)   Recipe Line Cost (4.1)
  |                               |          |
  v                               v          |
Sub Recipe Aggregation (3.2) Recipe Aggregation (4.2)
  |                               |
  v                               |
Sub Recipe Cost/Unit (3.3) -------+
                                  |
                    +-------------+-------------+
                    |             |              |
                    v             v              v
              Labour (14)   Overhead (15)   Tax (12)
                    |             |              |
                    +------+------+              |
                           |                     |
                           v                     v
                    Total Cost (20.4)      Pricing (5)
                           |                     |
                           v                     v
                    Target Analysis (6)   Menu Engineering (17)

Unit Conversion (10) ---> used by 2.1, 3.1, 4.1, 7.1
Currency (13) ---------> used by 2.1, all monetary calculations
Allergens (8) ---------> parallel to costing, uses ingredient list
Nutrition (7) ---------> parallel to costing, uses ingredient quantities
Scaling (11) ----------> modifies quantities, triggers recalculation
Price History (18) ----> feeds into 2.4 (effective price selection)
Supplier Analytics (19) -> feeds into 2.4 (supplier/price selection)
Formula Builder (20) --> governs all calculation expressions
```

---

## Appendix C: Cross-Reference to Excel Workbook Formulas

This appendix maps each Excel workbook formula to its CulinaryCore calculation section.

| Excel Formula/Cell | Workbook Location | CulinaryCore Section |
|---|---|---|
| `Total weight = PPC * UPP` | Product List / Table7 | 2.1 |
| `Gross/U = Buying cost / Total weight` | Product List / Table7 | 2.1 |
| `Ref% = (Waste / Gross) * 100` | Product List / Table7 | 2.3 / 9.1 |
| `Nett/U = Gross/U * ((Ref%/100) + 1)` | Product List / Table7 | 2.2 |
| `Yield% = 100 - Ref%` | Product List / Table7 | 2.2 / 9.1 |
| `Unit = INDEX(Table7[U3], MATCH(...))` | Recipe sheets | 3.1 / 4.1 (product lookup) |
| `Ref% = INDEX(Table7[Ref%], MATCH(...))` | Recipe sheets | 3.1 / 4.1 (waste lookup) |
| `Gross Qty = (100 * Nett Qty) / (100 - Ref%)` | Recipe sheets | 3.1 / 4.1 |
| `Cost/U = INDEX(Table7[Gross/U], MATCH(...))` | Recipe sheets | 3.1 / 4.1 (cost lookup) |
| `Line Cost = Gross Qty * Cost/U` | Recipe sheets (array formula) | 3.1 / 4.1 |
| `Total Cost = SUMIF(costs, "<>#VALUE!")` | Recipe sheets | 3.2 / 4.2 |
| `Total Cost + 5% SEC. MARGIN = Total Cost * 1.05` | Recipe/Sub Recipe sheets | 3.2 / 4.2 |
| `COST PER UNIT = (Total Cost * 1.05) / Batch Weight` | Sub Recipe sheets | 3.3 |
| `PRICE W/V.A.T.` | Recipe sheets (manual) | 5.1 |
| `PRICE - V.A.T.` | Recipe sheets (manual) | 5.1 |
| `GROSS CONTRIBUTION MARGIN = Price W/VAT - Total Cost` | Recipe sheets | 5.2 |
| `FOOD COST % = Total Cost / Price-VAT` | Recipe sheets | 5.3 |
| `(Nett Qty / 100) * nutrient_per_100g` | Nutrition columns | 7.1 |
| `K.Cal = (Fat*9) + (Carbs*4) + (Protein*4)` | Nutrition columns | 7.1 / 7.6 |
| `SUBTOTAL(9, column)` | Nutrition totals | 7.2 |
| `Total nutrients / Yield (portions)` | Nutrition per portion | 7.3 |
| `INDIRECT("'"&recipe&"'!$G$36")` etc. | Index sheet | Index aggregation (recipe summary view) |
| RDA values: Vit A=600mcg, Vit C=45mg, Ca=1000mg, Fe=18mg, Na=2300mg | Nutrition reference | 7.5 |

---

## Appendix D: Glossary

| Term | Definition |
|---|---|
| Base Unit | The smallest unit of measure for a product (g, ml, each) |
| Buying Cost | The purchase price for one purchase unit (case, bag, box) |
| Contribution Margin | Selling price minus food cost (monetary amount) |
| Food Cost % | (Food cost / Revenue ex-VAT) * 100 |
| Gross Cost per Unit (Gross/U) | Cost per base unit before waste adjustment |
| Gross Quantity | The amount of product needed before waste (more than nett) |
| Landed Cost | Purchase cost including import duty, freight, and customs fees |
| Markup % | ((Revenue - Cost) / Cost) * 100 |
| Menu Mix % | (Items sold / Total items sold) * 100 |
| Nett Cost per Unit (Nett/U) | Cost per base unit of usable product (after waste adjustment) |
| Nett Quantity | The usable quantity required in a recipe |
| PPC | Pieces Per Case -- individual units within a purchase case |
| Prime Cost | Food cost + labour cost |
| Ref% | Reference waste percentage; (waste / gross) * 100 |
| Security Margin | A configurable percentage added to food cost as a buffer (default 5%) |
| UPP | Units Per Piece -- weight or volume of each individual piece in base units |
| Yield % | 100 - Ref%; the usable proportion of a product |

---

## 21. Competitive Readiness Rules — Operations, Finance & Workforce

### 21.1 Theoretical versus actual variance

For each product/location/period: `theoretical_usage = approved_sales_depletion + approved_production_depletion + approved_waste + approved_transfers_out - approved_transfers_in`. `variance = actual_usage - theoretical_usage`. The UI must show quantity, value, percentage, data freshness and excluded/unposted transactions. A variance is an investigation signal, not automatic proof of theft or error.

### 21.2 Purchase-to-pay matching

`PO match` compares approved PO quantity/price; `receipt match` compares accepted goods receipt quantity; `invoice match` compares invoice quantity/price/tax. Tolerance is configured by organisation, supplier, currency and product risk. A mismatch outside tolerance creates an exception; it may not be auto-posted without authorised approval. Credit notes reduce supplier liability and inventory/cost only through a traceable reversal/adjustment.

### 21.3 Lot, expiry and recall

Lot consumption follows configured FIFO/FEFO policy and records the lot actually issued where operationally possible. A recalled/blocked lot cannot be issued, transferred, produced or sold through an integrated flow. Recall scope includes all descendant sub-recipes, recipes, menus, production batches and locations; closure requires action evidence and authorised sign-off.

### 21.4 Workforce and labour cost

Scheduled labour is an estimate. Actual labour cost uses approved time entries multiplied by the applicable pay-rate rule, premiums and employer-cost configuration. Schedules must warn—not silently repair—availability, rest-period, certification and overtime conflicts. Payroll calculations and payment execution remain the responsibility of an integrated payroll/payment provider unless explicitly brought into regulated scope.

### 21.5 Forecasting and recommendations

Demand, prep and order recommendations use a versioned forecast model, sales/event history, lead time, par, on-hand/reserved stock, open orders and shelf-life constraints. The system must expose assumptions, data period, confidence/range and override reason. Recommendations are never binding purchase orders or staffing decisions without authorised human action.

---

## 22. Shared Policy, Approval and Segregation-of-Duties Rules

1. Approval routing is evaluated from a versioned policy using entity, scope, department, cost centre, category, amount, risk, emergency status and actor attributes. Reporting hierarchy alone may not determine approval rights.
2. A requester cannot approve their own requisition, PO, invoice, leave, expense, compensation change or regulated recipe publication. Any permitted exception needs explicit policy, reason and audit event.
3. Supplier bank-detail maintenance, payment release, payroll preparation and payroll final approval must be separated according to configured SOD rules.
4. Delegation is time-bound, scoped, revocable, excludes prohibited conflicts and records both delegator and delegate in the decision history.
5. Emergency safety actions may bypass a normal approval sequence only through an emergency policy; post-action review, evidence and escalation remain mandatory.
6. Labour cost uses approved time/attendance data, not scheduled shifts alone. Employee-level pay data is never exposed in culinary or procurement views; those views receive only authorised aggregated cost.

---

*End of Document 3: Business Rules & Calculations*
