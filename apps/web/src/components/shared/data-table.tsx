// ---------------------------------------------------------------------------
// DataTable — lightweight, generic sortable/searchable table
// ---------------------------------------------------------------------------

import { useState, useMemo, useCallback } from "react";
import type { ReactNode } from "react";
import { ArrowUpDown, ArrowUp, ArrowDown, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

// ── Column definition ────────────────────────────────────────────────────────

export interface ColumnDef<T> {
  /** Property key used for sorting and as the React key */
  key: string;
  /** Column header label */
  header: string;
  /** Custom cell renderer — if omitted, accesses row[key] directly */
  cell?: (row: T) => ReactNode;
  /** Whether clicking the header sorts the column */
  sortable?: boolean;
  /** Extra className applied to both <th> and <td> */
  className?: string;
}

// ── Sort state ───────────────────────────────────────────────────────────────

type SortDirection = "asc" | "desc";

interface SortState {
  key: string;
  direction: SortDirection;
}

// ── Props ────────────────────────────────────────────────────────────────────

interface DataTableProps<T> {
  data: T[];
  columns: ColumnDef<T>[];
  /** Placeholder for the built-in search input */
  searchPlaceholder?: string;
  /** Fields on T to match against when searching (dot paths not supported) */
  searchFields?: (keyof T)[];
  /** Optional custom filter function (replaces searchFields-based search) */
  filterFn?: (row: T, query: string) => boolean;
  /** Click handler for a row */
  onRowClick?: (row: T) => void;
  /** Hide the built-in search input */
  hideSearch?: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getNestedValue(obj: unknown, key: string): unknown {
  // simple one-level accessor; supports keys like "cost" but not "cost.nett"
  return (obj as Record<string, unknown>)?.[key];
}

function defaultSearch<T>(
  row: T,
  query: string,
  fields: (keyof T)[],
): boolean {
  const q = query.toLowerCase();
  return fields.some((field) => {
    const val = (row as Record<string, unknown>)[field as string];
    if (val == null) return false;
    return String(val).toLowerCase().includes(q);
  });
}

// ── Component ────────────────────────────────────────────────────────────────

export function DataTable<T extends Record<string, unknown>>({
  data,
  columns,
  searchPlaceholder = "Search...",
  searchFields,
  filterFn,
  onRowClick,
  hideSearch = false,
}: DataTableProps<T>) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortState | null>(null);

  // ── Filter ───────────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    if (!search) return data;

    if (filterFn) {
      return data.filter((row) => filterFn(row, search));
    }

    if (searchFields && searchFields.length > 0) {
      return data.filter((row) => defaultSearch(row, search, searchFields));
    }

    // Fallback: search all columns
    const allKeys = columns.map((c) => c.key) as (keyof T)[];
    return data.filter((row) => defaultSearch(row, search, allKeys));
  }, [data, search, filterFn, searchFields, columns]);

  // ── Sort ─────────────────────────────────────────────────────────────────

  const sorted = useMemo(() => {
    if (!sort) return filtered;

    const { key, direction } = sort;
    return [...filtered].sort((a, b) => {
      const aVal = getNestedValue(a, key);
      const bVal = getNestedValue(b, key);

      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return 1;
      if (bVal == null) return -1;

      let cmp: number;
      if (typeof aVal === "number" && typeof bVal === "number") {
        cmp = aVal - bVal;
      } else {
        cmp = String(aVal).localeCompare(String(bVal));
      }
      return direction === "desc" ? -cmp : cmp;
    });
  }, [filtered, sort]);

  // ── Sort toggle ──────────────────────────────────────────────────────────

  const toggleSort = useCallback(
    (key: string) => {
      setSort((prev) => {
        if (!prev || prev.key !== key) return { key, direction: "asc" };
        if (prev.direction === "asc") return { key, direction: "desc" };
        return null; // third click clears
      });
    },
    [],
  );

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-3">
      {/* Search input */}
      {!hideSearch && (
        <div className="relative max-w-sm">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={searchPlaceholder}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
      )}

      {/* Table */}
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((col) => (
              <TableHead
                key={col.key}
                className={cn(
                  col.sortable && "cursor-pointer select-none",
                  col.className,
                )}
                onClick={col.sortable ? () => toggleSort(col.key) : undefined}
              >
                <span className="inline-flex items-center gap-1">
                  {col.header}
                  {col.sortable && (
                    <span className="text-muted-foreground">
                      {sort?.key === col.key ? (
                        sort.direction === "asc" ? (
                          <ArrowUp className="size-3.5" />
                        ) : (
                          <ArrowDown className="size-3.5" />
                        )
                      ) : (
                        <ArrowUpDown className="size-3.5 opacity-40" />
                      )}
                    </span>
                  )}
                </span>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={columns.length}
                className="h-24 text-center text-muted-foreground"
              >
                No results.
              </TableCell>
            </TableRow>
          ) : (
            sorted.map((row, idx) => (
              <TableRow
                key={(row as Record<string, unknown>).id as string ?? idx}
                className={cn(onRowClick && "cursor-pointer")}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
              >
                {columns.map((col) => (
                  <TableCell key={col.key} className={col.className}>
                    {col.cell
                      ? col.cell(row)
                      : (getNestedValue(row, col.key) as ReactNode) ?? "--"}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
