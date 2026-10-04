import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "@/lib/utils"

/*
 * forwardRef, for the same reason `Textarea` has it: React 18 does not pass
 * `ref` through as a plain prop to a function component, so a ref pointed at
 * this stayed null and every call through it did nothing.
 *
 * What that cost, concretely. The staff-comms screen clears the file input
 * after sending — `fileInput.current.value = ""` — and the guard in front of
 * it meant the line never ran. The input kept showing the file just sent, and
 * because a browser fires no `change` event when the chosen file is the same
 * one, picking it again set no state and the next message went without its
 * attachment. Nothing errored and nothing looked wrong.
 */
const Input = React.forwardRef<
  HTMLInputElement,
  React.ComponentProps<"input">
>(function Input({ className, type, ...props }, ref) {
  return (
    <InputPrimitive
      ref={ref}
      type={type}
      data-slot="input"
      className={cn(
        "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
})

export { Input }
