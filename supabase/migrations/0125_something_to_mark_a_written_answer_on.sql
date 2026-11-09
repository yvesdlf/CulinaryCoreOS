-- ---------------------------------------------------------------------------
-- Something to mark a written answer on
-- ---------------------------------------------------------------------------
-- `quiz_questions` has carried `kind`, `model_answer` and `points` since
-- 0070, `quiz_written_answers` has carried the candidate's prose and a place
-- to put a mark, and `mark_written_answers()` has been able to award it and
-- recompute the attempt's score. Nothing could read any of it.
--
-- Not an oversight in the screen: a marker genuinely cannot read
-- `quiz_questions`. `authenticated` holds no SELECT on that table and should
-- not — it is where the model answers live, and a candidate who can read it
-- is a candidate who has been given the answers. The read policy on it has
-- therefore never applied to anybody.
--
-- So the marker needs what the candidate already has: a definer-rights view
-- that hands out exactly the columns that role is entitled to. 0070 built
-- `my_exam_questions` for the candidate — prompt and options, never
-- `correct_index` or `model_answer`. This is its opposite number.
--
-- ── Why this view is not security_invoker ─────────────────────────────────
--
-- 0077's rule is that a view carries `security_invoker = true`, so that
-- reading through it is no more powerful than reading the tables under it.
-- This is one of the two deliberate exceptions, for the same reason
-- `my_exam_questions` is the other: the whole point is to expose a *subset*
-- of a table nobody may read. An invoker-rights view over `quiz_questions`
-- would return nothing to anyone.
--
-- Because the view does the deciding, it has to say who may read it, and the
-- `where` clause below is the access control. It is written to match
-- `mark_written_answers()` exactly — the same two rules, so a marker cannot
-- see an answer they would then be refused permission to mark, and more
-- importantly cannot see a model answer for a paper they are not allowed to
-- touch.
-- ---------------------------------------------------------------------------

create or replace view written_answers_to_mark
with (security_invoker = false) as
select w.id,
       w.org_id,
       w.attempt_id,
       w.question_id,
       w.answer,
       w.awarded_points,
       w.marker_comment,
       w.marked_by_email,
       w.marked_at,
       q.prompt,
       q.model_answer,
       q.points,
       a.employee_id,
       a.attempted_at,
       a.awaiting_marking,
       c.id    as course_id,
       c.title as course_title,
       e.first_name,
       e.last_name,
       e.employee_number
  from quiz_written_answers w
  join quiz_questions   q on q.id = w.question_id
  join quiz_attempts    a on a.id = w.attempt_id
  join training_courses c on c.id = a.course_id
  join employees        e on e.id = a.employee_id
 where
   /*
    * People *write*, not venue membership.
    *
    * The first version of this said `auth_can_write(w.org_id)`, copying the
    * test `mark_written_answers()` applies. That is an organisation-level
    * question — may you write anything here — and a chef with no People
    * access at all passed it and read the model answers. It is the same
    * mistake 23_exposure.sql was strengthened to catch after sixteen views
    * read past the section gates of 0079, and this view walked straight into
    * it.
    *
    * `can_write_section` rather than `can_read_section`: marking is a write,
    * and somebody who may only read People has no business being handed the
    * answers.
    */
   can_write_section('PEOPLE', w.org_id, null)
   -- And nobody marks their own paper, which here means nobody *reads the
   -- model answer* to their own paper either. The RPC refuses the write; a
   -- manager who could read this view for their own pending attempt would
   -- have the answers before somebody else marked it, which is the same
   -- failure arriving by a different door.
   and not exists (
     select 1 from employees me
      where me.id = a.employee_id
        and me.user_id is not null
        and me.user_id = (select auth.uid()));

comment on view written_answers_to_mark is
  'Written answers a marker may mark, with the model answer. Definer-rights on purpose: quiz_questions is unreadable by design. Excludes the reader''s own attempt.';

grant select on written_answers_to_mark to authenticated;
