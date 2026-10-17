-- ---------------------------------------------------------------------------
-- A person chooses what reaches them, except when it cannot wait
-- ---------------------------------------------------------------------------
-- Quiet hours and channel choice exist, and they are per venue: one set of
-- hours in `message_channels` for everybody. So a head chef who wants every
-- delivery short and a commis who wants none of it get the same traffic, and
-- the usual outcome of that is everybody muting everything.
--
-- Per person, per kind, per channel. Three rules shape it:
--
--   Silence is not the default. Somebody who has never opened the settings
--   gets what the venue sends, because a notification system that defaults
--   to off is one nobody ever turns on — and the first thing it fails to
--   deliver will be the thing that mattered.
--
--   Quiet hours are the person's, falling back to the venue's. "Do not wake
--   me" is a fact about a person, not about a restaurant.
--
--   Some things ignore all of it. A critical HACCP failure and a serious
--   incident reach the duty manager at four in the morning, because the
--   alternative is a muted phone and a regulator asking why nobody acted.
--   That list is a column on the kind, not a hard-coded set here, so a venue
--   can add to it without a migration — but it cannot be emptied silently,
--   because the default is seeded rather than inferred.
-- ---------------------------------------------------------------------------

create table if not exists notification_preferences (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,

  /* Null means "every kind", which is how somebody mutes everything. */
  kind notification_kind,
  /* Null means "every channel". */
  channel_kind text,

  enabled boolean not null default true,
  quiet_from time,
  quiet_to time,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint notification_preferences_window
    check ((quiet_from is null) = (quiet_to is null))
);

/*
 * Four partial indexes rather than one over coalesce(kind::text, '*').
 *
 * An enum-to-text cast is not immutable and Postgres refuses it in an index
 * expression. These say the same thing more precisely: one preference per
 * person for each combination of "a kind or all kinds" and "a channel or
 * all channels".
 */
create unique index if not exists idx_notification_preferences_both
  on notification_preferences(org_id, user_id, kind, channel_kind)
  where kind is not null and channel_kind is not null;
create unique index if not exists idx_notification_preferences_kind
  on notification_preferences(org_id, user_id, kind)
  where kind is not null and channel_kind is null;
create unique index if not exists idx_notification_preferences_channel
  on notification_preferences(org_id, user_id, channel_kind)
  where kind is null and channel_kind is not null;
create unique index if not exists idx_notification_preferences_all
  on notification_preferences(org_id, user_id)
  where kind is null and channel_kind is null;

/*
 * Kinds that ignore everything.
 *
 * A column rather than a list in a function, so a venue can add to it and
 * so reading the table answers "what will wake me up" without reading code.
 */
create table if not exists notification_kind_rules (
  org_id uuid not null references organizations(id) on delete cascade,
  kind notification_kind not null,
  /* Reaches people regardless of preference or quiet hours. */
  always_deliver boolean not null default false,
  note text,
  primary key (org_id, kind)
);

create or replace function public.seed_notification_rules(p_org uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  /*
   * The ones that cannot wait. A delivery that is short can wait until
   * morning; a critical hygiene failure cannot, and neither can an
   * unanswered request that has already been escalated.
   */
  insert into public.notification_kind_rules (org_id, kind, always_deliver, note)
  values
    (p_org, 'REQUEST_UNANSWERED', true,
     'Already escalated by the time this is sent. Waiting until morning is the failure.'),
    (p_org, 'CERTIFICATE_EXPIRING', false, null),
    (p_org, 'INVOICE_ON_HOLD', false, null)
  on conflict (org_id, kind) do nothing;
end $$;

revoke all on function public.seed_notification_rules(uuid)
  from public, anon, authenticated;

insert into public.organization_seeders (ordinal, function_name, note)
select coalesce(max(ordinal), 0) + 1, 'seed_notification_rules',
       'Which notification kinds ignore quiet hours (0105)'
  from public.organization_seeders
on conflict (function_name) do nothing;

do $$
declare o record;
begin
  for o in select id from public.organizations loop
    perform public.seed_notification_rules(o.id);
  end loop;
end $$;

/*
 * Should this reach this person, on this channel, now?
 *
 * The most specific preference wins: a rule naming both the kind and the
 * channel beats one naming only the kind, which beats a blanket one. Saying
 * "nothing, ever, except orders" has to be expressible or people will not
 * use it at all.
 */
create or replace function public.wants_notification(
  p_org uuid, p_user uuid, p_kind notification_kind,
  p_channel text, p_at timestamptz default now()
)
returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  pref record;
  venue record;
  tz text;
  local_time time;
begin
  if coalesce((select r.always_deliver from public.notification_kind_rules r
                where r.org_id = p_org and r.kind = p_kind), false) then
    return true;
  end if;

  select * into pref
    from public.notification_preferences n
   where n.org_id = p_org and n.user_id = p_user
     and (n.kind is null or n.kind = p_kind)
     and (n.channel_kind is null or n.channel_kind = p_channel)
   order by (n.kind is not null)::int + (n.channel_kind is not null)::int desc
   limit 1;

  -- Nothing said: the venue's behaviour. Defaulting to silence is how a
  -- notification system ends up delivering nothing to anybody.
  if pref is null then
    return true;
  end if;

  if not pref.enabled then
    return false;
  end if;

  select coalesce(o.timezone, 'UTC') into tz
    from public.organizations o where o.id = p_org;
  local_time := (p_at at time zone tz)::time;

  if pref.quiet_from is not null then
    -- A window that wraps midnight is the normal case for quiet hours.
    if pref.quiet_from < pref.quiet_to then
      return not (local_time >= pref.quiet_from and local_time < pref.quiet_to);
    else
      return not (local_time >= pref.quiet_from or local_time < pref.quiet_to);
    end if;
  end if;

  select ch.quiet_from, ch.quiet_to into venue
    from public.message_channels ch
   where ch.org_id = p_org and ch.kind = p_channel and ch.enabled
   limit 1;

  if venue.quiet_from is not null then
    if venue.quiet_from < venue.quiet_to then
      return not (local_time >= venue.quiet_from and local_time < venue.quiet_to);
    else
      return not (local_time >= venue.quiet_from or local_time < venue.quiet_to);
    end if;
  end if;

  return true;
end $$;

create or replace function public.touch_notification_preference()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists notification_preferences_set_org on notification_preferences;
create trigger notification_preferences_set_org before insert on notification_preferences
  for each row execute function public.set_org_id();
drop trigger if exists notification_preferences_touch on notification_preferences;
create trigger notification_preferences_touch before update on notification_preferences
  for each row execute function public.touch_notification_preference();

alter table notification_preferences enable row level security;
alter table notification_kind_rules enable row level security;

/*
 * A preference is the person's own.
 *
 * Readable and writable by them and by nobody else except an administrator,
 * who needs to be able to see why somebody is not getting messages without
 * being able to quietly mute them — hence read for ADMIN, write only for
 * the person.
 */
drop policy if exists notification_preferences_read on notification_preferences;
create policy notification_preferences_read on notification_preferences for select to authenticated
  using (user_id = (select auth.uid()) or public.can_read_section('ADMIN', org_id));
drop policy if exists notification_preferences_write on notification_preferences;
create policy notification_preferences_write on notification_preferences for insert to authenticated
  with check (user_id = (select auth.uid()));
drop policy if exists notification_preferences_update on notification_preferences;
create policy notification_preferences_update on notification_preferences for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists notification_preferences_delete on notification_preferences;
create policy notification_preferences_delete on notification_preferences for delete to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists notification_kind_rules_read on notification_kind_rules;
create policy notification_kind_rules_read on notification_kind_rules for select to authenticated
  using (org_id in (select public.auth_org_ids()));
drop policy if exists notification_kind_rules_write on notification_kind_rules;
create policy notification_kind_rules_write on notification_kind_rules for all to authenticated
  using (public.can_write_section('ADMIN', org_id))
  with check (public.can_write_section('ADMIN', org_id));

grant select, insert, update, delete on notification_preferences to authenticated;
grant select, insert, update, delete on notification_kind_rules to authenticated;

delete from public.section_read_rules
 where table_name in ('notification_preferences', 'notification_kind_rules');
insert into public.section_read_rules (table_name, section_code, shared_because) values
  ('notification_preferences', null, 'a person''s own settings, plus Administration'),
  ('notification_kind_rules', null, 'what will wake somebody up, readable by everybody it may wake');

comment on table notification_preferences is
  'Per person, per kind, per channel. Nothing said means the venue''s behaviour, never silence. See 0105.';
comment on table notification_kind_rules is
  'Which kinds ignore preferences and quiet hours. A column rather than a list in code, so reading it answers the question. See 0105.';
