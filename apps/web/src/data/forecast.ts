// ---------------------------------------------------------------------------
// The sales forecast, and the events the average cannot know about
// ---------------------------------------------------------------------------
// Building a forecast is `build_sales_forecast` (0107) and stays there. The
// method is four lines of arithmetic, which is exactly why it is tempting to
// reimplement here — and a second implementation is the one that drifts. More
// to the point, the stored figure is the one a roster was built against, so
// recomputing it in the browser would answer a different question from the
// one the screen is asking.
//
// Everything below is therefore reads, plus two writes that are rows rather
// than calculations: the event, and the actual that the forecast gets
// measured against afterwards.
// ---------------------------------------------------------------------------

import { requireSupabase } from "@/lib/supabase";
import { currentOrgId, fail } from "./_shared";

export interface ForecastRow {
  id: string;
  businessUnitId: string | null;
  unitName: string | null;
  forecastFor: string;
  /** Null where there was no trading history to go on — never zero. */
  covers: number | null;
  netSales: number | null;
  weeksSampled: number | null;
  samplesUsed: number | null;
  note: string | null;
  actualCovers: number | null;
  actualNetSales: number | null;
}

export interface KnownEvent {
  id: string;
  businessUnitId: string | null;
  onDate: string;
  name: string;
  coversOverride: number | null;
  coversExtra: number | null;
  note: string | null;
}

function num(v: unknown): number | null {
  return v === null || v === undefined ? null : Number(v);
}

export async function fetchForecasts(fromDate: string): Promise<ForecastRow[]> {
  const db = requireSupabase();
  const { data, error } = await db
    .from("sales_forecasts")
    .select("*, business_units(name)")
    .gte("forecast_for", fromDate)
    .order("forecast_for", { ascending: true })
    .limit(400);
  if (error) fail("fetchForecasts", error);

  return (data ?? []).map((r: any) => ({
    id: r.id,
    businessUnitId: r.business_unit_id,
    unitName: r.business_units?.name ?? null,
    forecastFor: r.forecast_for,
    covers: num(r.covers),
    netSales: num(r.net_sales),
    weeksSampled: r.weeks_sampled,
    samplesUsed: r.samples_used,
    note: r.note,
    actualCovers: num(r.actual_covers),
    actualNetSales: num(r.actual_net_sales),
  }));
}

export async function fetchKnownEvents(fromDate: string): Promise<KnownEvent[]> {
  const db = requireSupabase();
  const { data, error } = await db
    .from("known_events")
    .select("*")
    .gte("on_date", fromDate)
    .order("on_date", { ascending: true })
    .limit(200);
  if (error) fail("fetchKnownEvents", error);

  return (data ?? []).map((r: any) => ({
    id: r.id,
    businessUnitId: r.business_unit_id,
    onDate: r.on_date,
    name: r.name,
    coversOverride: num(r.covers_override),
    coversExtra: num(r.covers_extra),
    note: r.note,
  }));
}

/**
 * Returns how many outlets got a figure.
 *
 * Zero is a real answer and the screen says so rather than claiming success:
 * an outlet with no trading history on that weekday gets nothing, which is
 * the honest result and not a failure to report.
 */
export async function buildForecast(forDate: string, unitId?: string | null): Promise<number> {
  const org = await currentOrgId();
  const { data, error } = await requireSupabase().rpc("build_sales_forecast", {
    p_org: org,
    p_for: forDate,
    p_unit: unitId ?? null,
  });
  if (error) fail("buildForecast", error);
  return Number(data ?? 0);
}

export async function addKnownEvent(e: {
  unitId: string | null;
  onDate: string;
  name: string;
  coversOverride: number | null;
  coversExtra: number | null;
  note: string | null;
}): Promise<void> {
  const org = await currentOrgId();
  const { error } = await requireSupabase().from("known_events").insert({
    org_id: org,
    business_unit_id: e.unitId,
    on_date: e.onDate,
    name: e.name,
    covers_override: e.coversOverride,
    covers_extra: e.coversExtra,
    note: e.note,
  });
  if (error) fail("addKnownEvent", error);
}

export async function removeKnownEvent(id: string): Promise<void> {
  const { error } = await requireSupabase().from("known_events").delete().eq("id", id);
  if (error) fail("removeKnownEvent", error);
}

/**
 * What actually happened, written against the forecast that predicted it.
 *
 * Deliberately a separate step from the forecast itself. The figure is
 * recorded against the number that *was used*, which is the only comparison
 * worth making — a recomputation would be measuring today's method against
 * yesterday's outcome.
 */
export async function recordActual(
  id: string,
  actualCovers: number | null,
  actualNetSales: number | null,
): Promise<void> {
  const { error } = await requireSupabase()
    .from("sales_forecasts")
    .update({ actual_covers: actualCovers, actual_net_sales: actualNetSales })
    .eq("id", id);
  if (error) fail("recordActual", error);
}
