import * as React from "react"

import { cn } from "@/lib/utils"

/*
 * Two spacing tokens, not one.
 *
 * `--card-spacing` was doing both jobs: the inset from the card's edge AND the
 * vertical gap between header, content and footer. A metric tile is a label, a
 * figure and one line of hint, and at 16 px everywhere it came out 128 px tall
 * — pages that carry four of them spent a third of the first screen on four
 * numbers. The horizontal inset has to stay at 16 px, because tables and
 * toolbars inside cards align to it, so the vertical rhythm needed its own
 * token to move independently.
 *
 * The page-level stat tiles also pass `pb-2` on CardHeader, which compounds
 * with the gap rather than replacing it. Tightening the gap is what actually
 * reaches them, since this component cannot reach into the pages.
 */

function Card({
  className,
  size = "default",
  ...props
}: React.ComponentProps<"div"> & { size?: "default" | "sm" }) {
  return (
    <div
      data-slot="card"
      data-size={size}
      className={cn(
        // shadow-sm is DOC4's first elevation step. The ring stays: in dark
        // mode a 2 px shadow against a near-black page does almost nothing, so
        // the ring is what still draws the card's edge there.
        "group/card flex flex-col gap-(--card-rhythm) overflow-hidden rounded-xl bg-card py-(--card-rhythm) text-sm text-card-foreground shadow-sm ring-1 ring-foreground/10 [--card-rhythm:--spacing(3)] [--card-spacing:--spacing(4)] has-data-[slot=card-footer]:pb-0 has-[>img:first-child]:pt-0 data-[size=sm]:[--card-rhythm:--spacing(2)] data-[size=sm]:[--card-spacing:--spacing(3)] data-[size=sm]:has-data-[slot=card-footer]:pb-0 *:[img:first-child]:rounded-t-xl *:[img:last-child]:rounded-b-xl",
        className
      )}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "group/card-header @container/card-header grid auto-rows-min items-start gap-1 rounded-t-xl px-(--card-spacing) has-data-[slot=card-action]:grid-cols-[1fr_auto] has-data-[slot=card-description]:grid-rows-[auto_auto] [.border-b]:pb-(--card-rhythm)",
        className
      )}
      {...props}
    />
  )
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn(
        "font-heading text-base leading-snug font-medium group-data-[size=sm]/card:text-sm",
        className
      )}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        "col-start-2 row-span-2 row-start-1 self-start justify-self-end",
        className
      )}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("px-(--card-spacing)", className)}
      {...props}
    />
  )
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        "flex items-center rounded-b-xl border-t bg-muted/50 px-(--card-spacing) py-(--card-rhythm)",
        className
      )}
      {...props}
    />
  )
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
}
