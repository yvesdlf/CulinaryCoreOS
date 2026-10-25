// ---------------------------------------------------------------------------
// Which allergens this venue must declare
// ---------------------------------------------------------------------------
// The profile is the venue's, the substances are the food's, and the mapping
// between them is `allergen_declarations` (0119). None of it is computed
// here: the EU says "crustaceans" where the United States says "crustacean
// shellfish", and the written name is the legally meaningful text — a second
// copy of that mapping in TypeScript is a second copy that can be wrong about
// what a label must say.
// ---------------------------------------------------------------------------

import { requireSupabase } from "@/lib/supabase";
import { fail } from "./_shared";

export interface DeclaredAllergen {
  substanceId: string;
  substanceName: string;
  /** Whether this venue's profile requires it declared. */
  declared: boolean;
  /** The wording the profile requires. Null where it is not declarable. */
  declaredAs: string | null;
  /**
   * The declaration is wider than the record supports.
   *
   * Only gluten does this today: the record says a cereal containing gluten
   * and the United States declares wheat, and nobody wrote down which cereal.
   */
  overInclusive: boolean;
  overInclusiveNote: string | null;
  /** False where the registry has never heard of it — kept, never dropped. */
  recognised: boolean;
}

export async function fetchVenueProfile(): Promise<string> {
  const { data, error } = await requireSupabase()
    .from("organizations")
    .select("allergen_profile_code")
    .limit(1)
    .maybeSingle();
  if (error) fail("fetchVenueProfile", error);
  // The EU set is the default in the schema and the right fallback here: it
  // is the longer list, so a venue whose profile cannot be read declares
  // more rather than less.
  return ((data as any)?.allergen_profile_code as string) ?? "EU_FIC";
}

export async function allergensUnderProfile(
  profile: string,
  substances: string[],
): Promise<DeclaredAllergen[]> {
  if (substances.length === 0) return [];
  const { data, error } = await requireSupabase().rpc("allergens_under_profile", {
    p_profile: profile,
    p_substances: substances,
  });
  if (error) fail("allergensUnderProfile", error);
  return (data ?? []).map((r: any) => ({
    substanceId: r.substance_id,
    substanceName: r.substance_name,
    declared: Boolean(r.declared),
    declaredAs: r.declared_as ?? null,
    overInclusive: Boolean(r.over_inclusive),
    overInclusiveNote: r.over_inclusive_note ?? null,
    recognised: Boolean(r.recognised),
  }));
}
