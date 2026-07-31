/**
 * Re-cost the whole catalogue with the shipped engine and write it back.
 *
 * The COGS V5 import wrote ingredient lines, menu prices and product costs,
 * but none of the derived figures — so all 115 dishes read as costing zero and
 * showing 0% food cost, which is the one number the venue actually looks at.
 *
 * This runs `recalculateAll` (the same code path a price edit takes) and
 * persists through `apply_cascade`, so there is exactly one implementation of
 * the costing rules. Deriving these in SQL would have been quicker and would
 * have created a second one to keep in sync.
 *
 * Safe to re-run: the calculation is a pure function of the lines.
 *
 * Run: pnpm --filter web recost
 */
import { createClient } from "@supabase/supabase-js";
import { recalculateAll } from "@/engine/cascade";
import { setSupabaseClient } from "@/lib/supabase";
import { fetchAll, persistCascade } from "@/data/repository";

/**
 * Signs in as a real member rather than using the service-role key.
 *
 * Migration 0004 grants DML to `authenticated` only, so service_role cannot
 * read these tables at all — deliberately, since it also bypasses RLS. This
 * script therefore goes through the same tenant policies the app does and can
 * only touch the organisation the account belongs to.
 */
const url = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const anonKey = process.env.SUPABASE_ANON_KEY;
const email = process.env.CCOS_EMAIL ?? "demo@culinarycore.local";
const password = process.env.CCOS_PASSWORD;

if (!anonKey || !password) {
  console.error(
    "SUPABASE_ANON_KEY and CCOS_PASSWORD are required.\n" +
      "  export SUPABASE_ANON_KEY=$(supabase status -o json | jq -r .ANON_KEY)\n" +
      "  export CCOS_PASSWORD=...   # the account named by CCOS_EMAIL",
  );
  process.exit(1);
}

const client = createClient(url, anonKey, { auth: { persistSession: false } });
const { error: authError } = await client.auth.signInWithPassword({
  email,
  password,
});
if (authError) {
  console.error(`sign-in failed for ${email}: ${authError.message}`);
  process.exit(1);
}
setSupabaseClient(client);

const before = await fetchAll();
console.log(
  `loaded ${before.products.length} products, ` +
    `${before.subRecipes.length} sub-recipes, ${before.recipes.length} recipes`,
);

const out = recalculateAll(before);

// Report before writing, so a wrong result is visible rather than committed
// quietly. A dish costing zero after this has unresolved or zero-priced lines.
const zeroCost = out.recipes.filter((r) => Number(r.pricing.totalCost) === 0);
const priced = out.recipes.filter((r) => Number(r.pricing.menuPrice) > 0);
const inBand = priced.filter(
  (r) => r.pricing.foodCostPercent >= 20 && r.pricing.foodCostPercent <= 35,
);

console.log(`\nrecipes with a cost   : ${out.recipes.length - zeroCost.length}`);
console.log(`recipes costing zero  : ${zeroCost.length}`);
console.log(`priced dishes         : ${priced.length}`);
console.log(`food cost in 20-35%   : ${inBand.length}`);

if (zeroCost.length) {
  console.log(
    `\nzero-cost: ${zeroCost.slice(0, 8).map((r) => r.name).join(", ")}` +
      (zeroCost.length > 8 ? ` … +${zeroCost.length - 8}` : ""),
  );
}

if (process.env.DRY_RUN) {
  console.log("\nDRY_RUN set — nothing written.");
  process.exit(0);
}

// Chunked: one JSON payload carrying 227 entities and every ingredient line is
// large enough to be worth not finding out about in production.
const CHUNK = 40;
for (let i = 0; i < out.subRecipes.length; i += CHUNK) {
  await persistCascade(out.subRecipes.slice(i, i + CHUNK), []);
}
for (let i = 0; i < out.recipes.length; i += CHUNK) {
  await persistCascade([], out.recipes.slice(i, i + CHUNK));
}

console.log("\nwritten.");
