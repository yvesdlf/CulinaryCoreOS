// ---------------------------------------------------------------------------
// Where the venue is, as far as "today" is concerned
// ---------------------------------------------------------------------------
// The time zone decides when the business day turns over — on every screen
// and, since 0082, in every view the database computes. It was UTC until a
// venue said otherwise, which for a kitchen in Bali put the day's change at
// eight in the morning. Owners and administrators set it; the database
// refuses anybody else and any name it does not recognise.
// ---------------------------------------------------------------------------

import { useMemo, useState } from "react";
import { Clock } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { saveVenueTimezone } from "@/data/repository";
import { useVenueStore } from "@/stores/venue-store";
import { venueToday } from "@/lib/today";

function knownTimezones(current: string): string[] {
  let zones: string[] = [];
  try {
    zones = Intl.supportedValuesOf("timeZone");
  } catch {
    zones = ["UTC"];
  }
  // A zone the browser does not list must still be shown, not silently swapped.
  return zones.includes(current) ? zones : [current, ...zones];
}

export function VenueClockCard({ canManage }: { canManage: boolean }) {
  const settings = useVenueStore((s) => s.settings);
  const [zone, setZone] = useState(settings.timezone);
  const [busy, setBusy] = useState(false);
  const zones = useMemo(() => knownTimezones(settings.timezone), [settings.timezone]);
  const changed = zone !== settings.timezone;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <Clock className="size-4" />Time zone and currency
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          When the venue's day starts and ends — for checks that are due today,
          the rota, takings and every daily figure. Today here is{" "}
          <span className="font-medium tabular-nums text-foreground">{venueToday()}</span>.
        </p>
        <div className="max-w-sm space-y-2">
          <Label htmlFor="venue-tz">Time zone</Label>
          <select id="venue-tz" className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
            value={zone} disabled={!canManage || busy}
            onChange={(e) => setZone(e.target.value)}>
            {zones.map((z) => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}
          </select>
        </div>
        <p className="text-sm">
          Currency: <span className="font-medium">{settings.currency}</span>{" "}
          <span className="text-muted-foreground">
            — set when the catalogue was priced; changing it means repricing every ingredient.
          </span>
        </p>
        {canManage ? (
          <Button size="sm" disabled={!changed || busy} onClick={async () => {
            setBusy(true);
            try {
              await saveVenueTimezone(zone);
              await useVenueStore.getState().load();
              toast.success(`Time zone set to ${zone.replace(/_/g, " ")}`);
            } catch (err) {
              toast.error("Could not change the time zone", {
                description: err instanceof Error ? err.message : String(err),
              });
            } finally { setBusy(false); }
          }}>Save time zone</Button>
        ) : (
          <p className="text-xs text-muted-foreground">
            An owner or administrator can change this.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
