-- ---------------------------------------------------------------------------
-- Stock is somewhere (0096)
-- ---------------------------------------------------------------------------
-- A transfer must be two movements or none, a count can be of one room, and
-- the venue-wide answer must not change just because places now exist.
-- ---------------------------------------------------------------------------

begin;

select id as demo from organizations where name = 'Demo Kitchen' \gset

insert into products (id, org_id, name, category, pack_unit, status,
                      gross_unit, stock_unit)
values ('b0000000-0000-4000-8000-000000030001', :'demo', 'T-Wine-L',
        'Cellar', 'btl', 'ACTIVE', 'btl', 'btl'),
       ('b0000000-0000-4000-8000-000000030002', :'demo', 'T-Salt-L',
        'Store', 'kg', 'ACTIVE', 'g', 'g');

insert into locations (id, org_id, code, name, kind)
values ('b0000000-0000-4000-8000-000000030010', :'demo', 'T-CELLAR', 'T-Cellar', 'STORE_ROOM'),
       ('b0000000-0000-4000-8000-000000030011', :'demo', 'T-BARST', 'T-Bar store', 'BAR_STORE'),
       ('b0000000-0000-4000-8000-000000030012', :'demo', 'T-DRY', 'T-Dry store', 'DRY_STORE');

-- Sixty bottles into the cellar, and salt into the dry store.
insert into stock_movements (org_id, product_id, kind, quantity, unit,
                             location_id, occurred_at)
values (:'demo', 'b0000000-0000-4000-8000-000000030001', 'RECEIPT', 60, 'btl',
        'b0000000-0000-4000-8000-000000030010', now() - interval '2 days'),
       (:'demo', 'b0000000-0000-4000-8000-000000030002', 'RECEIPT', 5000, 'g',
        'b0000000-0000-4000-8000-000000030012', now() - interval '2 days');

select '── on hand, per place and overall' as "──";

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');

select t.expect_value($$select on_hand::text from product_stock_by_location
                         where product_name = 'T-Wine-L' and location_name = 'T-Cellar'$$,
  'the cellar holds sixty', '60.00000');
select t.expect_value($$select on_hand::text from product_stock
                         where product_id = 'b0000000-0000-4000-8000-000000030001'$$,
  'and the venue-wide figure is unchanged by places existing', '60.00000');

select '── a transfer is two movements or none' as "──";

select t.expect_value($$select (transfer_stock(
    'b0000000-0000-4000-8000-000000030001',
    'b0000000-0000-4000-8000-000000030010',
    'b0000000-0000-4000-8000-000000030011',
    24, 'btl', 'for the weekend') is not null)::text$$,
  'two dozen go to the bar', 'true');

reset role;
select t.expect_value($$select count(*)::text from stock_movements
                         where transfer_id is not null$$,
  'as a pair sharing one transfer id', '2');
select t.expect_value($$select sum(quantity)::text from stock_movements
                         where transfer_id is not null$$,
  'that creates and destroys nothing', '0.00000');
select t.expect_value($$select on_hand::text from product_stock
                         where product_id = 'b0000000-0000-4000-8000-000000030001'$$,
  'so the venue still has sixty', '60.00000');
select t.expect_value($$select on_hand::text from product_stock_by_location
                         where product_name = 'T-Wine-L' and location_name = 'T-Cellar'$$,
  'the cellar has thirty-six', '36.00000');
select t.expect_value($$select on_hand::text from product_stock_by_location
                         where product_name = 'T-Wine-L' and location_name = 'T-Bar store'$$,
  'and the bar has twenty-four', '24.00000');

select '── what a transfer refuses' as "──";

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');

select t.expect_refused($$select transfer_stock(
    'b0000000-0000-4000-8000-000000030001',
    'b0000000-0000-4000-8000-000000030010',
    'b0000000-0000-4000-8000-000000030010', 1, 'btl')$$,
  'a move to the same place is not a move', 'same place');
select t.expect_refused($$select transfer_stock(
    'b0000000-0000-4000-8000-000000030001',
    'b0000000-0000-4000-8000-000000030010',
    'b0000000-0000-4000-8000-000000030011', 500, 'btl')$$,
  'and moving more than is there names the figure', 'only 36');
select t.expect_refused($$select transfer_stock(
    'b0000000-0000-4000-8000-000000030001',
    'b0000000-0000-4000-8000-000000030010',
    'b0000000-0000-4000-8000-000000030011', -5, 'btl')$$,
  'a negative transfer is not a transfer', 'positive quantity');

reset role;
select t.expect_value($$select count(*)::text from stock_movements
                         where transfer_id is not null$$,
  'and none of those wrote half a pair', '2');

select '── a movement belongs to this venue''s own places' as "──";

insert into organizations (id, name, slug)
values ('b0000000-0000-4000-8000-0000000300ee', 'T-Other-Loc', 't-other-loc');
insert into locations (id, org_id, code, name, kind)
values ('b0000000-0000-4000-8000-0000000300ef', 'b0000000-0000-4000-8000-0000000300ee',
        'T-FAR', 'T-Far store', 'STORE_ROOM');

select t.expect_refused($$
  insert into stock_movements (org_id, product_id, kind, quantity, unit, location_id)
  values ((select id from organizations where name = 'Demo Kitchen'),
          'b0000000-0000-4000-8000-000000030001', 'RECEIPT', 1, 'btl',
          'b0000000-0000-4000-8000-0000000300ef')$$,
  'a movement cannot be filed in another organisation''s store',
  'belongs to another organisation');

select '── a count can be of one room' as "──";

insert into stocktakes (id, org_id, reference, kind, location_id, snapshot_at)
values ('b0000000-0000-4000-8000-000000030020', :'demo', 'T-COUNT-BAR', 'PARTIAL',
        'b0000000-0000-4000-8000-000000030011', now());

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');

select t.expect_value($$select open_stocktake('b0000000-0000-4000-8000-000000030020')::text$$,
  'opening a count of the bar lists only what the bar holds', '1');
select t.expect_value($$select expected_qty::text from stocktake_lines
                         where stocktake_id = 'b0000000-0000-4000-8000-000000030020'$$,
  'at that room''s figure, not the venue''s', '24.00000');
select t.expect_value($$select count(*)::text from stocktake_lines
                         where stocktake_id = 'b0000000-0000-4000-8000-000000030020'
                           and product_id = 'b0000000-0000-4000-8000-000000030002'$$,
  'and the salt kept in the dry store is not on the bar''s sheet', '0');

-- Twenty-two found, so two short, and the correction belongs to the bar.
update stocktake_lines set counted_qty = 22
 where stocktake_id = 'b0000000-0000-4000-8000-000000030020';
update stocktakes set status = 'SUBMITTED' where id = 'b0000000-0000-4000-8000-000000030020';
select t.act_as('a0000000-0000-0000-0000-000000000001', 'owner@test.local');
update stocktakes set status = 'APPROVED' where id = 'b0000000-0000-4000-8000-000000030020';
select t.expect_value($$select post_stocktake('b0000000-0000-4000-8000-000000030020')::text$$,
  'posting it writes one adjustment', '1');

reset role;
-- Scoped to this test's own product: a venue that has counted anything else
-- has other COUNT movements and the unscoped query read whichever came back
-- first.
select t.expect_value($$select location_id::text from stock_movements
                         where kind = 'COUNT' and reason = 'stocktake'
                           and product_id = 'b0000000-0000-4000-8000-000000030001'$$,
  'filed against the room that was counted',
  'b0000000-0000-4000-8000-000000030011');
select t.expect_value($$select on_hand::text from product_stock_by_location
                         where product_name = 'T-Wine-L' and location_name = 'T-Bar store'$$,
  'so the bar now reads twenty-two', '22.00000');
select t.expect_value($$select on_hand::text from product_stock_by_location
                         where product_name = 'T-Wine-L' and location_name = 'T-Cellar'$$,
  'and the cellar is untouched by the bar being wrong', '36.00000');

rollback;
