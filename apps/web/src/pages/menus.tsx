// ---------------------------------------------------------------------------
// Menus — the same dish, priced per outlet
// ---------------------------------------------------------------------------
// The screen over 0093, which separated a menu item from the recipe behind
// it. Before that a dish had one price everywhere and the till had nowhere
// to put its own code for the button.
//
// Two things this page exists to make visible, both of which are invisible
// on a screen that shows one menu at a time:
//
//   What the same dish costs elsewhere. A burger at 95,000 inside and
//   120,000 by the pool is the whole reason the table exists, and somebody
//   editing one price should be able to see the other without going to
//   look for it.
//
//   Which price answered. An item with no price of its own falls back to
//   `recipes.menu_price`, the single figure that predates all of this. That
//   is a deliberate fallback, not a default anybody chose, so it is labelled
//   — otherwise a menu looks fully priced when half of it is inherited.
//
// And the worklist: till codes that arrived in sales with nothing to map
// them to. 0092 lets those lines land rather than refusing the file, which
// is only better than dropping them if somebody can see them.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useState } from "react";
import { BookOpen, Plus, Link2Off, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { CurrencyDisplay } from "@/components/shared/currency-display";
import { StatusChip } from "@/components/shared/status-chip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCanWriteSection } from "@/stores/access-store";
import { useRecipeStore } from "@/stores/recipe-store";
import {
  fetchMenus, fetchMenuItems, fetchUnmappedCodes, fetchPricesElsewhere,
  createMenu, addMenuItem, updateMenuItem,
  type Menu, type MenuItemPricing, type UnmappedCode,
} from "@/data/menus";

function said(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  return text.replace(/^\w+(\([^)]*\))? failed: /, "");
}

export function MenusPage() {
  const canWrite = useCanWriteSection("MENU");
  // Hydrated globally by stores/persistence.ts, as every other catalogue
  // screen reads it — there is no per-page load.
  const recipes = useRecipeStore((s) => s.recipes);

  const [menus, setMenus] = useState<Menu[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [items, setItems] = useState<MenuItemPricing[]>([]);
  const [unmapped, setUnmapped] = useState<UnmappedCode[]>([]);
  const [elsewhere, setElsewhere] = useState<Record<string, { menuName: string; price: number | null }[]>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [newMenu, setNewMenu] = useState(false);
  const [menuName, setMenuName] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [addRecipe, setAddRecipe] = useState("");
  const [addPrice, setAddPrice] = useState("");
  const [addCode, setAddCode] = useState("");

  const load = useCallback(async () => {
    try {
      const [m, u] = await Promise.all([fetchMenus(), fetchUnmappedCodes()]);
      setMenus(m);
      setUnmapped(u);
      setSelected((cur) => cur ?? m[0]?.id ?? null);
    } catch (err) {
      toast.error("Could not load menus", { description: said(err) });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const loadItems = useCallback(async (menuId: string) => {
    try {
      const rows = await fetchMenuItems(menuId);
      setItems(rows);
      /*
       * Fetched per item rather than joined, because the question is "where
       * else is this dish priced" and the answer is usually nowhere. One
       * round trip per dish on a menu of twenty is cheap; a join that
       * returned every menu's every item to answer it is not.
       */
      const pairs = await Promise.all(
        rows
          .filter((r) => r.recipeId)
          .map(async (r) => [r.menuItemId, await fetchPricesElsewhere(r.recipeId!, menuId)] as const),
      );
      setElsewhere(Object.fromEntries(pairs));
    } catch (err) {
      toast.error("Could not load the menu", { description: said(err) });
    }
  }, []);

  useEffect(() => {
    if (selected) void loadItems(selected);
    else setItems([]);
  }, [selected, loadItems]);

  const current = menus.find((m) => m.id === selected) ?? null;

  const inherited = useMemo(
    () => items.filter((i) => i.pricedBy === "recipe fallback").length,
    [items],
  );

  return (
    <div>
      <PageHeader
        title="Menus"
        description="A dish can sit on several menus at different prices. The till's own code for each button lives here too, which is what maps a sales import to a recipe."
      >
        {canWrite && (
          <Button onClick={() => setNewMenu(true)}>
            <Plus aria-hidden="true" />
            New menu
          </Button>
        )}
      </PageHeader>

      <Tabs defaultValue="menus">
        <TabsList>
          <TabsTrigger value="menus">Menus</TabsTrigger>
          <TabsTrigger value="unmapped">
            Unmapped till codes
            {unmapped.length > 0 && (
              <Badge variant="outline" className="ml-2">{unmapped.length}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="menus" className="pt-4">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : menus.length === 0 ? (
            <EmptyState icon={BookOpen} title="No menus yet">
              A menu is a priced card for one outlet over a period. The same
              recipe can appear on several at different prices, which is the
              thing a single price on the recipe could never say.
            </EmptyState>
          ) : (
            <div className="grid gap-6 lg:grid-cols-[16rem_1fr]">
              <nav aria-label="Menus" className="space-y-2">
                {menus.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setSelected(m.id)}
                    aria-current={m.id === selected ? "true" : undefined}
                    className={`w-full rounded-lg border p-3 text-left transition-colors ${
                      m.id === selected
                        ? "border-ring bg-accent"
                        : "border-border hover:bg-accent/50"
                    }`}
                  >
                    <span className="block font-medium">{m.name}</span>
                    <span className="mt-1 block text-sm text-muted-foreground">
                      {m.activeTo
                        ? `Ended ${new Date(m.activeTo).toLocaleDateString()}`
                        : m.activeFrom
                          ? `Running since ${new Date(m.activeFrom).toLocaleDateString()}`
                          : "No dates set"}
                    </span>
                  </button>
                ))}
              </nav>

              <Card>
                <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
                  <div>
                    <CardTitle>{current?.name ?? "—"}</CardTitle>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {items.length} item{items.length === 1 ? "" : "s"}
                      {inherited > 0 && (
                        <>
                          {" · "}
                          {inherited} still priced from the recipe rather than
                          from this menu
                        </>
                      )}
                    </p>
                  </div>
                  {canWrite && current && (
                    <Button variant="outline" onClick={() => setAddOpen(true)}>
                      <Plus aria-hidden="true" />
                      Add dish
                    </Button>
                  )}
                </CardHeader>
                <CardContent>
                  {items.length === 0 ? (
                    <EmptyState icon={BookOpen} title="Nothing on this menu yet">
                      Add a dish and give it a price for this outlet.
                    </EmptyState>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Dish</TableHead>
                          <TableHead>Till code</TableHead>
                          <TableHead className="text-right">Price</TableHead>
                          <TableHead className="text-right">Cost</TableHead>
                          <TableHead className="text-right">Food cost</TableHead>
                          <TableHead>Elsewhere</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {items.map((i) => (
                          <TableRow key={i.menuItemId}>
                            <TableCell className="font-medium">
                              {i.itemName ?? "—"}
                              {!i.isAvailable && (
                                <Badge variant="outline" className="ml-2">off</Badge>
                              )}
                            </TableCell>
                            <TableCell>
                              {i.posItemCode ? (
                                <code className="text-sm">{i.posItemCode}</code>
                              ) : (
                                <span className="text-sm text-muted-foreground">
                                  not mapped
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              {canWrite ? (
                                <PriceCell
                                  item={i}
                                  onSaved={() => void loadItems(i.menuId)}
                                />
                              ) : i.price === null ? (
                                <span className="text-muted-foreground">unpriced</span>
                              ) : (
                                <>
                                  <CurrencyDisplay value={i.price} />
                                  {i.pricedBy === "recipe fallback" && (
                                    <Badge variant="outline" className="ml-2">
                                      from recipe
                                    </Badge>
                                  )}
                                </>
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              {i.recipeCost === null ? (
                                "—"
                              ) : (
                                <CurrencyDisplay value={i.recipeCost} />
                              )}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {i.foodCostPercent === null
                                ? "—"
                                : `${i.foodCostPercent}%`}
                            </TableCell>
                            <TableCell>
                              {(elsewhere[i.menuItemId] ?? []).length === 0 ? (
                                <span className="text-sm text-muted-foreground">
                                  only here
                                </span>
                              ) : (
                                <span className="flex flex-wrap gap-1">
                                  {elsewhere[i.menuItemId]!.map((e, n) => (
                                    <StatusChip key={n} tone="info">
                                      {e.menuName}:{" "}
                                      {e.price === null ? "—" : (
                                        <CurrencyDisplay value={e.price} />
                                      )}
                                    </StatusChip>
                                  ))}
                                </span>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>

        <TabsContent value="unmapped" className="pt-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Link2Off className="size-4" aria-hidden="true" />
                Till codes nothing answers to
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                A sales import lands every line the till sent, including the
                ones no menu item matches — refusing the file or dropping the
                rows would both lose the sale. These are the ones still to map.
              </p>
            </CardHeader>
            <CardContent>
              {unmapped.length === 0 ? (
                <EmptyState icon={Link2Off} title="Everything is mapped">
                  Every till code that has appeared in a sales import matches a
                  menu item.
                </EmptyState>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Till code</TableHead>
                      <TableHead className="text-right">Lines</TableHead>
                      <TableHead className="text-right">Units sold</TableHead>
                      <TableHead className="text-right">Net sales</TableHead>
                      <TableHead>Last seen</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {unmapped.map((u) => (
                      <TableRow key={u.posItemCode}>
                        <TableCell>
                          <code className="text-sm">{u.posItemCode}</code>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{u.lines}</TableCell>
                        <TableCell className="text-right tabular-nums">{u.unitsSold}</TableCell>
                        <TableCell className="text-right">
                          <CurrencyDisplay value={u.netSales} />
                        </TableCell>
                        <TableCell>
                          {u.lastSeen
                            ? new Date(u.lastSeen).toLocaleDateString()
                            : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              {unmapped.length > 0 && (
                <p className="mt-4 flex items-start gap-2 text-sm text-muted-foreground">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <span>
                    Sales on an unmapped code consume no stock, because nothing
                    says what the dish is made of. Food cost is understated
                    until they are mapped.
                  </span>
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={newMenu} onOpenChange={setNewMenu}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New menu</DialogTitle>
            <DialogDescription>
              A card for one outlet. It can be ended later rather than deleted,
              so last year's prices stay readable against last year's sales.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="menu-name">Name</Label>
            <Input
              id="menu-name"
              value={menuName}
              onChange={(e) => setMenuName(e.target.value)}
              placeholder="All day"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewMenu(false)}>Cancel</Button>
            <Button
              disabled={busy || menuName.trim() === ""}
              onClick={async () => {
                setBusy(true);
                try {
                  const id = await createMenu({
                    name: menuName.trim(),
                    code: null,
                    businessUnitId: null,
                    activeFrom: new Date().toISOString().slice(0, 10),
                  });
                  setNewMenu(false);
                  setMenuName("");
                  await load();
                  setSelected(id);
                } catch (err) {
                  toast.error("Could not create the menu", { description: said(err) });
                } finally {
                  setBusy(false);
                }
              }}
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a dish to {current?.name}</DialogTitle>
            <DialogDescription>
              Leave the price empty to use the recipe's own, which will be
              shown as inherited rather than set here.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="mi-recipe">Dish</Label>
              <select
                id="mi-recipe"
                className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
                value={addRecipe}
                onChange={(e) => setAddRecipe(e.target.value)}
              >
                <option value="">Choose a recipe</option>
                {recipes.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="mi-price">Price on this menu</Label>
              <Input
                id="mi-price"
                inputMode="decimal"
                value={addPrice}
                onChange={(e) => setAddPrice(e.target.value)}
                placeholder="Leave empty to use the recipe's"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="mi-code">Till code</Label>
              <Input
                id="mi-code"
                value={addCode}
                onChange={(e) => setAddCode(e.target.value)}
                placeholder="The button on the till, if you know it"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button
              disabled={busy || addRecipe === ""}
              onClick={async () => {
                if (!current) return;
                setBusy(true);
                try {
                  const price = addPrice.trim();
                  await addMenuItem({
                    menuId: current.id,
                    recipeId: addRecipe,
                    sellingPrice: price === "" ? null : Number(price),
                    posItemCode: addCode.trim() || null,
                    displayName: null,
                  });
                  setAddOpen(false);
                  setAddPrice(""); setAddCode(""); setAddRecipe("");
                  await loadItems(current.id);
                  await load();
                } catch (err) {
                  toast.error("Could not add the dish", { description: said(err) });
                } finally {
                  setBusy(false);
                }
              }}
            >
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/*
 * The price on this menu, edited in place.
 *
 * Clearing the box is not setting zero — it sends null and the item falls
 * back to the recipe's own price, which the badge then says. That is the
 * same distinction the count sheet makes between a blank and a zero, and it
 * matters here for the same reason: "no price of its own" and "free" are
 * different statements.
 */
function PriceCell({
  item,
  onSaved,
}: {
  item: MenuItemPricing;
  onSaved: () => void;
}) {
  const own = item.pricedBy === "menu item";
  const [draft, setDraft] = useState(own && item.price !== null ? String(item.price) : "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(own && item.price !== null ? String(item.price) : "");
  }, [own, item.price]);

  async function commit() {
    const trimmed = draft.trim();
    const next = trimmed === "" ? null : Number(trimmed);
    if (next !== null && (!Number.isFinite(next) || next < 0)) {
      toast.error("That is not a price", { description: `"${draft}"` });
      setDraft(own && item.price !== null ? String(item.price) : "");
      return;
    }
    if (next === (own ? item.price : null)) return;
    setSaving(true);
    try {
      await updateMenuItem(item.menuItemId, { sellingPrice: next });
      onSaved();
    } catch (err) {
      toast.error("Not saved", { description: said(err) });
      setDraft(own && item.price !== null ? String(item.price) : "");
    } finally {
      setSaving(false);
    }
  }

  return (
    <span className="inline-flex items-center justify-end gap-2">
      <Input
        value={draft}
        inputMode="decimal"
        disabled={saving}
        aria-label={`Price of ${item.itemName ?? "this dish"} on ${item.menuName}. Leave empty to use the recipe's own price.`}
        placeholder={item.price === null ? "unpriced" : String(item.price)}
        className="h-9 w-32 text-right tabular-nums"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
      />
      {item.pricedBy === "recipe fallback" && (
        <Badge variant="outline">from recipe</Badge>
      )}
    </span>
  );
}
