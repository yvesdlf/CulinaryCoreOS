-- ---------------------------------------------------------------------------
-- Marking a written answer (0125)
-- ---------------------------------------------------------------------------
-- `written_answers_to_mark` is a definer-rights view over `quiz_questions`,
-- which `authenticated` holds no SELECT on because it is where the model
-- answers live. The view is therefore the only route to them, and its `where`
-- clause is the access control rather than a filter — if it is wrong, the
-- answers to the exam are readable by whoever asks.
--
-- Two rules, matching `mark_written_answers()`: you need People write, and it
-- must not be your own paper. The second is the one worth having a test for,
-- because it is not about marking at all — a manager reading the model answer
-- to their own pending attempt has been given the answers, whoever marks it
-- afterwards.
-- ---------------------------------------------------------------------------

begin;

select id as demo from organizations where name = 'Demo Kitchen' \gset
select id as t5 from employees
 where employee_number = 'T-5' and org_id = :'demo' \gset

insert into training_courses (id, org_id, code, title, pass_mark)
values ('b0000000-0000-4000-8000-000000650001', :'demo', 'T-C65',
        'T-Knife safety', 80);

insert into quiz_questions (id, org_id, course_id, prompt, kind,
                            model_answer, points, sort_order)
values ('b0000000-0000-4000-8000-000000650002', :'demo',
        'b0000000-0000-4000-8000-000000650001',
        'T-Describe how you would store a boning knife overnight.',
        'WRITTEN', 'T-Washed, dried and in the rack, never in the sink.', 5, 1);

insert into quiz_attempts (id, org_id, course_id, employee_id, awaiting_marking)
values ('b0000000-0000-4000-8000-000000650003', :'demo',
        'b0000000-0000-4000-8000-000000650001', :'t5', true);

insert into quiz_written_answers (id, org_id, attempt_id, question_id, answer)
values ('b0000000-0000-4000-8000-000000650004', :'demo',
        'b0000000-0000-4000-8000-000000650003',
        'b0000000-0000-4000-8000-000000650002',
        'T-In the rack after washing it.');

select '── marking: the model answer is not readable directly ───────────';

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000001', 'owner@test.local');

/*
 * The premise. If this ever starts returning rows, the view below stops being
 * the only route to the model answers and its `where` clause stops being the
 * control it is written as.
 */
select t.expect_fail($$select model_answer from quiz_questions$$,
  'even an owner cannot read quiz_questions directly');

select '── marking: a marker sees the answer and the model ──────────────';

select t.expect_value($$
  select model_answer from written_answers_to_mark
   where attempt_id = 'b0000000-0000-4000-8000-000000650003'$$,
  'a marker reads the model answer through the view',
  'T-Washed, dried and in the rack, never in the sink.');

select t.expect_value($$
  select answer from written_answers_to_mark
   where attempt_id = 'b0000000-0000-4000-8000-000000650003'$$,
  'beside what the candidate wrote', 'T-In the rack after washing it.');

select t.expect_value($$
  select points::text from written_answers_to_mark
   where attempt_id = 'b0000000-0000-4000-8000-000000650003'$$,
  'and what it is worth', '5');

select '── marking: somebody with no People access sees nothing ─────────';

reset role;
select t.act_as_nobody();
delete from member_access
 where user_id = 'a0000000-0000-0000-0000-000000000003'
   and section_code = 'PEOPLE';

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000003', 'nobody@test.local');

select t.expect_value($$
  select count(*)::text from written_answers_to_mark$$,
  'a member without People write reads no model answer at all', '0');

select '── marking: nobody reads the model answer to their own paper ────';

/*
 * The rule that is not about marking.
 *
 * The attempt is repointed at the employee record belonging to the caller, so
 * the paper is theirs. They still hold People write — they are an owner —
 * so the first rule in the view passes and only the second can refuse them.
 * If it does not, a manager can read the model answers to an exam they are
 * about to sit, and the marking that happens afterwards is theatre.
 */
reset role;
select t.act_as_nobody();
update employees set user_id = 'a0000000-0000-0000-0000-000000000001'
 where id = (select employee_id from quiz_attempts
              where id = 'b0000000-0000-4000-8000-000000650003');

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000001', 'owner@test.local');

select t.expect_value($$
  select count(*)::text from written_answers_to_mark
   where attempt_id = 'b0000000-0000-4000-8000-000000650003'$$,
  'the model answer to your own paper is not yours to read', '0');

select t.expect_refused($$
  select mark_written_answers('b0000000-0000-4000-8000-000000650003'::uuid,
                              '{}'::jsonb)$$,
  'and marking it is refused for the same reason',
  'cannot be marked by the person who sat it');

rollback;
