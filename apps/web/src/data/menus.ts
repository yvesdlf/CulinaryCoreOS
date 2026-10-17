// ---------------------------------------------------------------------------
// Menus and what is on them
// ---------------------------------------------------------------------------
// Queries for the menus built in 0093, where a recipe stopped being a menu
// item and became something a menu item points at.
//
// `menu_item_pricing` is read rather than `menu_items`, because it resolves
// the price: an item with none falls back to `recipes.menu_price`, and the
// view says which answered. A screen that joined the tables itself would
// have to repeat that rule and would eventually disagree with the report.
// ---------------------------------------------------------------------------

import { requireSupabase } from "@/lib/supabase";
import { fail } from "./_shared";

export interface Menu {
  id: string;
  code: string | null;
  name: string;
  businessUnitId: string | null;
  activeFrom: string | null;
  activeTo: string | null;
  note: string | null;
}

export interface MenuItemPricing {
  menuItemId: string;
  menuId: string;
  menuName: string;
  recipeId: string | null;
  itemName: string | null;
  category: string | null;
  posItemCode: string | null;
  isAvailable: boolean;
  price: number | null;
  /** "menu item", "recipe fallback" or "unpriced". */
  pricedBy: string;
  recipeCost: number | null;
  contribution: number | null;
  foodCostPercent: number | null;
}

export interface UnmappedCode {
  posItemCode: string;
  lines: number;
  unitsSold: number;
  netSales: number;
  firstSeen: string | null;
  lastSeen: string | null;
}

export async function fetchMenus(): Promise<Menu[]> {
  const { data, error } = await requireSupabase()
    .from("menus")
    .select("*")
    .order("name");
  if (error) fail("fetchMenus", error);
  return (data ?? []).map((r: any) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    businessUnitId: r.business_unit_id,
    activeFrom: r.active_from,
    activeTo: r.active_to,
    note: r.note,
  }));
}

export async function fetchMenuItems(menuId: string): Promise<MenuItemPricing[]> {
  const { data, error } = await requireSupabase()
    .from("menu_item_pricing")
    .select("*")
    .eq("menu_id", menuId)
    .order("item_name");
  if (error) fail("fetchMenuItems", error);
  return (data ?? []).map((r: any) => ({
    menuItemId: r.menu_item_id,
    menuId: r.menu_id,
    menuName: r.menu_name,
    recipeId: r.recipe_id,
    itemName: r.item_name,
    category: r.category,
    posItemCode: r.pos_item_code,
    isAvailable: Boolean(r.is_available),
    price: r.price === null ? null : Number(r.price),
    pricedBy: r.priced_by,
    recipeCost: r.recipe_cost === null ? null : Number(r.recipe_cost),
    contribution: r.contribution === null ? null : Number(r.contribution),
    foodCostPercent:
      r.food_cost_percent === null ? null : Number(r.food_cost_percent),
  }));
}

/**
 * The same dish wherever else it is priced.
 *
 * The point of the table is that a burger can be 95,000 inside and 120,000
 * by the pool, and that is invisible on a screen showing one menu at a time.
 */
export async function fetchPricesElsewhere(
  recipeId: string,
  exceptMenuId: string,
): Promise<{ menuName: string; price: number | null }[]> {
  const { data, error } = await requireSupabase()
    .from("menu_item_pricing")
    .select("menu_name, price, menu_id")
    .eq("recipe_id", recipeId)
    .neq("menu_id", exceptMenuId);
  if (error) fail("fetchPricesElsewhere", error);
  return (data ?? []).map((r: any) => ({
    menuName: r.menu_name,
    price: r.price === null ? null : Number(r.price),
  }));
}

/** Till codes that reached sales with nothing to map them to. */
export async function fetchUnmappedCodes(): Promise<UnmappedCode[]> {
  const { data, error } = await requireSupabase()
    .from("sales_codes_unmapped")
    .select("*")
    .order("net_sales", { ascending: false });
  if (error) fail("fetchUnmappedCodes", error);
  return (data ?? []).map((r: any) => ({
    posItemCode: r.pos_item_code,
    lines: Number(r.lines ?? 0),
    unitsSold: Number(r.units_sold ?? 0),
    netSales: Number(r.net_sales ?? 0),
    firstSeen: r.first_seen,
    lastSeen: r.last_seen,
  }));
}

export async function createMenu(input: {
  name: string;
  code: string | null;
  businessUnitId: string | null;
  activeFrom: string | null;
}): Promise<string> {
  const { data, error } = await requireSupabase()
    .from("menus")
    .insert({
      name: input.name,
      code: input.code,
      business_unit_id: input.businessUnitId,
      active_from: input.activeFrom,
    })
    .select("id")
    .single();
  if (error) fail("createMenu", error);
  return (data as any).id;
}

export async function addMenuItem(input: {
  menuId: string;
  recipeId: string;
  sellingPrice: number | null;
  posItemCode: string | null;
  displayName: string | null;
}): Promise<void> {
  const { error } = await requireSupabase().from("menu_items").insert({
    menu_id: input.menuId,
    recipe_id: input.recipeId,
    selling_price: input.sellingPrice,
    pos_item_code: input.posItemCode,
    display_name: input.displayName,
  });
  if (error) fail("addMenuItem", error);
}

export async function updateMenuItem(
  id: string,
  patch: { sellingPrice?: number | null; posItemCode?: string | null; isAvailable?: boolean },
): Promise<void> {
  const row: Record<string, unknown> = {};
  if ("sellingPrice" in patch) row.selling_price = patch.sellingPrice;
  if ("posItemCode" in patch) row.pos_item_code = patch.posItemCode;
  if ("isAvailable" in patch) row.is_available = patch.isAvailable;
  const { error } = await requireSupabase()
    .from("menu_items")
    .update(row)
    .eq("id", id);
  if (error) fail("updateMenuItem", error);
}
