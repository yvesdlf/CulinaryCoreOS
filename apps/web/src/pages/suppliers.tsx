// ---------------------------------------------------------------------------
// Suppliers
// ---------------------------------------------------------------------------
// Derived from the supplier field on products rather than from a table of its
// own. There is nothing to store yet — no contacts, no terms, no order history
// — and inventing an entity to hold a string the products already carry would
// mean two places for the same name to disagree.
//
// What this is for: a price list arrives from one supplier, and the question is
// which ingredients it covers and what they currently cost. That, plus the
// nudge to fix names that have drifted apart.
// ---------------------------------------------------------------------------

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Download, TriangleAlert } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { CurrencyDisplay } from "@/components/shared/currency-display";
import { useProductStore } from "@/stores/product-store";
import { toDecimal } from "@/engine/cost-engine";
import { toCsv, downloadCsv, datedFilename } from "@/lib/csv";

interface Supplier {
  name: string;
  items: number;
  /** Sum of unit costs — a rough measure of exposure, not of spend. */
  totalUnitCost: string;
  needingReview: number;
}

/** Case- and space-insensitive, which is how the duplicates arise. */
function key(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export function SuppliersPage() {
  const products = useProductStore((s) => s.products);
  const [search, setSearch] = useState("");

  const { suppliers, unassigned, duplicates } = useMemo(() => {
    const byExactName = new Map<string, Supplier>();
    // Keyed loosely, so "UD Astungkara Lancar" and "UD Astungkara lancar"
    // collide here even though they are two distinct strings on the products.
    const byLooseKey = new Map<string, Set<string>>();
    let noSupplier = 0;

    for (const p of products) {
      const name = p.supplier?.trim();
      if (!name) {
        noSupplier++;
        continue;
      }

      const entry = byExactName.get(name) ?? {
        name,
        items: 0,
        totalUnitCost: "0",
        needingReview: 0,
      };
      entry.items++;
      entry.totalUnitCost = toDecimal(entry.totalUnitCost)
        .plus(toDecimal(p.cost.grossPricePerUnit))
        .toFixed(5);
      if (p.allergensNeedReview) entry.needingReview++;
      byExactName.set(name, entry);

      const k = key(name);
      byLooseKey.set(k, (byLooseKey.get(k) ?? new Set()).add(name));
    }

    return {
      suppliers: [...byExactName.values()].sort((a, b) => b.items - a.items),
      unassigned: noSupplier,
      // Only the genuine collisions: one loose key, more than one spelling.
      duplicates: [...byLooseKey.values()]
        .filter((names) => names.size > 1)
        .map((names) => [...names]),
    };
  }, [products]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? suppliers.filter((s) => s.name.toLowerCase().includes(q)) : suppliers;
  }, [suppliers, search]);

  function exportCsv() {
    downloadCsv(
      datedFilename("ccos-suppliers"),
      toCsv(
        ["Supplier", "Ingredients", "Total unit cost", "Allergens to verify"],
        filtered.map((s) => [s.name, s.items, s.totalUnitCost, s.needingReview]),
      ),
    );
  }

  return (
    <div>
      <PageHeader
        title="Suppliers"
        description={`${suppliers.length} suppliers across ${products.length - unassigned} ingredients`}
      >
        <Button
          variant="outline"
          onClick={exportCsv}
          disabled={filtered.length === 0}
        >
          <Download className="mr-1 size-4" aria-hidden="true" />
          Export CSV
        </Button>
      </PageHeader>

      {duplicates.length > 0 && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-status-warning/40 bg-status-warning-soft p-4"
        >
          <p className="flex items-center gap-2 text-sm font-medium text-status-warning">
            <TriangleAlert className="size-4" aria-hidden="true" />
            {duplicates.length}{" "}
            {duplicates.length === 1 ? "supplier appears" : "suppliers appear"}{" "}
            under more than one spelling
          </p>
          <p className="mt-1 text-xs text-foreground/80">
            These are counted separately everywhere, so their ingredients and
            totals are split between them. Correcting the spelling on the
            products merges them.
          </p>
          <ul className="mt-2 space-y-1 text-xs text-foreground/80">
            {duplicates.map((names) => (
              <li key={names.join("|")}>{names.join("  ·  ")}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="mb-4 max-w-xs">
        <Input
          placeholder="Search suppliers..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search suppliers"
        />
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Supplier</TableHead>
            <TableHead className="text-right">Ingredients</TableHead>
            <TableHead className="text-right">Total unit cost</TableHead>
            <TableHead className="text-right">Allergens to verify</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.length === 0 ? (
            <TableRow>
              <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">
                No suppliers match.
              </TableCell>
            </TableRow>
          ) : (
            filtered.map((s) => (
              <TableRow key={s.name}>
                <TableCell className="font-medium">
                  {/* Straight to that supplier's ingredients, which is what
                      you want open when their price list arrives. */}
                  <Link
                    to={`/products?search=${encodeURIComponent(s.name)}`}
                    className="underline-offset-4 hover:underline"
                  >
                    {s.name}
                  </Link>
                </TableCell>
                <TableCell className="text-right tabular-nums">{s.items}</TableCell>
                <TableCell className="text-right">
                  {/* Summed unit costs, not spend: without volumes there is no
                      honest way to say what is paid, and a number labelled
                      "spend" would be believed. */}
                  <CurrencyDisplay value={s.totalUnitCost} />
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {s.needingReview > 0 ? (
                    <span className="text-status-warning">{s.needingReview}</span>
                  ) : (
                    <span className="text-muted-foreground">--</span>
                  )}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      {unassigned > 0 && (
        <p className="mt-4 text-sm text-muted-foreground">
          {unassigned} ingredients have no supplier recorded.{" "}
          <Link to="/products" className="underline underline-offset-4">
            See products
          </Link>
        </p>
      )}
    </div>
  );
}
