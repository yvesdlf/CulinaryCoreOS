-- ---------------------------------------------------------------------------
-- Food past its use-by date (0061)
-- ---------------------------------------------------------------------------
-- PROGRESS.md said the database refused this and the traceability screen told
-- the user so. Neither was true: 0020 refused a lot by *status* and said
-- nothing about dates, and the front end's own refusal was the whole control.
--
-- The three cases that have to be kept apart, because conflating any two of
-- them is either food waste or a food-safety incident:
--
--   past a use-by      — unsafe under Article 14, refused
--   past a best-before — legal to use, allowed, and saying otherwise is waste
--   a date with no kind stated — unjudgeable, so not refused on a guess
--
-- And in every case, writing the stock off has to stay possible. A rule that
-- refuses the write-off leaves a venue holding stock it cannot record getting
-- rid of, which is how expired food stays on a shelf.
-- ---------------------------------------------------------------------------

begin;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');

-- Four lots of the same product, one per case, so the only thing that differs
-- between the assertions below is the date mark.
select t.fixture($$
  insert into stock_lots (org_id, product_id, lot_code, received_on, expires_on, expiry_kind)
  select o.id, (select id from products where name = 'T-flour'),
         'T-EXPIRED', current_date - 30, current_date - 1, 'USE_BY'
    from organizations o where o.name = 'Demo Kitchen' $$);
select t.fixture($$
  insert into stock_lots (org_id, product_id, lot_code, received_on, expires_on, expiry_kind)
  select o.id, (select id from products where name = 'T-flour'),
         'T-LASTDAY', current_date - 30, current_date, 'USE_BY'
    from organizations o where o.name = 'Demo Kitchen' $$);
select t.fixture($$
  insert into stock_lots (org_id, product_id, lot_code, received_on, expires_on, expiry_kind)
  select o.id, (select id from products where name = 'T-flour'),
         'T-PASTBEST', current_date - 30, current_date - 1, 'BEST_BEFORE'
    from organizations o where o.name = 'Demo Kitchen' $$);
select t.fixture($$
  insert into stock_lots (org_id, product_id, lot_code, received_on, expires_on, expiry_kind)
  select o.id, (select id from products where name = 'T-flour'),
         'T-NOKIND', current_date - 30, current_date - 1, null
    from organizations o where o.name = 'Demo Kitchen' $$);

select '── use-by: unsafe food cannot be used (Article 14) ──────────────';

select t.expect_fail($$
  insert into stock_movements (org_id, product_id, kind, quantity, unit, reason, lot_id)
  select o.id, (select id from products where name='T-flour'), 'USAGE', -100, 'g', 'T-after-date',
         (select id from stock_lots where lot_code='T-EXPIRED')
    from organizations o where o.name='Demo Kitchen'$$,
  'a lot past its use-by cannot be consumed');

-- Read back. A refusal that leaves the row behind is the second false pass in
-- _harness.sql, and a ledger row is the thing that would make the figure wrong.
select t.expect_value($$
  select count(*)::text from stock_movements
   where reason='T-after-date'$$,
  'and nothing reached the ledger', '0');

select t.expect_fail($$
  insert into stock_movements (org_id, product_id, kind, quantity, unit, reason, lot_id)
  select o.id, (select id from products where name='T-flour'), 'TRANSFER', -100, 'g', 'T-moved-on',
         (select id from stock_lots where lot_code='T-EXPIRED')
    from organizations o where o.name='Demo Kitchen'$$,
  'nor moved to another site, which is somebody else''s problem made portable');

select '── use-by: and it can still be thrown away ──────────────────────';

/*
 * The important half. A venue that cannot write off expired stock is a venue
 * where the expired stock stays on the shelf, because the system made the
 * honest action the impossible one.
 */
select t.expect_rows($$
  insert into stock_movements (org_id, product_id, kind, quantity, unit, reason, lot_id)
  select o.id, (select id from products where name='T-flour'), 'WASTE', -100, 'g', 'T-binned',
         (select id from stock_lots where lot_code='T-EXPIRED')
    from organizations o where o.name='Demo Kitchen'$$,
  'an expired lot can be written off as waste', 1);

select '── use-by: the last day shown is a day of use ───────────────────';

/*
 * 1169/2011 Annex X: the date is the last day the food may be used, so a lot
 * stamped today is usable today. `<=` instead of `<` here throws away one day
 * of every delivery in the building, silently.
 */
select t.expect_rows($$
  insert into stock_movements (org_id, product_id, kind, quantity, unit, reason, lot_id)
  select o.id, (select id from products where name='T-flour'), 'USAGE', -100, 'g', 'T-on-the-day',
         (select id from stock_lots where lot_code='T-LASTDAY')
    from organizations o where o.name='Demo Kitchen'$$,
  'a lot whose use-by is today is still food', 1);

select '── use-by: best-before is not a safety date ─────────────────────';

/*
 * Legal to use, and refusing it would be this system causing food waste. The
 * distinction is kept in `assessLot`, in the lot screen's wording, and now in
 * the trigger — three places that have to agree.
 */
select t.expect_rows($$
  insert into stock_movements (org_id, product_id, kind, quantity, unit, reason, lot_id)
  select o.id, (select id from products where name='T-flour'), 'USAGE', -100, 'g', 'T-past-best',
         (select id from stock_lots where lot_code='T-PASTBEST')
    from organizations o where o.name='Demo Kitchen'$$,
  'a lot past its best-before is still legal to use', 1);

select '── use-by: a date with no kind is not guessed ───────────────────';

/*
 * Guessing use-by throws away good food; guessing best-before serves unsafe
 * food. Neither guess is the system's to make, so the lot is reported as
 * unjudgeable on the traceability screen and is not refused here.
 */
select t.expect_rows($$
  insert into stock_movements (org_id, product_id, kind, quantity, unit, reason, lot_id)
  select o.id, (select id from products where name='T-flour'), 'USAGE', -100, 'g', 'T-unjudged',
         (select id from stock_lots where lot_code='T-NOKIND')
    from organizations o where o.name='Demo Kitchen'$$,
  'a date with no kind stated is not refused on a guess', 1);

select '── use-by: a correction can still put quantity back ─────────────';

/*
 * The line this file's first draft dropped, and the reason it is asserted here
 * as well as in 08_production.sql.
 *
 * 0060 added `quantity < 0` to the Article 19 branch so the reversal half of a
 * correction is not refused. Rewriting the function to add the date rule lost
 * it, and two checks in another file went red. The same reasoning applies to
 * the date rule itself: a lot that expired on Tuesday still has Tuesday's
 * over-recorded consumption to correct, and a system that refuses the
 * correction leaves the ledger permanently wrong about expired food.
 */
select t.expect_rows($$
  insert into stock_movements (org_id, product_id, kind, quantity, unit, reason, lot_id)
  select o.id, (select id from products where name='T-flour'), 'USAGE', 100, 'g', 'T-putting-it-back',
         (select id from stock_lots where lot_code='T-EXPIRED')
    from organizations o where o.name='Demo Kitchen'$$,
  'a correction may put quantity back on an expired lot', 1);

select '── use-by: Article 19 still answers first ───────────────────────';

/*
 * A lot that is both recalled and in date must refuse as recalled, not slip
 * through because the new rule found no date to object to.
 */
select t.expect_rows($$
  update stock_lots set status='RECALLED', status_reason='T-recall'
   where lot_code='T-LASTDAY'$$,
  'recall a lot that is in date', 1);
select t.expect_fail($$
  insert into stock_movements (org_id, product_id, kind, quantity, unit, reason, lot_id)
  select o.id, (select id from products where name='T-flour'), 'USAGE', -100, 'g', 'T-recalled-use',
         (select id from stock_lots where lot_code='T-LASTDAY')
    from organizations o where o.name='Demo Kitchen'$$,
  'and it is refused on the recall, not on the date');

rollback;
