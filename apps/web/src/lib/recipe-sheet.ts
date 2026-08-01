// ---------------------------------------------------------------------------
// Standalone recipe sheet
// ---------------------------------------------------------------------------
// The exported form of the print view: one self-contained HTML file per
// recipe, with its styles inline and no reference to anything outside itself.
//
// Self-contained matters more than it sounds. These files get emailed, copied
// to a USB stick, and opened on a kitchen office machine that is not running
// the app — a stylesheet link to localhost would render them as unformatted
// text exactly when someone needs them. HTML rather than PDF because a browser
// can print HTML to PDF and cannot be made to write one directly, and every
// machine opens HTML without being asked what is installed.
//
// The layout follows DOC4 §11.3, the same template the in-app sheet uses.
// ---------------------------------------------------------------------------

import type { Product, SubRecipe, Recipe } from "@ccos/shared";
import { allergenBreakdown } from "@/engine/allergen-breakdown";
import { resolveAllergens } from "@/lib/allergens";
import { formatCurrency, formatPercent, formatNumber } from "@/lib/format";

/**
 * A preparation's own sheet.
 *
 * Exported alongside the dishes because a recipe sheet's "* prepared in house
 * — see its own sheet" is a broken promise in a folder that contains only
 * dishes, and a prep pack is mostly preparations.
 */
export function renderSubRecipeSheet(sub: SubRecipe, sources: Sources): string {
  const productById = new Map(sources.products.map((p) => [p.id, p]));
  const subById = new Map(sources.subRecipes.map((s) => [s.id, s]));
  const nameOf = (l: SubRecipe["ingredientLines"][number]) =>
    (l.productId ? productById.get(l.productId)?.name : subById.get(l.subRecipeId ?? "")?.name) ??
    "Unknown ingredient";

  const allergens = resolveAllergens(sub.allergens);

  return page(
    sub.name,
    `<h1>${esc(sub.name)}</h1>
<p class="meta">Preparation · ${esc(sub.category)} · ${esc(sub.status)} · Batch ${esc(
      formatNumber(sub.batchYield.qty),
    )} ${esc(sub.batchYield.unit)}${
      sub.preparation.prepMinutes !== null ? ` · Prep ${sub.preparation.prepMinutes} min` : ""
    }${
      sub.preparation.cookMinutes !== null ? ` · Cook ${sub.preparation.cookMinutes} min` : ""
    }</p>
${
  allergens.length
    ? `<h2>Allergens carried into every dish using this</h2>
<p>${allergens
        .map((r) => (r.known ? `${esc(r.definition.name)} (${esc(r.definition.code)})` : esc(r.raw)))
        .join(" · ")}</p>`
    : ""
}
<h2>Ingredients</h2>
<table>
  <thead><tr><th class="num">Quantity</th><th>Ingredient</th><th class="num">Cost</th></tr></thead>
  <tbody>
${sub.ingredientLines
  .map(
    (l) => `    <tr><td class="num">${esc(formatNumber(l.nettQty))} ${esc(l.nettUnit)}</td>` +
      `<td>${esc(nameOf(l))}</td><td class="num">${esc(formatCurrency(l.lineCost))}</td></tr>`,
  )
  .join("\n")}
  </tbody>
</table>

<h2>Method</h2>
${
  sub.preparation.method.length === 0
    ? '<p class="note">Not written yet.</p>'
    : `<ol>${sub.preparation.method.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>`
}

<h2>Batch cost</h2>
<div class="cols">
  <dl>
    <div><dt>Ingredients</dt><dd>${esc(formatCurrency(sub.totalCost))}</dd></div>
    <div><dt>Batch yield</dt><dd>${esc(formatNumber(sub.batchYield.qty))} ${esc(sub.batchYield.unit)}</dd></div>
    <div><dt>Cost per unit</dt><dd>${esc(formatCurrency(sub.costPerUnit))}</dd></div>
  </dl>
</div>`,
  );
}

/** Escape for HTML. A dish called "Fish & Chips" must not become markup. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/*
 * Print-first, on paper that is often photocopied. Rules rather than tints,
 * a serif-free face at a size that survives a fax-quality copier, and no
 * colour carrying meaning.
 */
const STYLES = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    max-width: 46rem; margin: 0 auto; padding: 2rem 1.5rem;
    color: #111; background: #fff; line-height: 1.5;
  }
  h1 { font-size: 1.75rem; margin: 0 0 .25rem; }
  h2 {
    font-size: .8rem; text-transform: uppercase; letter-spacing: .06em;
    margin: 1.75rem 0 .5rem; padding-bottom: .25rem; border-bottom: 1px solid #111;
  }
  .meta { color: #555; margin: 0 0 1rem; font-size: .9rem; }
  table { width: 100%; border-collapse: collapse; font-size: .9rem; }
  th, td { text-align: left; padding: .35rem .25rem; border-bottom: 1px solid #ddd; }
  th { font-weight: 600; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 2rem; }
  dl { margin: 0; font-size: .9rem; }
  dl > div { display: flex; justify-content: space-between; gap: 1rem; padding: .15rem 0; }
  dt { color: #555; }
  dd { margin: 0; font-variant-numeric: tabular-nums; }
  .warn { border: 1px solid #111; padding: .5rem .75rem; font-size: .8rem; margin-top: .75rem; }
  .note { color: #555; font-size: .8rem; }
  footer { margin-top: 2rem; padding-top: .5rem; border-top: 1px solid #ddd;
           color: #555; font-size: .75rem; }
  ol { padding-left: 1.25rem; font-size: .9rem; }
  ol li { padding: .2rem 0; }
  ul.index { list-style: none; padding: 0; }
  ul.index li { padding: .35rem 0; border-bottom: 1px solid #ddd; }
  @media print {
    body { padding: 0; max-width: none; }
    .cols { grid-template-columns: 1fr; }
    @page { margin: 14mm; }
  }
`;

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${STYLES}</style>
</head>
<body>
${body}
<footer>CulinaryCoreOS · costs as at ${new Date().toLocaleDateString("id-ID")}</footer>
</body>
</html>`;
}

interface Sources {
  products: Product[];
  subRecipes: SubRecipe[];
}

interface IndexOptions {
  title: string;
  links: { href: string; label: string }[];
}

/**
 * Render one recipe, or the collection's index when `recipe` is null.
 *
 * The index exists so an exported folder is navigable rather than a pile of
 * files someone has to open one at a time to find the dish they wanted.
 */
export function renderRecipeSheet(
  recipe: Recipe | null,
  sources: Sources,
  index?: IndexOptions,
): string {
  if (!recipe && index) {
    return page(
      index.title,
      `<h1>${esc(index.title)}</h1>
<p class="meta">${index.links.length} recipe sheets</p>
<ul class="index">
${index.links
  .map((l) => `  <li><a href="${esc(l.href)}">${esc(l.label)}</a></li>`)
  .join("\n")}
</ul>`,
    );
  }
  if (!recipe) return page("Empty", "<p>Nothing to show.</p>");

  const productById = new Map(sources.products.map((p) => [p.id, p]));
  const subById = new Map(sources.subRecipes.map((s) => [s.id, s]));
  const nameOf = (l: Recipe["ingredientLines"][number]) =>
    (l.productId ? productById.get(l.productId)?.name : subById.get(l.subRecipeId ?? "")?.name) ??
    "Unknown ingredient";

  const allergens = resolveAllergens(recipe.allergens);
  const breakdown = allergenBreakdown(recipe.ingredientLines, sources);
  const unverified = breakdown.filter((b) => b.needsReview);

  const allergenList = allergens.length
    ? `<p>${allergens
        .map((r) =>
          r.known
            ? `${esc(r.definition.name)} (${esc(r.definition.code)})`
            : esc(r.raw),
        )
        .join(" · ")}</p>`
    : `<p class="note">None declared. That is not the same as having been checked.</p>`;

  const breakdownRows = breakdown
    .map(
      (b) => `    <tr>
      <td>${esc(b.name)}${b.kind === "sub-recipe" ? " (preparation)" : ""}${
        b.via.length
          ? `<div class="note">from ${esc(b.via.map((v) => v.name).join(", "))}</div>`
          : ""
      }</td>
      <td>${esc(
        resolveAllergens(b.allergens)
          .map((r) => (r.known ? r.definition.name : r.raw))
          .join(", ") || "--",
      )}${
        b.needsReview
          ? '<div class="note">Not verified against the product.</div>'
          : ""
      }</td>
    </tr>`,
    )
    .join("\n");

  const lineRows = recipe.ingredientLines
    .map(
      (l) => `    <tr>
      <td class="num">${esc(formatNumber(l.nettQty))} ${esc(l.nettUnit)}</td>
      <td>${esc(nameOf(l))}${l.subRecipeId ? "*" : ""}</td>
      <td class="num">${esc(formatCurrency(l.lineCost))}</td>
    </tr>`,
    )
    .join("\n");

  const cost = [
    ["Ingredients", formatCurrency(recipe.pricing.totalCost)],
    ["Waste", formatCurrency(recipe.pricing.wasteAmount)],
    ["Inflation", formatCurrency(recipe.pricing.inflationAmount)],
    ["Total cost", formatCurrency(recipe.pricing.totalCog)],
    ["Menu price (excl. tax)", formatCurrency(recipe.pricing.menuPrice)],
    ["Guest price (incl. tax)", formatCurrency(recipe.pricing.priceInclTax)],
    ["Food cost", formatPercent(recipe.pricing.foodCostPercent)],
  ]
    .map(([k, v]) => `    <div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`)
    .join("\n");

  return page(
    recipe.name,
    `<h1>${esc(recipe.name)}</h1>
<p class="meta">${esc(recipe.category)} · ${esc(recipe.status)} · Yields ${esc(
      formatNumber(recipe.portion.yieldQty),
    )} ${esc(recipe.portion.yieldUnit)}${
      recipe.preparation.prepMinutes !== null
        ? ` · Prep ${recipe.preparation.prepMinutes} min`
        : ""
    }${
      recipe.preparation.cookMinutes !== null
        ? ` · Cook ${recipe.preparation.cookMinutes} min`
        : ""
    }</p>

<h2>Allergens</h2>
${allergenList}
${
  breakdown.length
    ? `<table>
  <thead><tr><th>Ingredient</th><th>Contributes</th></tr></thead>
  <tbody>
${breakdownRows}
  </tbody>
</table>`
    : ""
}
${
  unverified.length
    ? `<p class="warn">This sheet is not an allergen declaration while ${
        unverified.length === 1
          ? "an ingredient has"
          : `${unverified.length} ingredients have`
      } an unverified list.</p>`
    : ""
}

<h2>Ingredients</h2>
<table>
  <thead><tr><th class="num">Quantity</th><th>Ingredient</th><th class="num">Cost</th></tr></thead>
  <tbody>
${lineRows}
  </tbody>
</table>
${
  recipe.ingredientLines.some((l) => l.subRecipeId)
    ? '<p class="note">* prepared in house — see its own sheet for the method.</p>'
    : ""
}

<h2>Method</h2>
${
  recipe.preparation.method.length === 0
    ? '<p class="note">Not written yet.</p>'
    : `<ol>${recipe.preparation.method
        .map((step) => `<li>${esc(step)}</li>`)
        .join("")}</ol>`
}

<h2>Cost</h2>
<div class="cols">
  <dl>
${cost}
  </dl>
</div>`,
  );
}
