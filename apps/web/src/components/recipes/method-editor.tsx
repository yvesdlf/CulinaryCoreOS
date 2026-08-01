// ---------------------------------------------------------------------------
// Method editor
// ---------------------------------------------------------------------------
// Steps, times and internal notes — the half of a recipe that says how to make
// it. Until this existed the app could cost a dish beautifully and could not
// tell anyone how to cook it.
//
// One textarea per step rather than one for the lot. A step is the unit a cook
// works in, and keeping them separate is what lets a sheet number them and a
// screen later tick them off. The cost of that is a slightly busier editor,
// which is the right trade for the thing being edited.
// ---------------------------------------------------------------------------

import { useRef } from "react";
import { Plus, X, ArrowUp, ArrowDown } from "lucide-react";
import type { Preparation } from "@ccos/shared";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface Props {
  value: Preparation;
  onChange: (next: Preparation) => void;
}

export function MethodEditor({ value, onChange }: Props) {
  // So a newly added step receives focus rather than leaving the user to hunt
  // for the box that just appeared.
  const lastStep = useRef<HTMLTextAreaElement>(null);

  const setSteps = (method: string[]) => onChange({ ...value, method });

  function addStep() {
    setSteps([...value.method, ""]);
    requestAnimationFrame(() => lastStep.current?.focus());
  }

  function move(from: number, to: number) {
    if (to < 0 || to >= value.method.length) return;
    const next = [...value.method];
    [next[from], next[to]] = [next[to], next[from]];
    setSteps(next);
  }

  return (
    <section className="space-y-4" aria-labelledby="method-heading">
      <div className="flex items-center justify-between gap-3">
        <h2 id="method-heading" className="text-sm font-medium">
          Method
        </h2>
        <div className="flex items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="prep-minutes" className="text-xs">
              Prep (min)
            </Label>
            <Input
              id="prep-minutes"
              type="number"
              min={0}
              className="w-24"
              value={value.prepMinutes ?? ""}
              onChange={(e) =>
                onChange({
                  ...value,
                  // Empty means unrecorded, which is not the same as zero
                  // minutes — a sheet showing "Prep: 0 min" would be a claim.
                  prepMinutes: e.target.value === "" ? null : Number(e.target.value),
                })
              }
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cook-minutes" className="text-xs">
              Cook (min)
            </Label>
            <Input
              id="cook-minutes"
              type="number"
              min={0}
              className="w-24"
              value={value.cookMinutes ?? ""}
              onChange={(e) =>
                onChange({
                  ...value,
                  cookMinutes: e.target.value === "" ? null : Number(e.target.value),
                })
              }
            />
          </div>
        </div>
      </div>

      {value.method.length === 0 ? (
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          No method written yet. A sheet without one is a costing, not a recipe.
        </p>
      ) : (
        <ol className="space-y-2">
          {value.method.map((step, i) => (
            <li key={i} className="flex items-start gap-2">
              <span
                className="mt-2 w-5 shrink-0 text-right text-sm tabular-nums text-muted-foreground"
                aria-hidden="true"
              >
                {i + 1}
              </span>
              <Textarea
                ref={i === value.method.length - 1 ? lastStep : undefined}
                value={step}
                rows={2}
                aria-label={`Step ${i + 1}`}
                placeholder="What to do..."
                onChange={(e) => {
                  const next = [...value.method];
                  next[i] = e.target.value;
                  setSteps(next);
                }}
                className="min-h-0 flex-1"
              />
              <div className="flex shrink-0 flex-col">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={i === 0}
                  onClick={() => move(i, i - 1)}
                >
                  <ArrowUp className="size-3.5" aria-hidden="true" />
                  <span className="sr-only">Move step {i + 1} up</span>
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={i === value.method.length - 1}
                  onClick={() => move(i, i + 1)}
                >
                  <ArrowDown className="size-3.5" aria-hidden="true" />
                  <span className="sr-only">Move step {i + 1} down</span>
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setSteps(value.method.filter((_, j) => j !== i))}
                >
                  <X className="size-3.5" aria-hidden="true" />
                  <span className="sr-only">Delete step {i + 1}</span>
                </Button>
              </div>
            </li>
          ))}
        </ol>
      )}

      <Button variant="outline" size="sm" onClick={addStep}>
        <Plus className="mr-1 size-4" aria-hidden="true" />
        Add step
      </Button>

      <div className="space-y-1">
        <Label htmlFor="internal-notes">Internal notes</Label>
        <Textarea
          id="internal-notes"
          rows={2}
          placeholder="Not printed — e.g. supplier substitutes cheaper cream, watch it"
          value={value.internalNotes ?? ""}
          onChange={(e) =>
            onChange({ ...value, internalNotes: e.target.value || null })
          }
        />
        {/* Stated rather than implied: someone writing a frank remark needs to
            know it will not reach a guest-facing sheet. */}
        <p className="text-xs text-muted-foreground">
          Kept off printed sheets and exports.
        </p>
      </div>
    </section>
  );
}
