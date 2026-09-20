// ---------------------------------------------------------------------------
// What the assistant is actually for
// ---------------------------------------------------------------------------
// Each task is a prompt plus a parser, and both are pure. That split is the
// point: the prompt is where the model's behaviour is decided and the parser is
// where its output stops being trusted. Neither needs a network to test.
//
// Every parser here assumes the model got it wrong. Models return JSON wrapped
// in prose, in code fences, with trailing commentary, with a field renamed, or
// with a number as a string — and a parser that assumes otherwise fails on a
// Tuesday in a kitchen rather than in CI.
//
// The tasks that touch food safety hand off to safety.ts rather than deciding
// anything themselves.
// ---------------------------------------------------------------------------

import { SAFETY_PREAMBLE } from "./safety";
import type { AiRequest } from "./types";

/**
 * Pull JSON out of whatever the model actually sent.
 *
 * Tries the whole string, then a fenced block, then the outermost braces or
 * brackets. Anything stricter breaks the moment a model prepends "Here is the
 * JSON you asked for:", which they do constantly and which is not an error
 * worth failing a kitchen's import over.
 */
export function extractJson<T = unknown>(raw: string): T | null {
  const attempts: string[] = [];
  const trimmed = raw.trim();
  attempts.push(trimmed);

  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fenced) attempts.push(fenced[1].trim());

  for (const [open, close] of [["{", "}"], ["[", "]"]] as const) {
    const start = trimmed.indexOf(open);
    const end = trimmed.lastIndexOf(close);
    if (start !== -1 && end > start) attempts.push(trimmed.slice(start, end + 1));
  }

  for (const candidate of attempts) {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      /* next */
    }
  }
  return null;
}

/**
 * Models return numbers as strings, with units, and with commas.
 *
 * The digit check is the load-bearing line. Stripping non-numerics out of
 * "a pinch" leaves an empty string, and `Number("")` is 0 — so without it this
 * returned a confident zero for every quantity a model could not express as a
 * figure. A recipe line silently worth nothing is worse than one flagged as
 * unreadable.
 */
export function looseNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  if (!/\d/.test(v)) return null;
  const cleaned = v.replace(/[^0-9.,-]/g, "").replace(/,(?=\d{3}\b)/g, "");
  if (!/\d/.test(cleaned)) return null;
  const n = Number(cleaned.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

// ── Recipe parsing ──────────────────────────────────────────────────────────

export interface ParsedRecipeLine {
  ingredient: string;
  quantity: number | null;
  unit: string | null;
}

export interface ParsedRecipe {
  name: string;
  category: string | null;
  yieldQty: number | null;
  yieldUnit: string | null;
  lines: ParsedRecipeLine[];
  method: string[];
  /** Anything the model could not read, rather than a silent omission. */
  notes: string[];
}

export function recipeParseRequest(source: string, images?: string[]): AiRequest {
  return {
    system: `${SAFETY_PREAMBLE}

You are reading a recipe and turning it into structured data.

Return ONLY JSON of this shape:
{
  "name": string,
  "category": string | null,
  "yieldQty": number | null,
  "yieldUnit": string | null,
  "lines": [{ "ingredient": string, "quantity": number | null, "unit": string | null }],
  "method": [string],
  "notes": [string]
}

Rules:
- Ingredient names stay as written. Do not translate, correct or standardise
  them — the app matches them against a catalogue that uses the venue's own
  spelling, including Indonesian names.
- Quantity is a number in the unit given. "1 kg" is 1 with unit "kg", never
  1000. Converting here loses the unit the kitchen actually buys in.
- A range ("2-3 shallots") takes the lower figure and notes the range.
- Anything ambiguous or unreadable goes in notes. Do not guess a quantity to
  make the shape complete — a null the app can flag beats a number nobody can
  trace.`,
    messages: [
      {
        role: "user",
        text: source.trim()
          ? source
          : "Read the recipe in the attached image.",
        images,
      },
    ],
    json: true,
    temperature: 0,
    maxTokens: 3000,
  };
}

export function parseRecipeResponse(raw: string): ParsedRecipe | null {
  const data = extractJson<any>(raw);
  if (!data || typeof data !== "object") return null;

  const linesIn = Array.isArray(data.lines) ? data.lines : [];
  const lines: ParsedRecipeLine[] = linesIn
    .map((l: any) => ({
      ingredient: String(l?.ingredient ?? l?.name ?? "").trim(),
      quantity: looseNumber(l?.quantity ?? l?.qty),
      unit: l?.unit ? String(l.unit).trim() : null,
    }))
    .filter((l: ParsedRecipeLine) => l.ingredient !== "");

  const name = String(data.name ?? "").trim();
  if (!name && lines.length === 0) return null;

  const method = Array.isArray(data.method)
    ? data.method.map((s: any) => String(s).trim()).filter(Boolean)
    : [];
  const notes = Array.isArray(data.notes)
    ? data.notes.map((s: any) => String(s).trim()).filter(Boolean)
    : [];

  return {
    name: name || "Untitled",
    category: data.category ? String(data.category).trim() : null,
    yieldQty: looseNumber(data.yieldQty ?? data.yield),
    yieldUnit: data.yieldUnit ? String(data.yieldUnit).trim() : null,
    lines,
    method,
    notes,
  };
}

// ── Nutrition and allergens ─────────────────────────────────────────────────

export interface NutritionProposal {
  kcal: number | null;
  proteinG: number | null;
  fatG: number | null;
  carbsG: number | null;
  sodiumMg: number | null;
  allergens: string[];
  allergenReasoning: Record<string, string>;
  note: string | null;
}

const ALLERGEN_IDS = [
  "EU14_CELERY", "EU14_GLUTEN_CEREALS", "EU14_CRUSTACEANS", "EU14_EGGS",
  "EU14_FISH", "EU14_LUPIN", "EU14_MILK", "EU14_MOLLUSCS", "EU14_MUSTARD",
  "EU14_PEANUTS", "EU14_SESAME", "EU14_SOYBEANS", "EU14_SULPHITES",
  "EU14_TREE_NUTS",
];

export function nutritionRequest(productName: string, images?: string[]): AiRequest {
  return {
    system: `${SAFETY_PREAMBLE}

You are estimating the composition of one food, per 100 g of the edible portion.

Return ONLY JSON:
{
  "kcal": number|null, "proteinG": number|null, "fatG": number|null,
  "carbsG": number|null, "sodiumMg": number|null,
  "allergens": [string], "allergenReasoning": { "<id>": "<why>" },
  "note": string|null
}

Allergen ids, and no others: ${ALLERGEN_IDS.join(", ")}

Rules:
- List an allergen if it is plausibly present. Err towards listing it. You are
  producing a list for a person to check against a label, not a declaration.
- Never state that an allergen is absent, and never return an empty list as
  though it were a finding. If you believe none is inherent, return [] and say
  in the note that the label decides.
- If the name is too vague to be sure which food it is, return nulls and say so
  in the note rather than describing a food it might be.`,
    messages: [
      {
        role: "user",
        text: `Food: ${productName}${
          images?.length ? "\n\nA photograph of the product or its label is attached." : ""
        }`,
        images,
      },
    ],
    json: true,
    temperature: 0,
    maxTokens: 1200,
  };
}

export function parseNutritionResponse(raw: string): NutritionProposal | null {
  const data = extractJson<any>(raw);
  if (!data || typeof data !== "object") return null;

  const known = new Set(ALLERGEN_IDS);
  const allergens = (Array.isArray(data.allergens) ? data.allergens : [])
    .map((a: any) => String(a).trim().toUpperCase())
    // A model inventing an allergen id would silently drop it from the badge
    // list, so unknown ids are discarded here where it is visible in a test
    // rather than downstream where it is not.
    .filter((a: string) => known.has(a));

  const reasoning: Record<string, string> = {};
  const rawReasoning = data.allergenReasoning ?? data.reasoning;
  if (rawReasoning && typeof rawReasoning === "object") {
    for (const [k, v] of Object.entries(rawReasoning)) {
      const id = k.trim().toUpperCase();
      if (known.has(id)) reasoning[id] = String(v);
    }
  }

  return {
    kcal: looseNumber(data.kcal),
    proteinG: looseNumber(data.proteinG ?? data.protein),
    fatG: looseNumber(data.fatG ?? data.fat),
    carbsG: looseNumber(data.carbsG ?? data.carbs),
    sodiumMg: looseNumber(data.sodiumMg ?? data.sodium),
    allergens,
    allergenReasoning: reasoning,
    note: data.note ? String(data.note).trim() : null,
  };
}

// ── Image analysis ──────────────────────────────────────────────────────────

export function imageAnalysisRequest(question: string, images: string[]): AiRequest {
  return {
    system: `${SAFETY_PREAMBLE}

You are looking at a photograph taken in a kitchen — a delivery, a label, a
piece of paperwork, a dish, or a storage area.

Describe what you can actually see. Where the question asks for a judgement you
cannot make from a picture — whether food is safe, whether a temperature is
acceptable, whether something is free from an allergen — say what you can see
and say that the judgement is not one a photograph supports.`,
    messages: [{ role: "user", text: question, images }],
    temperature: 0.1,
    maxTokens: 1500,
  };
}

// ── Writing ─────────────────────────────────────────────────────────────────

export function newsletterRequest(input: {
  venue: string;
  audience: string;
  points: string;
  tone?: string;
}): AiRequest {
  return {
    system: `${SAFETY_PREAMBLE}

You are drafting an internal staff notice for a hospitality venue. It will be
read by kitchen and floor staff on their phones.

Write plainly and short. No corporate filler, no "exciting news", no emoji.
Lead with what changes for the reader. If a point requires them to do something,
say what and by when.

Return the notice only — no preamble, no sign-off placeholder, no subject line
unless one is asked for.`,
    messages: [
      {
        role: "user",
        text: `Venue: ${input.venue}
Audience: ${input.audience}
Tone: ${input.tone ?? "direct and warm"}

Points to cover:
${input.points}`,
      },
    ],
    temperature: 0.6,
    maxTokens: 1200,
  };
}

export function reportRequest(input: {
  title: string;
  question: string;
  data: string;
}): AiRequest {
  return {
    system: `${SAFETY_PREAMBLE}

You are writing a short management summary from figures the app has supplied.

Rules:
- Use only the figures given. Never estimate, extrapolate or fill a gap. If the
  data does not answer the question, say which figure is missing.
- Lead with the finding, not the method.
- Name the number beside every claim, so a reader can check it.
- Where a figure looks wrong rather than merely bad, say so — a food cost of
  four percent is a data problem, not an achievement.`,
    messages: [
      {
        role: "user",
        text: `Report: ${input.title}
Question: ${input.question}

Figures from the app:
${input.data}`,
      },
    ],
    temperature: 0.3,
    maxTokens: 1600,
  };
}

/** The free-form assistant, given whatever page the person is looking at. */
export function assistRequest(input: {
  question: string;
  pageContext: string;
  history: { role: "user" | "assistant"; text: string }[];
  images?: string[];
}): AiRequest {
  return {
    system: `${SAFETY_PREAMBLE}

You are assisting somebody using CulinaryCoreOS, a recipe costing and
hospitality management app. They are currently on this screen:

${input.pageContext}

Answer about what they are looking at. Keep it short — they are at work. If the
answer depends on data you were not given, say which screen or figure would
answer it rather than guessing.`,
    messages: [
      ...input.history.map((h) => ({ role: h.role, text: h.text })),
      { role: "user" as const, text: input.question, images: input.images },
    ],
    temperature: 0.3,
    maxTokens: 1200,
  };
}
