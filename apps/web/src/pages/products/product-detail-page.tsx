// ---------------------------------------------------------------------------
// Product detail / create page
// ---------------------------------------------------------------------------

import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { Save, X, TriangleAlert } from "lucide-react";
import { PriceImpact } from "@/components/products/price-impact";
import { WhereUsed } from "@/components/shared/where-used";
import { toast } from "sonner";
import type { Product, NutritionPer100g, ProductStatus } from "@ccos/shared";
import { FoodLookupPanel } from "@/components/products/food-lookup-panel";
import { ProductSuppliersPanel } from "@/components/products/product-suppliers-panel";

import { useCatalogueLoaded } from "@/hooks/use-catalogue-loaded";
import { PageHeader } from "@/components/layout/page-header";
import { PermissionGate } from "@/components/shared/permission-gate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useProductStore } from "@/stores/product-store";
import { useSubRecipeStore } from "@/stores/sub-recipe-store";
import { useRecipeStore } from "@/stores/recipe-store";
import { DeleteEntity } from "@/components/shared/delete-entity";
import { canDeleteIngredient } from "@/engine/deletion";
import { removeProduct } from "@/stores/persistence";
import {
  updateProductAndCascade,
  describeCascade,
} from "@/stores/cascade-actions";
import { createProduct } from "@/stores/persistence";
import { PRODUCT_CATEGORIES, PRODUCT_STATUSES, UNITS } from "@/lib/constants";

// ── Empty product template ───────────────────────────────────────────────────

function emptyProduct(): Omit<Product, "id" | "createdAt" | "updatedAt"> {
  return {
    name: "",
    brand: null,
    category: PRODUCT_CATEGORIES[0],
    supplier: null,
    supplierId: null,
    status: "ACTIVE" as ProductStatus,
    allergens: [],
    allergensNeedReview: false,
    allergenReviewNote: null,
    parLevel: null,
    reorderPoint: null,
    stockUnit: null,
    version: 1,
    packing: {
      packQty: 1,
      packUnit: "pc",
      unitsPerPack: 1000,
      unitsPerPackUnit: "g",
      totalQty: 1000,
      totalUnit: "g",
    },
    cost: {
      buyingPricePerPack: "0",
      buyingPricePerUnit: "0",
      grossPricePerUnit: "0",
      nettPricePerUnit: "0",
    },
    yield_: {
      grossQty: 1000,
      grossUnit: "g",
      wasteQty: 0,
      wasteUnit: "g",
      nettQty: 1000,
      nettUnit: "g",
      refPercent: 0,
      yieldPercent: 100,
    },
    nutrition: {
      fatG: 0,
      carbsG: 0,
      proteinG: 0,
      vitAMg: 0,
      vitCMg: 0,
      calciumMg: 0,
      ironMg: 0,
      sodiumMg: 0,
      kcal: 0,
    },
  };
}

// ── Component ────────────────────────────────────────────────────────────────

function ProductDetailForm() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const store = useProductStore();
  const subRecipes = useSubRecipeStore((s) => s.subRecipes);
  const recipes = useRecipeStore((s) => s.recipes);

  const isNew = !id;
  const loaded = useCatalogueLoaded();
  const existing = id ? store.getById(id) : undefined;

  // Redirect if editing a non-existent product
  useEffect(() => {
    // Only once the catalogue has actually arrived. On a fresh page load the
    // stores are empty for a moment, and redirecting then made every deep link
    // bounce to the list.
    if (id && !existing && loaded) {
      navigate("/products", { replace: true });
    }
  }, [id, existing, loaded, navigate]);

  // ── Form state ─────────────────────────────────────────────────────────

  const [form, setForm] = useState(() =>
    existing
      ? {
          name: existing.name,
          brand: existing.brand,
          category: existing.category,
          supplier: existing.supplier,
          supplierId: existing.supplierId,
          status: existing.status,
          allergens: existing.allergens,
          // Carried so a save can name the version it was loaded at.
          version: existing.version,
          allergensNeedReview: existing.allergensNeedReview,
          allergenReviewNote: existing.allergenReviewNote,
          parLevel: existing.parLevel,
          reorderPoint: existing.reorderPoint,
          stockUnit: existing.stockUnit,
          packing: { ...existing.packing },
          cost: { ...existing.cost },
          yield_: { ...existing.yield_ },
          nutrition: { ...existing.nutrition },
        }
      : emptyProduct(),
  );

  // Allergens as comma string for editing
  const [allergensText, setAllergensText] = useState(
    form.allergens.join(", "),
  );
  const [needsReview, setNeedsReview] = useState(
    existing?.allergensNeedReview ?? false,
  );

  // ── Field helpers ──────────────────────────────────────────────────────

  const setField = useCallback(
    <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => {
      setForm((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const setPacking = useCallback(
    <K extends keyof Product["packing"]>(
      key: K,
      value: Product["packing"][K],
    ) => {
      setForm((prev) => {
        const packing = { ...prev.packing, [key]: value };
        // Auto-calculate totalQty
        packing.totalQty = packing.packQty * packing.unitsPerPack;
        return { ...prev, packing };
      });
    },
    [],
  );

  const setCost = useCallback(
    <K extends keyof Product["cost"]>(key: K, value: Product["cost"][K]) => {
      setForm((prev) => {
        const cost = { ...prev.cost, [key]: value };
        // Auto-calculate buyingPricePerUnit
        const totalQty = prev.packing.totalQty;
        if (totalQty > 0) {
          const ppPack = parseFloat(cost.buyingPricePerPack) || 0;
          cost.buyingPricePerUnit = (ppPack / totalQty).toFixed(5);
        }
        return { ...prev, cost };
      });
    },
    [],
  );

  const setYield = useCallback(
    (
      key: keyof Product["yield_"],
      value: number | string,
    ) => {
      const numVal = typeof value === "string" ? parseFloat(value) || 0 : value;

      setForm((prev) => {
        const y = { ...prev.yield_, [key]: typeof value === "string" ? value : numVal };

        if (key === "grossQty" || key === "wasteQty") {
          const gross = key === "grossQty" ? numVal : y.grossQty;
          const waste = key === "wasteQty" ? numVal : y.wasteQty;
          y.grossQty = gross;
          y.wasteQty = waste;
          y.nettQty = gross - waste;
          y.refPercent = gross > 0 ? round2((waste / gross) * 100) : 0;
          y.yieldPercent = round2(100 - y.refPercent);
        } else if (key === "refPercent") {
          y.refPercent = numVal;
          y.yieldPercent = round2(100 - numVal);
          y.wasteQty = round2((numVal / 100) * y.grossQty);
          y.nettQty = round2(y.grossQty - y.wasteQty);
        } else if (key === "yieldPercent") {
          y.yieldPercent = numVal;
          y.refPercent = round2(100 - numVal);
          y.wasteQty = round2((y.refPercent / 100) * y.grossQty);
          y.nettQty = round2(y.grossQty - y.wasteQty);
        }

        return { ...prev, yield_: y };
      });
    },
    [],
  );

  const setNutrition = useCallback(
    (key: keyof NutritionPer100g, value: number) => {
      setForm((prev) => {
        const n = { ...prev.nutrition, [key]: value };
        // Auto-calculate kcal from macros
        n.kcal = round2(n.fatG * 9 + n.carbsG * 4 + n.proteinG * 4);
        return { ...prev, nutrition: n };
      });
    },
    [],
  );

  /*
   * Take a whole set of figures at once.
   *
   * Separate from setNutrition, which derives kcal from the macros as somebody
   * types. Here the published energy value is the one worth keeping: it comes
   * from the same composition table as the macros and accounts for fibre and
   * polyols that the 4-4-9 sum does not.
   */
  const applyNutrition = useCallback((nutrition: NutritionPer100g) => {
    setForm((prev) => ({ ...prev, nutrition: { ...nutrition } }));
  }, []);

  const applyRefPercent = useCallback((percent: number) => {
    setForm((prev) => ({
      ...prev,
      yield_: {
        ...prev.yield_,
        refPercent: percent,
        yieldPercent: round2(100 - percent),
      },
    }));
  }, []);

  /*
   * Allergens from a lookup are added, never substituted, and always leave the
   * product marked unverified — whatever the form said a moment ago. A name
   * match is a prompt to read a label; it cannot clear a flag that means
   * "nobody has read the label yet".
   */
  const applyAllergens = useCallback((allergens: string[]) => {
    setAllergensText((current) => {
      const existingIds = current.split(",").map((a) => a.trim()).filter(Boolean);
      const merged = [...existingIds];
      for (const a of allergens) if (!merged.includes(a)) merged.push(a);
      return merged.join(", ");
    });
    setNeedsReview(true);
  }, []);

  // ── Save handler ───────────────────────────────────────────────────────

  const verdict = useMemo(
    () => canDeleteIngredient(id ?? "", { subRecipes, recipes }),
    [id, subRecipes, recipes],
  );

  const hrefFor = (kind: string, id: string) =>
    kind === "recipe"
      ? `/recipes/${id}`
      : kind === "collection"
        ? "/collections"
        : `/sub-recipes/${id}`;

  const handleSave = useCallback(async () => {
    if (!form.name.trim()) {
      toast.error("Product name is required");
      return;
    }

    const allergens = allergensText
      .split(",")
      .map((a) => a.trim())
      .filter(Boolean);

    const data = {
      ...form,
      allergens,
      allergensNeedReview: needsReview,
      // Clearing the flag clears the prompt with it: the note said what to go
      // and check, and leaving it behind would read as a standing warning on a
      // list somebody has just confirmed.
      allergenReviewNote: needsReview ? (existing?.allergenReviewNote ?? null) : null,
    };

    if (isNew) {
      try {
        await createProduct(data);
        toast.success("Product created");
      } catch (err) {
        toast.error("Could not create product", {
          description: err instanceof Error ? err.message : String(err),
        });
        return;
      }
    } else {
      // Cascading update: a price change here re-costs every sub-recipe and
      // recipe built on this product.
      const affected = updateProductAndCascade(id!, data);
      const cascadeNote = describeCascade(affected);
      toast.success("Product updated", {
        description: cascadeNote ?? undefined,
      });
    }
    navigate("/products");
  }, [form, allergensText, needsReview, existing, isNew, id, store, navigate]);

  // Don't render while redirecting
  if (id && !existing) return null;

  return (
    <div>
      <PageHeader
        title={isNew ? "New Product" : "Edit Product"}
        description={
          isNew
            ? "Add a new ingredient to your catalog"
            : "Update product details and pricing"
        }
      >
        <Button variant="outline" nativeButton={false} render={<Link to="/products" />}>
          <X className="mr-1 size-4" />
          Cancel
        </Button>
        {!isNew && existing && (
          <PermissionGate fallbackLabel="">
            <DeleteEntity
              entityLabel="ingredient"
              name={existing.name}
              verdict={verdict}
              hrefFor={hrefFor}
              archived={existing.status === "DISCONTINUED"}
              onDelete={async () => {
                await removeProduct(existing.id);
                toast.success(`${existing.name} deleted`);
                navigate("/products");
              }}
              onArchive={async () => {
                // A status change, so every dish built on it keeps costing.
                updateProductAndCascade(existing.id, { status: "DISCONTINUED" });
                toast.success(`${existing.name} archived`);
                navigate("/products");
              }}
            />
          </PermissionGate>
        )}
        <PermissionGate>
          <Button onClick={handleSave}>
            <Save className="mr-1 size-4" />
            Save
          </Button>
        </PermissionGate>
      </PageHeader>

      {/* ── Tabs ──────────────────────────────────────────────────────────── */}
      <Tabs defaultValue="general">
        <TabsList>
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="packing">Packing</TabsTrigger>
          <TabsTrigger value="cost-yield">Cost & Yield</TabsTrigger>
          <TabsTrigger value="suppliers">Suppliers</TabsTrigger>
          <TabsTrigger value="nutrition">Nutrition</TabsTrigger>
        </TabsList>

        {/* ── General tab ─────────────────────────────────────────────────── */}
        <TabsContent value="general">
          <Card>
            <CardHeader>
              <CardTitle>General Information</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Product Name" required>
                  <Input
                    value={form.name}
                    onChange={(e) => setField("name", e.target.value)}
                    placeholder="e.g. Butter (Unsalted)"
                  />
                </FormField>

                <FormField label="Brand">
                  <Input
                    value={form.brand ?? ""}
                    onChange={(e) =>
                      setField("brand", e.target.value || null)
                    }
                    placeholder="e.g. Lurpak"
                  />
                </FormField>

                <FormField label="Category">
                  <Select
                    value={form.category}
                    onValueChange={(val) => { if (val) setField("category", val) }}
                  >
                    <SelectTrigger aria-label="Category" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PRODUCT_CATEGORIES.map((cat) => (
                        <SelectItem key={cat} value={cat}>
                          {cat}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormField>

                <FormField label="Supplier">
                  <Input
                    value={form.supplier ?? ""}
                    onChange={(e) =>
                      setField("supplier", e.target.value || null)
                    }
                    placeholder="e.g. Al Rawabi"
                  />
                </FormField>

                <FormField label="Status">
                  <Select
                    value={form.status}
                    onValueChange={(val) => {
                      if (val) setField("status", val as ProductStatus)
                    }}
                  >
                    <SelectTrigger aria-label="Status" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PRODUCT_STATUSES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormField>

                <FormField label="Allergens">
                  <Input
                    value={allergensText}
                    onChange={(e) => setAllergensText(e.target.value)}
                    placeholder="dairy, gluten, nuts (comma-separated)"
                  />
                </FormField>
              </div>

              {/* Offered from the name alone, which is all it needs and all
                  it is entitled to work from. */}
              <div className="mt-4 sm:col-span-2">
                <FoodLookupPanel
                  productName={form.name}
                  hasNutrition={form.nutrition.kcal > 0}
                  onApplyNutrition={applyNutrition}
                  onApplyAllergens={applyAllergens}
                  onApplyRefPercent={applyRefPercent}
                />
              </div>

              {/*
                This is where an unverified list gets resolved, so the control
                to clear the flag lives beside the field it is about. Ticking
                it is a claim that someone read the label — it does not change
                the allergens, only who stands behind them.
              */}
              <div className="mt-4 sm:col-span-2">
                {needsReview ? (
                  <div
                    role="alert"
                    className="rounded-lg border border-status-warning/40 bg-status-warning-soft p-4"
                  >
                    <div className="flex items-start gap-3">
                      <TriangleAlert
                        className="mt-0.5 size-4 shrink-0 text-status-warning"
                        aria-hidden="true"
                      />
                      <div>
                        <h3 className="text-sm font-medium text-status-warning">
                          Allergens not verified against the product
                        </h3>
                        {existing?.allergenReviewNote && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {existing.allergenReviewNote}
                          </p>
                        )}
                        <label className="mt-3 flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            className="size-4 accent-[var(--color-status-success)]"
                            checked={false}
                            onChange={() => setNeedsReview(false)}
                          />
                          I have checked this against the product we buy
                        </label>
                      </div>
                    </div>
                  </div>
                ) : (
                  <label className="flex items-center gap-2 text-sm text-muted-foreground">
                    <input
                      type="checkbox"
                      className="size-4"
                      checked={needsReview}
                      onChange={(e) => setNeedsReview(e.target.checked)}
                    />
                    Flag these allergens as needing a check against the brand
                  </label>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Packing tab ─────────────────────────────────────────────────── */}
        <TabsContent value="packing">
          <Card>
            <CardHeader>
              <CardTitle>Packing & Purchase Units</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-3">
                <FormField label="Pack Qty">
                  <Input
                    type="number"
                    min={0}
                    value={form.packing.packQty}
                    onChange={(e) =>
                      setPacking("packQty", parseFloat(e.target.value) || 0)
                    }
                  />
                </FormField>

                <FormField label="Pack Unit">
                  <Select
                    value={form.packing.packUnit}
                    onValueChange={(val) => { if (val) setPacking("packUnit", val) }}
                  >
                    <SelectTrigger aria-label="Pack Unit" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {["blk", "ctn", "bag", "box", "btl", "jar", "pc", "whl"].map(
                        (u) => (
                          <SelectItem key={u} value={u}>
                            {u}
                          </SelectItem>
                        ),
                      )}
                    </SelectContent>
                  </Select>
                </FormField>

                <FormField label="Units Per Pack">
                  <Input
                    type="number"
                    min={0}
                    value={form.packing.unitsPerPack}
                    onChange={(e) =>
                      setPacking(
                        "unitsPerPack",
                        parseFloat(e.target.value) || 0,
                      )
                    }
                  />
                </FormField>

                <FormField label="Units Per Pack Unit">
                  <Select
                    value={form.packing.unitsPerPackUnit}
                    onValueChange={(val) => {
                      if (val) setPacking("unitsPerPackUnit", val)
                    }}
                  >
                    <SelectTrigger aria-label="Units Per Pack Unit" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {UNITS.map((u) => (
                        <SelectItem key={u} value={u}>
                          {u}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormField>

                <FormField label="Total Qty (auto)">
                  <Input
                    type="number"
                    value={form.packing.totalQty}
                    disabled
                    className="bg-muted"
                  />
                </FormField>

                <FormField label="Total Unit">
                  <Select
                    value={form.packing.totalUnit}
                    onValueChange={(val) => { if (val) setPacking("totalUnit", val) }}
                  >
                    <SelectTrigger aria-label="Total Unit" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {UNITS.map((u) => (
                        <SelectItem key={u} value={u}>
                          {u}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormField>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Cost & Yield tab ────────────────────────────────────────────── */}
        <TabsContent value="cost-yield">
          <div className="space-y-4">
            {/* Cost section */}
            <Card>
              <CardHeader>
                <CardTitle>Cost</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField label="Buying Price / Pack">
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={form.cost.buyingPricePerPack}
                      onChange={(e) =>
                        setCost("buyingPricePerPack", e.target.value)
                      }
                    />
                  </FormField>

                  <FormField label="Buying Price / Unit (auto)">
                    <Input
                      value={form.cost.buyingPricePerUnit}
                      disabled
                      className="bg-muted tabular-nums"
                    />
                  </FormField>

                  <FormField label="Gross Price / Unit">
                    <Input
                      type="number"
                      min={0}
                      step="0.00001"
                      value={form.cost.grossPricePerUnit}
                      onChange={(e) =>
                        setCost("grossPricePerUnit", e.target.value)
                      }
                    />
                  </FormField>

                  <FormField label="Nett Price / Unit">
                    <Input
                      type="number"
                      min={0}
                      step="0.00001"
                      value={form.cost.nettPricePerUnit}
                      onChange={(e) =>
                        setCost("nettPricePerUnit", e.target.value)
                      }
                    />
                  </FormField>
                </div>
              </CardContent>
            </Card>

            {/* Yield section */}
            <Card>
              <CardHeader>
                <CardTitle>Yield</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 sm:grid-cols-3">
                  <FormField label="Gross Qty">
                    <Input
                      type="number"
                      min={0}
                      value={form.yield_.grossQty}
                      onChange={(e) =>
                        setYield("grossQty", parseFloat(e.target.value) || 0)
                      }
                    />
                  </FormField>

                  <FormField label="Gross Unit">
                    <Select
                      value={form.yield_.grossUnit}
                      onValueChange={(val) => { if (val) setYield("grossUnit", val) }}
                    >
                      <SelectTrigger aria-label="Gross Unit" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {UNITS.map((u) => (
                          <SelectItem key={u} value={u}>
                            {u}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormField>

                  <FormField label="Waste Qty">
                    <Input
                      type="number"
                      min={0}
                      value={form.yield_.wasteQty}
                      onChange={(e) =>
                        setYield("wasteQty", parseFloat(e.target.value) || 0)
                      }
                    />
                  </FormField>

                  <FormField label="Waste Unit">
                    <Select
                      value={form.yield_.wasteUnit}
                      onValueChange={(val) => { if (val) setYield("wasteUnit", val) }}
                    >
                      <SelectTrigger aria-label="Waste Unit" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {UNITS.map((u) => (
                          <SelectItem key={u} value={u}>
                            {u}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormField>

                  <FormField label="Nett Qty (auto)">
                    <Input
                      type="number"
                      value={form.yield_.nettQty}
                      disabled
                      className="bg-muted tabular-nums"
                    />
                  </FormField>

                  <FormField label="Nett Unit">
                    <Select
                      value={form.yield_.nettUnit}
                      onValueChange={(val) => { if (val) setYield("nettUnit", val) }}
                    >
                      <SelectTrigger aria-label="Nett Unit" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {UNITS.map((u) => (
                          <SelectItem key={u} value={u}>
                            {u}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormField>
                </div>

                <Separator className="my-4" />

                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField label="Ref % (waste %)">
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      step="0.1"
                      value={form.yield_.refPercent}
                      onChange={(e) =>
                        setYield(
                          "refPercent",
                          parseFloat(e.target.value) || 0,
                        )
                      }
                    />
                  </FormField>

                  <FormField label="Yield %">
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      step="0.1"
                      value={form.yield_.yieldPercent}
                      onChange={(e) =>
                        setYield(
                          "yieldPercent",
                          parseFloat(e.target.value) || 0,
                        )
                      }
                    />
                  </FormField>
                </div>
              </CardContent>
            </Card>

            {/* Stock section — what makes a product appear on Inventory. */}
            <Card>
              <CardHeader>
                <CardTitle>Stock</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="mb-4 text-sm text-muted-foreground">
                  Leave the par level blank for anything bought to order. Only
                  products with a par level are counted and reordered on the
                  Inventory page.
                </p>
                <div className="grid gap-4 sm:grid-cols-3">
                  <FormField label="Par Level">
                    <Input
                      type="number"
                      min={0}
                      value={form.parLevel ?? ""}
                      placeholder="Not tracked"
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          // Blank means untracked, which is different from a
                          // par of zero — hence null rather than 0.
                          parLevel:
                            e.target.value === ""
                              ? null
                              : parseFloat(e.target.value) || 0,
                        }))
                      }
                    />
                  </FormField>

                  <FormField label="Reorder Point">
                    <Input
                      type="number"
                      min={0}
                      value={form.reorderPoint ?? ""}
                      placeholder="Half of par"
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          reorderPoint:
                            e.target.value === ""
                              ? null
                              : parseFloat(e.target.value) || 0,
                        }))
                      }
                    />
                  </FormField>

                  <FormField label="Stock Unit">
                    <Select
                      value={form.stockUnit ?? form.packing.totalUnit}
                      onValueChange={(val) => {
                        if (val) setForm((f) => ({ ...f, stockUnit: val }));
                      }}
                    >
                      <SelectTrigger aria-label="Stock Unit" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {UNITS.map((u) => (
                          <SelectItem key={u} value={u}>
                            {u}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormField>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── Nutrition tab ───────────────────────────────────────────────── */}
        <TabsContent value="suppliers">
          <Card>
            <CardHeader>
              <CardTitle>Who this can be bought from</CardTitle>
            </CardHeader>
            <CardContent>
              <ProductSuppliersPanel
                productId={isNew ? null : (id ?? null)}
                defaultPackUnit={form.packing.packUnit}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="nutrition">
          <Card>
            <CardHeader>
              <CardTitle>Nutrition per 100 g</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-3">
                <FormField label="Fat (g)">
                  <Input
                    type="number"
                    min={0}
                    step="0.1"
                    value={form.nutrition.fatG}
                    onChange={(e) =>
                      setNutrition("fatG", parseFloat(e.target.value) || 0)
                    }
                  />
                </FormField>

                <FormField label="Carbs (g)">
                  <Input
                    type="number"
                    min={0}
                    step="0.1"
                    value={form.nutrition.carbsG}
                    onChange={(e) =>
                      setNutrition("carbsG", parseFloat(e.target.value) || 0)
                    }
                  />
                </FormField>

                <FormField label="Protein (g)">
                  <Input
                    type="number"
                    min={0}
                    step="0.1"
                    value={form.nutrition.proteinG}
                    onChange={(e) =>
                      setNutrition(
                        "proteinG",
                        parseFloat(e.target.value) || 0,
                      )
                    }
                  />
                </FormField>

                <FormField label="Vitamin A (mg)">
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={form.nutrition.vitAMg}
                    onChange={(e) =>
                      setNutrition("vitAMg", parseFloat(e.target.value) || 0)
                    }
                  />
                </FormField>

                <FormField label="Vitamin C (mg)">
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={form.nutrition.vitCMg}
                    onChange={(e) =>
                      setNutrition("vitCMg", parseFloat(e.target.value) || 0)
                    }
                  />
                </FormField>

                <FormField label="Calcium (mg)">
                  <Input
                    type="number"
                    min={0}
                    step="0.1"
                    value={form.nutrition.calciumMg}
                    onChange={(e) =>
                      setNutrition(
                        "calciumMg",
                        parseFloat(e.target.value) || 0,
                      )
                    }
                  />
                </FormField>

                <FormField label="Iron (mg)">
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={form.nutrition.ironMg}
                    onChange={(e) =>
                      setNutrition("ironMg", parseFloat(e.target.value) || 0)
                    }
                  />
                </FormField>

                <FormField label="Sodium (mg)">
                  <Input
                    type="number"
                    min={0}
                    step="0.1"
                    value={form.nutrition.sodiumMg}
                    onChange={(e) =>
                      setNutrition(
                        "sodiumMg",
                        parseFloat(e.target.value) || 0,
                      )
                    }
                  />
                </FormField>

                <FormField label="kcal (auto)">
                  <Input
                    type="number"
                    value={form.nutrition.kcal}
                    disabled
                    className="bg-muted tabular-nums"
                  />
                </FormField>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Only for a saved product: a price that does not exist yet cannot
          have moved, and nothing can depend on it. */}
      {!isNew && existing && (
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <PriceImpact product={existing} />
          <WhereUsed entityId={existing.id} />
        </div>
      )}
    </div>
  );
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Tiny layout wrapper for label + input */
function FormField({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label>
        {label}
        {required && <span className="text-destructive"> *</span>}
      </Label>
      {children}
    </div>
  );
}

/**
 * Waits for the catalogue before mounting the form.
 *
 * The form seeds its fields from the stored entity in `useState` initialisers,
 * which run once. On a deep link those ran while the stores were still empty,
 * so the editor opened blank on a recipe that exists — and saving it reported
 * "name is required" over the top of real data. Remounting on `loaded` is what
 * makes those initialisers see the entity.
 */
export function ProductDetailPage() {
  const loaded = useCatalogueLoaded();
  const { id } = useParams<{ id: string }>();

  if (id && !loaded) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">
        Loading product...
      </p>
    );
  }
  return <ProductDetailForm key={id ?? "new"} />;
}
