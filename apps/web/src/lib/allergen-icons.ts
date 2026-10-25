// ---------------------------------------------------------------------------
// The glyph beside an allergen code
// ---------------------------------------------------------------------------
// Split out of `lib/allergens.ts`, which carried the icon as a field on
// `AllergenDefinition` and therefore imported Lucide components as values.
//
// That one import reached much further than it looked. `nutrition-engine.ts`
// and `allergen-breakdown.ts` both import the allergen registry, `cascade.ts`
// imports the nutrition engine, and `deletion.ts` imports the cascade — so an
// icon library was being pulled into four engine modules whose whole point is
// that they are pure. `AGENTS.md` is explicit: `engine/` is business logic
// with no React, no Supabase and no I/O.
//
// It surfaced on 2026-10-11 as `react.createContext is not a function`: the
// unit tests run with `environment: "node"`, Node resolved Lucide's CommonJS
// build, and its `require("react")` came back without `createContext`. Four
// suites stopped loading. The application was never affected — Vite resolves
// the ESM build and the icons render — which is exactly why this was worth
// fixing at the source rather than teaching the test runner to cope. The
// import should not have been there.
//
// So: the registry keeps what is legally meaningful — the name, the code, the
// aliases — and the picture lives here, where only a component imports it.
//
// Nothing about the rule changes. Per the Platform Standards Manual Appendix G
// and `AGENTS.md` §8, a code or icon never replaces the written allergen name,
// and peanuts and tree nuts still share the Nut glyph on purpose: they are
// legally distinct allergens, PNT and NUT carry that distinction, and that is
// precisely why an icon may never stand alone.
// ---------------------------------------------------------------------------

import type { LucideIcon } from "lucide-react";
import {
  Leaf, Wheat, Shrimp, Egg, Fish, Flower, Milk, Shell,
  Droplet, Nut, CircleDot, Bean, Wind, TriangleAlert,
} from "lucide-react";

/** Keyed by `AllergenDefinition.id`, which is the stable identifier. */
const ICONS: Record<string, LucideIcon> = {
  CELERY: Leaf,
  GLUTEN_CEREALS: Wheat,
  CRUSTACEANS: Shrimp,
  EGGS: Egg,
  FISH: Fish,
  LUPIN: Flower,
  MILK: Milk,
  MOLLUSCS: Shell,
  MUSTARD: Droplet,
  PEANUTS: Nut,
  SESAME: CircleDot,
  SOYBEANS: Bean,
  SULPHITES: Wind,
  TREE_NUTS: Nut,
};

/**
 * The glyph for an allergen, or the warning triangle.
 *
 * The fallback is the same one an unmapped declaration already gets, and it
 * is the honest answer for both cases: something is declared here that this
 * build has no picture for. It is never a reason to show nothing — the
 * registry's second rule is that an allergen we cannot map is still shown.
 */
export function allergenIcon(id: string | null | undefined): LucideIcon {
  return (id && ICONS[id]) || TriangleAlert;
}
