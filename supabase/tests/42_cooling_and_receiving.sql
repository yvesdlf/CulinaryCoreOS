-- ---------------------------------------------------------------------------
-- Cooling is a curve, and a delivery temperature is a record (0100)
-- ---------------------------------------------------------------------------
-- The breach has to be computed from the clock rather than from a screen,
-- the limits have to come from the venue, and a warm delivery has to leave
-- a hygiene record without anybody typing the temperature twice.
-- ---------------------------------------------------------------------------

begin;

select id as demo from organizations where name = 'Demo Kitchen' \gset

select '── the limits reached every venue' as "──";

select t.expect_value($$select count(*)::text from venue_parameters
                         where org_id = (select id from organizations where name='Demo Kitchen')
                           and code like 'COOLING%'$$,
  'an existing venue got all four cooling parameters', '4');
select t.expect_value($$select value::text from venue_parameters
                         where org_id = (select id from organizations where name='Demo Kitchen')
                           and code = 'COOLING_STAGE_2_TEMP'$$,
  'with the final limit at five degrees', '5.00000');

select '── a cooling that makes its stages' as "──";

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');

select t.expect_rows($$
  insert into cooling_logs (id, org_id, product_description, start_temperature_c, started_at)
  values ('b0000000-0000-4000-8000-000000070001',
          (select id from organizations where name='Demo Kitchen'),
          'T-Beef stock', 85, now() - interval '5 hours')$$,
  'a batch goes in to cool', 1);

select t.expect_rows($$
  insert into cooling_readings (cooling_log_id, stage, temperature_c, read_at)
  values ('b0000000-0000-4000-8000-000000070001', 'TWO_HOUR', 18,
          now() - interval '3 hours 10 minutes')$$,
  'down to 18 degrees inside two hours', 1);
select t.expect_value($$select within_limit::text from cooling_readings
                         where cooling_log_id = 'b0000000-0000-4000-8000-000000070001'
                           and stage = 'TWO_HOUR'$$,
  'which is inside the first stage', 'true');
select t.expect_value($$select breach::text from cooling_logs
                         where id = 'b0000000-0000-4000-8000-000000070001'$$,
  'so the log is not in breach', 'false');

select '── and one that overruns' as "──";

select t.expect_rows($$
  insert into cooling_logs (id, org_id, product_description, start_temperature_c, started_at)
  values ('b0000000-0000-4000-8000-000000070002',
          (select id from organizations where name='Demo Kitchen'),
          'T-Rice', 80, now() - interval '5 hours')$$,
  'another batch', 1);

/*
 * Four hours to reach 19 degrees. The temperature is fine for the first
 * stage and the clock is not, which is the whole point of logging cooling
 * as a curve rather than as a reading.
 */
select t.expect_rows($$
  insert into cooling_readings (cooling_log_id, stage, temperature_c, read_at)
  values ('b0000000-0000-4000-8000-000000070002', 'TWO_HOUR', 19,
          now() - interval '1 hour')$$,
  'reaches 19 degrees, but four hours in', 1);
select t.expect_value($$select within_limit::text from cooling_readings
                         where cooling_log_id = 'b0000000-0000-4000-8000-000000070002'$$,
  'the temperature was fine and the clock was not', 'false');
select t.expect_value($$select breach::text from cooling_logs
                         where id = 'b0000000-0000-4000-8000-000000070002'$$,
  'so the log is in breach without anybody saying so', 'true');
select t.expect_value($$select (breach_detail like '%19%hours%')::text from cooling_logs
                         where id = 'b0000000-0000-4000-8000-000000070002'$$,
  'naming the reading and the time', 'true');

/*
 * The same rule 0035 applies to every other breach, reused rather than
 * reinvented so the two cannot drift.
 */
select t.expect_refused($$
  update cooling_logs set finished_at = now()
   where id = 'b0000000-0000-4000-8000-000000070002'$$,
  'and it cannot be closed without saying what was done',
  'what was done about it');
select t.expect_rows($$
  update cooling_logs set finished_at = now(),
         corrective_action = 'Discarded; the blast chiller was full.'
   where id = 'b0000000-0000-4000-8000-000000070002'$$,
  'with an action it closes', 1);

select '── the venue''s own limits, not the file''s' as "──";

reset role;
update venue_parameters set value = 1
 where org_id = :'demo' and code = 'COOLING_STAGE_1_HOURS';

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');
select t.expect_rows($$
  insert into cooling_logs (id, org_id, product_description, start_temperature_c, started_at)
  values ('b0000000-0000-4000-8000-000000070003',
          (select id from organizations where name='Demo Kitchen'),
          'T-Sauce', 80, now() - interval '90 minutes')$$,
  'a venue tightens its first stage to one hour', 1);
select t.expect_rows($$
  insert into cooling_readings (cooling_log_id, stage, temperature_c, read_at)
  values ('b0000000-0000-4000-8000-000000070003', 'TWO_HOUR', 15, now())$$,
  'and the same ninety minutes that passed before', 1);
select t.expect_value($$select within_limit::text from cooling_readings
                         where cooling_log_id = 'b0000000-0000-4000-8000-000000070003'$$,
  'now fails, because the limit is the venue''s and not the migration''s',
  'false');

select '── a delivery temperature becomes a hygiene record' as "──";

reset role;
insert into suppliers (id, org_id, name)
values ('b0000000-0000-4000-8000-000000070010', :'demo', 'T-Chill-Co');

-- The venue's own receiving form, found by section rather than by a code.
insert into haccp_forms (id, org_id, code, section, title, frequency, fields, is_ccp)
values ('b0000000-0000-4000-8000-000000070020', :'demo', 'T-RECV', 'Receiving',
        'T-Delivery temperature', 'AS_NEEDED', '[]'::jsonb, true);

insert into goods_receipts (id, org_id, supplier_id, received_on, vehicle_temperature_c)
values ('b0000000-0000-4000-8000-000000070030', :'demo',
        'b0000000-0000-4000-8000-000000070010', current_date, 3);

select t.expect_value($$select count(*)::text from haccp_records
                         where goods_receipt_id = 'b0000000-0000-4000-8000-000000070030'$$,
  'a cold delivery still leaves a record', '1');
select t.expect_value($$select source from haccp_records
                         where goods_receipt_id = 'b0000000-0000-4000-8000-000000070030'$$,
  'marked as having come from receiving', 'receiving');
select t.expect_value($$select breach::text from haccp_records
                         where goods_receipt_id = 'b0000000-0000-4000-8000-000000070030'$$,
  'and is not a breach at three degrees', 'false');

insert into goods_receipts (id, org_id, supplier_id, received_on, vehicle_temperature_c, notes)
values ('b0000000-0000-4000-8000-000000070031', :'demo',
        'b0000000-0000-4000-8000-000000070010', current_date, 12, 'Rejected the chilled pallet');

select t.expect_value($$select breach::text from haccp_records
                         where goods_receipt_id = 'b0000000-0000-4000-8000-000000070031'$$,
  'twelve degrees is', 'true');
select t.expect_value($$select corrective_action from haccp_records
                         where goods_receipt_id = 'b0000000-0000-4000-8000-000000070031'$$,
  'carrying the note from the delivery as the action', 'Rejected the chilled pallet');

/*
 * A delivery with no temperature writes nothing. Recording a null as a
 * reading would put a measurement in the HACCP file that nobody took.
 */
insert into goods_receipts (id, org_id, supplier_id, received_on)
values ('b0000000-0000-4000-8000-000000070032', :'demo',
        'b0000000-0000-4000-8000-000000070010', current_date);
select t.expect_value($$select count(*)::text from haccp_records
                         where goods_receipt_id = 'b0000000-0000-4000-8000-000000070032'$$,
  'a delivery nobody took a temperature on records nothing', '0');

select t.expect_guarded('cooling_logs', 'HYGIENE');
select t.expect_guarded('cooling_readings', 'HYGIENE');

rollback;
