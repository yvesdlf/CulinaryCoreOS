-- ---------------------------------------------------------------------------
-- Production records (0060)
-- ---------------------------------------------------------------------------
-- What a completion may claim, what happens when it is wrong, and whether the
-- variance report says "cannot be compared" where it has to.
--
-- The unit checks are the ones worth the most here. A batch recorded in the
-- wrong unit is wrong by a factor of a thousand and every figure downstream
-- stays plausible, so nothing surfaces it until a delivery arrives short.
--
-- Every assertion that matters reads the row back afterwards. "The write was
-- allowed" is not "the write happened", and this file's whole subject is a
-- trigger that rewrites two columns and refuses a third.
-- ---------------------------------------------------------------------------
begin;
select t.act_as('a0000000-0000-0000-0000-000000000002','chef@test.local');

select '── production: a completion cannot lie about units ──────────────';

select t.expect_fail($$
  select public.record_production((select id from sub_recipes where name='T-prep'), 2, 'kg')$$,
  'a batch cannot be recorded in kg when the yield is in g');
-- The refusal has to have refused. An error that still left a row behind is
-- the shape of failure this suite exists to catch.
select t.expect_value($$
  select count(*)::text from production_records
   where sub_recipe_id=(select id from sub_recipes where name='T-prep')$$,
  'and no record was left behind by the refusal', '0');

select t.expect_fail($$
  insert into production_records
    (sub_recipe_id, batches, batch_yield_qty, sub_recipe_version, unit, quantity_made)
  select id, 1, 1, 1, 'g', 99 from sub_recipes where name='T-prep'$$,
  'a client cannot state the quantity made at all');

select t.expect_fail($$
  select public.record_production(
    (select id from sub_recipes where name='T-prep-no-yield'), 1, 'g')$$,
  'a preparation with no batch yield cannot have a completion recorded');

select '── production: the batch and its consumption are one write ──────';

select t.expect_fail($$
  select public.record_production((select id from sub_recipes where name='T-prep'), 2, 'g',
    jsonb_build_array(jsonb_build_object(
      'product_id',(select id from products where name='T-flour'),
      'quantity',0.22,'unit','kg')))$$,
  'a batch cannot consume kg of an ingredient the ledger holds in g');
select t.expect_value($$
  select count(*)::text from production_records
   where sub_recipe_id=(select id from sub_recipes where name='T-prep')$$,
  'and the batch did not land without its consumption', '0');

select '── production: what the record says afterwards ──────────────────';

select t.expect_rows($$
  select public.record_production(
    (select id from sub_recipes where name='T-prep'), 2, 'g',
    jsonb_build_array(jsonb_build_object(
      'product_id',(select id from products where name='T-flour'),
      'quantity',220,'unit','g','unit_cost','10',
      'lot_id',(select id from stock_lots where lot_code='T-LOT')::text)),
    (select id from production_plans where note='T-plan'),
    now(), 'T-made')$$,
  'two batches in the preparation''s own unit are accepted', 1);

select t.expect_value($$
  select quantity_made::text from production_records where note='T-made'$$,
  'the quantity made is derived from the yield, not supplied', '2000.00000');
select t.expect_value($$
  select batch_yield_qty::text from production_records where note='T-made'$$,
  'and the yield is captured, so editing it later does not rewrite history', '1000.00000');
-- 0054's lesson, in a new table: a record of who did something that the client
-- can address to somebody else is not a record.
select t.expect_value($$
  select produced_by_email from production_records where note='T-made'$$,
  'the record names the caller, not a field the client sent', 'chef@test.local');
select t.expect_value($$
  select (r.org_id = s.org_id)::text from production_records r
    join sub_recipes s on s.id=r.sub_recipe_id where r.note='T-made'$$,
  'and it inherits the preparation''s organisation, not the caller''s default', 'true');

select '── production: theoretical against actual (INV-FUNC-005) ────────';

-- Two batches at 100 g of flour each. Recorded as 220 g taken: 10% over.
select t.expect_value($$
  select theoretical_qty::text from public.production_variance(current_date, current_date)
   where product_name='T-flour'$$,
  'the recipes expected 200 g of flour for two batches', '200.00000');
select t.expect_value($$
  select actual_qty::text from public.production_variance(current_date, current_date)
   where product_name='T-flour'$$,
  'the ledger says 220 g went out', '220.00000');
select t.expect_value($$
  select variance_percent::text from public.production_variance(current_date, current_date)
   where product_name='T-flour'$$,
  'which is 10% over', '10.00');
-- Both sides at the same unit cost, so this is a usage variance and not a
-- price one. 20 g at 10 is 200.
select t.expect_value($$
  select variance_cost::text from public.production_variance(current_date, current_date)
   where product_name='T-flour'$$,
  'and 200 of money, valued at one price on both sides', '200.00000');

/*
 * The three ways the two sides cannot be compared.
 *
 * A zero here would be a lie in all three cases, and this codebase separates
 * "nobody entered any" from "none" everywhere else.
 */
select t.expect_value($$
  select comparable::text from public.production_variance(current_date, current_date)
   where product_name='T-salt'$$,
  'an ingredient the recipe expected and nobody took is not comparable', 'false');
select t.expect_value($$
  select theoretical_qty::text from public.production_variance(current_date, current_date)
   where product_name='T-salt'$$,
  'and its expected figure is still shown, because that part is known', '10.00000');
select t.expect_value($$
  select actual_qty is null from public.production_variance(current_date, current_date)
   where product_name='T-salt'$$,
  'while what was used is left blank rather than set to zero', 'true');

select t.expect_rows($$
  insert into stock_movements (product_id, kind, quantity, unit, unit_cost, reason)
  select id,'USAGE',-50,'ml',20,'T-staff-meal' from products where name='T-oil'$$,
  'something used with no production behind it', 1);
select t.expect_value($$
  select comparable::text from public.production_variance(current_date, current_date)
   where product_name='T-oil'$$,
  'is reported as not comparable rather than as a 100% overrun', 'false');

-- The grams-to-kilograms refusal, arriving from the ledger side where no
-- production record is attached and the consumption trigger does not fire.
select t.expect_rows($$
  insert into stock_movements (product_id, kind, quantity, unit, unit_cost, reason)
  select id,'USAGE',-0.1,'kg',10000,'T-second-unit' from products where name='T-flour'$$,
  'the same ingredient used in a second unit', 1);
select t.expect_value($$
  select comparable::text from public.production_variance(current_date, current_date)
   where product_name='T-flour'$$,
  'stops the two sides being added up at all', 'false');
select t.expect_value($$
  select variance_qty is null from public.production_variance(current_date, current_date)
   where product_name='T-flour'$$,
  'and no variance is offered for it', 'true');

select '── production: a correction is another record ───────────────────';

select t.expect_value($$
  select has_table_privilege('authenticated','production_records','UPDATE')::text$$,
  'nobody may edit a completion record', 'false');
select t.expect_value($$
  select has_table_privilege('authenticated','production_records','DELETE')::text$$,
  'nor delete one', 'false');

select t.expect_fail($$
  select public.record_production((select id from sub_recipes where name='T-prep'), 1, 'g',
    '[]'::jsonb, null, now(), 'T-correction',
    (select id from production_records where note='T-made'), null)$$,
  'a correction with no reason is refused');
select t.expect_fail($$
  select public.record_production(
    (select id from sub_recipes where name='T-prep-no-yield'), 1, 'g',
    '[]'::jsonb, null, now(), 'T-correction',
    (select id from production_records where note='T-made'), 'wrong preparation')$$,
  'a correction naming a different preparation is refused');

select t.expect_rows($$
  select public.record_production(
    (select id from sub_recipes where name='T-prep'), 1, 'g',
    jsonb_build_array(jsonb_build_object(
      'product_id',(select id from products where name='T-flour'),
      'quantity',110,'unit','g','unit_cost','10')),
    null, now(), 'T-correction',
    (select id from production_records where note='T-made'),
    'Only one batch was made; the second was never started')$$,
  'a correction that says why is accepted', 1);

select t.expect_value($$
  select count(*)::text from production_records where note in ('T-made','T-correction')$$,
  'both records are still there', '2');
select t.expect_value($$
  select count(*)::text from production_records_effective where note in ('T-made','T-correction')$$,
  'and exactly one of them counts', '1');
select t.expect_value($$
  select note from production_records_effective where note in ('T-made','T-correction')$$,
  'the correction, not the record it supersedes', 'T-correction');

-- A fork would make "what was actually made" ambiguous, which is the one thing
-- the record has to be unambiguous about.
select t.expect_fail($$
  select public.record_production(
    (select id from sub_recipes where name='T-prep'), 3, 'g',
    '[]'::jsonb, null, now(), 'T-second-correction',
    (select id from production_records where note='T-made'),
    'correcting it a second time')$$,
  'a record cannot be corrected twice');

/*
 * The ledger side of a correction: 220 taken, 220 put back, 110 taken.
 *
 * Appended, never edited — the same thing applying a stock count already does.
 * 110 is what the shelf is actually down by.
 */
select t.expect_value($$
  select sum(qty)::text from public.production_usage_actual
   where product_id=(select id from products where name='T-flour')
     and production_record_id is not null$$,
  'the reversal and the new figure net to what was really used', '110.00000');

select '── production: one step forward (178/2002 Article 18) ───────────';

select t.expect_value($$
  select preparation_name from lot_forward_trace
   where lot_code='T-LOT' and step_forward='BATCH' limit 1$$,
  'the lot can be traced forward to the preparation it went into', 'T-prep');
select t.expect_value($$
  select produced_by_email from lot_forward_trace
   where lot_code='T-LOT' and step_forward='BATCH' limit 1$$,
  'and to the person who made it', 'chef@test.local');
select t.expect_value($$
  select service from lot_forward_trace
   where lot_code='T-LOT' and step_forward='BATCH' limit 1$$,
  'and to the sheet that service was planned on', 'DINNER');
/*
 * The gap is named rather than omitted.
 *
 * Somebody took 10 g off the lot without recording what they made with it,
 * which is the normal way a traceability record goes wrong. A forward trace
 * that quietly dropped the row would read as complete; this is the finding an
 * inspector is actually looking for, so it is a value in a column.
 */
select t.expect_rows($$
  insert into stock_movements (product_id, kind, quantity, unit, reason, lot_id)
  select id,'USAGE',-10,'g','T-untraced',(select id from stock_lots where lot_code='T-LOT')
    from products where name='T-flour'$$,
  'something taken off the lot with no batch recorded against it', 1);
select t.expect_value($$
  select count(*)::text from lot_forward_trace
   where lot_code='T-LOT' and step_forward='UNRECORDED_USAGE'$$,
  'is reported as a gap in the forward trace, not hidden', '1');

select '── production: Article 19 still refuses a blocked lot ───────────';

select t.expect_rows($$
  update stock_lots set status='RECALLED', status_reason='T-recall' where lot_code='T-LOT'$$,
  'the lot is recalled', 1);
select t.expect_fail($$
  insert into stock_movements (product_id, kind, quantity, unit, reason, lot_id)
  select id,'USAGE',-10,'g','T-after-recall',(select id from stock_lots where lot_code='T-LOT')
    from products where name='T-flour'$$,
  'a recalled lot cannot be consumed');
/*
 * The half 0060 changed, and why.
 *
 * 0020 refused every usage movement on a blocked lot regardless of direction,
 * which also refused the reversal half of a correction. A lot recalled after
 * Tuesday's service then left Tuesday's over-recorded consumption permanently
 * uncorrectable — the ledger stuck wrong about a recalled lot, which is the
 * opposite of what Article 19 is for.
 */
select t.expect_rows($$
  insert into stock_movements (product_id, kind, quantity, unit, reason, lot_id)
  select id,'USAGE',10,'g','T-putting-it-back',(select id from stock_lots where lot_code='T-LOT')
    from products where name='T-flour'$$,
  'but a correction that puts quantity back is allowed', 1);
select t.expect_value($$
  select quantity::text from stock_movements where reason='T-putting-it-back'$$,
  'and it is in the ledger afterwards', '10.00000');

select '── production: who may record anything at all ───────────────────';

select t.expect_guarded('production_records','PRODUCTION');
select t.expect_guarded('production_plans','PRODUCTION');
select t.expect_guarded('production_plan_lines','PRODUCTION');

select t.act_as('a0000000-0000-0000-0000-000000000003','nobody@test.local');
select t.expect_fail($$
  select public.record_production((select id from sub_recipes where name='T-prep'), 1, 'g')$$,
  'somebody granted nothing cannot record a batch');
select t.expect_fail($$
  insert into production_plans (org_id, planned_for, note)
  select id, current_date, 'T-plan-2' from organizations where name='Demo Kitchen' limit 1$$,
  'nor save a prep list');
select t.expect_value($$
  select count(*)::text from production_plans where note='T-plan-2'$$,
  'and neither refusal left anything behind', '0');

select '── production: the tolerance a new venue starts with ────────────';
-- 0040's rule: starting data in a function called on organisation creation,
-- never an INSERT in a migration body that runs over the organisations that
-- happened to exist at the time, which on a rebuild from empty is none.
select t.act_as('a0000000-0000-0000-0000-000000000002','chef@test.local');
select t.expect_value($$
  select value::text from venue_parameters
   where code='PRODUCTION_VARIANCE_TOLERANCE'
     and org_id=(select id from organizations where name='Demo Kitchen')$$,
  'every venue has a variance tolerance, so a gram is not a finding', '5.00000');
rollback;
