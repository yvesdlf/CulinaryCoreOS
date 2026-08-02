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
// What is imported is held in the browser, not the database. That is a real
// limitation and it is stated on the page: the analysis is reproducible from
// the same file, but nobody else sees it and it does not survive a different
// machine. Persisting a sales period properly is a schema change worth doing
// on its own rather than smuggling in here.
// ---------------------------------------------------------------------------

import { useMemo, useRef, useState } from "react";
import {
  Upload,
  TriangleAlert,
  Star,
  Tractor,
  Puzzle,
  Dog,
  Info,
} from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { CurrencyDisplay } from "@/components/shared/currency-display";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

const QUADRANT: Record<
  MenuClass,
  { icon: typeof Star; className: string; dot: string }
> = {
  star: {
    icon: Star,
    className: "bg-status-success-soft text-status-success",
    dot: "bg-status-success",
  },
  plowhorse: {
    icon: Tractor,
    className: "bg-status-info-soft text-status-info",
    dot: "bg-status-info",
  },
  puzzle: {
    icon: Puzzle,
    className: "bg-status-warning-soft text-status-warning",
    dot: "bg-status-warning",
  },
  dog: {
    icon: Dog,
    className: "bg-status-danger-soft text-status-danger",
    dot: "bg-status-danger",
  },
};

const ORDER: MenuClass[] = ["star", "plowhorse", "puzzle", "dog"];

export function MenuEngineeringPage() {
  const recipes = useRecipeStore((s) => s.recipes);
  const fileInput = useRef<HTMLInputElement>(null);
  const [imported, setImported] = useState<SalesMixImport | null>(null);
  const [filename, setFilename] = useState("");
  const [showSkipped, setShowSkipped] = useState(false);

  const menu = useMemo(
    () => engineerMenu(imported?.lines ?? []),
    [imported],
  );

  async function handleFile(file: File) {
    const text = await file.text();
    setFilename(file.name);
    setImported(parseSalesMix(parseCsv(text), recipes));
  }

  return (
    <div>
      <PageHeader
        title="Menu Engineering"
        description="Which dishes sell, which pay, and which do neither. Import a sales export from the POS to see it."
      >
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
          {imported ? "Import another" : "Import sales"}
        </Button>
      </PageHeader>

      {!imported ? (
        <EmptyState />
      ) : (
        <div className="space-y-6">
          <ImportSummary
            imported={imported}
            filename={filename}
            showSkipped={showSkipped}
            onToggleSkipped={() => setShowSkipped((s) => !s)}
          />

          {menu.dishes.length > 0 && (
            <>
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
                        <div className="text-2xl font-semibold">
                          {menu.counts[c]}
                        </div>
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
                  A dish counts as profitable above{" "}
                  <CurrencyDisplay value={menu.averageContribution} /> per plate,
                  and popular above {menu.popularityThresholdPercent.toFixed(1)}%
                  of covers
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
                          <TableCell className="font-medium">
                            {d.recipe.name}
                          </TableCell>
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
            </>
          )}
        </div>
      )}
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
        <div className="mx-auto max-w-xl space-y-2 text-left text-sm text-muted-foreground">
          <p className="flex gap-2">
            <Info className="mt-0.5 size-4 shrink-0" />
            <span>
              The file needs a column of item names and a column of quantities
              sold. A column of net sales is used when present. Rows naming
              something this kitchen has no recipe for — category headings and
              totals among them — are listed as skipped rather than imported,
              so nothing is counted twice.
            </span>
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function ImportSummary({
  imported,
  filename,
  showSkipped,
  onToggleSkipped,
}: {
  imported: SalesMixImport;
  filename: string;
  showSkipped: boolean;
  onToggleSkipped: () => void;
}) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Read <span className="font-medium text-foreground">{filename}</span>:
        matched {imported.lines.length} dish
        {imported.lines.length === 1 ? "" : "es"} on{" "}
        {imported.matchedOn ? (
          <>
            &ldquo;{imported.matchedOn.name}&rdquo; and &ldquo;
            {imported.matchedOn.units}&rdquo;
          </>
        ) : (
          "no recognised columns"
        )}
        .{" "}
        {imported.skipped.length > 0 && (
          <button
            type="button"
            className="underline underline-offset-2"
            onClick={onToggleSkipped}
          >
            {showSkipped ? "Hide" : "Show"} {imported.skipped.length} skipped
            row{imported.skipped.length === 1 ? "" : "s"}
          </button>
        )}
      </p>

      {imported.problems.length > 0 && (
        <div className="rounded-lg border border-status-warning bg-status-warning-soft p-4">
          <div className="flex items-center gap-2 font-medium text-status-warning">
            <TriangleAlert className="size-4" />
            {imported.problems.length} row
            {imported.problems.length === 1 ? "" : "s"} could not be read
          </div>
          <ul className="mt-2 space-y-1 text-sm">
            {imported.problems.slice(0, 12).map((p) => (
              <li key={`${p.line}-${p.name}`}>
                Line {p.line}
                {p.name && <> &mdash; {p.name}</>}: {p.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {showSkipped && (
        <div className="max-h-72 overflow-y-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Not in this kitchen&rsquo;s recipes</TableHead>
                <TableHead className="text-right">Quantity in file</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {imported.skipped.map((s) => (
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

      {imported.lines.length === 0 && imported.problems.length === 0 && (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Nothing in that file matched a recipe by name. Check the skipped rows
          — the dishes may be named differently in the POS.
        </p>
      )}

      <p className="text-xs text-muted-foreground">
        This analysis lives in your browser only. Importing again replaces it.
      </p>
    </div>
  );
}
