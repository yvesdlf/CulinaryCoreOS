-- ---------------------------------------------------------------------------
-- What a department actually made (0073)
-- ---------------------------------------------------------------------------
-- Gap 22's headline. Three of the four numbers already existed — pay (0064),
-- takings (0065) and the catalogue's costs — and the missing join was which
-- department consumed the stock.
--
-- The rule most worth proving is the one about the number that is missing. A
-- margin that quietly spreads unattributed cost across departments is wrong for
-- every one of them and right in total, which is the most expensive kind of
-- wrong: it survives a check against the venue's own accounts, and is only
-- found when somebody acts on a department figure that was never real.
-- ---------------------------------------------------------------------------

begin;
select t.act_as('a0000000-0000-0000-0000-000000000001', 'owner@test.local');

select '── profit: a movement belongs to a department, or to nobody ─────';

select t.expect_value($$
  select count(*)::text from stock_movements where business_unit_id is not null$$,
  'no movement was given a department by the migration', '0');

select t.expect_fail($$
  insert into stock_movements (org_id, product_id, kind, quantity, unit, unit_cost,
                               reason, business_unit_id)
  select o.id, (select id from products where name='T-flour'), 'USAGE', -100, 'g', 10,
         'T-wrong venue',
         (select b.id from business_units b join organizations o2 on o2.id=b.org_id
           where o2.name <> 'Demo Kitchen' limit 1)
    from organizations o where o.name='Demo Kitchen' limit 1$$,
  'and cannot be given another venue''s');

select '── profit: what left the shelf, at what it was worth ────────────';

select t.expect_rows($$
  insert into stock_movements (org_id, product_id, kind, quantity, unit, unit_cost,
                               reason, business_unit_id, occurred_at)
  select o.id, (select id from products where name='T-flour'), 'USAGE', -2000, 'g', 10,
         'T-kitchen usage',
         (select id from business_units where code='KITCHEN' and org_id=o.id),
         current_date - 1
    from organizations o where o.name='Demo Kitchen' limit 1$$,
  'the kitchen uses twenty thousand of flour', 1);

select t.expect_rows($$
  insert into stock_movements (org_id, product_id, kind, quantity, unit, unit_cost,
                               reason, business_unit_id, occurred_at)
  select o.id, (select id from products where name='T-flour'), 'WASTE', -500, 'g', 10,
         'T-kitchen waste',
         (select id from business_units where code='KITCHEN' and org_id=o.id),
         current_date - 1
    from organizations o where o.name='Demo Kitchen' limit 1$$,
  'and throws five thousand away', 1);

select t.expect_value($$
  select used_cost::text || '/' || wasted_cost::text || '/' || total_cost::text
    from cost_of_goods_daily
   where on_date = current_date - 1
     and business_unit_id = (select id from business_units where code='KITCHEN'
       and org_id=(select id from organizations where name='Demo Kitchen'))$$,
  'both count, and are told apart', '20000.00000/5000.00000/25000.00000');

/*
 * A return goes back to the supplier and is recovered; a transfer is still the
 * venue's, in another room. Counting either as consumed makes every margin
 * wrong in the direction that flatters nobody and confuses everybody.
 */
select t.expect_rows($$
  insert into stock_movements (org_id, product_id, kind, quantity, unit, unit_cost,
                               reason, business_unit_id, occurred_at)
  select o.id, (select id from products where name='T-flour'), 'RETURN', -300, 'g', 10,
         'T-sent back', (select id from business_units where code='KITCHEN' and org_id=o.id),
         current_date - 1
    from organizations o where o.name='Demo Kitchen' limit 1$$,
  'something is returned to the supplier', 1);
select t.expect_value($$
  select total_cost::text from cost_of_goods_daily
   where on_date = current_date - 1
     and business_unit_id = (select id from business_units where code='KITCHEN'
       and org_id=(select id from organizations where name='Demo Kitchen'))$$,
  'and is not counted as something the venue consumed', '25000.00000');

select '── profit: the four numbers in one line ─────────────────────────';

select t.expect_rows($$
  insert into daily_takings (business_unit_id, channel_id, on_date, gross_amount, covers)
  select (select id from business_units where code='KITCHEN' and org_id=o.id),
         (select id from revenue_channels where code='TILL' and org_id=o.id),
         current_date - 1, 100000, 40
    from organizations o where o.name='Demo Kitchen' limit 1$$,
  'the kitchen took a hundred thousand', 1);

select t.expect_rows($$
  insert into pay_rates (employee_id, basis, amount, effective_from)
  select id, 'HOURLY', 2000, current_date - 30
    from employees where employee_number='T-1'$$,
  'somebody is paid two thousand an hour', 1);
select t.expect_rows($$
  insert into time_entries (org_id, employee_id, clock_in_at, clock_out_at, break_minutes)
  select o.id, (select id from employees where employee_number='T-1'),
         (current_date - 1 + time '09:00') at time zone 'UTC',
         (current_date - 1 + time '19:00') at time zone 'UTC', 0
    from organizations o where o.name='Demo Kitchen' limit 1$$,
  'and works ten hours', 1);
select t.expect_rows($$
  update employees set business_unit_id=(select id from business_units where code='KITCHEN'
    and org_id=(select id from organizations where name='Demo Kitchen'))
   where employee_number='T-1'$$,
  'in the kitchen', 1);

select t.expect_value($$
  select revenue_net::text || ' - ' || labour_cost::text || ' - ' || goods_cost::text
      || ' = ' || gross_profit::text
    from unit_profit_daily
   where unit_code='KITCHEN' and on_date = current_date - 1$$,
  'a hundred thousand, less twenty thousand of labour, less twenty-five of goods',
  '100000.00000 - 20000.00 - 25000.00000 = 55000.00000');

select t.expect_value($$
  select gross_profit_percent::text from unit_profit_daily
   where unit_code='KITCHEN' and on_date = current_date - 1$$,
  'which is fifty-five per cent', '55.00');

select '── profit: what could not be put to a department is shown ───────';

/*
 * The rule this file exists for. Spreading it would be wrong for every
 * department and right in total, which survives a check against the venue's
 * own accounts and is found only when somebody acts on a figure that was never
 * real.
 */
select t.expect_rows($$
  insert into stock_movements (org_id, product_id, kind, quantity, unit, unit_cost,
                               reason, occurred_at)
  select o.id, (select id from products where name='T-flour'), 'USAGE', -1000, 'g', 10,
         'T-nobody said whose', current_date - 1
    from organizations o where o.name='Demo Kitchen' limit 1$$,
  'ten thousand of stock nobody attributed', 1);

select t.expect_value($$
  select gross_profit::text from unit_profit_daily
   where unit_code='KITCHEN' and on_date = current_date - 1$$,
  'the kitchen''s profit does not move', '55000.00000');
select t.expect_value($$
  select unattributed_goods_cost::text from unit_profit_daily
   where unit_code='KITCHEN' and on_date = current_date - 1$$,
  'and the figure beside it says how much is missing', '10000.00000');

select '── profit: it needs Pay, and says nothing without it ────────────';

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000003', 'nobody@test.local');
select t.expect_value($$select count(*)::text from unit_profit_daily$$,
  'without Pay there is no row, rather than a row with a blank in it', '0');
select t.act_as('a0000000-0000-0000-0000-000000000001', 'owner@test.local');
select t.expect_value($$
  select count(*)::text from unit_profit_daily where on_date = current_date - 1$$,
  'and with it, the day is there', '1');
reset role;

select '── profit: the export is lines, not a ledger ────────────────────';

select t.expect_value($$
  select string_agg(distinct account, ',' order by account) from accounting_export
   where on_date = current_date - 1$$,
  'four kinds of line, and nothing that posts anything',
  'COST_OF_GOODS,LABOUR,REVENUE,WASTE');

select t.expect_value($$
  select amount::text from accounting_export
   where on_date = current_date - 1 and account='COST_OF_GOODS' and unit_code='UNALLOCATED'$$,
  'and the stock nobody attributed is its own line, not somebody else''s',
  '10000.00000');

select '── profit: what is NOT built ────────────────────────────────────';

/*
 * Gap 22 lists three things and this delivers two. A supplier invoice can be
 * matched, approved and disputed, and nothing records that it was paid — so a
 * venue cannot answer "what do we owe" from this platform. Asserted rather than
 * commented, so the day somebody builds it this line fails and the paragraph in
 * 0073 has to go with it.
 */
select t.expect_value($$
  select count(*)::text from information_schema.tables
   where table_schema='public' and table_name='supplier_payments'$$,
  'GAP: nothing records that a supplier invoice was paid', '0');

rollback;
