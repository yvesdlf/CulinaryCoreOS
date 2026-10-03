import { useCallback, useState } from "react";

import { cn } from "@/lib/utils";
import type { TableDensity } from "@/components/ui/table";

/*
 * One key for the whole app, not one per table.
 *
 * Somebody who wants tighter rows wants them everywhere; making them say so
 * again on products, then on recipes, then on the rota is the opposite of a
 * preference. The cost is that two tables mounted at once only agree after a
 * remount, which is why each page calls the hook once and hands the value to
 * its tables rather than every table asking for itself.
 */
const KEY = "ccos-table-density";

/*
 * Every access is wrapped. `localStorage` is not merely empty in a private
 * window or with site data blocked — the property access itself throws a
 * SecurityError, which would take the whole page down from a render.
 */
function read(): TableDensity {
  try {
    return localStorage.getItem(KEY) === "compact" ? "compact" : "comfortable";
  } catch {
    return "comfortable";
  }
}

function write(density: TableDensity): void {
  try {
    localStorage.setItem(KEY, density);
  } catch {
    // Nothing to do and nothing worth saying: the tables still work, the
    // choice just will not outlive the tab.
  }
}

/**
 * The remembered row height, and a setter that remembers it.
 *
 * Read in the initialiser rather than an effect so the first paint is already
 * the right density — hydrating afterwards would show comfortable rows and
 * then jump, which is the same flash the theme loader exists to avoid.
 */
export function useTableDensity() {
  const [density, setLocal] = useState<TableDensity>(read);

  const setDensity = useCallback((next: TableDensity) => {
    setLocal(next);
    write(next);
  }, []);

  return [density, setDensity] as const;
}

const OPTIONS: { value: TableDensity; label: string }[] = [
  { value: "comfortable", label: "Comfortable" },
  { value: "compact", label: "Compact" },
];

/**
 * Two buttons, pressed or not.
 *
 * `aria-pressed` on real buttons rather than a radio group: this changes the
 * appearance of something already on screen, it does not choose a value to
 * submit, and a toggle button is what assistive technology announces for that.
 *
 * Both labels are written out. An icon pair for row height — two stacked lines
 * against three — is a distinction almost nobody reads correctly, and the
 * keyboard suite would accept it because an `aria-label` is still a name.
 */
export function DensityToggle({
  value,
  onChange,
  className,
}: {
  value: TableDensity;
  onChange: (density: TableDensity) => void;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label="Row height"
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-0.5 rounded-lg bg-muted p-[3px]",
        className,
      )}
    >
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "h-full rounded-md px-2 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
            value === option.value
              ? "bg-background text-foreground shadow-sm"
              : // Not /70 of the foreground: on the muted fill that blends to a
                // ratio nobody checked. The secondary text token is the one
                // already tuned against this surface.
                "text-muted-foreground hover:text-foreground",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
