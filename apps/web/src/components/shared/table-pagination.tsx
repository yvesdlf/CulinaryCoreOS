// ---------------------------------------------------------------------------
// Table pagination
// ---------------------------------------------------------------------------
// The Manuza catalogue is 1.106 products, and the list rendered every one of
// them as a DOM row. That is slow to paint, slow to scroll, and slow enough
// walking the accessibility tree that the tablet axe scan timed out at 30 s.
//
// Paging rather than windowing. A virtualised list has to rebuild row
// semantics by hand — aria-rowcount, aria-rowindex, and a scroll container a
// screen reader can still count — and gets them subtly wrong far more often
// than not. Pages keep a real <table> with real rows, which is what assistive
// technology already understands, and 25 rows is a more useful unit than an
// infinite scroll for someone checking a price.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export const DEFAULT_PAGE_SIZE = 25;

/**
 * Slice a list into the current page.
 *
 * Resets to page 1 whenever the filtered length changes, otherwise typing a
 * search that narrows 1.106 rows to 3 leaves you on page 12 looking at an
 * empty table.
 */
export function usePagination<T>(items: T[], pageSize = DEFAULT_PAGE_SIZE) {
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));

  useEffect(() => {
    setPage(1);
  }, [items.length]);

  // Clamp rather than trust: a deletion can shrink the list under the cursor.
  const current = Math.min(page, pageCount);
  const pageItems = useMemo(
    () => items.slice((current - 1) * pageSize, current * pageSize),
    [items, current, pageSize],
  );

  return {
    pageItems,
    page: current,
    pageCount,
    setPage,
    total: items.length,
    from: items.length === 0 ? 0 : (current - 1) * pageSize + 1,
    to: Math.min(current * pageSize, items.length),
  };
}

interface Props {
  page: number;
  pageCount: number;
  from: number;
  to: number;
  total: number;
  /** Plural noun for the status line, e.g. "products". */
  noun: string;
  onPageChange: (page: number) => void;
}

export function TablePagination({
  page,
  pageCount,
  from,
  to,
  total,
  noun,
  onPageChange,
}: Props) {
  if (total === 0) return null;

  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
      {/*
        A live region, because changing page updates the table silently
        otherwise — a screen-reader user gets no confirmation anything moved.
      */}
      <p className="text-sm text-muted-foreground" aria-live="polite">
        Showing {from.toLocaleString()}–{to.toLocaleString()} of{" "}
        {total.toLocaleString()} {noun}
      </p>

      <nav aria-label={`${noun} pagination`} className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft className="mr-1 size-4" aria-hidden="true" />
          Previous
        </Button>
        {/* Written out, so the position is not carried by the disabled
            states of the buttons alone. */}
        <span className="text-sm tabular-nums">
          Page {page} of {pageCount}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= pageCount}
          onClick={() => onPageChange(page + 1)}
        >
          Next
          <ChevronRight className="ml-1 size-4" aria-hidden="true" />
        </Button>
      </nav>
    </div>
  );
}
