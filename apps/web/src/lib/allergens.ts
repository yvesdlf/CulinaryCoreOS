// ---------------------------------------------------------------------------
// Regulated allergen registry — EU/UK 14 profile
// ---------------------------------------------------------------------------
// Codes, icons and canonical identifiers per the CulinaryCoreOS Platform
// Standards Manual, Appendix G (based on Annex II of EU FIC 1169/2011 and UK
// FSA guidance).
//
// Two rules from that appendix shape this module and must not be undone:
//
//  * A code or icon NEVER replaces the written allergen name. They are compact
//    aids for matrices and lists; the full name must be reachable in the same
//    view. Every badge therefore carries an accessible name and a tooltip, and
//    lists render a key.
//  * Unknown declarations are flagged, not dropped. An allergen we cannot map
//    is still shown, because silently discarding one is a safety failure.
//
// The manual specifies monochrome SVG assets for production use and notes the
// emoji here are illustrative, since rendering varies by platform. They stand
// in until the asset set exists — tracked in docs/PROGRESS.md.
// ---------------------------------------------------------------------------

export interface AllergenDefinition {
  /** Stable identifier for storage and exchange. */
  id: string;
  /** Full name — the legally meaningful text. Never omit it. */
  name: string;
  /** Compact display code, e.g. "GLU". */
  code: string;
  /** Assistive visual cue only; never the sole carrier of meaning. */
  icon: string;
  /** Asset key for the monochrome SVG that will replace the emoji. */
  assetKey: string;
  /** Scope note from the registry, shown in the tooltip. */
  note?: string;
  /** Lower-case spellings that map to this allergen. */
  aliases: string[];
}

export const EU14_ALLERGENS: AllergenDefinition[] = [
  {
    id: "EU14_CELERY", name: "Celery", code: "CEL", icon: "🌿",
    assetKey: "allergen-celery",
    note: "Includes celeriac and celery seed.",
    aliases: ["celery", "celeriac"],
  },
  {
    id: "EU14_GLUTEN_CEREALS", name: "Cereals containing gluten", code: "GLU",
    icon: "🌾", assetKey: "allergen-gluten-cereals",
    note: "Wheat, rye, barley, oats and specified hybrids.",
    aliases: ["gluten", "wheat", "rye", "barley", "oats", "cereals"],
  },
  {
    id: "EU14_CRUSTACEANS", name: "Crustaceans", code: "CRU", icon: "🦐",
    assetKey: "allergen-crustaceans",
    note: "E.g. prawn, crab, lobster, crayfish.",
    // "shellfish" is ambiguous between crustaceans and molluscs. It maps here
    // because it is the commoner intent, and the mapping is deliberately
    // visible so imported data can be corrected rather than silently assumed.
    aliases: ["crustaceans", "shellfish", "prawn", "prawns", "shrimp", "crab", "lobster"],
  },
  {
    id: "EU14_EGGS", name: "Eggs", code: "EGG", icon: "🥚",
    assetKey: "allergen-eggs", aliases: ["egg", "eggs"],
  },
  {
    id: "EU14_FISH", name: "Fish", code: "FSH", icon: "🐟",
    assetKey: "allergen-fish", aliases: ["fish"],
  },
  {
    id: "EU14_LUPIN", name: "Lupin", code: "LUP", icon: "🌼",
    assetKey: "allergen-lupin", aliases: ["lupin"],
  },
  {
    id: "EU14_MILK", name: "Milk", code: "MLK", icon: "🥛",
    assetKey: "allergen-milk",
    note: "Includes milk products; lactose alone is not equivalent.",
    aliases: ["milk", "dairy", "lactose", "cheese", "butter", "cream"],
  },
  {
    id: "EU14_MOLLUSCS", name: "Molluscs", code: "MOL", icon: "🦪",
    assetKey: "allergen-molluscs",
    note: "E.g. mussels, oysters, squid, snails.",
    aliases: ["molluscs", "mollusks", "squid", "octopus", "mussel", "oyster", "clam"],
  },
  {
    id: "EU14_MUSTARD", name: "Mustard", code: "MUS", icon: "🟡",
    assetKey: "allergen-mustard", aliases: ["mustard"],
  },
  {
    id: "EU14_PEANUTS", name: "Peanuts", code: "PNT", icon: "🥜",
    assetKey: "allergen-peanuts",
    note: "Peanut/groundnut. Not combined with tree nuts.",
    aliases: ["peanut", "peanuts", "groundnut"],
  },
  {
    id: "EU14_SESAME", name: "Sesame", code: "SES", icon: "◉",
    assetKey: "allergen-sesame", aliases: ["sesame"],
  },
  {
    id: "EU14_SOYBEANS", name: "Soybeans", code: "SOY", icon: "🫛",
    assetKey: "allergen-soybeans", aliases: ["soy", "soya", "soybean", "soybeans"],
  },
  {
    id: "EU14_SULPHITES", name: "Sulphur dioxide and sulphites", code: "SUL",
    icon: "SO₂", assetKey: "allergen-sulphites",
    note: "Declarable above 10 mg/kg or 10 mg/l expressed as SO₂.",
    aliases: ["sulphites", "sulfites", "sulphur dioxide", "sulfur dioxide", "so2"],
  },
  {
    id: "EU14_TREE_NUTS", name: "Tree nuts", code: "NUT", icon: "🌰",
    assetKey: "allergen-tree-nuts",
    note: "Almond, hazelnut, walnut, cashew, pecan, Brazil, pistachio, macadamia. Excludes peanuts.",
    aliases: ["nuts", "tree nuts", "treenuts", "almond", "hazelnut", "walnut",
              "cashew", "pecan", "pistachio", "macadamia"],
  },
];

const BY_ALIAS = new Map<string, AllergenDefinition>();
for (const a of EU14_ALLERGENS) {
  BY_ALIAS.set(a.id.toLowerCase(), a);
  BY_ALIAS.set(a.code.toLowerCase(), a);
  BY_ALIAS.set(a.name.toLowerCase(), a);
  for (const alias of a.aliases) BY_ALIAS.set(alias, a);
}

/** An allergen we could not map — surfaced rather than dropped. */
export interface UnknownAllergen {
  raw: string;
}

export type ResolvedAllergen =
  | { known: true; definition: AllergenDefinition }
  | { known: false; raw: string };

/** Map one stored value onto the registry. */
export function resolveAllergen(value: string): ResolvedAllergen {
  const def = BY_ALIAS.get(value.trim().toLowerCase());
  return def ? { known: true, definition: def } : { known: false, raw: value };
}

/**
 * Resolve a stored allergen list, de-duplicated and in registry order.
 *
 * Registry order rather than alphabetical so a matrix reads the same way every
 * time — a chef scanning several dishes should find gluten in the same place.
 * Unmapped values are appended so they stay visible.
 */
export function resolveAllergens(values: string[]): ResolvedAllergen[] {
  const known = new Set<string>();
  const unknown: string[] = [];

  for (const v of values) {
    const r = resolveAllergen(v);
    if (r.known) known.add(r.definition.id);
    else if (!unknown.includes(r.raw)) unknown.push(r.raw);
  }

  return [
    ...EU14_ALLERGENS.filter((a) => known.has(a.id)).map(
      (definition) => ({ known: true, definition }) as const,
    ),
    ...unknown.map((raw) => ({ known: false, raw }) as const),
  ];
}

/** Full names, for screen readers and any place needing the legal wording. */
export function allergenNames(values: string[]): string[] {
  return resolveAllergens(values).map((r) =>
    r.known ? r.definition.name : r.raw,
  );
}
