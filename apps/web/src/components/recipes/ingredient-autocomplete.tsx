import { useState } from "react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useProductStore } from "@/stores/product-store";
import { useSubRecipeStore } from "@/stores/sub-recipe-store";
import { Plus } from "lucide-react";

export interface IngredientSelection {
  type: "product" | "sub-recipe";
  id: string;
  name: string;
  unit: string;
  refPercent: number;
  costPerUnit: number;
}

interface IngredientAutocompleteProps {
  onSelect: (item: IngredientSelection) => void;
}

export function IngredientAutocomplete({
  onSelect,
}: IngredientAutocompleteProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const products = useProductStore((s) => s.products);
  const subRecipes = useSubRecipeStore((s) => s.subRecipes);

  const query = search.toLowerCase();

  const filteredProducts = query
    ? products.filter((p) => p.name.toLowerCase().includes(query))
    : products;

  const filteredSubRecipes = query
    ? subRecipes.filter((s) => s.name.toLowerCase().includes(query))
    : subRecipes;

  function handleSelect(item: IngredientSelection) {
    onSelect(item);
    setOpen(false);
    setSearch("");
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {/* Styled via buttonVariants rather than render={<Button/>}: nesting a
          Base UI Button inside a Base UI Trigger swallows the open handler. */}
      <PopoverTrigger
        className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
      >
        <Plus className="mr-1 size-3.5" />
        Add ingredient
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search products or sub-recipes..."
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>No results found.</CommandEmpty>
            {filteredProducts.length > 0 && (
              <CommandGroup heading="Products">
                {filteredProducts.map((product) => (
                  <CommandItem
                    key={product.id}
                    onSelect={() =>
                      handleSelect({
                        type: "product",
                        id: product.id,
                        name: product.name,
                        unit: product.yield_.nettUnit,
                        refPercent: product.yield_.refPercent,
                        costPerUnit: parseFloat(product.cost.nettPricePerUnit),
                      })
                    }
                  >
                    <div className="flex flex-1 items-center justify-between gap-2">
                      <div className="flex flex-col">
                        <span className="text-sm">{product.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {product.category}
                        </span>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {product.yield_.nettUnit}
                      </span>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {filteredSubRecipes.length > 0 && (
              <CommandGroup heading="Sub Recipes">
                {filteredSubRecipes.map((subRecipe) => (
                  <CommandItem
                    key={subRecipe.id}
                    onSelect={() =>
                      handleSelect({
                        type: "sub-recipe",
                        id: subRecipe.id,
                        name: subRecipe.name,
                        unit: subRecipe.batchYield.unit,
                        refPercent: 0,
                        costPerUnit: parseFloat(subRecipe.costPerUnit),
                      })
                    }
                  >
                    <div className="flex flex-1 items-center justify-between gap-2">
                      <div className="flex flex-col">
                        <span className="text-sm">{subRecipe.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {subRecipe.category}
                        </span>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {subRecipe.batchYield.unit}
                      </span>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
