-- ---------------------------------------------------------------------------
-- A checklist is a form with a version (0102)
-- ---------------------------------------------------------------------------
-- The rule worth proving hardest: editing a form must not rewrite what
-- people already answered. An inspector reading March's closing check is
-- entitled to March's questions.
-- ---------------------------------------------------------------------------

begin;

select id as demo from organizations where name = 'Demo Kitchen' \gset

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');

select '── a form, and a run of it' as "──";

select t.expect_rows($$
  insert into checklist_forms (id, org_id, code, title, items)
  values ('b0000000-0000-4000-8000-000000090001',
          (select id from organizations where name='Demo Kitchen'),
          'T-CLOSE', 'T-Closing check',
          '[{"key":"fridge","label":"Fridge temperature","type":"temperature","max":5,"required":true,"raises_request":true},
            {"key":"gas","label":"Gas off","type":"yes_no","required":true},
            {"key":"who","label":"Who closed","type":"text","required":false}]'::jsonb)$$,
  'a form is recorded', 1);
select t.expect_value($$select version::text from checklist_forms
                         where id = 'b0000000-0000-4000-8000-000000090001'$$,
  'at version one', '1');

select t.expect_rows($$
  insert into checklist_runs (id, form_id)
  values ('b0000000-0000-4000-8000-000000090010', 'b0000000-0000-4000-8000-000000090001')$$,
  'and a run of it starts', 1);
select t.expect_value($$select jsonb_array_length(items_at_the_time)::text from checklist_runs
                         where id = 'b0000000-0000-4000-8000-000000090010'$$,
  'taking a copy of the questions', '3');
select t.expect_value($$select started_by_email from checklist_runs
                         where id = 'b0000000-0000-4000-8000-000000090010'$$,
  'against whoever started it, from the session', 'chef@test.local');

select '── answers are judged by the question as it was asked' as "──";

select t.expect_rows($$
  insert into checklist_answers (run_id, item_key, value)
  values ('b0000000-0000-4000-8000-000000090010', 'fridge', '3')$$,
  'three degrees against a limit of five', 1);
select t.expect_value($$select passed::text from checklist_answers
                         where run_id = 'b0000000-0000-4000-8000-000000090010' and item_key='fridge'$$,
  'passes', 'true');

select t.expect_refused($$
  insert into checklist_answers (run_id, item_key, value)
  values ('b0000000-0000-4000-8000-000000090010', 'invented', 'x')$$,
  'a question that is not on the form cannot be answered', 'no item called');
select t.expect_refused($$
  update checklist_answers set value = 'warm'
   where run_id = 'b0000000-0000-4000-8000-000000090010' and item_key='fridge'$$,
  'and a temperature that is not a number is refused', 'not a number');

select '── a run with gaps is not evidence' as "──";

select t.expect_refused($$
  select complete_checklist_run('b0000000-0000-4000-8000-000000090010')$$,
  'closing it with a required question unanswered is refused', 'still to answer');
select t.expect_refused($$
  select complete_checklist_run('b0000000-0000-4000-8000-000000090010')$$,
  'and the refusal names which question is outstanding', 'Gas off');

select t.expect_rows($$
  insert into checklist_answers (run_id, item_key, value)
  values ('b0000000-0000-4000-8000-000000090010', 'gas', 'yes')$$,
  'answering the last required one', 1);
select t.expect_value($$select complete_checklist_run('b0000000-0000-4000-8000-000000090010')::text$$,
  'lets it close, and it passed', 'true');
select t.expect_refused($$
  select complete_checklist_run('b0000000-0000-4000-8000-000000090010')$$,
  'and it closes once', 'already been closed');

select '── editing the form does not rewrite what was answered' as "──";

select t.expect_rows($$
  update checklist_forms
     set items = '[{"key":"fridge","label":"Fridge temperature","type":"temperature","max":2,"required":true,"raises_request":true}]'::jsonb
   where id = 'b0000000-0000-4000-8000-000000090001'$$,
  'the limit is tightened and a question removed', 1);
select t.expect_value($$select version::text from checklist_forms
                         where id = 'b0000000-0000-4000-8000-000000090001'$$,
  'which bumps the version without anybody remembering to', '2');

/*
 * The old run still reads against the old questions. Without the snapshot,
 * March's closing check would now be a failure against a limit nobody was
 * asked to meet.
 */
select t.expect_value($$select jsonb_array_length(items_at_the_time)::text from checklist_runs
                         where id = 'b0000000-0000-4000-8000-000000090010'$$,
  'the finished run still has its three questions', '3');
select t.expect_value($$select form_version::text from checklist_runs
                         where id = 'b0000000-0000-4000-8000-000000090010'$$,
  'recorded against version one', '1');
select t.expect_value($$select passed::text from checklist_answers
                         where run_id = 'b0000000-0000-4000-8000-000000090010' and item_key='fridge'$$,
  'and three degrees still passes, against the limit it was asked to meet',
  'true');

select '── a failure that matters raises a request' as "──";

reset role;
select count(*) as before_requests from requests \gset

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');
select t.expect_rows($$
  insert into checklist_runs (id, form_id)
  values ('b0000000-0000-4000-8000-000000090011', 'b0000000-0000-4000-8000-000000090001')$$,
  'a second run, on the tightened form', 1);
select t.expect_rows($$
  insert into checklist_answers (run_id, item_key, value)
  values ('b0000000-0000-4000-8000-000000090011', 'fridge', '9')$$,
  'nine degrees against a limit of two', 1);
select t.expect_value($$select passed::text from checklist_answers
                         where run_id = 'b0000000-0000-4000-8000-000000090011'$$,
  'fails', 'false');
select t.expect_value($$select complete_checklist_run('b0000000-0000-4000-8000-000000090011')::text$$,
  'and the run closes as a failure', 'false');

reset role;
select t.expect_value($$select count(*)::text from requests
                         where title like 'Checklist: Fridge temperature%'$$,
  'raising a request through the front door rather than telling nobody', '1');

select t.expect_guarded('checklist_forms', 'HYGIENE');
select t.expect_guarded('checklist_runs', 'HYGIENE');
select t.expect_guarded('checklist_answers', 'HYGIENE');

rollback;
