// ---------------------------------------------------------------------------
// Delete or archive
// ---------------------------------------------------------------------------
// Two different actions behind one button, chosen by whether anything depends
// on the thing:
//
//   * nothing depends on it  -> deleting is safe; confirm once and do it
//   * something does         -> deleting is refused, archiving is offered
//
// Refused rather than warned about. A confirmation that can be clicked through
// is a warning; this is a wrong number in a costing, and the app knows enough
// to be certain. Archiving is the honest alternative: it takes the row out of
// the working list while every dish built on it keeps costing correctly, which
// is what "we do not buy this any more" means in a kitchen.
// ---------------------------------------------------------------------------

import { useState } from "react";
import { Link } from "react-router-dom";
import { Trash2, Archive, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { DeletionVerdict } from "@/engine/deletion";

interface Props {
  /** What is being removed, for the wording. */
  entityLabel: string;
  name: string;
  verdict: DeletionVerdict;
  /** Where a blocker of each kind lives, so the dialog can link to it. */
  hrefFor: (kind: string, id: string) => string;
  onDelete: () => Promise<void> | void;
  /** Archiving is a status change; absent when the entity has no such state. */
  onArchive?: () => Promise<void> | void;
  /** Already archived — offering it again would do nothing. */
  archived?: boolean;
}

export function DeleteEntity({
  entityLabel,
  name,
  verdict,
  hrefFor,
  onDelete,
  onArchive,
  archived = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<void> | void, what: string) {
    setBusy(true);
    try {
      await action();
      setOpen(false);
    } catch (err) {
      toast.error(`Could not ${what}`, {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Trash2 className="mr-1 size-4" aria-hidden="true" />
        Delete
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {verdict.canDelete ? `Delete ${name}?` : `${name} is in use`}
            </DialogTitle>
            <DialogDescription>
              {verdict.canDelete
                ? `Nothing depends on this ${entityLabel}, so removing it changes no costing. This cannot be undone.`
                : `${verdict.reason} Deleting it would leave them costing from something that no longer exists.`}
            </DialogDescription>
          </DialogHeader>

          {verdict.blockers.length > 0 && (
            <div className="rounded-md border border-status-warning/40 bg-status-warning-soft p-3">
              <p className="flex items-center gap-2 text-sm font-medium text-status-warning">
                <TriangleAlert className="size-4" aria-hidden="true" />
                Remove it from these first
              </p>
              <ul className="mt-2 space-y-1 text-sm text-foreground/80">
                {verdict.blockers.slice(0, 10).map((b) => (
                  <li key={`${b.kind}-${b.id}`}>
                    <Link
                      to={hrefFor(b.kind, b.id)}
                      className="underline underline-offset-4"
                      onClick={() => setOpen(false)}
                    >
                      {b.name}
                    </Link>
                    <span className="text-muted-foreground"> · {b.kind}</span>
                  </li>
                ))}
              </ul>
              {verdict.blockers.length > 10 && (
                <p className="mt-1 text-xs text-foreground/80">
                  and {verdict.blockers.length - 10} more
                </p>
              )}
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>

            {/* Offered whenever it is possible and would change something —
                the useful action for a line that is simply no longer bought. */}
            {onArchive && !archived && (
              <Button
                variant="outline"
                onClick={() => void run(onArchive, "archive")}
                disabled={busy}
              >
                <Archive className="mr-1 size-4" aria-hidden="true" />
                Archive instead
              </Button>
            )}

            {verdict.canDelete && (
              <Button
                variant="destructive"
                onClick={() => void run(onDelete, "delete")}
                disabled={busy}
              >
                <Trash2 className="mr-1 size-4" aria-hidden="true" />
                {busy ? "Deleting..." : "Delete permanently"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
