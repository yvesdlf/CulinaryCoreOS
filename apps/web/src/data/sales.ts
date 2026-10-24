// ---------------------------------------------------------------------------
// Sales periods and what they consumed
// ---------------------------------------------------------------------------
// Separate from the sales-period functions in `inventory.ts`, which menu
// engineering uses, and deliberately so. `saveSalesPeriod` there takes lines
// with a required `recipeId`, and the entire point of a till import is that
// an unmapped line lands anyway — widening its contract would change what
// menu engineering is allowed to write for no benefit to it. Two names, two
// jobs: `SalesPeriod` is the record, `SalesPeriodSummary` is the record plus
// what is in it.
// ---------------------------------------------------------------------------
// The import lands lines; 0092's `post_sales_consumption` turns them into
// stock movements through the recipes. Posting is a database function and
// stays one: it explodes every recipe through its sub-recipes, and a second
// implementation in TypeScript would be the one that drifts.
// ---------------------------------------------------------------------------

import { requireSupabase } from "@/lib/supabase";
import { fail } from "./_shared";
import type { CodeMapping } from "@/engine/sales-import";

export interface SalesPeriodSummary {
  id: string;
  name: string | null;
  startsOn: string;
  endsOn: string;
  source: string | null;
  consumptionPostedAt: string | null;
  lines: number;
  unmappedLines: number;
  netSales: number;
}

export async function fetchSalesPeriodSummaries(): Promise<SalesPeriodSummary[]> {
  const db = requireSupabase();
  const { data, error } = await db
    .from("sales_periods")
    .select("*")
    .order("ends_on", { ascending: false })
    .limit(60);
  if (error) fail("fetchSalesPeriodSummaries", error);

  const periods = data ?? [];
  if (periods.length === 0) return [];

  /*
   * Counted here rather than in a view.
   *
   * A view would be the better home if anything else needed these figures,
   * but nothing does, and 0092 already added enough surface. One extra query
   * over the lines of at most sixty periods is cheaper than a migration
   * nobody else reads.
   */
  const { data: lines, error: lineErr } = await db
    .from("sales_lines")
    .select("period_id, recipe_id, net_sales")
    .in("period_id", periods.map((p: any) => p.id));
  if (lineErr) fail("fetchSalesPeriodSummaries lines", lineErr);

  const tally = new Map<string, { lines: number; unmapped: number; net: number }>();
  for (const l of lines ?? []) {
    const row = tally.get((l as any).period_id) ?? { lines: 0, unmapped: 0, net: 0 };
    row.lines += 1;
    if ((l as any).recipe_id === null) row.unmapped += 1;
    row.net += Number((l as any).net_sales ?? 0);
    tally.set((l as any).period_id, row);
  }

  return periods.map((r: any) => {
    const t = tally.get(r.id) ?? { lines: 0, unmapped: 0, net: 0 };
    return {
      id: r.id,
      name: r.name,
      startsOn: r.starts_on,
      endsOn: r.ends_on,
      source: r.source,
      consumptionPostedAt: r.consumption_posted_at,
      lines: t.lines,
      unmappedLines: t.unmapped,
      netSales: t.net,
    };
  });
}

/** Every till code a menu item claims, for matching an import against. */
export async function fetchCodeMappings(): Promise<CodeMapping[]> {
  const { data, error } = await requireSupabase()
    .from("menu_items")
    .select("pos_item_code, recipe_id, display_name, recipes(name)")
    .not("pos_item_code", "is", null);
  if (error) fail("fetchCodeMappings", error);
  return (data ?? [])
    .filter((r: any) => r.recipe_id)
    .map((r: any) => ({
      posItemCode: r.pos_item_code,
      recipeId: r.recipe_id,
      itemName: r.display_name ?? r.recipes?.name ?? "—",
    }));
}

export async function createImportedSalesPeriod(input: {
  name: string;
  startsOn: string;
  endsOn: string;
}): Promise<string> {
  const { data, error } = await requireSupabase()
    .from("sales_periods")
    .insert({
      name: input.name,
      starts_on: input.startsOn,
      ends_on: input.endsOn,
      source: "CSV",
    })
    .select("id")
    .single();
  if (error) fail("createImportedSalesPeriod", error);
  return (data as any).id;
}

export async function insertSalesLines(
  periodId: string,
  businessDate: string,
  rows: {
    posItemCode: string;
    recipeId: string | null;
    unitsSold: number;
    netSales: number | null;
    grossAmount: number | null;
    covers: number | null;
  }[],
): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await requireSupabase().from("sales_lines").insert(
    rows.map((r) => ({
      period_id: periodId,
      recipe_id: r.recipeId,
      pos_item_code: r.posItemCode,
      units_sold: r.unitsSold,
      net_sales: r.netSales ?? 0,
      gross_amount: r.grossAmount,
      covers: r.covers,
      business_date: businessDate,
    })),
  );
  if (error) fail("insertSalesLines", error);
}

/** Posts theoretical consumption. Returns how many movements it wrote. */
export async function postSalesConsumption(periodId: string): Promise<number> {
  const { data, error } = await requireSupabase().rpc("post_sales_consumption", {
    p_period: periodId,
  });
  if (error) fail("postSalesConsumption", error);
  return Number(data ?? 0);
}

export interface TheoreticalLine {
  productName: string;
  unit: string;
  qty: number;
}

/** What this period would take out of stock, before anybody commits it. */
export async function fetchTheoretical(periodId: string): Promise<TheoreticalLine[]> {
  const { data, error } = await requireSupabase()
    .from("sales_usage_theoretical")
    .select("product_name, unit, qty")
    .eq("period_id", periodId)
    .not("product_id", "is", null);
  if (error) fail("fetchTheoretical", error);
  const byProduct = new Map<string, TheoreticalLine>();
  for (const r of data ?? []) {
    const key = `${(r as any).product_name}|${(r as any).unit}`;
    const cur = byProduct.get(key) ?? {
      productName: (r as any).product_name,
      unit: (r as any).unit,
      qty: 0,
    };
    cur.qty += Number((r as any).qty ?? 0);
    byProduct.set(key, cur);
  }
  return [...byProduct.values()].sort((a, b) => b.qty - a.qty);
}
