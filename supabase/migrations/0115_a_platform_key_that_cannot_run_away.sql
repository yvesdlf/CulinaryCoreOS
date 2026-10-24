-- ---------------------------------------------------------------------------
-- A platform key that cannot run away
-- ---------------------------------------------------------------------------
-- Until now the assistant has been bring-your-own-key only: the key lives in
-- one browser's localStorage, the call goes straight to the provider, and the
-- bill is the venue's own. `stores/ai-store.ts` sets out why that is the
-- right default and it still is — it costs the platform nothing, exposes
-- nothing centrally, and a venue that already pays Google or Anthropic can
-- carry on doing so.
--
-- What it cannot do is serve a venue that has no account with anybody, which
-- is most of them. So this adds the other half: the venue uses the
-- platform's key and the platform bills for it.
--
-- The thing that makes that half hard is not the key, it is the meter.
--
--   A platform key in the browser is not a platform key, it is a shared key
--   given away. So the call has to go through something the venue cannot
--   read, and the only part of this stack that qualifies is an edge
--   function. The key never enters the database either — it is a function
--   secret, because a key in a table is in every backup.
--
--   A cap checked in the browser is not a cap. One venue in a retry loop
--   would bill the platform for all of them, and the first anybody knows is
--   the invoice. So the allowance is checked in the database, by the same
--   function that records the usage, inside one statement.
--
--   The meter counts what the provider says it used, not what the app
--   guessed. An estimate drifts from the invoice, and a meter that disagrees
--   with the bill is a meter nobody can charge from.
--
-- `ai_usage` is append-only, like every other ledger here (AGENTS.md §4),
-- because it is what an invoice is built from. A correction is a new row.
-- ---------------------------------------------------------------------------

do $$ begin
  create type ai_key_source as enum ('OWN_KEY', 'PLATFORM');
exception when duplicate_object then null; end $$;

/*
 * What a venue is allowed each month, and whether it may use the platform
 * key at all.
 *
 * Default: not allowed. A venue opts in — or is opted in by whoever sells to
 * them — rather than discovering that it has been spending somebody else's
 * money. Opt-out would make the platform's bill a function of how many
 * venues forgot to look.
 */
create table if not exists ai_allowances (
  org_id uuid primary key references organizations(id) on delete cascade,

  platform_key_allowed boolean not null default false,
  monthly_request_limit integer not null default 0,
  monthly_token_limit bigint not null default 0,

  /* What the venue is charged, so an invoice can be built from the ledger. */
  price_per_1k_tokens numeric(12,6),
  currency text not null default 'USD',

  note text,
  updated_at timestamptz not null default now(),
  updated_by_email text,

  constraint ai_allowances_limits check (
    monthly_request_limit >= 0 and monthly_token_limit >= 0)
);

/*
 * Every call, win or lose.
 *
 * A refused call is recorded too: "we stopped you" and "nothing happened"
 * look identical in a ledger that only writes successes, and the first thing
 * somebody asks when the assistant goes quiet is whether it was them or us.
 */
create table if not exists ai_usage (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,

  occurred_at timestamptz not null default now(),
  key_source ai_key_source not null,
  provider_id text not null,
  model text,
  task text,

  input_tokens integer,
  output_tokens integer,
  /* Stored, not computed: the price can change and this is what was charged. */
  charged_amount numeric(12,6),
  currency text,

  outcome text not null default 'OK',
  refused_reason text,

  requested_by_email text,

  constraint ai_usage_tokens check (
    coalesce(input_tokens, 0) >= 0 and coalesce(output_tokens, 0) >= 0)
);

create index if not exists idx_ai_usage_month
  on ai_usage(org_id, occurred_at desc);

drop trigger if exists ai_allowances_touch on ai_allowances;
create trigger ai_allowances_touch before update on ai_allowances
  for each row execute function public.set_updated_at();
drop trigger if exists ai_usage_set_org on ai_usage;
create trigger ai_usage_set_org before insert on ai_usage
  for each row execute function public.set_org_id();

/*
 * Append-only, because an invoice is built from it.
 *
 * The same rule as `stock_movements` and `time_entries`: a line that can be
 * edited after the fact is a line nobody can bill from, and a line that can
 * be deleted is a bill nobody can defend.
 */
create or replace function public.refuse_ai_usage_edit()
returns trigger language plpgsql as $$
begin
  raise exception 'the AI usage ledger is append-only'
    using hint = 'A correction is a new row, not an edit to this one.';
end $$;

drop trigger if exists zz_ai_usage_append_only on ai_usage;
create trigger zz_ai_usage_append_only
  before update or delete on ai_usage
  for each row execute function public.refuse_ai_usage_edit();

revoke update, delete on ai_usage from authenticated;

/*
 * What is left this month.
 *
 * Calendar month rather than a rolling window, because an allowance a venue
 * cannot predict the end of is one they cannot plan around — and because
 * "this month" is what appears on the invoice.
 */
create or replace view ai_usage_this_month
with (security_invoker = true) as
  select
    a.org_id,
    a.platform_key_allowed,
    a.monthly_request_limit,
    a.monthly_token_limit,
    coalesce(u.requests, 0)                             as requests_used,
    coalesce(u.tokens, 0)                               as tokens_used,
    greatest(a.monthly_request_limit - coalesce(u.requests, 0), 0) as requests_left,
    greatest(a.monthly_token_limit - coalesce(u.tokens, 0), 0)     as tokens_left,
    coalesce(u.charged, 0)::numeric(12,6)               as charged_this_month,
    a.currency
  from public.ai_allowances a
  left join (
    select
      org_id,
      count(*) filter (where outcome = 'OK')                     as requests,
      sum(coalesce(input_tokens, 0) + coalesce(output_tokens, 0)) as tokens,
      sum(coalesce(charged_amount, 0))                            as charged
    from public.ai_usage
    where key_source = 'PLATFORM'
      and occurred_at >= date_trunc('month', now())
    group by org_id
  ) u on u.org_id = a.org_id;

grant select on ai_usage_this_month to authenticated;

/*
 * May this venue make a platform-key call right now?
 *
 * Returns a row rather than raising, and that is not a style choice. The
 * first draft raised on refusal and the refusal was never written: a
 * `raise exception` in plpgsql rolls back everything the function did,
 * including the INSERT recording it. The ledger of refusals — the whole
 * reason "the assistant went quiet" is answerable — was being discarded by
 * the statement that created it. The test caught it on its first run.
 *
 * So the answer comes back as data. The caller is the edge function, which
 * is the only thing holding the key, so the cap is still enforced
 * server-side; and `record_ai_usage` will not record against a claim that
 * does not exist, so a call that skipped this cannot reach the invoice.
 *
 * It does not record the tokens — nobody knows them yet.
 */
create or replace function public.claim_ai_call(
  p_org uuid, p_provider text, p_task text
)
returns table (claim_id uuid, allowed boolean, reason text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  state record;
  refusal text;
  row_id uuid;
begin
  select * into state from public.ai_usage_this_month where org_id = p_org;

  if state.org_id is null or not state.platform_key_allowed then
    refusal := 'this venue is not set up to use the platform key';
  elsif state.requests_left <= 0 then
    refusal := format('this venue has used its %s assistant requests for the month',
                      state.monthly_request_limit);
  elsif state.tokens_left <= 0 then
    refusal := 'this venue has used its assistant allowance for the month';
  end if;

  insert into public.ai_usage
    (org_id, key_source, provider_id, task, outcome, refused_reason,
     requested_by_email)
  values (p_org, 'PLATFORM', p_provider, p_task,
          case when refusal is null then 'CLAIMED' else 'REFUSED' end,
          refusal, auth.jwt() ->> 'email')
  returning id into row_id;

  return query select row_id, refusal is null, refusal;
end $$;

revoke all on function public.claim_ai_call(uuid, text, text) from public, anon;
grant execute on function public.claim_ai_call(uuid, text, text) to authenticated, service_role;

/*
 * What it actually used.
 *
 * A new row rather than an update, because the ledger is append-only and
 * because the claim and the result are two different facts: a call that was
 * allowed and then failed at the provider is not the same as one that never
 * started, and an invoice needs to tell them apart.
 */
create or replace function public.record_ai_usage(
  p_claim uuid, p_model text, p_input integer, p_output integer,
  p_outcome text default 'OK'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  claim record;
  rate numeric;
begin
  select * into claim from public.ai_usage where id = p_claim;
  if claim.id is null then
    raise exception 'there is no such AI call to record against';
  end if;

  select price_per_1k_tokens into rate
    from public.ai_allowances where org_id = claim.org_id;

  insert into public.ai_usage
    (org_id, key_source, provider_id, model, task,
     input_tokens, output_tokens, charged_amount, currency,
     outcome, requested_by_email)
  values (
    claim.org_id, claim.key_source, claim.provider_id, p_model, claim.task,
    p_input, p_output,
    -- Null where no price is set, never zero: a venue on a free pilot and a
    -- venue nobody priced look identical in a total of zeroes.
    case when rate is not null
         then round(rate * (coalesce(p_input, 0) + coalesce(p_output, 0)) / 1000.0, 6)
    end,
    (select currency from public.ai_allowances where org_id = claim.org_id),
    p_outcome, claim.requested_by_email);
end $$;

revoke all on function public.record_ai_usage(uuid, text, integer, integer, text)
  from public, anon;
grant execute on function public.record_ai_usage(uuid, text, integer, integer, text)
  to authenticated, service_role;

alter table ai_allowances enable row level security;
alter table ai_usage enable row level security;

/*
 * A venue can see what it is spending; only ADMIN can change what it is
 * allowed. Nobody can change it upward from inside the venue, because the
 * allowance is a commercial agreement and not a setting — the write policy
 * is deliberately absent and the platform sets it with the service role.
 */
drop policy if exists ai_allowances_read on ai_allowances;
create policy ai_allowances_read on ai_allowances for select to authenticated
  using (org_id in (select public.auth_org_ids()));

drop policy if exists ai_usage_read on ai_usage;
create policy ai_usage_read on ai_usage for select to authenticated
  using (public.can_read_section('ADMIN', org_id));

grant select on ai_allowances to authenticated;
grant select on ai_usage to authenticated;

comment on table ai_allowances is
  'Whether a venue may use the platform key and how much of it. Not writable from inside the venue: it is a commercial agreement, not a setting. See 0115.';
comment on table ai_usage is
  'Append-only, because an invoice is built from it. Refusals are recorded too — "we stopped you" and "nothing happened" look identical in a ledger of successes. See 0115.';
comment on function public.claim_ai_call(uuid, text, text) is
  'Checked in the database, not the browser: a cap a client enforces is not a cap, and one venue in a retry loop would bill the platform for all of them.';
