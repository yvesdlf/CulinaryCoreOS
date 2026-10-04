-- ---------------------------------------------------------------------------
-- The part that actually sends
-- ---------------------------------------------------------------------------
-- Gap 13, and the oldest unkept promise in the codebase: "an invitation is not
-- emailed. An approver is never told there is something waiting. An order
-- marked 'sent' transmits nothing to the supplier."
--
-- Everything up to the last step has existed since 0031. A notification is
-- raised, `queue_notification_deliveries` fans it out to one row per enabled
-- channel with `status = 'PENDING'`, and then nothing in this system has ever
-- changed a PENDING row to anything else. The queue has been filling for
-- thirty-nine migrations.
--
-- ## What this is and is not
--
-- It is the worker: claiming, attempting, recording what happened, backing
-- off, respecting quiet hours, and never sending the same thing twice. All of
-- that is database logic and all of it is tested here.
--
-- It is **not** a mail server, and this migration does not make anybody's
-- inbox receive anything. The last hop is an HTTP call to whatever the venue
-- has configured — a provider's send API — and that needs an account and a key
-- the platform does not have. `attempt_delivery` makes the call through
-- `pg_net` when a channel names an endpoint and does nothing at all when it
-- does not, which is the honest behaviour on a laptop and on a venue that has
-- not finished setting up.
--
-- Saying that plainly matters more than it looks. "Email is built" and "email
-- is built except for the part that emails" are different claims, and the
-- second one is this.
--
-- ## Why the worker, and not just the call
--
-- The call is the easy half. What makes an outbox work is the rest:
--
--   **Claim before attempting.** Two workers, or one worker and a retry,
--   otherwise send the same message twice. The claim is a conditional UPDATE
--   that only one of them can win.
--
--   **Attempts and backoff.** A channel that is down gets five tries over
--   increasing intervals and then stops. Without that, one bad address is
--   retried every minute forever and the queue never drains.
--
--   **Quiet hours already exist.** `message_channels.quiet_from/quiet_to` have
--   been columns since 0031 and nothing read them. A system that wakes a chef
--   at three in the morning to say an invoice matched gets switched off.
--
--   **Nothing is attempted twice after it succeeded.** The one failure mode
--   nobody forgives.
-- ---------------------------------------------------------------------------

alter table message_deliveries
  add column if not exists next_attempt_at timestamptz,
  add column if not exists claimed_at timestamptz,
  add column if not exists response_code integer;

comment on column message_deliveries.next_attempt_at is
  'When this may be tried again. Null means now. Pushed out after each failure.';

create index if not exists idx_message_deliveries_due
  on message_deliveries(next_attempt_at)
  where status = 'PENDING';

/*
 * How many tries, and how far apart.
 *
 * Five, over roughly a quarter of an hour in total. A supplier's mail server
 * being briefly unreachable should not lose an order; a wrong address should
 * not be retried for a week. Both of those are the same column, so the numbers
 * are a judgement and are written where they can be read rather than buried in
 * an expression.
 */
create or replace function public.delivery_backoff(p_attempt integer)
returns interval
language sql
immutable
set search_path = ''
as $$
  select case greatest(p_attempt, 0)
    when 0 then interval '0'
    when 1 then interval '1 minute'
    when 2 then interval '5 minutes'
    when 3 then interval '15 minutes'
    else        interval '1 hour'
  end;
$$;

/*
 * Is this channel allowed to speak right now?
 *
 * Quiet hours are a property of the channel and are stored as two times with
 * no date, so a window that crosses midnight — 22:00 to 07:00, which is the
 * normal shape — has `quiet_from > quiet_to`. Both cases are handled, because
 * getting this wrong means either no quiet hours at all or a channel that is
 * silent for nineteen hours a day, and both look plausible in the column.
 *
 * An EMERGENCY carries through quiet hours. A fire door propped open at two in
 * the morning is exactly what the quiet window must not swallow, and a system
 * that holds that until seven is worse than one with no quiet hours at all.
 */
create or replace function public.channel_may_speak(
  p_channel uuid, p_at timestamptz, p_urgent boolean default false)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_urgent then true
    else coalesce((
      select case
        when c.quiet_from is null or c.quiet_to is null then true
        when c.quiet_from < c.quiet_to
          then not (p_at::time >= c.quiet_from and p_at::time < c.quiet_to)
        -- Crosses midnight: quiet is from `quiet_from` to the end of the day
        -- and from the start of the next to `quiet_to`.
        else not (p_at::time >= c.quiet_from or p_at::time < c.quiet_to)
      end
      from public.message_channels c where c.id = p_channel
    ), true)
  end;
$$;

-- ── Attempting one ──────────────────────────────────────────────────────────

/*
 * Send one delivery, and say what happened.
 *
 * The endpoint comes from the channel's own config. A channel with no endpoint
 * is not an error and is not a failure: it is a venue that has not finished
 * setting up, and burning an attempt on it would exhaust the retries before
 * anybody had configured anything. It is left PENDING and reported as such.
 *
 * `pg_net` is asynchronous — `http_post` returns a request id and the response
 * arrives in `net._http_response` later — so this records the request and the
 * next pass reconciles it. That is why `response_code` exists as a column
 * rather than being read inline: the answer is not available at the moment the
 * question is asked, and pretending otherwise would mean marking everything
 * SENT the instant it was handed over.
 */
create or replace function public.attempt_delivery(p_delivery uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  d record;
  endpoint text;
  auth_header text;
  req_id bigint;
begin
  select m.*, c.config, c.kind as channel_kind, n.subject, n.body, n.kind as notification_kind
    into d
    from public.message_deliveries m
    join public.message_channels c on c.id = m.channel_id
    join public.notifications n on n.id = m.notification_id
   where m.id = p_delivery;

  if d is null then
    return 'gone';
  end if;

  if d.destination is null or btrim(d.destination) = '' then
    update public.message_deliveries
       set status = 'SKIPPED', last_error = 'no destination recorded', updated_at = now()
     where id = p_delivery;
    return 'skipped: no destination';
  end if;

  endpoint := d.config ->> 'endpoint';
  if endpoint is null or btrim(endpoint) = '' then
    -- Not a failure. See the header: this is the state of every venue that has
    -- not been given a provider, including this project's own laptops.
    return 'waiting: no endpoint configured for this channel';
  end if;

  auth_header := d.config ->> 'auth_header';

  select net.http_post(
    url := endpoint,
    headers := jsonb_strip_nulls(jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', auth_header)),
    body := jsonb_build_object(
      'to', d.destination,
      'subject', d.subject,
      'text', d.body,
      'reference', d.id)
  ) into req_id;

  update public.message_deliveries
     set attempts = attempts + 1,
         external_id = req_id::text,
         claimed_at = now(),
         updated_at = now()
   where id = p_delivery;

  return 'sent to ' || endpoint;
end;
$$;

revoke all on function public.attempt_delivery(uuid) from public;
grant execute on function public.attempt_delivery(uuid) to service_role;

-- ── Reconciling what the provider said ──────────────────────────────────────

/*
 * `pg_net` answers later, into `net._http_response`. This reads the answers for
 * requests we are still waiting on and settles them.
 *
 * A 2xx is SENT. Anything else is a failure with the code and body recorded,
 * backed off, and retried until the attempts run out — at which point it is
 * FAILED and stays FAILED, because a message nobody can deliver should stop
 * consuming the queue and start being visible.
 */
create or replace function public.reconcile_deliveries()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer := 0;
  d record;
  resp record;
begin
  for d in
    select m.id, m.external_id, m.attempts
      from public.message_deliveries m
     where m.status = 'PENDING' and m.external_id is not null
  loop
    /*
     * `error_msg` as well as `status_code`, and the difference is a defect
     * this had before it was tested against a real endpoint.
     *
     * `pg_net` records two kinds of answer. A server that replied puts a code
     * and a body in `status_code`/`content`. A request that never reached a
     * server — no connection, DNS failure, timeout — puts a sentence in
     * `error_msg` and leaves the other two null. The first draft of this
     * selected only the first pair, so a transport failure produced a record
     * whose fields were all null, `resp is null` was true, and the delivery was
     * treated as still in flight. Forever: PENDING, with `external_id` set, so
     * nothing retried it and nothing reported it. A message that sticks
     * silently is the exact failure an outbox exists to make impossible, and it
     * was found by pointing a channel at an address that does not answer.
     */
    select status_code, content, error_msg into resp
      from net._http_response where id = d.external_id::bigint;
    if resp is null then
      continue;                      -- Still in flight.
    end if;

    if resp.status_code is null then
      -- Never reached a server. Treated as a failure, with the reason kept.
      update public.message_deliveries
         set status = case when d.attempts >= 5 then 'FAILED' else 'PENDING' end,
             last_error = left(coalesce(resp.error_msg, 'no response and no reason given'), 500),
             next_attempt_at = now() + public.delivery_backoff(d.attempts),
             external_id = null,
             updated_at = now()
       where id = d.id;
    elsif resp.status_code between 200 and 299 then
      update public.message_deliveries
         set status = 'SENT', sent_at = now(), response_code = resp.status_code,
             last_error = null, updated_at = now()
       where id = d.id;
    else
      update public.message_deliveries
         set status = case when d.attempts >= 5 then 'FAILED' else 'PENDING' end,
             response_code = resp.status_code,
             last_error = left(coalesce(resp.content, 'no response body'), 500),
             next_attempt_at = now() + public.delivery_backoff(d.attempts),
             external_id = null,
             updated_at = now()
       where id = d.id;
    end if;
    n := n + 1;
  end loop;
  return n;
end;
$$;

revoke all on function public.reconcile_deliveries() from public;
grant execute on function public.reconcile_deliveries() to service_role;

-- ── The drain ───────────────────────────────────────────────────────────────

/*
 * One pass over the outbox.
 *
 * The claim is the point. `for update skip locked` plus a status change in the
 * same statement means two workers — or one worker and the retry of a pass
 * that timed out — cannot both pick up the same row. Without it the first
 * thing a busy venue notices is duplicate emails, and the second is that
 * nobody trusts the system.
 *
 * `p_now` is a parameter for the same reason it is in `chase_unanswered_
 * requests`: quiet hours and backoff are both about the clock, and a function
 * that reads it cannot be tested across either boundary.
 */
create or replace function public.drain_outbox(
  p_now timestamptz default now(),
  p_limit integer default 100)
returns table (delivery_id uuid, channel text, destination text, outcome text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  d record;
begin
  perform public.reconcile_deliveries();

  for d in
    with claimed as (
      select m.id
        from public.message_deliveries m
        join public.notifications n on n.id = m.notification_id
       where m.status = 'PENDING'
         and m.external_id is null
         and coalesce(m.next_attempt_at, p_now) <= p_now
         and public.channel_may_speak(
               m.channel_id, p_now,
               n.kind in ('REQUEST_UNANSWERED'))
       order by m.queued_at
       limit greatest(p_limit, 0)
       for update of m skip locked
    )
    update public.message_deliveries m
       set claimed_at = p_now, updated_at = p_now
      from claimed
     where m.id = claimed.id
     returning m.id, m.kind, m.destination
  loop
    delivery_id := d.id;
    channel := d.kind;
    destination := d.destination;
    outcome := public.attempt_delivery(d.id);
    return next;
  end loop;
end;
$$;

revoke all on function public.drain_outbox(timestamptz, integer) from public;
grant execute on function public.drain_outbox(timestamptz, integer) to service_role;

-- ── What anybody can see about it ───────────────────────────────────────────

/*
 * The health of the outbox, for the screen that has to answer "did the
 * supplier get the order".
 *
 * `waiting_on_setup` is counted apart from `pending` on purpose: a venue with
 * four hundred messages queued because nobody has configured a provider has a
 * different problem from one with four hundred queued because the provider is
 * down, and a single "pending" figure hides which.
 */
create or replace view outbox_health with (security_invoker = true) as
  select
    m.org_id,
    c.kind as channel_kind,
    c.name as channel_name,
    count(*) filter (where m.status = 'PENDING'
                       and coalesce(c.config ->> 'endpoint', '') <> '') as pending,
    count(*) filter (where m.status = 'PENDING'
                       and coalesce(c.config ->> 'endpoint', '') = '') as waiting_on_setup,
    count(*) filter (where m.status = 'SENT') as sent,
    count(*) filter (where m.status = 'FAILED') as failed,
    count(*) filter (where m.status = 'SKIPPED') as skipped,
    max(m.sent_at) as last_sent_at,
    max(m.updated_at) filter (where m.status = 'FAILED') as last_failure_at
  from public.message_deliveries m
  join public.message_channels c on c.id = m.channel_id
  group by m.org_id, c.kind, c.name;

grant select on outbox_health to authenticated;

comment on function public.drain_outbox(timestamptz, integer) is
  'One pass over the outbox. Claims before attempting, so two workers cannot send the same message twice.';
comment on function public.attempt_delivery(uuid) is
  'Hands one message to the channel''s endpoint. A channel with no endpoint is waiting, not failing.';
comment on view outbox_health is
  'Did it go out. "Waiting on setup" is counted apart from "pending": they are different problems.';

-- ── And something runs it ───────────────────────────────────────────────────
/*
 * The outbox, every minute.
 *
 * 0069 turned on the scheduler and said what it is for. This is scheduled here
 * rather than there because a migration that schedules a function defined in
 * the next one is a job that errors every minute until that one runs.
 *
 * Every minute rather than every fifteen: an approver waiting to be told there
 * is something to approve notices a quarter of an hour, and the pass costs
 * nothing when the queue is empty. It is also safe on a laptop — a channel
 * with no endpoint is left alone rather than attempted, which is the state of
 * every channel in every venue until somebody configures a provider.
 */
do $$
begin
  perform cron.unschedule('drain-outbox');
exception when others then
  null;
end $$;

select cron.schedule(
  'drain-outbox',
  '* * * * *',
  $job$ select public.drain_outbox() $job$
);
