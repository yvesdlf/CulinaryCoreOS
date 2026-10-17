-- ---------------------------------------------------------------------------
-- A rate on the day it mattered (0099)
-- ---------------------------------------------------------------------------
-- The two rules worth proving: a document converts at the rate that applied
-- when it was written, and an unknown rate yields nothing rather than the
-- unconverted figure.
-- ---------------------------------------------------------------------------

begin;

select id as demo from organizations where name = 'Demo Kitchen' \gset
select currency_code as base from organizations where name = 'Demo Kitchen' \gset

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');

select '── the rate that applied, not the latest one' as "──";

select t.expect_rows($$
  insert into exchange_rates (org_id, from_currency, to_currency, rate, rate_on)
  values ((select id from organizations where name='Demo Kitchen'),
          'eur', 'IDR', 17000, date '2026-01-01')$$,
  'a rate is recorded, and the currency is folded to upper case', 1);
select t.expect_value($$select from_currency from exchange_rates where rate = 17000$$,
  'stored as EUR whatever was typed', 'EUR');

select t.expect_rows($$
  insert into exchange_rates (org_id, from_currency, to_currency, rate, rate_on)
  values ((select id from organizations where name='Demo Kitchen'),
          'EUR', 'IDR', 18500, date '2026-06-01')$$,
  'and a later one beside it', 1);

select t.expect_value($$select rate_on(
    (select id from organizations where name='Demo Kitchen'),
    'EUR','IDR', date '2026-03-15')::text$$,
  'March converts at January''s rate, not June''s', '17000.00000000');
select t.expect_value($$select rate_on(
    (select id from organizations where name='Demo Kitchen'),
    'EUR','IDR', date '2026-07-01')::text$$,
  'and July at June''s', '18500.00000000');

/*
 * Before any rate exists there is no answer. Reaching forward to the first
 * known rate would convert a document at a figure that did not exist when
 * it was written, which nobody could reproduce.
 */
select t.expect_value($$select coalesce(rate_on(
    (select id from organizations where name='Demo Kitchen'),
    'EUR','IDR', date '2025-12-31')::text, 'none')$$,
  'and a date before any rate has none, rather than borrowing a later one', 'none');

select t.expect_value($$select rate_on(
    (select id from organizations where name='Demo Kitchen'),
    'IDR','IDR', current_date)::text$$,
  'the same currency needs no rate at all', '1');

select t.expect_value($$select round(rate_on(
    (select id from organizations where name='Demo Kitchen'),
    'IDR','EUR', date '2026-07-01'), 8)::text$$,
  'and the inverse is derived rather than having to be typed twice',
  '0.00005405');

select '── an unknown rate is nothing, not the raw figure' as "──";

select t.expect_value($$select coalesce(in_base_currency(
    (select id from organizations where name='Demo Kitchen'),
    100, 'GBP', current_date)::text, 'none')$$,
  'a currency with no rate converts to nothing', 'none');
select t.expect_value($$select in_base_currency(
    (select id from organizations where name='Demo Kitchen'),
    100, 'EUR', date '2026-03-15')::text$$,
  'and one with a rate converts at it', '1700000.00000000');

select '── what the table refuses' as "──";

select t.expect_refused($$
  insert into exchange_rates (org_id, from_currency, to_currency, rate, rate_on)
  values ((select id from organizations where name='Demo Kitchen'),
          'EUR','IDR', 0, current_date)$$,
  'a rate of zero is not a rate', 'exchange_rates_positive');
select t.expect_refused($$
  insert into exchange_rates (org_id, from_currency, to_currency, rate, rate_on)
  values ((select id from organizations where name='Demo Kitchen'),
          'EUR',' eur ', 1.2, current_date)$$,
  'and a currency does not convert to itself', 'exchange_rates_distinct');
select t.expect_refused($$
  insert into exchange_rates (org_id, from_currency, to_currency, rate, rate_on)
  values ((select id from organizations where name='Demo Kitchen'),
          'EUR','IDR', 19000, date '2026-06-01')$$,
  'nor two rates for one pair on one day', 'exchange_rates_unique');
select t.expect_refused($$
  update exchange_rates set rate = 1 where rate = 17000$$,
  'a rate that was used cannot be rewritten', 'denied|permission');

select '── invoices in the venue''s own money' as "──";

reset role;
insert into suppliers (id, org_id, name)
values ('b0000000-0000-4000-8000-000000060001', :'demo', 'T-FX-Co');
insert into supplier_invoices (org_id, supplier_id, invoice_number, invoice_date, total_amount, currency)
values (:'demo','b0000000-0000-4000-8000-000000060001','T-FX-EUR', date '2026-03-10', 200, 'EUR'),
       (:'demo','b0000000-0000-4000-8000-000000060001','T-FX-GBP', date '2026-03-10', 150, 'GBP');

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');
select t.expect_value($$select total_in_base::text from supplier_invoices_in_base
                         where invoice_number = 'T-FX-EUR'$$,
  'a euro invoice reports in the venue''s currency at March''s rate', '3400000.00000');
select t.expect_value($$select needs_a_rate::text from supplier_invoices_in_base
                         where invoice_number = 'T-FX-GBP'$$,
  'and one in a currency nobody has a rate for says so', 'true');
select t.expect_value($$select coalesce(total_in_base::text,'none') from supplier_invoices_in_base
                         where invoice_number = 'T-FX-GBP'$$,
  'rather than quietly contributing its raw figure to a total', 'none');

reset role;
select t.expect_guarded('exchange_rates', 'PURCHASING');

rollback;
