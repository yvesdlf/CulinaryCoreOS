import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Package,
  ChefHat,
  Layers,
  ShieldAlert,
  Truck,
  CopyCheck,
  Warehouse,
  ShoppingCart,
  Users,
  ShieldCheck,
  Factory,
  ChartNoAxesCombined,
  FolderOpen,
} from "lucide-react";

import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { useProductStore } from "@/stores/product-store";
import { useRecipeStore } from "@/stores/recipe-store";
import { useSubRecipeStore } from "@/stores/sub-recipe-store";
import { formatCurrency, formatPercent } from "@/lib/format";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const navigationItems = [
  { label: "Go to Dashboard", to: "/", icon: LayoutDashboard },
  { label: "Go to Products", to: "/products", icon: Package },
  { label: "Go to Recipes", to: "/recipes", icon: ChefHat },
  { label: "Go to Sub Recipes", to: "/sub-recipes", icon: Layers },
  { label: "Go to Suppliers", to: "/suppliers", icon: Truck },
  { label: "Go to Allergen Matrix", to: "/allergen-matrix", icon: ShieldAlert },
  { label: "Go to Purchasing", to: "/purchasing", icon: ShoppingCart },
  { label: "Go to People", to: "/people", icon: Users },
  { label: "Go to Inventory", to: "/inventory", icon: Warehouse },
  { label: "Go to Traceability", to: "/traceability", icon: ShieldCheck },
  { label: "Go to Production", to: "/production", icon: Factory },
  { label: "Go to Menu Engineering", to: "/menu-engineering", icon: ChartNoAxesCombined },
  { label: "Go to Duplicates", to: "/duplicates", icon: CopyCheck },
  { label: "Go to Collections", to: "/collections", icon: FolderOpen },
];

/**
 * How many matches of each kind to offer.
 *
 * Enough to find the thing, few enough that one kind cannot bury the others:
 * a search for "beef" hits dozens of products, and burying the two beef dishes
 * under them would defeat the point of searching across everything at once.
 */
const PER_GROUP = 6;

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");

  const products = useProductStore((s) => s.products);
  const recipes = useRecipeStore((s) => s.recipes);
  const subRecipes = useSubRecipeStore((s) => s.subRecipes);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onOpenChange(!open);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onOpenChange]);

  // A stale query on reopening is worse than none: the first keystroke would
  // filter against whatever was typed last time.
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  /*
   * Searching the catalogue, not just the menu.
   *
   * The header advertises this as "Search" and it offered six page links —
   * with 1.102 products and 115 dishes, the thing anyone actually wants to
   * jump to was the one thing it could not find.
   *
   * Filtered here rather than by cmdk's own matcher, which scores every child
   * it is given; handing it 1.300 items to rank on each keystroke is work
   * nobody sees the benefit of.
   */
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return null;

    const match = (s: string | null | undefined) =>
      Boolean(s && s.toLowerCase().includes(q));

    return {
      recipes: recipes.filter((r) => match(r.name) || match(r.category)).slice(0, PER_GROUP),
      subRecipes: subRecipes.filter((s) => match(s.name) || match(s.category)).slice(0, PER_GROUP),
      // Supplier included: "what do we buy from Masuya" is a real question,
      // and it is the fastest route to a price the kitchen wants to check.
      products: products
        .filter((p) => match(p.name) || match(p.brand) || match(p.supplier))
        .slice(0, PER_GROUP),
    };
  }, [query, products, recipes, subRecipes]);

  function handleSelect(to: string) {
    onOpenChange(false);
    navigate(to);
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      // The lists below are already filtered, and their values are ids rather
      // than names — leaving cmdk's matcher on would hide every result.
      shouldFilter={false}
    >
      <CommandInput
        placeholder="Search dishes, preparations, ingredients..."
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>
          {query.trim().length < 2
            ? "Type at least two characters."
            : "Nothing matches."}
        </CommandEmpty>

        {results && results.recipes.length > 0 && (
          <CommandGroup heading="Dishes">
            {results.recipes.map((r) => (
              <CommandItem
                key={r.id}
                value={`recipe-${r.id}`}
                onSelect={() => handleSelect(`/recipes/${r.id}`)}
              >
                <ChefHat className="mr-2 size-4" aria-hidden="true" />
                <span className="flex-1 truncate">{r.name}</span>
                {/* The figure people are usually looking for anyway. */}
                <span className="ml-2 shrink-0 text-xs tabular-nums text-muted-foreground">
                  {formatPercent(r.pricing.foodCostPercent)}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {results && results.subRecipes.length > 0 && (
          <CommandGroup heading="Preparations">
            {results.subRecipes.map((s) => (
              <CommandItem
                key={s.id}
                value={`sub-${s.id}`}
                onSelect={() => handleSelect(`/sub-recipes/${s.id}`)}
              >
                <Layers className="mr-2 size-4" aria-hidden="true" />
                <span className="flex-1 truncate">{s.name}</span>
                <span className="ml-2 shrink-0 text-xs text-muted-foreground">
                  {s.category}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {results && results.products.length > 0 && (
          <CommandGroup heading="Ingredients">
            {results.products.map((p) => (
              <CommandItem
                key={p.id}
                value={`product-${p.id}`}
                onSelect={() => handleSelect(`/products/${p.id}`)}
              >
                <Package className="mr-2 size-4" aria-hidden="true" />
                <span className="flex-1 truncate">{p.name}</span>
                <span className="ml-2 shrink-0 text-xs tabular-nums text-muted-foreground">
                  {formatCurrency(p.cost.grossPricePerUnit)}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        <CommandGroup heading="Navigation">
          {navigationItems.map((item) => (
            <CommandItem
              key={item.to}
              value={item.label}
              onSelect={() => handleSelect(item.to)}
            >
              <item.icon className="mr-2 size-4" aria-hidden="true" />
              <span>{item.label}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
