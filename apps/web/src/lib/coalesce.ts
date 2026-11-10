// ---------------------------------------------------------------------------
// Many signals, one piece of work
// ---------------------------------------------------------------------------
// A trailing debounce, kept apart from the hook that needs it so it can be
// tested with fake timers rather than with a websocket.
//
// Trailing rather than leading, and the difference matters here. One save in
// this app is one transaction that rewrites a product and every recipe the
// cascade reaches, so it arrives as a burst of events a few milliseconds
// apart. A leading edge would re-read the catalogue on the first of them —
// the state *before* the rest of the transaction's rows are visible — and
// then sit quiet through the ones that matter.
// ---------------------------------------------------------------------------

export interface Coalesced {
  /** Ask for the work. Repeated asks inside the window collapse into one. */
  nudge: () => void;
  /** Drop a pending ask, for an unmount. */
  cancel: () => void;
}

export function coalesce(run: () => void, quietMs: number): Coalesced {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    nudge() {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        run();
      }, quietMs);
    },
    cancel() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}
