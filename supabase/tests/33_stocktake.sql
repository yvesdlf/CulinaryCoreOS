-- ---------------------------------------------------------------------------
-- A stock count is a session (0091)
-- ---------------------------------------------------------------------------
-- The four rules that make a count worth having, each asserted by trying to
-- break it: the books are frozen when the session opens, a blank is not a
-- zero, the counter cannot approve, and posting appends the difference
-- rather than the count.
-- ---------------------------------------------------------------------------

begin;

select id as demo from organizations where name = 'Demo Kitchen' \gset

insert into products (id, org_id, name, category, pack_unit, status,
                      gross_unit, stock_unit, gross_price_per_unit)
values ('b0000000-0000-4000-8000-00000000d001', :'demo', 'T-Saffron',
        'Store', 'g', 'ACTIVE', 'g', 'g', 50),
       ('b0000000-0000-4000-8000-00000000d002', :'demo', 'T-Flour',
        'Store', 'kg', 'ACTIVE', 'g', 'g', 0.002),
       ('b0000000-0000-4000-8000-00000000d003', :'demo', 'T-Vinegar',
        'Store', 'l', 'ACTIVE', 'ml', 'ml', 0.004);

-- Opening stock: 100 saffron, 5000 flour, 2000 vinegar.
insert into stock_movements (org_id, product_id, kind, quantity, unit, occurred_at)
values (:'demo', 'b0000000-0000-4000-8000-00000000d001', 'RECEIPT', 100, 'g', now() - interval '2 days'),
       (:'demo', 'b0000000-0000-4000-8000-00000000d002', 'RECEIPT', 5000, 'g', now() - interval '2 days'),
       (:'demo', 'b0000000-0000-4000-8000-00000000d003', 'RECEIPT', 2000, 'ml', now() - interval '2 days');

insert into stocktakes (id, org_id, reference, kind, snapshot_at)
values ('b0000000-0000-4000-8000-00000000d010', :'demo', 'T-COUNT-1', 'FULL',
        now() - interval '1 hour');

select '── opening a count freezes the books' as "──";

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');

select t.expect_ok($$select open_stocktake('b0000000-0000-4000-8000-00000000d010')$$,
  'opening it builds the lines');
select t.expect_value($$select expected_qty::text from stocktake_lines
                         where stocktake_id = 'b0000000-0000-4000-8000-00000000d010'
                           and product_id = 'b0000000-0000-4000-8000-00000000d001'$$,
  'and each line carries what the ledger said', '100.00000');
select t.expect_value($$select status::text from stocktakes
                         where id = 'b0000000-0000-4000-8000-00000000d010'$$,
  'and the count is now being counted', 'COUNTING');
select t.expect_refused($$select open_stocktake('b0000000-0000-4000-8000-00000000d010')$$,
  'and it cannot be opened twice', 'already been opened');

/*
 * A delivery lands while somebody is walking the store.
 *
 * The expected figure must not move. If it did, the variance — the only
 * number anybody opens this screen for — would come out as zero and the
 * count would have proved nothing.
 */
reset role;
insert into stock_movements (org_id, product_id, kind, quantity, unit, occurred_at)
values (:'demo', 'b0000000-0000-4000-8000-00000000d001', 'RECEIPT', 40, 'g', now());

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');
select t.expect_value($$select expected_qty::text from stocktake_lines
                         where stocktake_id = 'b0000000-0000-4000-8000-00000000d010'
                           and product_id = 'b0000000-0000-4000-8000-00000000d001'$$,
  'a delivery mid-count does not move what the books said at the snapshot',
  '100.00000');

select '── a blank is not a zero' as "──";

-- Saffron: 92 found against 100 expected. Flour: counted and there is none.
-- Vinegar: nobody reached that shelf.
select t.expect_rows($$
  update stocktake_lines set counted_qty = 92
   where stocktake_id = 'b0000000-0000-4000-8000-00000000d010'
     and product_id = 'b0000000-0000-4000-8000-00000000d001'$$,
  'a counted line records what was found', 1);
select t.expect_rows($$
  update stocktake_lines set counted_qty = 0
   where stocktake_id = 'b0000000-0000-4000-8000-00000000d010'
     and product_id = 'b0000000-0000-4000-8000-00000000d002'$$,
  'and a zero records that somebody looked and there was none', 1);

select t.expect_value($$select counted_by_email from stocktake_lines
                         where stocktake_id = 'b0000000-0000-4000-8000-00000000d010'
                           and product_id = 'b0000000-0000-4000-8000-00000000d001'$$,
  'the line remembers who counted it, from the session', 'chef@test.local');

select t.expect_value($$select not_counted::text from stocktake_variance
                         where stocktake_line_id =
                           (select id from stocktake_lines
                             where stocktake_id = 'b0000000-0000-4000-8000-00000000d010'
                               and product_id = 'b0000000-0000-4000-8000-00000000d003')$$,
  'the untouched shelf is reported as not counted, not as none', 'true');
select t.expect_value($$select difference_qty::text from stocktake_variance
                         where stocktake_line_id =
                           (select id from stocktake_lines
                             where stocktake_id = 'b0000000-0000-4000-8000-00000000d010'
                               and product_id = 'b0000000-0000-4000-8000-00000000d003')$$,
  'and has no difference at all, rather than a difference of minus everything', null);

-- Saffron is worth 50 a gram, flour 0.002. By quantity the flour is the big
-- number; by money it is not, which is why the report sorts by value.
select t.expect_value($$select difference_value::text from stocktake_variance
                         where product_name = 'T-Saffron'$$,
  'the saffron shortfall is priced', '-400.00000');

select '── nobody approves their own count' as "──";

select t.expect_rows($$
  update stocktakes set status = 'SUBMITTED'
   where id = 'b0000000-0000-4000-8000-00000000d010'$$,
  'the chef submits it', 1);
select t.expect_value($$select submitted_by_email from stocktakes
                         where id = 'b0000000-0000-4000-8000-00000000d010'$$,
  'and the session records who, not a column they sent', 'chef@test.local');

select t.expect_refused($$
  update stocktakes set status = 'APPROVED'
   where id = 'b0000000-0000-4000-8000-00000000d010'$$,
  'and cannot then approve it', 'cannot approve it');

/*
 * Nor by claiming somebody else did the counting — the submitter is read
 * from the row as it already stands, and the caller from the session. This
 * is the shape 0085 was written for.
 */
select t.expect_refused($$
  update stocktakes set status = 'APPROVED', submitted_by_email = 'owner@test.local'
   where id = 'b0000000-0000-4000-8000-00000000d010'$$,
  'nor by rewriting who submitted it on the way past', 'cannot approve it');

select t.expect_refused($$
  select post_stocktake('b0000000-0000-4000-8000-00000000d010')$$,
  'and nothing posts before it is approved', 'after it is approved');

select '── posting appends the difference' as "──";

select t.act_as('a0000000-0000-0000-0000-000000000001', 'owner@test.local');
select t.expect_rows($$
  update stocktakes set status = 'APPROVED'
   where id = 'b0000000-0000-4000-8000-00000000d010'$$,
  'somebody else approves it', 1);
select t.expect_value($$select approved_by_email from stocktakes
                         where id = 'b0000000-0000-4000-8000-00000000d010'$$,
  'recorded against them', 'owner@test.local');

select t.expect_refused($$
  update stocktake_lines set counted_qty = 1
   where stocktake_id = 'b0000000-0000-4000-8000-00000000d010'
     and product_id = 'b0000000-0000-4000-8000-00000000d001'$$,
  'and the figures are frozen once approved', 'can no longer change');

-- Two movements, not three: the uncounted vinegar writes nothing.
select t.expect_value($$select post_stocktake('b0000000-0000-4000-8000-00000000d010')::text$$,
  'posting writes one movement per line that actually differs', '2');

reset role;
select t.expect_value($$select quantity::text from stock_movements
                         where product_id = 'b0000000-0000-4000-8000-00000000d001'
                           and kind = 'COUNT'$$,
  'the adjustment is the difference, not the count', '-8.00000');

/*
 * And the delivery survives it.
 *
 * 100 on the books, 92 found, so minus 8 — but 40 arrived mid-count. On hand
 * must be 132, not 92. An adjustment that wrote the counted figure, or that
 * was dated now instead of at the snapshot, would lose the delivery.
 */
select t.expect_value($$select on_hand::text from product_stock
                         where product_id = 'b0000000-0000-4000-8000-00000000d001'$$,
  'and the delivery that landed mid-count is still there', '132.00000');

select t.expect_value($$select count(*)::text from stock_movements
                         where product_id = 'b0000000-0000-4000-8000-00000000d003'
                           and kind = 'COUNT'$$,
  'the shelf nobody counted is not written off', '0');
select t.expect_value($$select on_hand::text from product_stock
                         where product_id = 'b0000000-0000-4000-8000-00000000d002'$$,
  'but the one counted empty is', '0.00000');

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000001', 'owner@test.local');
select t.expect_refused($$
  select post_stocktake('b0000000-0000-4000-8000-00000000d010')$$,
  'and it cannot be posted twice', 'after it is approved');

select '── and it stays behind Inventory' as "──";

select t.act_as('a0000000-0000-0000-0000-000000000003', 'nobody@test.local');
select t.expect_value($$select count(*)::text from stocktakes$$,
  'somebody with no Inventory access sees no counts', '0');
select t.expect_value($$select count(*)::text from stocktake_variance$$,
  'nor the variance report', '0');
select t.expect_refused($$
  insert into stocktakes (org_id, reference)
  values ((select id from organizations where name = 'Demo Kitchen'), 'T-COUNT-2')$$,
  'nor opens one', 'INVENTORY');

reset role;
select t.expect_guarded('stocktakes', 'INVENTORY');
select t.expect_guarded('stocktake_lines', 'INVENTORY');

rollback;
