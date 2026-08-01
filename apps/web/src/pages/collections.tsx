// ---------------------------------------------------------------------------
// Collections
// ---------------------------------------------------------------------------
// The venue's folder of printouts, except the costs and allergens on the
// sheets are current. A named set of dishes — a prep pack for a section, a
// tasting menu for a briefing — that prints as one document and exports as one
// file per recipe.
//
// It holds references. Copying a recipe into a folder is how a kitchen ends up
// with two versions of a dish and no idea which is cooked.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { FolderPlus, Printer, Download, Trash2, Plus, X } from "lucide-react";
import { toast } from "sonner";
import type { Collection } from "@ccos/shared";

import { PageHeader } from "@/components/layout/page-header";
import { PermissionGate } from "@/components/shared/permission-gate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CurrencyDisplay } from "@/components/shared/currency-display";
import { FoodCostIndicator } from "@/components/shared/food-cost-indicator";
import { useRecipeStore } from "@/stores/recipe-store";
import { useProductStore } from "@/stores/product-store";
import { useSubRecipeStore } from "@/stores/sub-recipe-store";
import {
  fetchCollections,
  insertCollection,
  deleteCollection,
  setCollectionRecipes,
} from "@/data/repository";
import { isSupabaseConfigured } from "@/lib/supabase";
import { createZip, downloadZip, safeFilename } from "@/lib/zip";
import { renderRecipeSheet } from "@/lib/recipe-sheet";

export function CollectionsPage() {
  const recipes = useRecipeStore((s) => s.recipes);
  const products = useProductStore((s) => s.products);
  const subRecipes = useSubRecipeStore((s) => s.subRecipes);

  const [collections, setCollections] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [picker, setPicker] = useState("");

  const recipeById = useMemo(
    () => new Map(recipes.map((r) => [r.id, r])),
    [recipes],
  );

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }
    fetchCollections()
      .then(setCollections)
      .catch((err) =>
        toast.error("Could not load collections", {
          description: err instanceof Error ? err.message : String(err),
        }),
      )
      .finally(() => setLoading(false));
  }, []);

  const active = collections.find((c) => c.id === activeId) ?? null;

  const activeRecipes = useMemo(
    () =>
      active
        ? active.recipeIds
            .map((id) => recipeById.get(id))
            .filter((r): r is NonNullable<typeof r> => Boolean(r))
        : [],
    [active, recipeById],
  );

  async function create() {
    const name = newName.trim();
    if (!name) return;
    try {
      const c = await insertCollection(name, null);
      setCollections((cs) => [...cs, c].sort((a, b) => a.name.localeCompare(b.name)));
      setNewName("");
      setActiveId(c.id);
    } catch (err) {
      toast.error("Could not create", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function updateMembers(collection: Collection, recipeIds: string[]) {
    try {
      await setCollectionRecipes(collection.id, recipeIds);
      setCollections((cs) =>
        cs.map((c) => (c.id === collection.id ? { ...c, recipeIds } : c)),
      );
    } catch (err) {
      toast.error("Could not save", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function remove(c: Collection) {
    try {
      await deleteCollection(c.id);
      setCollections((cs) => cs.filter((x) => x.id !== c.id));
      if (activeId === c.id) setActiveId(null);
    } catch (err) {
      toast.error("Could not delete", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * One file per recipe, in a folder named after the collection.
   *
   * Self-contained HTML rather than PDF: a browser can print HTML to PDF and
   * cannot be made to write one directly, and an HTML file opens on every
   * machine in a kitchen office without asking what is installed.
   */
  function exportFiles() {
    if (!active) return;
    const folder = safeFilename(active.name);
    const entries = activeRecipes.map((r) => ({
      name: `${folder}/${safeFilename(r.name)}.html`,
      content: renderRecipeSheet(r, { products, subRecipes }),
    }));
    // An index, so the folder is navigable rather than a pile of files.
    entries.push({
      name: `${folder}/index.html`,
      content: renderRecipeSheet(null, { products, subRecipes }, {
        title: active.name,
        links: activeRecipes.map((r) => ({
          href: `${safeFilename(r.name)}.html`,
          label: r.name,
        })),
      }),
    });
    downloadZip(folder, createZip(entries));
    toast.success(`${activeRecipes.length} recipe sheets exported`);
  }

  return (
    <div>
      <PageHeader
        title="Collections"
        description="Sets of recipe sheets to print or share together"
      />

      {!isSupabaseConfigured ? (
        <p className="rounded-lg border border-status-warning/40 bg-status-warning-soft p-3 text-sm text-foreground/80">
          Running on the mock catalogue, so collections are unavailable — there
          is nothing to store them in.
        </p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
          {/* ── The collections themselves ──────────────────────────────── */}
          <div className="space-y-3">
            <PermissionGate fallbackLabel="View only">
              <div className="flex gap-2">
                <Input
                  placeholder="New collection..."
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void create();
                  }}
                  aria-label="New collection name"
                />
                <Button size="icon-sm" onClick={() => void create()} disabled={!newName.trim()}>
                  <FolderPlus className="size-4" aria-hidden="true" />
                  <span className="sr-only">Create collection</span>
                </Button>
              </div>
            </PermissionGate>

            {loading ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : collections.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No collections yet. Name one above — a section's prep pack, or
                the sheets for a tasting.
              </p>
            ) : (
              <ul className="space-y-1">
                {collections.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => setActiveId(c.id)}
                      aria-current={c.id === activeId ? "true" : undefined}
                      className={`flex w-full items-baseline justify-between gap-2 rounded-md px-3 py-2 text-left text-sm ${
                        c.id === activeId ? "bg-muted font-medium" : "hover:bg-muted/50"
                      }`}
                    >
                      <span className="truncate">{c.name}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {c.recipeIds.length}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* ── What is in the selected one ─────────────────────────────── */}
          <div>
            {!active ? (
              <div className="flex min-h-[240px] items-center justify-center rounded-lg border border-dashed">
                <p className="text-sm text-muted-foreground">
                  Select a collection.
                </p>
              </div>
            ) : (
              <Card>
                <CardHeader>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <CardTitle className="text-base">{active.name}</CardTitle>
                      <CardDescription>
                        {activeRecipes.length}{" "}
                        {activeRecipes.length === 1 ? "recipe" : "recipes"}
                      </CardDescription>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        nativeButton={false}
                        render={<Link to={`/collections/${active.id}/print`} />}
                      >
                        <Printer className="mr-1 size-4" aria-hidden="true" />
                        Print all
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={exportFiles}
                        disabled={activeRecipes.length === 0}
                      >
                        <Download className="mr-1 size-4" aria-hidden="true" />
                        Export files
                      </Button>
                      <PermissionGate fallbackLabel="View only">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void remove(active)}
                        >
                          <Trash2 className="mr-1 size-4" aria-hidden="true" />
                          Delete
                        </Button>
                      </PermissionGate>
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="space-y-4">
                  <PermissionGate fallbackLabel="View only">
                    <div className="flex gap-2">
                      <Input
                        list="collection-recipe-options"
                        placeholder="Add a dish by name..."
                        value={picker}
                        onChange={(e) => setPicker(e.target.value)}
                        aria-label="Add a dish to this collection"
                      />
                      <datalist id="collection-recipe-options">
                        {recipes
                          .filter((r) => !active.recipeIds.includes(r.id))
                          .map((r) => (
                            <option key={r.id} value={r.name} />
                          ))}
                      </datalist>
                      <Button
                        size="sm"
                        onClick={() => {
                          const match = recipes.find(
                            (r) => r.name.toLowerCase() === picker.trim().toLowerCase(),
                          );
                          if (!match) {
                            toast.error("No dish with that name");
                            return;
                          }
                          if (active.recipeIds.includes(match.id)) return;
                          void updateMembers(active, [...active.recipeIds, match.id]);
                          setPicker("");
                        }}
                        disabled={!picker.trim()}
                      >
                        <Plus className="mr-1 size-4" aria-hidden="true" />
                        Add
                      </Button>
                    </div>
                  </PermissionGate>

                  {activeRecipes.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                      Nothing in this collection yet.
                    </p>
                  ) : (
                    <ul className="divide-y">
                      {activeRecipes.map((r) => (
                        <li
                          key={r.id}
                          className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm"
                        >
                          <Link
                            to={`/recipes/${r.id}/print`}
                            className="min-w-0 flex-1 truncate underline-offset-4 hover:underline"
                          >
                            {r.name}
                          </Link>
                          <span className="flex items-center gap-3">
                            <CurrencyDisplay value={r.pricing.menuPrice} />
                            <FoodCostIndicator value={r.pricing.foodCostPercent} />
                            <PermissionGate fallbackLabel="">
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                onClick={() =>
                                  void updateMembers(
                                    active,
                                    active.recipeIds.filter((id) => id !== r.id),
                                  )
                                }
                              >
                                <X className="size-4" aria-hidden="true" />
                                <span className="sr-only">
                                  Remove {r.name} from {active.name}
                                </span>
                              </Button>
                            </PermissionGate>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
