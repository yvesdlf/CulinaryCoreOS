// ---------------------------------------------------------------------------
// The glyph for one allergen
// ---------------------------------------------------------------------------
// A component rather than seven call sites each resolving the icon for
// themselves, because `aria-hidden` belongs with it and the one rule that
// must never slip is that the glyph is decoration: per Appendix G and
// `AGENTS.md` §8, a code or icon never replaces the written allergen name.
// Keeping the attribute here means a new call site cannot forget it.
//
// Exists because the icon stopped being a field on `AllergenDefinition` —
// see `lib/allergen-icons.ts` for what that field was costing.
// ---------------------------------------------------------------------------

import { createElement } from "react";

import { allergenIcon } from "@/lib/allergen-icons";

export function AllergenGlyph({
  id,
  className,
}: {
  /** `AllergenDefinition.id`. An unknown one gets the warning triangle. */
  id: string;
  className?: string;
}) {
  /*
   * `createElement` rather than `const Icon = allergenIcon(id)` and `<Icon/>`.
   *
   * That form reads better and `react-hooks` refuses it: "Cannot create
   * components during render". The rule matches a capitalised binding
   * assigned inside a component and cannot tell that this one returns an
   * icon that already exists at module scope rather than defining a new one.
   * It is a false positive, but the rule is an error here for good reason
   * (`AGENTS.md` names the `useMemo` it caught on the housekeeping board),
   * and this says exactly the same thing without the shape it objects to.
   */
  return createElement(allergenIcon(id), { className, "aria-hidden": true });
}
