/**
 * Reconcile the cost engine against the venue's own COGS V5 workbook.
 *
 * Everything verified so far has been checked against data I generated myself,
 * which is circular. This runs the SHIPPED engine — imported, not
 * reimplemented — over the real catalogue and diffs the result against the
 * workbook's own computed figures. Any divergence is a genuine defect in the
 * formulas, in how the sheets were read, or in the source data.
 *
 * Run: pnpm --filter web reconcile
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  calculateLineCost,
  calculateRecipeTotalCost,
  calculateTotalCog,
  calculateFoodCostPercent,
  toDecimal,
} from "@/engine/cost-engine";

const DATA = resolve(
  process.env.COGS_JSON ??
    "/private/tmp/claude-501/-Users-yvesdelafontaine-Documents-GITHUB-stocktake-app/" +
      "ddf41b94-7403-4987-9bbb-8bb2be06f9f9/scratchpad/cogs/extracted.json",
);

interface Line {
  ingredient: string;
  qty: number | null;
  unit: string;
  costPerUnit: number | null;
  lineTotal: number | null;
}
interface Dish {
  name: string;
  section: string;
  menuPrice: number | null;
  statedCostPercent: number | null;
  statedIngredientCost: number | null;
  statedWasteAllowance: number | null;
  statedTotalCost: number | null;
  lines: Line[];
}

const data = JSON.parse(readFileSync(DATA, "utf8")) as {
  params: { wastePercent: number };
  dishes: Dish[];
};

/** Money agrees if it is within one rupiah — below that is display rounding. */
const MONEY_TOL = 1;
/** Percentages are compared in percentage points. */
const PCT_TOL = 0.05;

interface Finding {
  dish: string;
  field: string;
  mine: number;
  theirs: number;
  delta: number;
}

const findings: Finding[] = [];
const skipped: string[] = [];
let checkedDishes = 0;
let checkedLines = 0;
let lineMismatches = 0;

for (const dish of data.dishes) {
  const usable = dish.lines.filter(
    (l) => l.qty !== null && l.costPerUnit !== null,
  );
  if (usable.length === 0 || dish.statedIngredientCost === null) {
    skipped.push(dish.name);
    continue;
  }
  checkedDishes++;

  // --- line level -----------------------------------------------------------
  // The sheet applies no trim at line level: waste is the 4% taken on the dish
  // total. So refPercent is 0 and lineCost is simply qty * cost.
  const results = usable.map((l) => {
    const { lineCost } = calculateLineCost(l.qty!, 0, l.costPerUnit!);
    checkedLines++;
    if (
      l.lineTotal !== null &&
      lineCost.minus(l.lineTotal).abs().greaterThan(MONEY_TOL)
    ) {
      lineMismatches++;
      findings.push({
        dish: `${dish.name} / ${l.ingredient}`,
        field: "line total",
        mine: lineCost.toNumber(),
        theirs: l.lineTotal,
        delta: lineCost.minus(l.lineTotal).toNumber(),
      });
    }
    return { lineCost };
  });

  // --- ingredient cost ------------------------------------------------------
  const total = calculateRecipeTotalCost(results);
  if (total.minus(dish.statedIngredientCost).abs().greaterThan(MONEY_TOL)) {
    findings.push({
      dish: dish.name,
      field: "ingredient cost",
      mine: total.toNumber(),
      theirs: dish.statedIngredientCost,
      delta: total.minus(dish.statedIngredientCost).toNumber(),
    });
  }

  // --- cost including the 4% buffer ----------------------------------------
  const cog = calculateTotalCog(total, data.params.wastePercent, 0);
  if (
    dish.statedTotalCost !== null &&
    cog.minus(dish.statedTotalCost).abs().greaterThan(MONEY_TOL)
  ) {
    findings.push({
      dish: dish.name,
      field: "total cost incl. waste",
      mine: cog.toNumber(),
      theirs: dish.statedTotalCost,
      delta: cog.minus(dish.statedTotalCost).toNumber(),
    });
  }

  // --- food cost % ----------------------------------------------------------
  if (dish.menuPrice && dish.statedCostPercent !== null) {
    const pct = calculateFoodCostPercent(cog, dish.menuPrice);
    const theirs = toDecimal(dish.statedCostPercent).times(100); // stored 0-1
    if (pct.minus(theirs).abs().greaterThan(PCT_TOL)) {
      findings.push({
        dish: dish.name,
        field: "food cost %",
        mine: pct.toNumber(),
        theirs: theirs.toNumber(),
        delta: pct.minus(theirs).toNumber(),
      });
    }
  }
}

// ── Report ──────────────────────────────────────────────────────────────────

const fmt = (n: number) =>
  n.toLocaleString("en-US", { maximumFractionDigits: 2 });

console.log("CulinaryCoreOS — cost engine vs. COGS V5 workbook\n");
console.log(`dishes reconciled     : ${checkedDishes}`);
console.log(`ingredient lines      : ${checkedLines}`);
console.log(`line mismatches       : ${lineMismatches}`);
console.log(`dishes skipped        : ${skipped.length}` +
  (skipped.length ? ` (no lines or no stated cost)` : ""));
console.log(`total divergences     : ${findings.length}\n`);

const byField = new Map<string, Finding[]>();
for (const f of findings) {
  if (!byField.has(f.field)) byField.set(f.field, []);
  byField.get(f.field)!.push(f);
}

if (findings.length === 0) {
  console.log("No divergences. The engine reproduces the workbook exactly.");
} else {
  for (const [field, list] of byField) {
    list.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
    console.log(`── ${field} — ${list.length} divergence(s), worst first`);
    for (const f of list.slice(0, 8)) {
      console.log(
        `   ${f.dish.slice(0, 46).padEnd(46)} ` +
          `mine ${fmt(f.mine).padStart(12)}  theirs ${fmt(f.theirs).padStart(12)}` +
          `  Δ ${fmt(f.delta)}`,
      );
    }
    if (list.length > 8) console.log(`   … and ${list.length - 8} more`);
    console.log();
  }
}

if (skipped.length) {
  console.log(`skipped: ${skipped.slice(0, 6).join(", ")}` +
    (skipped.length > 6 ? ` … +${skipped.length - 6}` : ""));
}

// Non-zero exit on divergence so this can gate a build.
process.exit(findings.length === 0 ? 0 : 1);
