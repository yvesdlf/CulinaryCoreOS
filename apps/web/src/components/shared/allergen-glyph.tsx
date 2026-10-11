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

import { allergenIcon } from "@/lib/allergen-icons";

export function AllergenGlyph({
  id,
  className,
}: {
  /** `AllergenDefinition.id`. An unknown one gets the warning triangle. */
  id: string;
  className?: string;
}) {
  const Icon = allergenIcon(id);
  return <Icon className={className} aria-hidden="true" />;
}
