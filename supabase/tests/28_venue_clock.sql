-- ---------------------------------------------------------------------------
-- The venue's today, not Greenwich's (0082)
-- ---------------------------------------------------------------------------

select '── clock: a request reads the day where the venue is ────────────';

select t.expect_value($$
  select coalesce(
    (select array_to_string(r.rolconfig, ',') from pg_roles r where r.rolname = 'authenticator'), '')
    ~ 'pgrst.db_pre_request=public.apply_venue_timezone'$$::text,
  'every API request is put in its venue''s time zone first', 'true');

begin;

/*
 * Kiritimati is UTC+14: at any moment of the day its date differs from UTC's
 * for fourteen hours, so this is the zone where the two answers disagree
 * most often. The check compares against the zone's own date rather than a
 * fixed one, so it holds whenever it runs.
 */
update organizations set timezone = 'Pacific/Kiritimati' where name = 'Demo Kitchen';

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');
select public.apply_venue_timezone();

select t.expect_value($$select current_setting('timezone')$$,
  'a member''s session is in the venue''s zone', 'Pacific/Kiritimati');
select t.expect_value($$
  select (current_date = (now() at time zone 'Pacific/Kiritimati')::date)::text$$,
  'so current_date is the venue''s date', 'true');

/*
 * The portal reads the same day: staff@ is employee T-5, not a member.
 */
select set_config('timezone', 'UTC', true);
select t.act_as('a0000000-0000-0000-0000-000000000004', 'staff@test.local');
select public.apply_venue_timezone();
select t.expect_value($$select current_setting('timezone')$$,
  'and so is a staff-portal user''s', 'Pacific/Kiritimati');

reset role;
select t.expect_fail($$update organizations set timezone = 'Mars/Olympus_Mons'
                        where name = 'Demo Kitchen'$$,
  'a time zone Postgres does not know is refused when it is saved, not on every request after');

rollback;
