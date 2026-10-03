// ---------------------------------------------------------------------------
// Production planning — SRS 4.11, PRO-FUNC-001, PRO-FUNC-002 AC6, INV-FUNC-005
// ---------------------------------------------------------------------------
// A chef types expected covers per dish; the page answers with what to make
// and what to pull. Those are two sheets for two people — the prep cook works
// the first, whoever opens the store works the second — so they print apart.
//
// The plan is recomputed as you type rather than behind a "Calculate" button.
// Covers are a guess being adjusted, and seeing the shortfall move while you
// adjust it is the whole point.
//
// Two more tabs, and they are the reason the page now writes as well as reads:
// what was actually made, and what that used against what the recipes expect.
// A prep list that nobody records against produces no variance figure, and the
// variance figure is the single most valuable number inventory can give a
// kitchen — it is where over-portioning, waste and theft become visible.
//
// Recording is a write to two tables at once, so it goes through one database
// function rather than two calls from here. A batch that exists without its
// consumption reads as a kitchen producing food from nothing.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useState } from "react";
import { Factory, Printer, Search, TriangleAlert, X,
  ChefHat, PackageOpen, ClipboardCheck, Scale, PencilLine,
} from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { PermissionGate } from "@/components/shared/permission-gate";
import { CurrencyDisplay } from "@/components/shared/currency-display";
import { StatusChip, type StatusTone } from "@/components/shared/status-chip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useProductStore } from "@/stores/product-store";
import { useRecipeStore } from "@/stores/recipe-store";
import { useSubRecipeStore } from "@/stores/sub-recipe-store";
import { planProduction, type PrepTask } from "@/engine/production";
import { toDecimal } from "@/engine/cost-engine";
import {
  proposeCompletion,
  completionCost,
  recordableTasks,
  varianceVerdict,
  compareVarianceRows,
  summariseVariance,
  suggestLot,
  type LotChoice,
  type ConsumptionLine,
  type VarianceRow,
  type VarianceVerdict,
} from "@/engine/production-records";
import {
  fetchStockLevels,
  fetchProductionRecords,
  fetchProductionVariance,
  fetchVarianceTolerance,
  ensureProductionPlan,
  recordProduction,
  fetchStockLots,
  type ProductionRecordRow,
} from "@/data/repository";
import { isSupabaseConfigured } from "@/lib/supabase";

/** Covers survive a reload — a service plan is not worth retyping. */
const STORAGE_KEY = "ccos-production-covers";

function loadCovers(): Record<string, number> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch {
    return {};
  }
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

const VERDICT: Record<VarianceVerdict, { label: string; tone: StatusTone }> = {
  over: { label: "Over", tone: "danger" },
  under: { label: "Under", tone: "warning" },
  within: { label: "On target", tone: "success" },
  incomparable: { label: "Cannot compare", tone: "neutral" },
};

export function ProductionPage() {
  const products = useProductStore((s) => s.products);
  const recipes = useRecipeStore((s) => s.recipes);
  const subRecipes = useSubRecipeStore((s) => s.subRecipes);

  const [covers, setCovers] = useState<Record<string, number>>(loadCovers);
  const [query, setQuery] = useState("");
  const [levels, setLevels] = useState<Map<string, { onHand: number }>>(new Map());

  const [records, setRecords] = useState<ProductionRecordRow[]>([]);
  const [recording, setRecording] = useState<PrepTask | null>(null);
  const [correcting, setCorrecting] = useState<ProductionRecordRow | null>(null);

  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [variance, setVariance] = useState<VarianceRow[]>([]);
  const [tolerance, setTolerance] = useState(5);
  const [loadingVariance, setLoadingVariance] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    fetchStockLevels()
      .then(setLevels)
      .catch((err) =>
        toast.error("Could not read stock levels", {
          description:
            err instanceof Error
              ? `${err.message}. The pull list will show what is needed, but not what is missing.`
              : String(err),
        }),
      );
    fetchVarianceTolerance().then(setTolerance).catch(() => {
      // Falls back to the seeded 5%. Not worth interrupting the plan for.
    });
  }, []);

  const loadRecords = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    try {
      setRecords(await fetchProductionRecords(`${today()}T00:00:00Z`));
    } catch (err) {
      toast.error("Could not read what has been made", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  const loadVariance = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    setLoadingVariance(true);
    try {
      setVariance(await fetchProductionVariance(from, to));
    } catch (err) {
      toast.error("Could not work out the variance", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setLoadingVariance(false);
    }
  }, [from, to]);

  useEffect(() => {
    void loadRecords();
  }, [loadRecords]);
  useEffect(() => {
    void loadVariance();
  }, [loadVariance]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(covers));
    } catch {
      // A full or blocked store is not worth interrupting the plan for.
    }
  }, [covers]);

  const planned = useMemo(
    () =>
      Object.entries(covers)
        .filter(([, n]) => n > 0)
        .map(([recipeId, n]) => ({ recipeId, covers: n })),
    [covers],
  );

  const plan = useMemo(
    () => planProduction(planned, { products, subRecipes, recipes }, levels),
    [planned, products, subRecipes, recipes, levels],
  );

  const plannedRecipes = useMemo(
    () =>
      planned
        .map((p) => recipes.find((r) => r.id === p.recipeId))
        .filter((r): r is NonNullable<typeof r> => Boolean(r)),
    [planned, recipes],
  );

  /** Batches already recorded today, per preparation, so the sheet says so. */
  const recordedBatches = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of records) {
      map.set(r.subRecipeId, (map.get(r.subRecipeId) ?? 0) + r.batches);
    }
    return map;
  }, [records]);

  const tasks = useMemo(
    () => recordableTasks(plan.prep, recordedBatches),
    [plan.prep, recordedBatches],
  );

  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return recipes
      .filter((r) => r.name.toLowerCase().includes(q) && !covers[r.id])
      .slice(0, 8);
  }, [query, recipes, covers]);

  const totalCovers = planned.reduce((n, p) => n + p.covers, 0);

  function setCover(id: string, value: number) {
    setCovers((c) => ({ ...c, [id]: value }));
  }

  function removeDish(id: string) {
    setCovers((c) => {
      const next = { ...c };
      delete next[id];
      return next;
    });
  }

  /**
   * Write the batch, and the sheet it was made against.
   *
   * The plan is saved here rather than behind a Save button, because covers
   * live in one browser's local storage and a record pointing at nothing is a
   * record nobody can argue about later. Saving it only when something is
   * actually recorded keeps the venue from collecting forty empty sheets a day.
   */
  async function write(input: {
    subRecipeId: string;
    batches: number;
    unit: string;
    consumption: ConsumptionLine[];
    /** Product id to the lot it came off, where the venue tracks lots. */
    lots: Record<string, string | null>;
    note: string | null;
    correctsId?: string | null;
    correctionReason?: string | null;
  }) {
    let planId: string | null = null;
    if (planned.length > 0 && !input.correctsId) {
      try {
        planId = await ensureProductionPlan({
          plannedFor: today(),
          service: null,
          covers: planned.map((p) => ({ recipeId: p.recipeId, covers: p.covers })),
        });
      } catch (err) {
        // The batch is still worth recording without the sheet. Losing the
        // link is a smaller loss than losing the completion.
        toast.warning("The prep list could not be saved", {
          description:
            err instanceof Error
              ? `${err.message}. The batch will be recorded without it.`
              : String(err),
        });
      }
    }
    await recordProduction({
      subRecipeId: input.subRecipeId,
      batches: input.batches,
      unit: input.unit,
      planId,
      note: input.note,
      correctsId: input.correctsId ?? null,
      correctionReason: input.correctionReason ?? null,
      consumption: input.consumption.map((c) => ({
        productId: c.productId,
        quantity: c.quantity,
        unit: c.unit,
        unitCost: c.unitCost,
        /*
         * The forward step of Article 18, and the line this screen was
         * missing. Without it every movement the dialog wrote had a null lot,
         * so `lot_forward_trace` came back empty for every lot in the venue —
         * which reads as "nothing to report" rather than as "this screen never
         * filled it in". The database half had been built and proved; nothing
         * was calling it.
         */
        lotId: input.lots[c.productId] ?? null,
      })),
    });
    await Promise.all([loadRecords(), loadVariance()]);
    setLevels(await fetchStockLevels());
  }

  return (
    <div>
      <PageHeader
        title="Production"
        description="Expected covers in, prep list and pull list out. Record what was actually made and the variance against the recipes follows."
      >
        <Button
          variant="outline"
          onClick={() => window.print()}
          disabled={plan.prep.length === 0 && plan.pull.length === 0}
        >
          <Printer />
          Print
        </Button>
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
        <Card className="print:hidden">
          <CardHeader>
            <CardTitle className="text-base">Expected covers</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Add a dish"
                aria-label="Add a dish to the plan"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>

            {searchResults.length > 0 && (
              <ul className="rounded-md border">
                {searchResults.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      className="w-full px-3 py-2 text-left text-sm hover:bg-muted"
                      onClick={() => {
                        setCover(r.id, 10);
                        setQuery("");
                      }}
                    >
                      {r.name}
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {plannedRecipes.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Search for a dish to start the plan.
              </p>
            ) : (
              <ul className="space-y-2">
                {plannedRecipes.map((r) => (
                  <li key={r.id} className="flex items-center gap-2">
                    <span className="flex-1 truncate text-sm">{r.name}</span>
                    <Input
                      type="number"
                      min="0"
                      className="w-20 text-right"
                      aria-label={`Covers for ${r.name}`}
                      value={covers[r.id] ?? ""}
                      onChange={(e) => setCover(r.id, Number(e.target.value) || 0)}
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => removeDish(r.id)}
                      aria-label={`Remove ${r.name} from the plan`}
                    >
                      <X className="size-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}

            {totalCovers > 0 && (
              <p className="border-t pt-3 text-sm text-muted-foreground">
                {totalCovers} covers across {plannedRecipes.length} dish
                {plannedRecipes.length === 1 ? "" : "es"}
              </p>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          {plan.problems.length > 0 && (
            <div className="rounded-lg border border-status-warning bg-status-warning-soft p-4">
              <div className="flex items-center gap-2 font-medium text-status-warning">
                <TriangleAlert className="size-4" />
                The plan is incomplete
              </div>
              <ul className="mt-2 space-y-1 text-sm">
                {[...new Set(plan.problems)].map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
          )}

          <Tabs defaultValue={totalCovers === 0 ? "variance" : "prep"}>
            <TabsList className="print:hidden">
              <TabsTrigger value="prep">
                <Factory className="size-4" />
                Prep list ({plan.prep.length})
              </TabsTrigger>
              <TabsTrigger value="pull">Pull list ({plan.pull.length})</TabsTrigger>
              <TabsTrigger value="made">
                <ClipboardCheck className="size-4" />
                Made today ({records.length})
              </TabsTrigger>
              <TabsTrigger value="variance">
                <Scale className="size-4" />
                Variance
              </TabsTrigger>
            </TabsList>

            <TabsContent value="prep" className="mt-4">
              {totalCovers === 0 ? (
                <EmptyState icon={Factory} title="Nothing planned yet">
                  Enter how many covers you expect of each dish and this becomes the prep
                  list — every preparation exploded out, in the order it has to be made,
                  with a button on each row to record what was actually produced.
                </EmptyState>
              ) : (
                <PrepList
                  plan={plan}
                  tasks={tasks}
                  onRecord={(task) => setRecording(task)}
                />
              )}
            </TabsContent>

            <TabsContent value="pull" className="mt-4">
              {totalCovers === 0 ? (
                <EmptyState icon={PackageOpen} title="Nothing planned yet">
                  The pull list is what has to come out of the store for the batches on
                  the prep list, with whatever is already on the shelf subtracted.
                </EmptyState>
              ) : (
                <PullList plan={plan} />
              )}
            </TabsContent>

            <TabsContent value="made" className="mt-4">
              <MadeToday records={records} onCorrect={(r) => setCorrecting(r)} />
            </TabsContent>

            <TabsContent value="variance" className="mt-4">
              <VarianceReport
                rows={variance}
                tolerance={tolerance}
                from={from}
                to={to}
                loading={loadingVariance}
                onFrom={setFrom}
                onTo={setTo}
              />
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {recording && (
        <RecordDialog
          subRecipeId={recording.subRecipe.id}
          suggestedBatches={recording.batches}
          onClose={() => setRecording(null)}
          onWrite={write}
        />
      )}
      {correcting && (
        <RecordDialog
          subRecipeId={correcting.subRecipeId}
          suggestedBatches={correcting.batches}
          correcting={correcting}
          onClose={() => setCorrecting(null)}
          onWrite={write}
        />
      )}
    </div>
  );
}

function PrepList({
  plan,
  tasks,
  onRecord,
}: {
  plan: ReturnType<typeof planProduction>;
  tasks: ReturnType<typeof recordableTasks>;
  onRecord: (task: PrepTask) => void;
}) {
  if (plan.prep.length === 0) {
    return (
      <EmptyState icon={ChefHat} title="Nothing to prepare">
        None of the dishes you have planned are built on a preparation, so there is
        nothing to make ahead.
      </EmptyState>
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground print:hidden">
        In order: anything a later preparation is built on comes first. Record a batch
        as it comes off the stove — the variance report is built from these.
      </p>
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8">#</TableHead>
              <TableHead>Preparation</TableHead>
              <TableHead className="text-right">Needed</TableHead>
              <TableHead className="text-right">Batches</TableHead>
              <TableHead className="text-right">Making</TableHead>
              <TableHead>For</TableHead>
              <TableHead className="w-40 text-center">Made</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tasks.map(({ task, recordable, reason, batchesRecorded }, i) => (
              <TableRow key={task.subRecipe.id}>
                <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                <TableCell>
                  <div className="font-medium">{task.subRecipe.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {task.batchYield} {task.unit} per batch
                  </div>
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {task.quantityNeeded} {task.unit}
                </TableCell>
                <TableCell className="text-right tabular-nums font-medium">
                  {task.batches || "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {task.quantityMade} {task.unit}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {task.drivenBy.join(", ")}
                </TableCell>
                <TableCell className="text-center text-sm">
                  {/* A box to tick on the printed sheet — PRO-FUNC-001 AC6. */}
                  <span className="hidden print:inline-block size-4 rounded border" />
                  <span className="print:hidden">
                    {!recordable ? (
                      <span className="text-xs text-status-warning">{reason}</span>
                    ) : (
                      <PermissionGate>
                        <Button
                          size="sm"
                          variant={batchesRecorded > 0 ? "ghost" : "outline"}
                          onClick={() => onRecord(task)}
                        >
                          {batchesRecorded > 0
                            ? `${batchesRecorded} recorded — add`
                            : "Record"}
                        </Button>
                      </PermissionGate>
                    )}
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function PullList({ plan }: { plan: ReturnType<typeof planProduction> }) {
  const short = plan.pull.filter((l) => l.shortfall > 0);

  if (plan.pull.length === 0) {
    return (
      <EmptyState icon={PackageOpen} title="Nothing to pull">
        The pull list is what has to come out of the store for the batches above,
        with whatever is already on the shelf subtracted.
      </EmptyState>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <span className="text-muted-foreground">
          {plan.pull.length} ingredients,{" "}
          <span className="font-medium text-foreground">
            <CurrencyDisplay value={plan.totalCost} />
          </span>{" "}
          at current prices
        </span>
        {short.length > 0 && (
          <span className="font-medium text-status-warning">
            {short.length} short of what is on the shelf
          </span>
        )}
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Ingredient</TableHead>
              <TableHead className="text-right">Needed</TableHead>
              <TableHead className="text-right">On hand</TableHead>
              <TableHead className="text-right">Short by</TableHead>
              <TableHead className="text-right">Cost</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {plan.pull.map((l) => (
              <TableRow key={l.product.id}>
                <TableCell>
                  <div className="font-medium">{l.product.name}</div>
                  {l.product.supplier && (
                    <div className="text-xs text-muted-foreground">
                      {l.product.supplier}
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {l.grossQty} {l.unit}
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {l.onHand || "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums font-medium">
                  {l.shortfall > 0 ? (
                    <span className="text-status-warning">
                      {l.shortfall} {l.unit}
                    </span>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  <CurrencyDisplay value={l.estimatedCost} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

/**
 * What has been recorded today.
 *
 * Corrections are offered rather than edits, because the record is append-only
 * and the database has no update grant at all. Both rows stay readable; this
 * list shows the one that counts.
 */
function MadeToday({
  records,
  onCorrect,
}: {
  records: ProductionRecordRow[];
  onCorrect: (record: ProductionRecordRow) => void;
}) {
  if (records.length === 0) {
    return (
      <EmptyState icon={ClipboardCheck} title="Nothing recorded today">
        Record a batch from the prep list as it comes off the stove. Until something is
        recorded there is no "should have used" figure, so the variance report has
        nothing to compare the stock ledger against.
      </EmptyState>
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        A completion cannot be edited. A correction is a new record naming this one, and
        both stay visible — the same rule as the stock ledger.
      </p>
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Preparation</TableHead>
              <TableHead className="text-right">Batches</TableHead>
              <TableHead className="text-right">Made</TableHead>
              <TableHead>By</TableHead>
              <TableHead>At</TableHead>
              <TableHead>Note</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {records.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  <div className="font-medium">{r.preparationName}</div>
                  {r.recipeChangedSince && (
                    <div className="text-xs text-status-warning">
                      The preparation has been edited since this batch was made, so what
                      it should have used is derived from a different recipe.
                    </div>
                  )}
                  {r.correctionReason && (
                    <div className="text-xs text-muted-foreground">
                      Correction: {r.correctionReason}
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">{r.batches}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {r.quantityMade} {r.unit}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {r.producedByEmail ?? "Not recorded"}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {r.occurredAt ? new Date(r.occurredAt).toLocaleTimeString() : "—"}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {r.note ?? "—"}
                </TableCell>
                <TableCell>
                  <PermissionGate>
                    <Button size="sm" variant="ghost" onClick={() => onCorrect(r)}>
                      <PencilLine className="size-4" />
                      Correct
                    </Button>
                  </PermissionGate>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

/**
 * Record a batch, or correct one.
 *
 * The consumption is pre-filled from the recipe and then edited by hand, which
 * is the point: the pre-filled figure is the theoretical one, and typing over
 * it is how the actual one gets into the system. A line the recipe and the
 * shelf measure differently is left out and named rather than converted —
 * guessing a factor from two unit names is how grams become kilograms.
 */
function RecordDialog({
  subRecipeId,
  suggestedBatches,
  correcting,
  onClose,
  onWrite,
}: {
  subRecipeId: string;
  suggestedBatches: number;
  correcting?: ProductionRecordRow;
  onClose: () => void;
  onWrite: (input: {
    subRecipeId: string;
    batches: number;
    unit: string;
    consumption: ConsumptionLine[];
    lots: Record<string, string | null>;
    note: string | null;
    correctsId?: string | null;
    correctionReason?: string | null;
  }) => Promise<void>;
}) {
  const products = useProductStore((s) => s.products);
  const subRecipes = useSubRecipeStore((s) => s.subRecipes);
  const sub = subRecipes.find((s) => s.id === subRecipeId);

  const [batches, setBatches] = useState(String(suggestedBatches || 1));
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [lotPicks, setLotPicks] = useState<Record<string, string>>({});
  const [lots, setLots] = useState<LotChoice[]>([]);
  const [busy, setBusy] = useState(false);

  /*
   * Loaded here rather than by the page, because this is the only screen that
   * asks and a venue can hold several thousand of them.
   */
  useEffect(() => {
    let live = true;
    void fetchStockLots()
      .then((rows) => {
        if (!live) return;
        setLots(rows.map((l) => ({
          id: l.id,
          productId: l.productId,
          lotCode: l.lotCode,
          receivedOn: l.receivedOn,
          expiresOn: l.expiresOn,
          status: l.status,
        })));
      })
      .catch(() => {
        /*
         * A batch is still worth recording without the lot. Losing the forward
         * step is a smaller loss than losing the completion, which is the same
         * trade the prep-sheet save above makes.
         */
        if (live) setLots([]);
      });
    return () => { live = false; };
  }, []);

  const count = Number(batches);
  const batchesValid = batches.trim() !== "" && Number.isFinite(count) && count > 0;

  const proposal = useMemo(
    () => (sub && batchesValid ? proposeCompletion(sub, count, products) : null),
    [sub, batchesValid, count, products],
  );

  /**
   * What will actually be written: the proposal with anything typed over it.
   *
   * The line cost is recomputed rather than carried over. It was not, at
   * first, and the figure under the table went on reporting what the recipe
   * would have cost while the quantities above it said something else — the
   * one number on this dialog whose job is to reflect what was typed.
   */
  const consumption = useMemo<ConsumptionLine[]>(() => {
    if (!proposal) return [];
    return proposal.consumption.map((line) => {
      const typed = overrides[line.productId];
      if (typed === undefined || typed.trim() === "") return line;
      const qty = Number(typed);
      if (!Number.isFinite(qty) || qty < 0) return line;
      return {
        ...line,
        quantity: qty,
        lineCost: toDecimal(line.unitCost).times(qty).toFixed(2),
      };
    });
  }, [proposal, overrides]);

  /*
   * What each line will be filed against: whatever the cook picked, or the
   * suggestion, or nothing where the venue does not lot-track that product.
   *
   * The suggestion is first expired, first out — `suggestLot` — and it is a
   * default rather than a decision. A blank default would have been the honest
   * UI choice and the dishonest food-safety one: nobody picks a lot off a
   * dropdown for every ingredient of every batch, so the field would stay
   * empty and Article 18's forward step would stay unanswerable.
   */
  const chosenLots = useMemo<Record<string, string | null>>(() => {
    const picks: Record<string, string | null> = {};
    for (const line of consumption) {
      const available = lots.filter((l) => l.productId === line.productId);
      const typed = lotPicks[line.productId];
      picks[line.productId] = typed !== undefined
        ? (typed === "" ? null : typed)
        : (suggestLot(available)?.id ?? null);
    }
    return picks;
  }, [consumption, lots, lotPicks]);

  /*
   * Only the ingredients that have a usable lot to offer. `suggestLot` already
   * decides what usable means — status OK — and the database refuses the rest,
   * so offering one is offering a refusal.
   */
  const lotRows = useMemo(
    () =>
      consumption
        .map((line) => ({
          productId: line.productId,
          productName: line.productName,
          choices: lots
            .filter((l) => l.productId === line.productId && l.status === "OK")
            .sort((a, b) => {
              if (a.expiresOn !== b.expiresOn) {
                if (a.expiresOn === null) return 1;
                if (b.expiresOn === null) return -1;
                return a.expiresOn < b.expiresOn ? -1 : 1;
              }
              return a.receivedOn < b.receivedOn ? -1 : 1;
            }),
        }))
        .filter((row) => row.choices.length > 0),
    [consumption, lots],
  );

  const quantitiesValid = Object.values(overrides).every(
    (v) => v.trim() === "" || (Number.isFinite(Number(v)) && Number(v) >= 0),
  );
  const valid =
    Boolean(sub) &&
    batchesValid &&
    quantitiesValid &&
    (!correcting || reason.trim() !== "");

  async function submit() {
    if (!valid || !sub) return;
    setBusy(true);
    try {
      await onWrite({
        subRecipeId,
        batches: count,
        unit: sub.batchYield.unit,
        consumption,
        lots: chosenLots,
        note: note.trim() || null,
        correctsId: correcting?.id ?? null,
        correctionReason: correcting ? reason.trim() : null,
      });
      toast.success(
        correcting
          ? `Corrected to ${count} batch${count === 1 ? "" : "es"} of ${sub.name}`
          : `Recorded ${count} batch${count === 1 ? "" : "es"} of ${sub.name}`,
      );
      onClose();
    } catch (err) {
      // The database refuses a wrong unit, a preparation with no yield and a
      // correction with no reason. Its message is the useful one, so it is
      // shown rather than replaced with something reassuring.
      toast.error(correcting ? "Could not record the correction" : "Could not record the batch", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  }

  if (!sub) return null;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {correcting ? "Correct" : "Record"} production — {sub.name}
          </DialogTitle>
          <DialogDescription>
            {correcting
              ? "The original record stays. This one supersedes it, and the stock it consumed is put back and taken again."
              : `One batch yields ${sub.batchYield.qty} ${sub.batchYield.unit}. What is pre-filled below is what the recipe says; type over it with what was actually used.`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="batches">Batches made</Label>
              <Input
                id="batches"
                type="number"
                min="0"
                step="any"
                autoFocus
                value={batches}
                onChange={(e) => setBatches(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {batchesValid
                  ? `${Math.round(count * sub.batchYield.qty * 1000) / 1000} ${sub.batchYield.unit}`
                  : "A part batch is allowed — say what was made rather than rounding."}
              </p>
            </div>
            {correcting && (
              <div className="space-y-2">
                <Label htmlFor="correction-reason">Why</Label>
                <Input
                  id="correction-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="What was wrong with the first record"
                />
              </div>
            )}
          </div>

          {proposal && proposal.problems.length > 0 && (
            <div className="rounded-lg border border-status-warning bg-status-warning-soft p-3 text-sm">
              <ul className="space-y-1">
                {[...new Set(proposal.problems)].map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
          )}

          {/*
            * A stacked list rather than a table.
            *
            * Three columns of quantities overflowed the dialog on anything
            * narrower than a laptop and the input ended up off the edge, which
            * is the one control on this screen that has to be reachable. The
            * expected figure sits under the name instead, where it still reads
            * as the thing being typed over.
            */}
          {consumption.length > 0 && (
            <ul className="divide-y rounded-lg border">
              {proposal!.consumption.map((line) => (
                <li
                  key={line.productId}
                  className="flex items-center gap-3 px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">
                      {line.productName}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      The recipe says {line.quantity} {line.unit}
                    </div>
                  </div>
                  <Input
                    type="number"
                    min="0"
                    step="any"
                    className="w-28 shrink-0 text-right"
                    aria-label={`Quantity of ${line.productName} actually used`}
                    placeholder={String(line.quantity)}
                    value={overrides[line.productId] ?? ""}
                    onChange={(e) =>
                      setOverrides((o) => ({
                        ...o,
                        [line.productId]: e.target.value,
                      }))
                    }
                  />
                  <span className="w-8 shrink-0 text-sm text-muted-foreground">
                    {line.unit}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {/*
            * The lot each ingredient came off, where the venue tracks them.
            *
            * Separate from the quantity rows above rather than a fourth column
            * on them: those rows already overflowed at laptop width, which is
            * why they are a stacked list and not a table. Shown only for the
            * ingredients that actually have lots, so a venue that lot-tracks
            * two products out of forty sees two rows and not forty "—"s.
            */}
          {lotRows.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Which delivery each came off. First expired, first out is filled in;
                change it if the shelf says otherwise. This is what lets a recall be
                followed forward to the batch.
              </p>
              <ul className="divide-y rounded-lg border">
                {lotRows.map((row) => (
                  <li key={row.productId} className="flex items-center gap-3 px-3 py-2">
                    <div className="min-w-0 flex-1 truncate text-sm">{row.productName}</div>
                    <select
                      className="h-9 w-56 shrink-0 rounded-md border bg-transparent px-2 text-sm"
                      aria-label={`Lot of ${row.productName} used`}
                      value={chosenLots[row.productId] ?? ""}
                      onChange={(e) =>
                        setLotPicks((o) => ({ ...o, [row.productId]: e.target.value }))
                      }
                    >
                      {/* Not naming one is allowed and is not the default. */}
                      <option value="">Not recorded</option>
                      {row.choices.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.expiresOn ? `${c.lotCode} · ${c.expiresOn}` : c.lotCode}
                        </option>
                      ))}
                    </select>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {proposal && proposal.consumption.length > 0 && (
            <p className="text-sm text-muted-foreground">
              <CurrencyDisplay value={completionCost({ ...proposal, consumption })} /> at
              current prices. Every line below goes on the stock ledger as usage, so the
              shelf drops by what was really taken.
            </p>
          )}

          <div className="space-y-2">
            <Label htmlFor="record-note">Note (optional)</Label>
            <Textarea
              id="record-note"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Anything about this batch worth remembering"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={!valid || busy}>
            {correcting ? "Record the correction" : "Record"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Theoretical against actual — SRS INV-FUNC-005.
 *
 * The rows that cannot be compared are shown with their reason rather than
 * dropped or zeroed. A report that only listed the ingredients where both
 * sides happened to be known would read as complete and would be the easiest
 * place in this system to hide a problem.
 */
function VarianceReport({
  rows,
  tolerance,
  from,
  to,
  loading,
  onFrom,
  onTo,
}: {
  rows: VarianceRow[];
  tolerance: number;
  from: string;
  to: string;
  loading: boolean;
  onFrom: (v: string) => void;
  onTo: (v: string) => void;
}) {
  const sorted = useMemo(
    () => [...rows].sort((a, b) => compareVarianceRows(a, b, tolerance)),
    [rows, tolerance],
  );
  const summary = useMemo(() => summariseVariance(rows, tolerance), [rows, tolerance]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-4 print:hidden">
        <div className="space-y-2">
          <Label htmlFor="variance-from">From</Label>
          <Input
            id="variance-from"
            type="date"
            value={from}
            onChange={(e) => onFrom(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="variance-to">To</Label>
          <Input
            id="variance-to"
            type="date"
            value={to}
            onChange={(e) => onTo(e.target.value)}
          />
        </div>
        <p className="text-sm text-muted-foreground">
          Flagged above {tolerance}% either way — the venue's own tolerance.
        </p>
      </div>

      {rows.length === 0 ? (
        <EmptyState icon={Scale} title={loading ? "Working it out" : "Nothing to compare"}>
          This sets what the recipes say should have been used against what the stock
          ledger says was. It needs two things in the period: a batch recorded as made,
          and usage on the ledger. Record something on the prep list and it fills in.
        </EmptyState>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryCard
              label="Used more than expected"
              value={<CurrencyDisplay value={summary.overCost} />}
              detail={`${summary.over} ingredient${summary.over === 1 ? "" : "s"} over tolerance`}
            />
            <SummaryCard
              label="Net difference"
              value={<CurrencyDisplay value={summary.netCost} />}
              detail="Overruns and shortfalls netted off — read it beside the figure on the left"
            />
            <SummaryCard
              label="On target"
              value={String(summary.within)}
              detail={`within ${tolerance}%`}
            />
            <SummaryCard
              label="Cannot be compared"
              value={String(summary.incomparable)}
              detail="Each one says why, and each one is a finding"
            />
          </div>

          {summary.recipeChanged > 0 && (
            <div className="rounded-lg border border-status-warning bg-status-warning-soft p-3 text-sm">
              {summary.recipeChanged} ingredient
              {summary.recipeChanged === 1 ? "" : "s"} sit on a preparation that has been
              edited since a batch of it was recorded. The expected figure is derived from
              the recipe as it is now, not the one the cook worked from.
            </div>
          )}

          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ingredient</TableHead>
                  <TableHead className="text-right">Should have used</TableHead>
                  <TableHead className="text-right">Did use</TableHead>
                  <TableHead className="text-right">Difference</TableHead>
                  <TableHead className="text-right">In money</TableHead>
                  <TableHead>Reading</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((row) => {
                  const verdict = varianceVerdict(row, tolerance);
                  return (
                    <TableRow key={row.productId}>
                      <TableCell>
                        <div className="font-medium">{row.productName}</div>
                        {row.note && (
                          <div className="text-xs text-muted-foreground">{row.note}</div>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.theoreticalQty === null ? (
                          <span className="text-muted-foreground">Not recorded</span>
                        ) : (
                          `${row.theoreticalQty} ${row.unit}`
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.actualQty === null ? (
                          <span className="text-muted-foreground">Not recorded</span>
                        ) : (
                          `${row.actualQty} ${row.unit}`
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-medium">
                        {row.varianceQty === null || row.variancePercent === null ? (
                          "—"
                        ) : (
                          <span
                            className={
                              verdict === "over"
                                ? "text-status-danger"
                                : verdict === "under"
                                  ? "text-status-warning"
                                  : ""
                            }
                          >
                            {row.varianceQty > 0 ? "+" : ""}
                            {row.varianceQty} {row.unit} ({row.variancePercent > 0 ? "+" : ""}
                            {row.variancePercent}%)
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.varianceCost === null ? (
                          "—"
                        ) : (
                          <CurrencyDisplay value={row.varianceCost} />
                        )}
                      </TableCell>
                      <TableCell>
                        <StatusChip tone={VERDICT[verdict].tone}>
                          {VERDICT[verdict].label}
                        </StatusChip>
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
  );
}

function SummaryCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: React.ReactNode;
  detail: string;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
        <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  );
}
