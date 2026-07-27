import { useMemo } from "react";
import type { IngredientLine } from "@ccos/shared";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useProductStore } from "@/stores/product-store";
import { useSubRecipeStore } from "@/stores/sub-recipe-store";
import { calculateGrossQty, calculateLineCost } from "@/engine/cost-engine";
import { formatCurrency, formatNumber } from "@/lib/format";
import { Trash2 } from "lucide-react";
import {
  IngredientAutocomplete,
  type IngredientSelection,
} from "./ingredient-autocomplete";

interface IngredientLinesTableProps {
  lines: IngredientLine[];
  onChange: (lines: IngredientLine[]) => void;
  readOnly?: boolean;
}

export function IngredientLinesTable({
  lines,
  onChange,
  readOnly = false,
}: IngredientLinesTableProps) {
  const getProduct = useProductStore((s) => s.getById);
  const getSubRecipe = useSubRecipeStore((s) => s.getById);

  function getIngredientName(line: IngredientLine): string {
    if (line.productId) {
      const product = getProduct(line.productId);
      return product?.name ?? "Unknown Product";
    }
    if (line.subRecipeId) {
      const subRecipe = getSubRecipe(line.subRecipeId);
      return subRecipe?.name ?? "Unknown Sub Recipe";
    }
    return "—";
  }

  function updateLine(index: number, changes: Partial<IngredientLine>) {
    const updated = lines.map((line, i) => {
      if (i !== index) return line;

      const merged = { ...line, ...changes };
      const nettQty = merged.nettQty;
      const refPercent = merged.refPercent;
      const costPerUnit = parseFloat(merged.costPerUnit);

      const { grossQty, lineCost } = calculateLineCost(
        nettQty,
        refPercent,
        costPerUnit,
      );

      return {
        ...merged,
        grossQty,
        grossUnit: merged.nettUnit,
        lineCost: lineCost.toFixed(2),
      };
    });
    onChange(updated);
  }

  function removeLine(index: number) {
    const updated = lines
      .filter((_, i) => i !== index)
      .map((line, i) => ({ ...line, lineNumber: i + 1 }));
    onChange(updated);
  }

  function addIngredient(item: IngredientSelection) {
    const lineNumber = lines.length + 1;
    const { grossQty, lineCost } = calculateLineCost(
      0,
      item.refPercent,
      item.costPerUnit,
    );

    const newLine: IngredientLine = {
      id: crypto.randomUUID(),
      lineNumber,
      productId: item.type === "product" ? item.id : null,
      subRecipeId: item.type === "sub-recipe" ? item.id : null,
      nettQty: 0,
      nettUnit: item.unit,
      refPercent: item.refPercent,
      grossQty,
      grossUnit: item.unit,
      costPerUnit: item.costPerUnit.toFixed(5),
      lineCost: lineCost.toFixed(2),
    };

    onChange([...lines, newLine]);
  }

  if (lines.length === 0 && readOnly) {
    return (
      <div className="flex min-h-[120px] items-center justify-center rounded-lg border border-dashed">
        <p className="text-sm text-muted-foreground">No ingredients added</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">#</TableHead>
            <TableHead className="min-w-[180px]">Ingredient</TableHead>
            <TableHead className="w-24">Nett Qty</TableHead>
            <TableHead className="w-16">Unit</TableHead>
            <TableHead className="w-20">Ref%</TableHead>
            <TableHead className="w-24">Gross Qty</TableHead>
            <TableHead className="w-24">Cost/Unit</TableHead>
            <TableHead className="w-24 text-right">Cost</TableHead>
            {!readOnly && <TableHead className="w-12" />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={readOnly ? 8 : 9}
                className="h-24 text-center text-muted-foreground"
              >
                No ingredients added. Click "Add ingredient" below to start.
              </TableCell>
            </TableRow>
          ) : (
            lines.map((line, index) => (
              <TableRow key={line.id}>
                <TableCell className="text-muted-foreground">
                  {line.lineNumber}
                </TableCell>
                <TableCell className="font-medium">
                  {getIngredientName(line)}
                  {line.subRecipeId && (
                    <span className="ml-1.5 text-xs text-muted-foreground">
                      (sub)
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  {readOnly ? (
                    formatNumber(line.nettQty)
                  ) : (
                    <Input
                      type="number"
                      min={0}
                      step="any"
                      value={line.nettQty || ""}
                      onChange={(e) =>
                        updateLine(index, {
                          nettQty: parseFloat(e.target.value) || 0,
                        })
                      }
                      className="h-7 w-20 tabular-nums"
                    />
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {line.nettUnit}
                </TableCell>
                <TableCell>
                  {readOnly ? (
                    `${line.refPercent}%`
                  ) : (
                    <Input
                      type="number"
                      min={0}
                      max={99}
                      step="any"
                      value={line.refPercent || ""}
                      onChange={(e) =>
                        updateLine(index, {
                          refPercent: parseFloat(e.target.value) || 0,
                        })
                      }
                      className="h-7 w-16 tabular-nums"
                    />
                  )}
                </TableCell>
                <TableCell className="tabular-nums">
                  {formatNumber(line.grossQty)}
                </TableCell>
                <TableCell className="tabular-nums text-muted-foreground">
                  {parseFloat(line.costPerUnit).toFixed(4)}
                </TableCell>
                <TableCell className="text-right tabular-nums font-medium">
                  {formatCurrency(parseFloat(line.lineCost))}
                </TableCell>
                {!readOnly && (
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => removeLine(index)}
                    >
                      <Trash2 className="size-3.5 text-muted-foreground hover:text-destructive" />
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      {!readOnly && <IngredientAutocomplete onSelect={addIngredient} />}
    </div>
  );
}
