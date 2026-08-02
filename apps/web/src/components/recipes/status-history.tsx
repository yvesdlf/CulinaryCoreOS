// ---------------------------------------------------------------------------
// Status history
// ---------------------------------------------------------------------------
// The audit table is written on every transition and, until now, read by
// nobody. A record that cannot be seen answers the question it exists for —
// "who put this on the menu, and when" — only to someone with database access,
// which is not the person asking.
// ---------------------------------------------------------------------------

import { useEffect, useState } from "react";
import { History } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fetchStatusHistory, type StatusEvent } from "@/data/repository";
import { isSupabaseConfigured } from "@/lib/supabase";
import { label } from "@/engine/status-workflow";
import type { RecipeStatus } from "@ccos/shared";

export function StatusHistory({ recipeId }: { recipeId: string }) {
  const [events, setEvents] = useState<StatusEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }
    fetchStatusHistory(recipeId)
      .then(setEvents)
      // A history that cannot be loaded is not worth an error toast over the
      // editor — the recipe itself is fine, and the panel says so below.
      .catch(() => setEvents([]))
      .finally(() => setLoading(false));
  }, [recipeId]);

  if (!isSupabaseConfigured) return null;

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <History className="size-4" aria-hidden="true" />
          Status history
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : events.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No status changes recorded yet.
          </p>
        ) : (
          <ol className="space-y-2 text-sm">
            {events.map((e) => (
              <li key={e.id} className="border-b pb-2 last:border-0 last:pb-0">
                <p>
                  {e.fromStatus && (
                    <>
                      <span className="text-muted-foreground">
                        {label(e.fromStatus as RecipeStatus)}
                      </span>{" "}
                      <span aria-hidden="true">→</span>{" "}
                    </>
                  )}
                  <span className="font-medium">
                    {label(e.toStatus as RecipeStatus)}
                  </span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {/* Who and when, which is the whole point of the record. */}
                  {e.actorEmail ?? "unknown"} ·{" "}
                  {new Date(e.createdAt).toLocaleString("id-ID")}
                </p>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
