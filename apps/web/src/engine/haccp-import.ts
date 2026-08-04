// ---------------------------------------------------------------------------
// Hygiene template import
// ---------------------------------------------------------------------------
// A venue's HACCP paperwork is its own. The forms seeded here are Manuza's,
// and every other kitchen — and Manuza itself after its next audit — needs to
// bring its own sheets in rather than ask for a migration.
//
// Same shape as the recipe import, because it is the same problem: a form and
// the fields on it are one thing spread over several rows, so the form's code
// and title repeat down the sheet and each row adds one field. That is how
// anybody lays a form out in Excel, and it means a template can be edited by
// the person who owns the paperwork rather than by a developer.
//
// The reason to carry fields at all rather than just a title: a form that
// declares its limits can decide for itself whether a reading is a breach.
// Until now the app asked the person filling it in to tick "something was
// outside its limit", which is precisely the judgement a control sheet exists
// to take out of a tired cook's hands at eleven at night. A chiller log that
// knows 5 °C is the limit flags 9,2 °C whether or not anybody ticks anything.
//
// Pure, so the preview and the commit cannot disagree about what will happen.
// ---------------------------------------------------------------------------

import { parseNumber } from "@/lib/csv";

export type HaccpFrequency =
  | "PER_SHIFT" | "DAILY" | "WEEKLY" | "MONTHLY"
  | "QUARTERLY" | "ANNUAL" | "AS_NEEDED";

export type HaccpFieldType = "text" | "number" | "yes_no" | "time" | "date";

export interface HaccpField {
  label: string;
  type: HaccpFieldType;
  /** °C, pH, ppm — shown beside the input and stored with the reading. */
  unit: string | null;
  /** Limits, where the form has them. A number outside them is a breach. */
  min: number | null;
  max: number | null;
}

export interface ImportedHaccpForm {
  code: string;
  section: string;
  title: string;
  frequency: HaccpFrequency;
  isCcp: boolean;
  fields: HaccpField[];
  /** Set when a form with this code already exists; the import replaces it. */
  existingId: string | null;
}

export interface HaccpImportProblem {
  line: number;
  code: string;
  reason: string;
}

export interface HaccpImportPlan {
  forms: ImportedHaccpForm[];
  problems: HaccpImportProblem[];
  /** Which header each meaning was read from, so a misread file is visible. */
  columns: Record<string, string> | null;
}

const key = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/*
 * Header synonyms.
 *
 * Wide rather than clever. A kitchen's own sheet says "Check", "Item" or
 * "What is measured" where this code says "field", and refusing the file over
 * a word sends somebody back to Excel to rename a column for no reason.
 */
const HEADERS: Record<string, string[]> = {
  code: ["code", "form", "form code", "ref", "reference", "no", "number"],
  section: ["section", "group", "category", "area", "chapter"],
  title: ["title", "form title", "name", "form name", "description"],
  frequency: ["frequency", "rhythm", "how often", "when", "interval"],
  ccp: ["critical", "ccp", "is ccp", "critical control point", "cp/ccp"],
  field: ["field", "check", "item", "measure", "what is measured", "question", "line"],
  type: ["type", "kind", "input", "answer"],
  unit: ["unit", "units", "uom", "measured in"],
  min: ["min", "minimum", "lower", "low limit", "min limit"],
  max: ["max", "maximum", "upper", "high limit", "max limit", "limit"],
};

const FREQUENCIES: Record<string, HaccpFrequency> = {
  "per shift": "PER_SHIFT", "per_shift": "PER_SHIFT", "shift": "PER_SHIFT",
  "every shift": "PER_SHIFT",
  "daily": "DAILY", "day": "DAILY", "every day": "DAILY",
  "weekly": "WEEKLY", "week": "WEEKLY", "every week": "WEEKLY",
  "monthly": "MONTHLY", "month": "MONTHLY",
  "quarterly": "QUARTERLY", "quarter": "QUARTERLY",
  "annual": "ANNUAL", "annually": "ANNUAL", "yearly": "ANNUAL", "year": "ANNUAL",
  "as needed": "AS_NEEDED", "as_needed": "AS_NEEDED", "ad hoc": "AS_NEEDED",
  "when needed": "AS_NEEDED", "on demand": "AS_NEEDED",
};

const FIELD_TYPES: Record<string, HaccpFieldType> = {
  // No entry for the empty string: a blank type column must fall through to
  // inference from the unit, not resolve to text before it gets there.
  "text": "text", "free text": "text", "note": "text",
  "number": "number", "numeric": "number", "reading": "number",
  "temperature": "number", "temp": "number", "ph": "number",
  "yes/no": "yes_no", "yes no": "yes_no", "yes_no": "yes_no",
  "boolean": "yes_no", "check": "yes_no", "tick": "yes_no", "pass/fail": "yes_no",
  "time": "time", "clock": "time",
  "date": "date", "day": "date",
};

/** A unit that implies a number, so "Walk-in / °C" needs no type column. */
const NUMERIC_UNITS = ["°c", "c", "°f", "f", "ph", "ppm", "%", "kg", "g", "min"];

function truthy(v: string): boolean {
  const s = key(v);
  return s === "yes" || s === "y" || s === "true" || s === "1"
    || s === "ccp" || s === "critical" || s === "x";
}

/**
 * Locate the columns by header name.
 *
 * Scans the first few rows rather than assuming row one: exported sheets carry
 * a title line, a venue name, or a blank row above the real header more often
 * than not.
 */
function findHeader(rows: string[][]): { row: number; map: Record<string, number> } | null {
  const limit = Math.min(rows.length, 10);
  let best: { row: number; map: Record<string, number>; score: number } | null = null;

  for (let r = 0; r < limit; r++) {
    const map: Record<string, number> = {};
    rows[r].forEach((cell, i) => {
      const k = key(cell);
      for (const [meaning, names] of Object.entries(HEADERS)) {
        if (map[meaning] === undefined && names.includes(k)) map[meaning] = i;
      }
    });
    // A header is only a header if it names the form. Everything else is
    // optional, and a row matching one stray word is not a header.
    if (map.code === undefined && map.title === undefined) continue;
    const score = Object.keys(map).length;
    if (!best || score > best.score) best = { row: r, map, score };
  }
  return best ? { row: best.row, map: best.map } : null;
}

export interface HaccpImportContext {
  /** Forms already in the venue, so an upload updates rather than duplicates. */
  existing: { id: string; code: string }[];
}

/**
 * Read a template file into forms.
 *
 * A row carries the form it belongs to and, optionally, one field on it. The
 * form's details are taken from the first row that names them and later rows
 * may leave them blank — which is what a sheet looks like when a human fills
 * it in, and means a form with three fields is not three forms.
 */
export function planHaccpImport(
  rows: string[][],
  context: HaccpImportContext,
): HaccpImportPlan {
  const problems: HaccpImportProblem[] = [];
  const header = findHeader(rows);

  if (!header) {
    return {
      forms: [],
      problems: [{
        line: 0, code: "",
        reason:
          "No header row found. The file needs a row naming its columns — at " +
          "least a form code or a title, and ideally section, frequency and field.",
      }],
      columns: null,
    };
  }

  const { row: headerRow, map } = header;
  const at = (row: string[], meaning: string): string => {
    const i = map[meaning];
    return i === undefined ? "" : (row[i] ?? "").trim();
  };

  const byCode = new Map<string, ImportedHaccpForm>();
  // Insertion order, so the preview lists forms as the file does.
  const order: string[] = [];
  const existingByCode = new Map(
    context.existing.map((f) => [key(f.code), f.id]),
  );
  // The form the previous row belonged to, for rows that only add a field.
  let current: string | null = null;

  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r];
    const line = r + 1;
    if (row.every((c) => c.trim() === "")) continue;

    const rawCode = at(row, "code");
    const rawTitle = at(row, "title");
    const code = rawCode || (rawTitle ? "" : "");

    let formKey: string | null = null;
    if (code) {
      formKey = key(code);
    } else if (rawTitle) {
      // A file with titles and no codes is legitimate; the title identifies it.
      formKey = key(rawTitle);
    } else if (current) {
      // A continuation row: another field on the form above.
      formKey = current;
    } else {
      problems.push({
        line, code: "",
        reason: "No form code or title, and no form above it to belong to.",
      });
      continue;
    }

    let form = byCode.get(formKey);
    if (!form) {
      const title = rawTitle || rawCode;
      if (!title) {
        problems.push({ line, code: rawCode, reason: "The form has no title." });
        continue;
      }

      const rawFreq = at(row, "frequency");
      const frequency = rawFreq ? FREQUENCIES[key(rawFreq)] : "DAILY";
      if (rawFreq && !frequency) {
        problems.push({
          line, code: rawCode || title,
          reason:
            `"${rawFreq}" is not a rhythm this app knows. Use per shift, daily, ` +
            `weekly, monthly, quarterly, annual or as needed.`,
        });
        continue;
      }

      form = {
        code: rawCode || title,
        section: at(row, "section") || "General",
        title,
        frequency: frequency ?? "DAILY",
        isCcp: truthy(at(row, "ccp")),
        fields: [],
        existingId: existingByCode.get(key(rawCode || title)) ?? null,
      };
      byCode.set(formKey, form);
      order.push(formKey);
    } else {
      // A later row may still be the one that declares the form critical, or
      // names its section — sheets are not consistent about which row carries
      // what, and dropping it would silently lose a CCP flag.
      if (!form.isCcp && truthy(at(row, "ccp"))) form.isCcp = true;
      if (form.section === "General" && at(row, "section")) {
        form.section = at(row, "section");
      }
    }
    current = formKey;

    const label = at(row, "field");
    if (!label) continue;

    if (form.fields.some((f) => key(f.label) === key(label))) {
      problems.push({
        line, code: form.code,
        reason: `"${label}" appears twice on this form.`,
      });
      continue;
    }

    const unit = at(row, "unit") || null;
    const rawType = at(row, "type");
    let type = FIELD_TYPES[key(rawType)];
    if (rawType && !type) {
      problems.push({
        line, code: form.code,
        reason: `"${rawType}" is not a field type. Use text, number, yes/no, time or date.`,
      });
      continue;
    }
    if (!type) {
      // Infer from the unit, so "Walk-in / °C" needs no type column at all.
      type = unit && NUMERIC_UNITS.includes(key(unit)) ? "number" : "text";
    }

    const rawMin = at(row, "min");
    const rawMax = at(row, "max");
    const min = rawMin === "" ? null : parseNumber(rawMin);
    const max = rawMax === "" ? null : parseNumber(rawMax);

    if (rawMin !== "" && min === null) {
      problems.push({ line, code: form.code, reason: `"${rawMin}" is not a number.` });
      continue;
    }
    if (rawMax !== "" && max === null) {
      problems.push({ line, code: form.code, reason: `"${rawMax}" is not a number.` });
      continue;
    }
    if (min !== null && max !== null && min > max) {
      problems.push({
        line, code: form.code,
        reason: `The limits are the wrong way round: ${min} to ${max}.`,
      });
      continue;
    }
    if ((min !== null || max !== null) && type !== "number") {
      // A limit on a text field cannot be checked, and silently keeping it
      // would suggest the form is monitoring something it is not.
      problems.push({
        line, code: form.code,
        reason: `"${label}" has limits but is not a number field.`,
      });
      continue;
    }

    form.fields.push({ label, type, unit, min, max });
  }

  const columns: Record<string, string> = {};
  for (const [meaning, i] of Object.entries(map)) {
    columns[meaning] = rows[headerRow][i] ?? "";
  }

  return { forms: order.map((k) => byCode.get(k)!), problems, columns };
}

/**
 * Whether a recorded value breaks its field's limits.
 *
 * Returns the wording for the breach rather than a boolean, because a control
 * sheet that says "out of limits" is worth less at an audit than one that says
 * what was read and what it should have been.
 */
export function checkFieldLimits(
  field: HaccpField,
  raw: string,
): string | null {
  if (field.type !== "number") return null;
  if (raw.trim() === "") return null;
  const value = parseNumber(raw);
  if (value === null) return null;

  const unit = field.unit ? ` ${field.unit}` : "";
  if (field.min !== null && value < field.min) {
    return `${field.label} read ${value}${unit}, below its limit of ${field.min}${unit}.`;
  }
  if (field.max !== null && value > field.max) {
    return `${field.label} read ${value}${unit}, above its limit of ${field.max}${unit}.`;
  }
  return null;
}
