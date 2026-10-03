import * as React from "react"

import { cn } from "@/lib/utils"

/** Row height. Comfortable is the spacing every table already had. */
export type TableDensity = "comfortable" | "compact"

/**
 * Is this container actually scrolling right now, and on which axis?
 *
 * A container that overflows must be reachable by keyboard, or the off-screen
 * content exists only for people using a pointer (WCAG 2.1.1). A container
 * that fits must NOT be a tab stop, though — that would put a stop before
 * every table in the app for no benefit, which is its own accessibility cost.
 * Neither state can be known from markup, so it is measured, and re-measured
 * on resize because the same table overflows on a tablet and fits on a desktop.
 *
 * Both axes now, not just the horizontal one: a sticky-header table caps its
 * own height, so the rows a mouse can reach by scrolling down were otherwise
 * unreachable by keyboard.
 *
 * The table element is observed as well as the container. With the height
 * capped the container stops changing size once it hits the cap, so rows
 * arriving from Supabase — which is every one of these tables — would never
 * trigger a re-measure and the region would never become focusable.
 */
function useOverflows(ref: React.RefObject<HTMLDivElement | null>) {
  const [overflows, setOverflows] = React.useState({ x: false, y: false })

  React.useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => {
      const x = el.scrollWidth > el.clientWidth + 1
      const y = el.scrollHeight > el.clientHeight + 1
      // Same object back when nothing moved, so a resize that changes neither
      // axis does not re-render every row.
      setOverflows((prev) => (prev.x === x && prev.y === y ? prev : { x, y }))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    if (el.firstElementChild) observer.observe(el.firstElementChild)
    return () => observer.disconnect()
  }, [ref])

  return overflows
}

function Table({
  className,
  density = "comfortable",
  stickyHeader = false,
  ...props
}: React.ComponentProps<"table"> & {
  density?: TableDensity
  stickyHeader?: boolean
}) {
  const ref = React.useRef<HTMLDivElement>(null)
  const overflows = useOverflows(ref)
  const scrollable = overflows.x || overflows.y

  return (
    <div
      ref={ref}
      data-slot="table-container"
      className={cn(
        "relative w-full overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        /*
         * A sticky header needs a scrollport to stick inside, and this
         * container already is one: `overflow-x: auto` computes `overflow-y`
         * to auto too, so `top: 0` on a header cell was pinning it to a
         * scrollport the same height as the table — which is to say, nowhere.
         * Capping the height gives the rows somewhere to scroll and leaves the
         * filter bar and the page heading on screen while they do, which is
         * the whole point of the request.
         *
         * 70vh, not a row count: what matters is that the header and the
         * filters stay visible, and that depends on the window rather than on
         * how many requisitions happen to exist.
         */
        stickyHeader && "max-h-[70vh] overflow-y-auto",
      )}
      // Only a tab stop while there is something off-screen to scroll to.
      tabIndex={scrollable ? 0 : undefined}
      role={scrollable ? "region" : undefined}
      aria-label={scrollable ? "Table, scrollable" : undefined}
    >
      <table
        data-slot="table"
        data-density={density}
        data-sticky-header={stickyHeader ? "true" : undefined}
        className={cn("group/table w-full caption-bottom text-sm", className)}
        {...props}
      />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("[&_tr]:border-b", className)}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "border-t bg-muted/50 font-medium [&>tr]:last:border-b-0",
        className
      )}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "border-b transition-colors hover:bg-muted/50 has-aria-expanded:bg-muted/50 data-[state=selected]:bg-muted",
        className
      )}
      {...props}
    />
  )
}

/*
 * Sticky lives on the cells, not on the thead.
 *
 * Tailwind's preflight sets `border-collapse: collapse`, and under collapse a
 * positioned `thead` loses its own background and border in Chrome — the rows
 * show through it as they pass. Each `th` carries the fill instead, and the
 * separating line is an inset shadow rather than `border-b`, because a
 * collapsed border belongs to the table grid and scrolls away with it.
 *
 * `bg-background` is right for every table here: they all sit directly on the
 * page, including the ones wrapped in `rounded-lg border`, which adds no fill
 * of its own.
 */
function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "h-10 px-2 text-left align-middle font-medium whitespace-nowrap text-foreground [&:has([role=checkbox])]:pr-0",
        "group-data-[density=compact]/table:h-8",
        "group-data-[sticky-header=true]/table:sticky group-data-[sticky-header=true]/table:top-0 group-data-[sticky-header=true]/table:z-10 group-data-[sticky-header=true]/table:bg-background group-data-[sticky-header=true]/table:shadow-[inset_0_-1px_0_var(--border-subtle)]",
        className
      )}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0",
        // Vertical only. Squeezing the horizontal padding as well would move
        // every column and make the two densities read as two layouts.
        "group-data-[density=compact]/table:py-1",
        className
      )}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
