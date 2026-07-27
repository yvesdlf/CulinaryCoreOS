// ---------------------------------------------------------------------------
// Product detail / create page
// ---------------------------------------------------------------------------

import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { Save, X } from "lucide-react";
import { toast } from "sonner";
import type { Product, NutritionPer100g, ProductStatus } from "@ccos/shared";

import { PageHeader } from "@/components/layout/page-header";
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
import { PRODUCT_CATEGORIES, PRODUCT_STATUSES, UNITS } from "@/lib/constants";

// ── Empty product template ───────────────────────────────────────────────────

function emptyProduct(): Omit<Product, "id" | "createdAt" | "updatedAt"> {
  return {
    name: "",
    brand: null,
    category: PRODUCT_CATEGORIES[0],
    supplier: null,
    status: "ACTIVE" as ProductStatus,
    allergens: [],
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

export function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const store = useProductStore();

  const isNew = !id;
  const existing = id ? store.getById(id) : undefined;

  // Redirect if editing a non-existent product
  useEffect(() => {
    if (id && !existing) {
      navigate("/products", { replace: true });
    }
  }, [id, existing, navigate]);

  // ── Form state ─────────────────────────────────────────────────────────

  const [form, setForm] = useState(() =>
    existing
      ? {
          name: existing.name,
          brand: existing.brand,
          category: existing.category,
          supplier: existing.supplier,
          status: existing.status,
          allergens: existing.allergens,
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

  // ── Save handler ───────────────────────────────────────────────────────

  const handleSave = useCallback(() => {
    if (!form.name.trim()) {
      toast.error("Product name is required");
      return;
    }

    const allergens = allergensText
      .split(",")
      .map((a) => a.trim())
      .filter(Boolean);

    const data = { ...form, allergens };

    if (isNew) {
      store.create(data);
      toast.success("Product created");
    } else {
      store.update(id!, data);
      toast.success("Product updated");
    }
    navigate("/products");
  }, [form, allergensText, isNew, id, store, navigate]);

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
        <Button onClick={handleSave}>
          <Save className="mr-1 size-4" />
          Save
        </Button>
      </PageHeader>

      {/* ── Tabs ──────────────────────────────────────────────────────────── */}
      <Tabs defaultValue="general">
        <TabsList>
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="packing">Packing</TabsTrigger>
          <TabsTrigger value="cost-yield">Cost & Yield</TabsTrigger>
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
                    <SelectTrigger className="w-full">
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
                    <SelectTrigger className="w-full">
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
                    <SelectTrigger className="w-full">
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
                    <SelectTrigger className="w-full">
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
                    <SelectTrigger className="w-full">
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
                      <SelectTrigger className="w-full">
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
                      <SelectTrigger className="w-full">
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
                      <SelectTrigger className="w-full">
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
          </div>
        </TabsContent>

        {/* ── Nutrition tab ───────────────────────────────────────────────── */}
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
