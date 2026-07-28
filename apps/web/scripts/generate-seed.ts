// ---------------------------------------------------------------------------
// Generate supabase/seed.sql from the in-repo mock catalogue.
// ---------------------------------------------------------------------------
// Run: pnpm --filter web seed:generate
//
// The mock data uses readable ids ("prod-016"); Postgres uses uuid primary
// keys. Rather than inventing random uuids at seed time — which would change on
// every run and break the recipe/sub-recipe references — each slug is mapped to
// a deterministic uuid v5 under a fixed namespace. Re-running the generator
// therefore produces byte-identical SQL.
// ---------------------------------------------------------------------------

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { v5 as uuidv5 } from "uuid";
import { MOCK_PRODUCTS } from "../src/data/mock-products";
import { MOCK_SUB_RECIPES } from "../src/data/mock-sub-recipes";
import { MOCK_RECIPES } from "../src/data/mock-recipes";
import type { IngredientLine, NutritionPer100g } from "@ccos/shared";

/** Arbitrary but fixed, so slug -> uuid is stable across runs and machines. */
const NAMESPACE = "1b671a64-40d5-491e-99b0-da01ff1f3341";
const id = (slug: string) => uuidv5(slug, NAMESPACE);

const q = (v: string | null | undefined) =>
  v === null || v === undefined ? "null" : `'${v.replace(/'/g, "''")}'`;
const n = (v: number | string | null | undefined) =>
  v === null || v === undefined || v === "" ? "null" : String(v);
const arr = (v: string[]) =>
  v.length === 0 ? "'{}'" : `'{${v.map((s) => `"${s}"`).join(",")}}'`;

const nutritionCols = [
  "fat_g", "carbs_g", "protein_g", "vit_a_mg", "vit_c_mg",
  "calcium_mg", "iron_mg", "sodium_mg", "kcal",
];
const nutritionVals = (x: NutritionPer100g) =>
  [x.fatG, x.carbsG, x.proteinG, x.vitAMg, x.vitCMg,
   x.calciumMg, x.ironMg, x.sodiumMg, x.kcal].map(n);

const lineCols = [
  "line_number", "product_id", "nett_qty", "nett_unit", "ref_percent",
  "gross_qty", "gross_unit", "cost_per_unit", "line_cost",
];
function lineVals(l: IngredientLine): string[] {
  return [
    n(l.lineNumber),
    l.productId ? q(id(l.productId)) : "null",
    n(l.nettQty), q(l.nettUnit), n(l.refPercent),
    n(l.grossQty), q(l.grossUnit), n(l.costPerUnit), n(l.lineCost),
  ];
}

/** Fixed so the org, the demo user and every row reference each other stably. */
const DEMO_ORG_ID = id("org:demo");
const DEMO_USER_ID = "11111111-1111-4111-8111-111111111111";
const DEMO_EMAIL = "demo@culinarycore.local";
const DEMO_PASSWORD = "demo-password-123";

const out: string[] = [
  "-- CulinaryCoreOS seed data — GENERATED, do not edit by hand.",
  "-- Regenerate with: pnpm --filter web seed:generate",
  "--",
  "-- Idempotent: truncating first means `supabase db reset` and a re-run of",
  "-- this file both land on the same state.",
  "--",
  "-- LOCAL DEVELOPMENT ONLY. This creates a user with a known password so the",
  "-- seeded catalogue can be signed into. Never load it into a hosted project.",
  "",
  "truncate table recipe_lines, sub_recipe_lines, recipes, sub_recipes, products cascade;",
  "",
  "-- Demo organization -------------------------------------------------------",
  "insert into organizations (id, name, slug) values",
  `  (${q(DEMO_ORG_ID)}, 'Demo Kitchen', 'demo')`,
  "on conflict (id) do nothing;",
  "",
  "-- Demo user ---------------------------------------------------------------",
  "-- GoTrue reads these token columns as NOT NULL strings; leaving them NULL",
  "-- makes every sign-in fail with 'converting NULL to string is unsupported'.",
  "insert into auth.users (",
  "  instance_id, id, aud, role, email, encrypted_password,",
  "  email_confirmed_at, created_at, updated_at,",
  "  raw_app_meta_data, raw_user_meta_data,",
  "  confirmation_token, recovery_token, email_change_token_new,",
  "  email_change_token_current, email_change, phone_change,",
  "  phone_change_token, reauthentication_token",
  ") values (",
  "  '00000000-0000-0000-0000-000000000000',",
  `  ${q(DEMO_USER_ID)}, 'authenticated', 'authenticated', ${q(DEMO_EMAIL)},`,
  `  crypt(${q(DEMO_PASSWORD)}, gen_salt('bf')),`,
  "  now(), now(), now(),",
  `  '{"provider":"email","providers":["email"]}', '{}',`,
  "  '', '', '', '', '', '', '', ''",
  ") on conflict (id) do nothing;",
  "",
  "insert into auth.identities (",
  "  provider_id, user_id, identity_data, provider,",
  "  last_sign_in_at, created_at, updated_at",
  ") values (",
  `  ${q(DEMO_USER_ID)}, ${q(DEMO_USER_ID)},`,
  `  jsonb_build_object('sub', ${q(DEMO_USER_ID)}, 'email', ${q(DEMO_EMAIL)}, 'email_verified', true),`,
  "  'email', now(), now(), now()",
  ") on conflict (provider, provider_id) do nothing;",
  "",
  "-- handle_new_user() gave the user its own organization; drop that and put",
  "-- them in the demo org so they see the seeded catalogue.",
  "delete from organizations",
  ` where slug <> 'demo'`,
  `   and id in (select organization_id from organization_members`,
  `              where user_id = ${q(DEMO_USER_ID)});`,
  "",
  "insert into organization_members (organization_id, user_id, role) values",
  `  (${q(DEMO_ORG_ID)}, ${q(DEMO_USER_ID)}, 'OWNER')`,
  "on conflict (organization_id, user_id) do update set role = 'OWNER';",
  "",
];

// ── Products ────────────────────────────────────────────────────────────────
out.push("-- Products");
const productCols = [
  "id", "category", "supplier", "name", "brand",
  "pack_qty", "pack_unit", "units_per_pack", "units_per_pack_unit",
  "total_qty", "total_unit",
  "buying_price_per_pack", "buying_price_per_unit",
  "gross_price_per_unit", "nett_price_per_unit",
  "gross_qty", "gross_unit", "waste_qty", "waste_unit",
  "nett_qty", "nett_unit", "ref_percent", "yield_percent",
  "status", ...nutritionCols, "allergens", "org_id",
];
out.push(`insert into products (${productCols.join(", ")}) values`);
out.push(
  MOCK_PRODUCTS.map((p) =>
    "  (" + [
      q(id(p.id)), q(p.category), q(p.supplier), q(p.name), q(p.brand),
      n(p.packing.packQty), q(p.packing.packUnit),
      n(p.packing.unitsPerPack), q(p.packing.unitsPerPackUnit),
      n(p.packing.totalQty), q(p.packing.totalUnit),
      n(p.cost.buyingPricePerPack), n(p.cost.buyingPricePerUnit),
      n(p.cost.grossPricePerUnit), n(p.cost.nettPricePerUnit),
      n(p.yield_.grossQty), q(p.yield_.grossUnit),
      n(p.yield_.wasteQty), q(p.yield_.wasteUnit),
      n(p.yield_.nettQty), q(p.yield_.nettUnit),
      n(p.yield_.refPercent), n(p.yield_.yieldPercent),
      q(p.status), ...nutritionVals(p.nutrition), arr(p.allergens),
      q(DEMO_ORG_ID),
    ].join(", ") + ")",
  ).join(",\n") + ";",
);
out.push("");

// ── Sub-recipes ─────────────────────────────────────────────────────────────
out.push("-- Sub-recipes");
const subCols = [
  "id", "name", "category", "status",
  "batch_yield_qty", "batch_yield_unit",
  "total_cost", "cost_per_unit", "security_margin_percent",
  ...nutritionCols, "allergens", "version", "org_id",
];
out.push(`insert into sub_recipes (${subCols.join(", ")}) values`);
out.push(
  MOCK_SUB_RECIPES.map((s) =>
    "  (" + [
      q(id(s.id)), q(s.name), q(s.category), q(s.status),
      n(s.batchYield.qty), q(s.batchYield.unit),
      n(s.totalCost), n(s.costPerUnit), n(s.securityMarginPercent),
      ...nutritionVals(s.nutritionPer100g), arr(s.allergens), n(s.version),
      q(DEMO_ORG_ID),
    ].join(", ") + ")",
  ).join(",\n") + ";",
);
out.push("");

out.push("-- Sub-recipe lines");
const subLineRows = MOCK_SUB_RECIPES.flatMap((s) =>
  s.ingredientLines.map(
    (l) =>
      "  (" + [
        q(id(s.id)),
        ...lineVals(l),
        l.subRecipeId ? q(id(l.subRecipeId)) : "null",
      ].join(", ") + ")",
  ),
);
if (subLineRows.length) {
  out.push(
    `insert into sub_recipe_lines (sub_recipe_id, ${lineCols.join(", ")}, child_sub_recipe_id) values`,
  );
  out.push(subLineRows.join(",\n") + ";");
}
out.push("");

// ── Recipes ─────────────────────────────────────────────────────────────────
out.push("-- Recipes");
const recipeCols = [
  "id", "name", "category", "status", "yield_qty", "yield_unit",
  "price_incl_vat", "price_excl_vat", "total_cost",
  "total_cost_with_margin", "gross_contribution_margin",
  "food_cost_percent", "currency",
  ...nutritionCols,
  "gluten_free", "dairy_free", "vegetarian", "vegan",
  "nuts_free", "soy_free", "sulfites_free",
  "allergens", "version", "org_id",
];
out.push(`insert into recipes (${recipeCols.join(", ")}) values`);
out.push(
  MOCK_RECIPES.map((r) => {
    const d = r.dietaryFlags;
    return "  (" + [
      q(id(r.id)), q(r.name), q(r.category), q(r.status),
      n(r.portion.yieldQty), q(r.portion.yieldUnit),
      n(r.pricing.priceInclVat), n(r.pricing.priceExclVat),
      n(r.pricing.totalCost), n(r.pricing.totalCostWithSecurityMargin),
      n(r.pricing.grossContributionMargin), n(r.pricing.foodCostPercent),
      q(r.pricing.currency),
      ...nutritionVals(r.nutritionPerPortion),
      d.glutenFree, d.dairyFree, d.vegetarian, d.vegan,
      d.nutsFree, d.soyFree, d.sulfitesFree,
      arr(r.allergens), n(r.version), q(DEMO_ORG_ID),
    ].join(", ") + ")";
  }).join(",\n") + ";",
);
out.push("");

out.push("-- Recipe lines");
const recipeLineRows = MOCK_RECIPES.flatMap((r) =>
  r.ingredientLines.map(
    (l) =>
      "  (" + [
        q(id(r.id)),
        ...lineVals(l),
        l.subRecipeId ? q(id(l.subRecipeId)) : "null",
      ].join(", ") + ")",
  ),
);
if (recipeLineRows.length) {
  out.push(
    `insert into recipe_lines (recipe_id, ${lineCols.join(", ")}, sub_recipe_id) values`,
  );
  out.push(recipeLineRows.join(",\n") + ";");
}
out.push("");

const target = resolve(process.cwd(), "../../supabase/seed.sql");
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, out.join("\n"), "utf8");

console.log(
  `seed.sql written: ${MOCK_PRODUCTS.length} products, ` +
    `${MOCK_SUB_RECIPES.length} sub-recipes (${subLineRows.length} lines), ` +
    `${MOCK_RECIPES.length} recipes (${recipeLineRows.length} lines)`,
);
