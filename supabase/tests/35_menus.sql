-- ---------------------------------------------------------------------------
-- A recipe is not a menu item (0093)
-- ---------------------------------------------------------------------------
-- The point of the table is that one dish can be priced twice. That is the
-- first thing asserted, because everything else about menus is bookkeeping
-- if it does not hold.
-- ---------------------------------------------------------------------------

begin;

select id as demo from organizations where name = 'Demo Kitchen' \gset

insert into recipes (id, org_id, name, category, status, yield_qty, yield_unit,
                     menu_price, total_cost)
values ('b0000000-0000-4000-8000-00000000f101', :'demo', 'T-Burger', 'Mains',
        'ACTUAL', 1, 'portion', 90000, 27000);

insert into business_units (id, org_id, code, name)
values ('b0000000-0000-4000-8000-00000000f110', :'demo', 'T-REST', 'T-Restaurant'),
       ('b0000000-0000-4000-8000-00000000f111', :'demo', 'T-POOL', 'T-Poolside');

insert into menus (id, org_id, business_unit_id, code, name, active_from)
values ('b0000000-0000-4000-8000-00000000f120', :'demo',
        'b0000000-0000-4000-8000-00000000f110', 'T-ALLDAY', 'T-All day', current_date - 30),
       ('b0000000-0000-4000-8000-00000000f121', :'demo',
        'b0000000-0000-4000-8000-00000000f111', 'T-POOLM', 'T-Pool menu', current_date - 30);

select '── the same dish, two prices' as "──";

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');

select t.expect_rows($$
  insert into menu_items (menu_id, recipe_id, selling_price, pos_item_code)
  values ('b0000000-0000-4000-8000-00000000f120',
          'b0000000-0000-4000-8000-00000000f101', 95000, 'TILL-BUR-R')$$,
  'the burger is 95,000 in the restaurant', 1);
select t.expect_rows($$
  insert into menu_items (menu_id, recipe_id, selling_price, pos_item_code)
  values ('b0000000-0000-4000-8000-00000000f121',
          'b0000000-0000-4000-8000-00000000f101', 120000, 'TILL-BUR-P')$$,
  'and 120,000 by the pool, which recipes.menu_price could never say', 1);

select t.expect_value($$select string_agg(price::text, ' / ' order by price)
                          from menu_item_pricing where recipe_id =
                            'b0000000-0000-4000-8000-00000000f101'$$,
  'both prices stand against one recipe', '95000.00000 / 120000.00000');
select t.expect_value($$select food_cost_percent::text from menu_item_pricing
                         where pos_item_code = 'TILL-BUR-R'$$,
  'and each carries its own food cost against the shared cost', '28.4');

select '── the old single price is a fallback, and says so' as "──";

select t.expect_rows($$
  insert into menu_items (menu_id, recipe_id, pos_item_code)
  values ('b0000000-0000-4000-8000-00000000f120',
          'b0000000-0000-4000-8000-00000000f101', 'TILL-BUR-X')$$,
  'an item with no price of its own is allowed', 1);
select t.expect_value($$select priced_by from menu_item_pricing
                         where pos_item_code = 'TILL-BUR-X'$$,
  'and falls back to the recipe, saying which answered', 'recipe fallback');
select t.expect_value($$select price::text from menu_item_pricing
                         where pos_item_code = 'TILL-BUR-X'$$,
  'at the recipe price', '90000.00000');

select '── what the table refuses' as "──";

select t.expect_refused($$
  insert into menu_items (menu_id, recipe_id, selling_price, pos_item_code)
  values ('b0000000-0000-4000-8000-00000000f120',
          'b0000000-0000-4000-8000-00000000f101', 1000, 'till-bur-r')$$,
  'one till code per menu, whatever its casing', 'idx_menu_items_code');
select t.expect_refused($$
  insert into menu_items (menu_id, recipe_id, selling_price)
  values ('b0000000-0000-4000-8000-00000000f120',
          'b0000000-0000-4000-8000-00000000f101', -5)$$,
  'and a negative price is not a price', 'menu_items_price');

-- Two uncoded items on one menu: a plain unique constraint would have
-- allowed exactly one, which is why the index is partial.
select t.expect_rows($$
  insert into menu_items (menu_id, recipe_id, display_name)
  values ('b0000000-0000-4000-8000-00000000f120',
          'b0000000-0000-4000-8000-00000000f101', 'T-Unmapped two')$$,
  'but a menu may hold many items nobody has coded yet', 1);

select t.expect_refused($$
  insert into menus (org_id, name) values
    ((select id from organizations where name = 'Demo Kitchen'), '   ')$$,
  'a menu has a name', 'menus_named');
select t.expect_refused($$
  insert into menus (org_id, name, active_from, active_to) values
    ((select id from organizations where name = 'Demo Kitchen'), 'T-Backwards',
     current_date, current_date - 1)$$,
  'and does not end before it starts', 'menus_period');

select '── a modifier moves money and stock together' as "──";

select id as item_r from menu_items where pos_item_code = 'TILL-BUR-R' \gset

select t.expect_rows($$
  insert into menu_item_modifiers (menu_item_id, name, price_delta)
  values ((select id from menu_items where pos_item_code = 'TILL-BUR-R'),
          'T-Large', 15000)$$,
  'a modifier may only change the price', 1);
select t.expect_refused($$
  insert into menu_item_modifiers (menu_item_id, name, product_id, price_delta)
  values ((select id from menu_items where pos_item_code = 'TILL-BUR-R'),
          'T-Add avocado', (select id from products limit 1), 20000)$$,
  'but one that adds an ingredient must say how much',
  'menu_item_modifiers_quantified');

select '── the till codes nothing answers to' as "──";

reset role;
insert into sales_periods (id, org_id, name, starts_on, ends_on, source)
values ('b0000000-0000-4000-8000-00000000f130', :'demo', 'T-MP',
        current_date - 1, current_date - 1, 'CSV');
insert into sales_lines (org_id, period_id, recipe_id, units_sold, net_sales,
                         business_date, pos_item_code)
values (:'demo', 'b0000000-0000-4000-8000-00000000f130', null, 4, 40000,
        current_date - 1, 'TILL-COFFEE'),
       (:'demo', 'b0000000-0000-4000-8000-00000000f130', null, 2, 190000,
        current_date - 1, 'TILL-BUR-R');

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');
select t.expect_value($$select pos_item_code from sales_codes_unmapped$$,
  'the coffee nobody has mapped is on the worklist', 'TILL-COFFEE');
select t.expect_value($$select count(*)::text from sales_codes_unmapped
                         where pos_item_code = 'TILL-BUR-R'$$,
  'and the burger, which a menu item answers, is not', '0');

select '── and it stays behind Menu' as "──";

select t.act_as('a0000000-0000-0000-0000-000000000003', 'nobody@test.local');
select t.expect_value($$select count(*)::text from menus$$,
  'somebody with no Menu access sees no menus', '0');
select t.expect_value($$select count(*)::text from menu_item_pricing$$,
  'nor the pricing', '0');
select t.expect_refused($$
  insert into menus (org_id, name)
  values ((select id from organizations where name = 'Demo Kitchen'), 'T-Sneak')$$,
  'nor writes one', 'MENU');

reset role;
select t.expect_guarded('menus', 'MENU');
select t.expect_guarded('menu_items', 'MENU');
select t.expect_guarded('menu_item_modifiers', 'MENU');

rollback;
