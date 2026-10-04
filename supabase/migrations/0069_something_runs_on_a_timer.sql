-- ---------------------------------------------------------------------------
-- Something runs on a timer
-- ---------------------------------------------------------------------------
-- Three migrations have now written a sweep and ended with a version of the
-- same sentence. 0059, about deleting expired photographs: "**Nothing calls
-- this.** There is no scheduler in this project — no pg_cron, no job runner,
-- and nothing deployed to run one on." 0068, about chasing unanswered
-- requests: "What runs it: pg_cron, in 0069."
--
-- There is a scheduler. `pg_cron` is in `shared_preload_libraries` on the
-- Supabase image and has been the whole time; nothing had asked for it. That
-- is the kind of thing worth saying plainly, because "we cannot do that yet"
-- survives in a codebase long after it stops being true.
--
-- ## What is scheduled, and what deliberately is not
--
-- The outbox drain is scheduled too, in 0070, where the function it calls is
-- defined. Keeping the timer beside the thing it runs costs a reader one file
-- and saves a migration that schedules a function that does not exist yet.
--
-- **Chasing unanswered requests, every fifteen minutes.** Safe to run anywhere:
-- with no overdue requests it does nothing, it is idempotent within a period by
-- construction, and the worst case of running it on a laptop is a row in a
-- ledger nobody reads.
--
-- **Deleting expired photographs is not scheduled.** `expired_attachments` has
-- been written and tested since 0059 and still nothing calls it, and that is
-- now a decision rather than an absence. Retention deletion destroys evidence
-- on a timer: a venue that has not thought about its retention figures would
-- discover them by losing a photograph it needed. It is one `cron.schedule`
-- away for a venue that wants it, and the function to call is named below so
-- nobody has to go looking.
--
-- ## Why fifteen minutes and not one
--
-- The chase cadence is governed by the promise, not by the sweep, so running
-- more often changes nothing except how soon a late request is noticed —
-- bounded by a quarter of an hour, against promises measured in hours. A sweep
-- every minute would be ninety-six times the work for a difference nobody can
-- perceive.
-- ---------------------------------------------------------------------------

create extension if not exists pg_cron;

/*
 * Only `postgres` schedules things. The default is that `cron` is readable by
 * nobody else, and this keeps it that way rather than widening it for
 * convenience: a job list anybody can write is a way to run anything as the
 * superuser on a timer.
 */

/*
 * Idempotent, because a migration is re-run on every rebuild from empty and
 * `cron.schedule` with the same name replaces rather than duplicating — but
 * only in recent versions, and an unscheduled-then-scheduled pair says what it
 * means on every version.
 */
do $$
begin
  perform cron.unschedule('chase-unanswered-requests');
exception when others then
  -- Not scheduled yet, which is the normal case on a fresh database.
  null;
end $$;

select cron.schedule(
  'chase-unanswered-requests',
  '*/15 * * * *',
  $job$ select public.chase_unanswered_requests() $job$
);

/*
 * What is running, for somebody who wants to know without reaching for the
 * `cron` schema.
 *
 * Owner's rights on purpose and restricted to administrators by the grant
 * below: the job list is infrastructure, and a venue's staff have no reason to
 * read it, but the person debugging "why did nobody get told" has every reason.
 */
create or replace view scheduled_jobs as
  select jobname as name,
         schedule,
         active,
         command
    from cron.job
   where jobname in ('chase-unanswered-requests', 'drain-outbox');

revoke all on scheduled_jobs from public;
grant select on scheduled_jobs to authenticated;

comment on view scheduled_jobs is
  'The background jobs this database runs. Deleting expired media is deliberately not one — see 0069.';
