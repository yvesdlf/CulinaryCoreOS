// ---------------------------------------------------------------------------
// Menu engineering — SRS 4.8, Phase 6
// ---------------------------------------------------------------------------
// Crosses how often a dish sells against what each sale contributes, and says
// what to do about each quadrant.
//
// Sales arrive by file rather than by typing. The number the analysis needs —
// units sold per dish — already exists in the POS, and asking a chef to retype
// a hundred rows every month is how a report stops being run.
//
// An import is saved as a period, not held in the tab. A menu decision gets
// argued about, so everyone has to be able to open the same numbers; a private
// reading of a file nobody else has is not something a kitchen can act on.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Upload,
  TriangleAlert,
  Star,
  Tractor,
  Puzzle,
  Dog,
  Info,
  Trash2,
  FlaskConical,
} from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/layout/page-header";
import { PermissionGate } from "@/components/shared/permission-gate";
import { CurrencyDisplay } from "@/components/shared/currency-display";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { parseCsv } from "@/lib/csv";
import { useRecipeStore } from "@/stores/recipe-store";
import { parseSalesMix, type SalesMixImport } from "@/engine/sales-mix";
import {
  engineerMenu,
  CLASS_LABEL,
  CLASS_ADVICE,
  type MenuClass,
} from "@/engine/menu-engineering";
import {
  fetchSalesPeriods,
  fetchSalesLines,
  saveSalesPeriod,
  deleteSalesPeriod,
  type SalesPeriod,
} from "@/data/repository";
import { isSupabaseConfigured } from "@/lib/supabase";

const QUADRANT: Record<MenuClass, { icon: typeof Star; className: string }> = {
  star: { icon: Star, className: "bg-status-success-soft text-status-success" },
  plowhorse: { icon: Tractor, className: "bg-status-info-soft text-status-info" },
  puzzle: { icon: Puzzle, className: "bg-status-warning-soft text-status-warning" },
  dog: { icon: Dog, className: "bg-status-danger-soft text-status-danger" },
};

const ORDER: MenuClass[] = ["star", "plowhorse", "puzzle", "dog"];

export function MenuEngineeringPage() {
  const recipes = useRecipeStore((s) => s.recipes);
  const fileInput = useRef<HTMLInputElement>(null);

  const [periods, setPeriods] = useState<SalesPeriod[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sales, setSales] = useState<{ recipeId: string; unitsSold: number }[]>([]);
  const [loading, setLoading] = useState(true);

  /** An import waiting to be named and saved. */
  const [pending, setPending] = useState<{
    result: SalesMixImport;
    filename: string;
  } | null>(null);
  const [showSkipped, setShowSkipped] = useState(false);

  async function loadPeriods(selectFirst = true) {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }
    try {
      const list = await fetchSalesPeriods();
      setPeriods(list);
      if (selectFirst && list.length > 0) setSelectedId(list[0].id);
    } catch (err) {
      toast.error("Could not load sales periods", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadPeriods();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setSales([]);
      return;
    }
    let current = true;
    fetchSalesLines(selectedId)
      .then((lines) => {
        if (current) setSales(lines);
      })
      .catch((err) =>
        toast.error("Could not load that period", {
          description: err instanceof Error ? err.message : String(err),
        }),
      );
    return () => {
      current = false;
    };
  }, [selectedId]);

  const byId = useMemo(() => new Map(recipes.map((r) => [r.id, r])), [recipes]);

  const menu = useMemo(
    () =>
      engineerMenu(
        sales
          .map((s) => ({ recipe: byId.get(s.recipeId)!, unitsSold: s.unitsSold }))
          // A dish deleted after the period was recorded leaves a line behind.
          .filter((s) => s.recipe),
      ),
    [sales, byId],
  );

  const selected = periods.find((p) => p.id === selectedId) ?? null;

  async function handleFile(file: File) {
    const text = await file.text();
    setPending({ result: parseSalesMix(parseCsv(text), recipes), filename: file.name });
    if (fileInput.current) fileInput.current.value = "";
  }

  async function removePeriod(period: SalesPeriod) {
    try {
      await deleteSalesPeriod(period.id);
      toast.success(`Removed ${period.name}`);
      setSelectedId(null);
      await loadPeriods();
    } catch (err) {
      toast.error("Could not remove that period", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return (
    <div>
      <PageHeader
        title="Menu Engineering"
        description="Which dishes sell, which pay, and which do neither."
      >
        <PermissionGate>
          <input
            ref={fileInput}
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            aria-label="POS sales export (CSV)"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
            }}
          />
          <Button variant="outline" onClick={() => fileInput.current?.click()}>
            <Upload />
            Import sales
          </Button>
        </PermissionGate>
      </PageHeader>

      {periods.length > 0 && (
        <div className="mb-6 flex flex-wrap items-center gap-2">
          {periods.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setSelectedId(p.id)}
              aria-pressed={p.id === selectedId}
              className={`rounded-full border px-3 py-1 text-sm ${
                p.id === selectedId
                  ? "border-primary bg-primary text-primary-foreground"
                  : "hover:bg-muted"
              }`}
            >
              {p.name}
              {p.source === "SAMPLE" && (
                <FlaskConical className="ml-1.5 inline size-3" aria-label="sample data" />
              )}
            </button>
          ))}
          {selected && (
            <PermissionGate>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void removePeriod(selected)}
                aria-label={`Remove ${selected.name}`}
              >
                <Trash2 className="size-4" />
              </Button>
            </PermissionGate>
          )}
        </div>
      )}

      {selected?.source === "SAMPLE" && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-status-info bg-status-info-soft p-3 text-sm">
          <FlaskConical className="mt-0.5 size-4 shrink-0 text-status-info" />
          <span>
            <span className="font-medium">These figures are made up.</span> They
            exist so the analysis can be seen working before the venue trades.
            Nothing here describes real sales.
          </span>
        </div>
      )}

      {loading ? (
        <p className="py-12 text-center text-sm text-muted-foreground">Loading…</p>
      ) : periods.length === 0 ? (
        <EmptyState />
      ) : menu.dishes.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          No dish in this period matches a recipe that still exists.
        </p>
      ) : (
        <Analysis menu={menu} />
      )}

      {pending && (
        <SavePeriodDialog
          result={pending.result}
          filename={pending.filename}
          showSkipped={showSkipped}
          onToggleSkipped={() => setShowSkipped((s) => !s)}
          onClose={() => setPending(null)}
          onSaved={async (period) => {
            setPending(null);
            await loadPeriods(false);
            setSelectedId(period.id);
          }}
        />
      )}
    </div>
  );
}

function Analysis({ menu }: { menu: ReturnType<typeof engineerMenu> }) {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {ORDER.map((c) => {
          const q = QUADRANT[c];
          return (
            <Card key={c}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm font-medium">
                  <span
                    className={`flex size-6 items-center justify-center rounded-full ${q.className}`}
                  >
                    <q.icon className="size-3.5" />
                  </span>
                  {CLASS_LABEL[c]}s
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-semibold">{menu.counts[c]}</div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {CLASS_ADVICE[c]}
                </p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
        <span>
          {menu.totalUnits.toLocaleString()} dishes sold across{" "}
          {menu.dishes.length} recipes
        </span>
        <span>
          Total contribution{" "}
          <span className="font-medium text-foreground">
            <CurrencyDisplay value={menu.totalContribution} />
          </span>
        </span>
        <span>
          Profitable above <CurrencyDisplay value={menu.averageContribution} />{" "}
          per plate, popular above{" "}
          {menu.popularityThresholdPercent.toFixed(1)}% of covers
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Dish</TableHead>
              <TableHead>Class</TableHead>
              <TableHead className="text-right">Sold</TableHead>
              <TableHead className="text-right">Mix</TableHead>
              <TableHead className="text-right">Margin each</TableHead>
              <TableHead className="text-right">Food cost</TableHead>
              <TableHead className="text-right">Contribution</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {menu.dishes.map((d) => {
              const q = QUADRANT[d.classification];
              return (
                <TableRow key={d.recipe.id}>
                  <TableCell className="font-medium">{d.recipe.name}</TableCell>
                  <TableCell>
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${q.className}`}
                    >
                      <q.icon className="size-3" />
                      {CLASS_LABEL[d.classification]}
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {d.unitsSold.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {d.menuMixPercent.toFixed(1)}%
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    <CurrencyDisplay value={d.contributionMargin} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {d.foodCostPercent.toFixed(1)}%
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    <CurrencyDisplay value={d.totalContribution} />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <Card>
      <CardContent className="space-y-4 py-10 text-center">
        <p className="text-sm text-muted-foreground">
          Export the item sales report from your POS as CSV and import it here.
        </p>
        <p className="mx-auto flex max-w-xl gap-2 text-left text-sm text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" />
          <span>
            The file needs a column of item names and a column of quantities
            sold. A column of net sales is used when present. Rows naming
            something this kitchen has no recipe for — category headings and
            totals among them — are listed as skipped rather than imported, so
            nothing is counted twice.
          </span>
        </p>
      </CardContent>
    </Card>
  );
}

/** Guess a period name and dates from the filename, to be corrected. */
function guessPeriod(filename: string): { name: string; start: string; end: string } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const end = new Date(now.getFullYear(), now.getMonth(), 0);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const stem = filename.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
  return { name: stem || "Sales period", start: iso(start), end: iso(end) };
}

function SavePeriodDialog({
  result,
  filename,
  showSkipped,
  onToggleSkipped,
  onClose,
  onSaved,
}: {
  result: SalesMixImport;
  filename: string;
  showSkipped: boolean;
  onToggleSkipped: () => void;
  onClose: () => void;
  onSaved: (period: SalesPeriod) => void | Promise<void>;
}) {
  const guess = useMemo(() => guessPeriod(filename), [filename]);
  const [name, setName] = useState(guess.name);
  const [start, setStart] = useState(guess.start);
  const [end, setEnd] = useState(guess.end);
  const [saving, setSaving] = useState(false);

  const datesValid = Boolean(start && end && end >= start);
  const canSave = result.lines.length > 0 && name.trim() !== "" && datesValid;

  async function save() {
    setSaving(true);
    try {
      const period = await saveSalesPeriod(
        {
          name: name.trim(),
          startsOn: start,
          endsOn: end,
          source: "IMPORT",
          sourceFile: filename,
        },
        result.lines.map((l) => ({
          recipeId: l.recipe.id,
          unitsSold: l.unitsSold,
          netSales: l.netSales,
        })),
      );
      toast.success(`Saved ${period.name}`, {
        description: `${result.lines.length} dishes recorded.`,
      });
      await onSaved(period);
    } catch (err) {
      toast.error("Could not save the period", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Save this sales period</DialogTitle>
          <DialogDescription>
            Read {filename}: matched {result.lines.length} dish
            {result.lines.length === 1 ? "" : "es"}
            {result.matchedOn && (
              <>
                {" "}
                on &ldquo;{result.matchedOn.name}&rdquo; and &ldquo;
                {result.matchedOn.units}&rdquo;
              </>
            )}
            .
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2 sm:col-span-3">
              <Label htmlFor="period-name">Name</Label>
              <Input
                id="period-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="period-start">From</Label>
              <Input
                id="period-start"
                type="date"
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="period-end">To</Label>
              <Input
                id="period-end"
                type="date"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </div>
          </div>

          {!datesValid && (
            <p className="text-sm text-status-danger">
              The end of the period cannot be before its start.
            </p>
          )}

          {result.problems.length > 0 && (
            <div className="rounded-lg border border-status-warning bg-status-warning-soft p-3">
              <div className="flex items-center gap-2 text-sm font-medium text-status-warning">
                <TriangleAlert className="size-4" />
                {result.problems.length} row
                {result.problems.length === 1 ? "" : "s"} could not be read
              </div>
              <ul className="mt-2 max-h-32 space-y-1 overflow-y-auto text-sm">
                {result.problems.map((p) => (
                  <li key={`${p.line}-${p.name}`}>
                    Line {p.line}
                    {p.name && <> &mdash; {p.name}</>}: {p.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.skipped.length > 0 && (
            <div>
              <button
                type="button"
                className="text-sm underline underline-offset-2"
                onClick={onToggleSkipped}
              >
                {showSkipped ? "Hide" : "Show"} {result.skipped.length} skipped
                row{result.skipped.length === 1 ? "" : "s"}
              </button>
              <p className="mt-1 text-xs text-muted-foreground">
                Category headings and anything this kitchen has no recipe for.
                Check a real dish is not among them.
              </p>
              {showSkipped && (
                <div className="mt-2 max-h-48 overflow-y-auto rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Not matched</TableHead>
                        <TableHead className="text-right">Quantity</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {result.skipped.map((s) => (
                        <TableRow key={s.name}>
                          <TableCell>{s.name}</TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">
                            {s.unitsSold.toLocaleString()}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          )}

          {result.lines.length === 0 && (
            <p className="text-sm text-status-danger">
              Nothing in that file matched a recipe by name, so there is nothing
              to save. The dishes may be named differently in the POS.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={!canSave || saving}>
            Save period
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
