import { describe, it, expect } from "vitest";
import { planHaccpImport, checkFieldLimits } from "./haccp-import";
import { parseCsv } from "@/lib/csv";

const NONE = { existing: [] };

function plan(csv: string, existing: { id: string; code: string }[] = []) {
  return planHaccpImport(parseCsv(csv), { existing });
}

describe("planHaccpImport", () => {
  it("groups the rows of one form into one form", () => {
    const result = plan(
      [
        "code,section,title,frequency,critical,field,type,unit,min,max",
        "3.1,Temperature,Chiller Log,DAILY,yes,Walk-in,number,°C,0,5",
        "3.1,,,,,Dessert fridge,number,°C,0,5",
        "3.1,,,,,Checked by,text,,,",
      ].join("\n"),
    );

    expect(result.problems).toEqual([]);
    expect(result.forms).toHaveLength(1);
    const form = result.forms[0];
    expect(form.code).toBe("3.1");
    expect(form.title).toBe("Chiller Log");
    expect(form.section).toBe("Temperature");
    expect(form.frequency).toBe("DAILY");
    expect(form.isCcp).toBe(true);
    expect(form.fields.map((f) => f.label)).toEqual([
      "Walk-in", "Dessert fridge", "Checked by",
    ]);
    expect(form.fields[0]).toMatchObject({ type: "number", unit: "°C", min: 0, max: 5 });
    expect(form.fields[2]).toMatchObject({ type: "text", min: null, max: null });
  });

  it("keeps a form with no fields at all", () => {
    const result = plan(
      "code,section,title,frequency\n2.1,Personal Hygiene,Grooming Standard,ANNUAL",
    );
    expect(result.problems).toEqual([]);
    expect(result.forms).toHaveLength(1);
    expect(result.forms[0].fields).toEqual([]);
    expect(result.forms[0].frequency).toBe("ANNUAL");
  });

  it("reads the rhythm however the sheet words it", () => {
    const result = plan(
      [
        "code,title,how often",
        "a,Hand Washing,per shift",
        "b,Deep Clean,Weekly",
        "c,Pest Report,as needed",
        "d,Water Test,yearly",
      ].join("\n"),
    );
    expect(result.problems).toEqual([]);
    expect(result.forms.map((f) => f.frequency)).toEqual([
      "PER_SHIFT", "WEEKLY", "AS_NEEDED", "ANNUAL",
    ]);
  });

  it("refuses a rhythm it does not know rather than guessing one", () => {
    const result = plan("code,title,frequency\n9.9,Odd Form,fortnightly");
    expect(result.forms).toHaveLength(0);
    expect(result.problems[0].reason).toContain("fortnightly");
  });

  it("finds the header below a title row", () => {
    const result = plan(
      [
        "Manuza Beach Club — HACCP forms",
        "",
        "code,title,field",
        "1.1,Cleaning Schedule,Kitchen floor",
      ].join("\n"),
    );
    expect(result.columns).toMatchObject({ code: "code", title: "title" });
    expect(result.forms).toHaveLength(1);
    expect(result.forms[0].fields[0].label).toBe("Kitchen floor");
  });

  it("marks a form that already exists as an update", () => {
    const result = plan(
      "code,title\n3.1,Chiller Log",
      [{ id: "form-1", code: "3.1" }],
    );
    expect(result.forms[0].existingId).toBe("form-1");
  });

  it("matches an existing code regardless of case and padding", () => {
    const result = plan(
      "code,title\n  A.1 ,Chiller Log",
      [{ id: "form-9", code: "a.1" }],
    );
    expect(result.forms[0].existingId).toBe("form-9");
  });

  it("infers a number field from its unit", () => {
    const result = plan("code,title,field,unit\n3.2,Probe Check,Core temperature,°C");
    expect(result.forms[0].fields[0].type).toBe("number");
  });

  it("refuses limits the wrong way round", () => {
    const result = plan(
      "code,title,field,type,min,max\n3.1,Chiller,Walk-in,number,8,2",
    );
    expect(result.forms[0].fields).toEqual([]);
    expect(result.problems[0].reason).toContain("wrong way round");
  });

  it("refuses limits on a field that is not a number", () => {
    const result = plan(
      "code,title,field,type,min,max\n3.1,Chiller,Signed by,text,0,5",
    );
    expect(result.problems[0].reason).toContain("not a number field");
    expect(result.forms[0].fields).toEqual([]);
  });

  it("reports a field listed twice on the same form", () => {
    const result = plan(
      [
        "code,title,field",
        "3.1,Chiller,Walk-in",
        "3.1,,Walk-in",
      ].join("\n"),
    );
    expect(result.forms[0].fields).toHaveLength(1);
    expect(result.problems[0].reason).toContain("twice");
  });

  it("takes a critical flag from a later row of the same form", () => {
    const result = plan(
      [
        "code,title,critical,field",
        "3.1,Chiller,,Walk-in",
        "3.1,,yes,Dessert fridge",
      ].join("\n"),
    );
    expect(result.forms[0].isCcp).toBe(true);
  });

  it("reports a file with no header instead of importing nothing quietly", () => {
    const result = plan("3.1,Chiller Log,daily\n3.2,Probe,daily");
    expect(result.forms).toEqual([]);
    expect(result.problems[0].reason).toContain("No header row");
    expect(result.columns).toBeNull();
  });

  it("keeps forms in the order the file lists them", () => {
    const result = plan(
      [
        "code,title",
        "5.3,Waste",
        "1.1,Cleaning",
        "3.2,Probe",
      ].join("\n"),
    );
    expect(result.forms.map((f) => f.code)).toEqual(["5.3", "1.1", "3.2"]);
  });

  it("ignores blank rows in the middle of a file", () => {
    const result = plan(
      [
        "code,title,field",
        "3.1,Chiller,Walk-in",
        ",,",
        "3.1,,Dessert fridge",
      ].join("\n"),
    );
    expect(result.problems).toEqual([]);
    expect(result.forms[0].fields).toHaveLength(2);
  });

  it("identifies a form by title when the sheet has no codes", () => {
    const result = plan(
      [
        "title,field",
        "Chiller Log,Walk-in",
        "Chiller Log,Dessert fridge",
        "Probe Check,Core temperature",
      ].join("\n"),
    );
    expect(result.forms).toHaveLength(2);
    expect(result.forms[0].fields).toHaveLength(2);
    expect(result.forms[0].code).toBe("Chiller Log");
  });

  it("does not turn a stray row into a form of its own", () => {
    const result = planHaccpImport(parseCsv("code,title,field\n,,Orphan field"), NONE);
    expect(result.forms).toEqual([]);
    expect(result.problems[0].reason).toContain("no form above it");
  });
});

describe("checkFieldLimits", () => {
  const walkIn = { label: "Walk-in", type: "number" as const, unit: "°C", min: 0, max: 5 };

  it("says what was read and what it should have been", () => {
    expect(checkFieldLimits(walkIn, "9,2")).toBe(
      "Walk-in read 9.2 °C, above its limit of 5 °C.",
    );
    expect(checkFieldLimits(walkIn, "-3")).toBe(
      "Walk-in read -3 °C, below its limit of 0 °C.",
    );
  });

  it("passes a reading inside the limits, including on the boundary", () => {
    expect(checkFieldLimits(walkIn, "3,4")).toBeNull();
    expect(checkFieldLimits(walkIn, "5")).toBeNull();
    expect(checkFieldLimits(walkIn, "0")).toBeNull();
  });

  it("has nothing to say about a blank, a word, or a field with no limits", () => {
    expect(checkFieldLimits(walkIn, "")).toBeNull();
    expect(checkFieldLimits(walkIn, "broken")).toBeNull();
    expect(checkFieldLimits(
      { label: "Signed", type: "text", unit: null, min: null, max: null }, "x",
    )).toBeNull();
  });
});
