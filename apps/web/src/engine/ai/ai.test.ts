import { describe, it, expect } from "vitest";
import { mergeAllergenProposal, guardAnswer, SAFETY_PREAMBLE } from "./safety";
import {
  extractJson, looseNumber, parseRecipeResponse, parseNutritionResponse,
  recipeParseRequest, nutritionRequest, assistRequest,
} from "./tasks";
import { AI_PROVIDERS, providerById } from "./providers";

/**
 * The AI layer.
 *
 * Two kinds of failure are guarded here. The first is a model being wrong about
 * an allergen, which is the only failure in this app that can put somebody in
 * hospital. The second is a model being untidy — JSON in a code fence, a number
 * as a string, a field renamed — which is not dangerous but is constant, and a
 * parser that assumes otherwise breaks in a kitchen rather than in CI.
 */

describe("allergen safety", () => {
  it("never returns fewer allergens than it was given", () => {
    // DOC5 §6.1: the AI may add a warning and may never remove one.
    const merged = mergeAllergenProposal(
      ["EU14_TREE_NUTS", "EU14_MILK"],
      { suggested: ["EU14_MILK"], reasoning: {} },
    );
    expect(merged.allergens).toContain("EU14_TREE_NUTS");
    expect(merged.allergens).toContain("EU14_MILK");
    expect(merged.allergens).toHaveLength(2);
  });

  it("reports what the model omitted rather than acting on it", () => {
    const merged = mergeAllergenProposal(
      ["EU14_TREE_NUTS"],
      { suggested: ["EU14_MILK"], reasoning: {} },
    );
    expect(merged.omittedButKept).toEqual(["EU14_TREE_NUTS"]);
    expect(merged.added).toEqual(["EU14_MILK"]);
  });

  it("cannot be made to drop an allergen by any input", () => {
    // An empty suggestion is the shape a confidently wrong model produces.
    for (const suggestion of [[], ["EU14_MILK"], ["", "  "]]) {
      const merged = mergeAllergenProposal(
        ["EU14_PEANUTS"],
        { suggested: suggestion, reasoning: {} },
      );
      expect(merged.allergens).toContain("EU14_PEANUTS");
    }
  });

  it("always marks the result unverified", () => {
    const merged = mergeAllergenProposal([], { suggested: ["EU14_FISH"], reasoning: {} });
    expect(merged.needsReview).toBe(true);
  });

  it("does not duplicate an allergen the recipe already carries", () => {
    const merged = mergeAllergenProposal(
      ["EU14_MILK"],
      { suggested: ["EU14_MILK", "EU14_EGGS"], reasoning: {} },
    );
    expect(merged.allergens).toEqual(["EU14_MILK", "EU14_EGGS"]);
    expect(merged.added).toEqual(["EU14_EGGS"]);
  });
});

describe("refused claims", () => {
  it("strips a free-from claim and says why", () => {
    const { text, substituted } = guardAnswer(
      "This dish is gluten-free. Serve it with the herb oil.",
    );
    expect(text).not.toMatch(/gluten-free/i);
    expect(text).toContain("Serve it with the herb oil.");
    expect(substituted[0]).toContain("1169/2011");
  });

  it("strips a safety clearance", () => {
    const { text, substituted } = guardAnswer(
      "The chicken is safe to serve. Rest it for five minutes.",
    );
    expect(text).not.toMatch(/safe to serve/i);
    expect(text).toContain("Rest it");
    expect(substituted).toHaveLength(1);
  });

  it("is idempotent — running it twice does not eat its own warning", () => {
    // Each replacement must avoid the pattern that triggers it. A warning that
    // matches its own filter is deleted on the second pass, which turns the
    // guard into the thing it guards against.
    const once = guardAnswer("This dish is gluten-free and safe to serve.");
    const twice = guardAnswer(once.text);
    expect(twice.text).toBe(once.text);
    expect(twice.substituted).toEqual([]);
    expect(once.text).toContain("1169/2011");
  });

  it("leaves an ordinary answer completely alone", () => {
    const answer = "Reduce the stock by half, then whisk in the butter off the heat.";
    const { text, substituted } = guardAnswer(answer);
    expect(text).toBe(answer);
    expect(substituted).toEqual([]);
  });

  it("catches the phrasings a model actually reaches for", () => {
    for (const claim of [
      "It is dairy-free.",
      "This contains no nuts.",
      "Safe for coeliacs.",
      "This is allergen-free.",
    ]) {
      expect(guardAnswer(claim).substituted.length).toBeGreaterThan(0);
    }
  });

  it("tells the model the rules as well as enforcing them", () => {
    // The prompt is the request; the code above is the guarantee. Both.
    expect(SAFETY_PREAMBLE).toMatch(/never say\s+that one is absent/i);
    expect(SAFETY_PREAMBLE).toMatch(/1169\/2011/);
  });
});

describe("extractJson", () => {
  it("reads plain JSON", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it("reads JSON out of a code fence", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("reads JSON a model wrapped in politeness", () => {
    // Models do this constantly and it is not worth failing an import over.
    expect(extractJson('Here is the JSON you asked for:\n{"a":1}\nHope that helps!'))
      .toEqual({ a: 1 });
  });

  it("returns null rather than throwing on rubbish", () => {
    expect(extractJson("I could not read that image.")).toBeNull();
  });
});

describe("looseNumber", () => {
  it("accepts the shapes a model returns", () => {
    expect(looseNumber(1.5)).toBe(1.5);
    expect(looseNumber("1.5")).toBe(1.5);
    expect(looseNumber("1,5")).toBe(1.5);
    expect(looseNumber("250 g")).toBe(250);
    expect(looseNumber("1,200")).toBe(1200);
  });

  it("returns null rather than NaN", () => {
    expect(looseNumber("a pinch")).toBeNull();
    expect(looseNumber(null)).toBeNull();
    expect(looseNumber(undefined)).toBeNull();
  });
});

describe("recipe parsing", () => {
  it("reads a well-formed answer", () => {
    const parsed = parseRecipeResponse(JSON.stringify({
      name: "Greek salad", category: "Starters", yieldQty: 4, yieldUnit: "por",
      lines: [
        { ingredient: "Tomato Cherry", quantity: 0.2, unit: "kg" },
        { ingredient: "Feta", quantity: "150 g", unit: "g" },
      ],
      method: ["Dice the tomato.", "Crumble the feta over."],
      notes: [],
    }));
    expect(parsed!.name).toBe("Greek salad");
    expect(parsed!.lines).toHaveLength(2);
    expect(parsed!.lines[1].quantity).toBe(150);
  });

  it("keeps a line whose quantity could not be read", () => {
    // Dropping it would hide an ingredient from a dish. A null the app can
    // flag is the honest outcome.
    const parsed = parseRecipeResponse(JSON.stringify({
      name: "Aioli",
      lines: [{ ingredient: "Garlic", quantity: "a clove or two", unit: null }],
      notes: ["Quantity given as 'a clove or two'."],
    }));
    expect(parsed!.lines).toHaveLength(1);
    expect(parsed!.lines[0].quantity).toBeNull();
    expect(parsed!.notes).toHaveLength(1);
  });

  it("drops a line with no ingredient name at all", () => {
    const parsed = parseRecipeResponse(JSON.stringify({
      name: "X", lines: [{ ingredient: "  ", quantity: 1 }, { ingredient: "Salt" }],
    }));
    expect(parsed!.lines).toHaveLength(1);
  });

  it("returns null when there is no recipe in the answer", () => {
    expect(parseRecipeResponse("I could not read that.")).toBeNull();
    expect(parseRecipeResponse(JSON.stringify({ name: "", lines: [] }))).toBeNull();
  });

  it("tells the model not to convert units", () => {
    // "1 kg" becoming 1000 loses the unit the kitchen buys in, and the costing
    // engine works from pack units.
    expect(recipeParseRequest("x").system).toMatch(/1 kg" is 1 with unit "kg"/);
  });
});

describe("nutrition parsing", () => {
  it("discards an allergen id the model invented", () => {
    // An unknown id would render as no badge at all — a silently dropped
    // allergen, which is the failure mode this whole layer exists to avoid.
    const parsed = parseNutritionResponse(JSON.stringify({
      kcal: 717,
      allergens: ["EU14_MILK", "EU14_HONEY", "dairy"],
      allergenReasoning: { EU14_MILK: "Butter is a dairy product." },
    }));
    expect(parsed!.allergens).toEqual(["EU14_MILK"]);
    expect(parsed!.allergenReasoning.EU14_MILK).toContain("dairy");
  });

  it("accepts lower-case ids", () => {
    const parsed = parseNutritionResponse(JSON.stringify({ allergens: ["eu14_fish"] }));
    expect(parsed!.allergens).toEqual(["EU14_FISH"]);
  });

  it("keeps nulls rather than inventing figures", () => {
    const parsed = parseNutritionResponse(JSON.stringify({
      kcal: null, allergens: [], note: "Too vague to identify.",
    }));
    expect(parsed!.kcal).toBeNull();
    expect(parsed!.note).toContain("vague");
  });

  it("forbids the model from treating an empty list as a finding", () => {
    expect(nutritionRequest("Butter").system)
      .toMatch(/never return an empty list as\s+though it were a finding/i);
  });
});

describe("providers", () => {
  it("all declare a key url and a default model", () => {
    for (const p of AI_PROVIDERS) {
      expect(p.keyUrl).toMatch(/^https:\/\//);
      expect(p.defaultModel).not.toBe("");
      expect(p.suggestedModels).toContain(p.defaultModel);
    }
  });

  it("offers at least one with a free tier", () => {
    expect(AI_PROVIDERS.some((p) => p.hasFreeTier)).toBe(true);
  });

  it("all support vision, because every task here may involve a photograph", () => {
    for (const p of AI_PROVIDERS) expect(p.capabilities.vision).toBe(true);
  });

  it("resolves by id and returns undefined for an unknown one", () => {
    expect(providerById("gemini")?.displayName).toBe("Google Gemini");
    expect(providerById("nope")).toBeUndefined();
  });
});

describe("the assistant prompt", () => {
  it("carries the page the person is looking at", () => {
    const req = assistRequest({
      question: "why is this dish flagged?",
      pageContext: "Recipe editor — Greek salad, food cost 32.6%",
      history: [],
    });
    expect(req.system).toContain("Greek salad");
    expect(req.messages.at(-1)!.text).toBe("why is this dish flagged?");
  });

  it("carries the conversation so far", () => {
    const req = assistRequest({
      question: "and the second one?",
      pageContext: "Purchasing",
      history: [
        { role: "user", text: "what needs ordering?" },
        { role: "assistant", text: "Eighteen lines are at or below reorder." },
      ],
    });
    expect(req.messages).toHaveLength(3);
    expect(req.messages[0].role).toBe("user");
    expect(req.messages[1].role).toBe("assistant");
  });

  it("puts the safety rules ahead of everything else", () => {
    const req = assistRequest({ question: "x", pageContext: "y", history: [] });
    expect(req.system!.indexOf("1169/2011")).toBeLessThan(req.system!.indexOf("CulinaryCoreOS"));
  });
});
