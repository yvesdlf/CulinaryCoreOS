// ---------------------------------------------------------------------------
// What the model is not allowed to do
// ---------------------------------------------------------------------------
// DOC5 §6.1 states the rule this file enforces, and states it first among all
// safety domains:
//
//     Never suppress allergen warnings. The AI can add allergen warnings but
//     can never remove them. Only a human user can remove an allergen
//     designation, and the action is logged with a reason.
//
// The reasoning is the asymmetry. A false positive costs somebody an
// unnecessary substitution. A false negative puts somebody in hospital. Those
// are not two sides of an accuracy trade-off to be tuned; one of them is not
// an acceptable outcome at any rate.
//
// So a model's allergen output is treated as a set of *additions* and nothing
// else. Whatever it returns, the allergens already on a recipe survive. A model
// that confidently reports "contains: milk" on a dish that was marked for nuts
// does not thereby unmark the nuts, and it does not matter whether it was
// right about the milk.
//
// This is enforced here rather than trusted to a prompt. A prompt is a request;
// a function that cannot express the forbidden operation is a guarantee. There
// is deliberately no exported function in this module that removes an allergen.
// ---------------------------------------------------------------------------

export interface AllergenProposal {
  /** Allergen ids the model believes are present. */
  suggested: string[];
  /** What it said about each, for a person to read before accepting. */
  reasoning: Record<string, string>;
}

export interface AllergenMerge {
  /** What the recipe should carry: everything it had, plus what was added. */
  allergens: string[];
  /** New ones, so the UI can say which are the model's rather than the venue's. */
  added: string[];
  /**
   * Allergens the model omitted that the recipe already carries.
   *
   * Reported so the screen can say so out loud, never acted on. A model
   * omitting an allergen is not evidence of its absence — it is far more often
   * evidence that the model did not know.
   */
  omittedButKept: string[];
  /** Always true for anything a model touched. */
  needsReview: true;
}

/**
 * Fold a model's allergen suggestion into what a recipe already declares.
 *
 * Union, always. There is no argument, flag or edge case that makes this
 * function return fewer allergens than it was given, and that is the whole
 * point of it existing.
 */
export function mergeAllergenProposal(
  existing: string[],
  proposal: AllergenProposal,
): AllergenMerge {
  const current = existing.filter((a) => a && a.trim() !== "");
  const seen = new Set(current);

  const added: string[] = [];
  for (const a of proposal.suggested) {
    const id = a.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    added.push(id);
  }

  const suggestedSet = new Set(proposal.suggested.map((a) => a.trim()));
  const omittedButKept = current.filter((a) => !suggestedSet.has(a));

  return {
    allergens: [...current, ...added],
    added,
    omittedButKept,
    needsReview: true,
  };
}

/**
 * Things a model must not be believed about, and the phrasing to show instead.
 *
 * Models are fluent about food safety and confidently wrong at a rate that
 * does not matter until it does. Where an answer would function as a legal
 * declaration or a safety clearance, the app substitutes its own sentence
 * rather than passing the model's through.
 */
export const REFUSED_CLAIMS: { pattern: RegExp; replacement: string }[] = [
  {
    // "free from", "gluten-free", "contains no nuts", "safe for coeliacs"
    pattern: /\b(free[- ]from|gluten[- ]free|dairy[- ]free|nut[- ]free|allergen[- ]free|contains no (allergen|nut|gluten|dairy|milk)|safe for (coeliac|celiac|allerg))/i,
    // Worded so it does not match the pattern above. A replacement that trips
    // its own filter gets stripped on a second pass, leaving an answer with
    // the warning deleted — the precise failure this guard exists to prevent.
    replacement:
      "A claim of that kind cannot come from this assistant. It is a legal " +
      "statement under Regulation 1169/2011 and depends on the label of the " +
      "product actually in the store and on how the dish is prepared.",
  },
  {
    pattern: /\b(safe to (eat|serve|consume)|no risk of (food )?poisoning|will not make (anyone|you) ill)\b/i,
    // Worded to avoid the phrases above. A replacement that trips its own
    // filter is stripped the second time the guard runs, which leaves an
    // answer with the warning removed — the exact failure being guarded.
    replacement:
      "Whether to serve this is a decision for the venue, from its HACCP " +
      "records and the state of the food in front of you. This assistant " +
      "cannot make it.",
  },
];

/**
 * Replace any refused claim with the sentence that belongs there.
 *
 * Returns the flags too, so a screen can show that something was substituted
 * rather than silently changing what the model said — a person who asked a
 * question deserves to know their answer was edited.
 */
export function guardAnswer(text: string): { text: string; substituted: string[] } {
  let out = text;
  const substituted: string[] = [];

  for (const rule of REFUSED_CLAIMS) {
    if (rule.pattern.test(out)) {
      substituted.push(rule.replacement);
      // The sentence containing the claim goes, rather than the whole answer:
      // the rest is usually useful and deleting it teaches people to work
      // around the assistant.
      out = out
        .split(/(?<=[.!?])\s+/)
        .filter((sentence) => !rule.pattern.test(sentence))
        .join(" ");
    }
  }

  if (substituted.length > 0) {
    out = [out.trim(), ...substituted].filter(Boolean).join("\n\n");
  }
  return { text: out.trim(), substituted };
}

/**
 * Everything the model is told before it is told anything else.
 *
 * Repeated in the system prompt as well as enforced in code, because the
 * cheapest place to stop a wrong answer is before it is generated — but the
 * prompt is the request and the code above is the guarantee.
 */
export const SAFETY_PREAMBLE = `You assist staff in a professional kitchen that operates under EU food law.

Rules you must follow, without exception:

- You may point out that an allergen is likely present. You must never say
  that one is absent, and you must never suggest removing an allergen already
  recorded. Under Regulation 1169/2011 an allergen declaration is a legal
  statement made by the venue after reading a label, not a conclusion drawn
  from a name.
- Never make a free-from claim of any kind.
- Never state that food is safe to eat or serve. That is decided by the
  venue's HACCP records and by the food in front of the person.
- Where you are unsure, say so plainly. "I don't know" is a useful answer here
  and a confident wrong one is not.
- Costs, stock figures and prices come from the app's own data. Do not invent
  a number; if you were not given it, say it was not provided.`;
