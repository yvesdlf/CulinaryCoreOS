// ---------------------------------------------------------------------------
// Translation, without a library
// ---------------------------------------------------------------------------
// Two languages, both left-to-right, with no gendered agreement and no case
// system between them. The whole of what a library would give us here is a
// lookup, an interpolation and a plural rule — and i18next is 40 kB to do
// that, on a tablet in a kitchen over hotel wifi.
//
// The rules that actually matter are the ones below, and they are the ones a
// library would not enforce anyway:
//
//   A missing translation falls back to English and says so in development.
//   Silently showing the key — `portal.home.greeting` — on a screen somebody
//   is using is worse than showing English, and silently showing English in
//   development is how a page ships half-translated without anybody noticing.
//
//   Plurals are per language, not per string. English has two forms and
//   Indonesian has one, and writing "1 shift(s)" to avoid the problem is a
//   decision to look broken in both.
//
//   Interpolation never concatenates. "You have {count} shifts" has to be one
//   string the translator can reorder, because word order is the first thing
//   that differs and a sentence assembled from fragments cannot be rearranged.
// ---------------------------------------------------------------------------

export const LOCALES = ["en", "id"] as const;
export type Locale = (typeof LOCALES)[number];

export const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  // In the language itself. A language list in the reader's *current*
  // language is useless to the person who cannot read it.
  id: "Bahasa Indonesia",
};

/** One entry: a string, or the forms a count needs. */
export type Phrase = string | { one: string; other: string };

export type Dictionary = Record<string, Phrase>;

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/**
 * Which form a count takes.
 *
 * English distinguishes one from everything else — including zero, which
 * takes the plural: "0 shifts". Indonesian does not inflect for number at
 * all, so every count takes the same form and `other` is the only one its
 * dictionary needs to carry.
 */
function pluralForm(locale: Locale, count: number): "one" | "other" {
  if (locale === "id") return "other";
  return Math.abs(count) === 1 ? "one" : "other";
}

function interpolate(template: string, vars: Record<string, unknown>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  );
}

export interface TranslateOptions {
  /** Picks the plural form, and is available as {count}. */
  count?: number;
  [key: string]: unknown;
}

/**
 * Look a phrase up.
 *
 * `missing` is called for anything the active dictionary does not carry, so
 * the caller decides what a gap means — a warning while developing, silence
 * in a kitchen.
 */
export function translate(
  dictionaries: Partial<Record<Locale, Dictionary>>,
  locale: Locale,
  fallback: Locale,
  key: string,
  options: TranslateOptions = {},
  missing?: (key: string, locale: Locale) => void,
): string {
  const found = dictionaries[locale]?.[key];
  const phrase = found ?? dictionaries[fallback]?.[key];

  if (found === undefined && locale !== fallback) missing?.(key, locale);

  if (phrase === undefined) {
    /*
     * The key itself, which is deliberately the worst-looking outcome: it is
     * the only one somebody notices. Returning an empty string loses the
     * sentence silently, and returning a prettified key invents wording in a
     * product where the wording is the point.
     */
    missing?.(key, fallback);
    return key;
  }

  const template =
    typeof phrase === "string"
      ? phrase
      : phrase[pluralForm(found === undefined ? fallback : locale, options.count ?? 0)];

  return interpolate(template, options as Record<string, unknown>);
}

/**
 * What the browser asks for, narrowed to what exists.
 *
 * `navigator.languages` is ordered by preference and carries regions —
 * `id-ID`, `en-GB` — so the base tag is what gets matched. A browser asking
 * for a language nothing is written in gets the fallback rather than a
 * half-empty page.
 */
export function preferredLocale(
  requested: readonly string[],
  fallback: Locale = "en",
): Locale {
  for (const tag of requested) {
    const base = tag.split("-")[0]?.toLowerCase();
    if (isLocale(base)) return base;
  }
  return fallback;
}
