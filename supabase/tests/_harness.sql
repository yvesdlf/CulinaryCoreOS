-- ---------------------------------------------------------------------------
-- The test harness
-- ---------------------------------------------------------------------------
-- Every control in this database was proved once, by hand, in a scratch file
-- nobody kept. This directory keeps them, and CI runs them on every push.
--
-- Three ways this repository has produced a false pass, all of them expensive,
-- and each one is why a function below exists rather than a bare statement:
--
--   1. An UPDATE that matches zero rows raises nothing. A test asserting "no
--      error" on an empty table passes without executing the rule it names.
--      `expect_ok` and `expect_fail` are therefore never used alone on a
--      statement whose target might not exist — `expect_rows` asserts the
--      count, and the fixtures are checked before the assertions run.
--
--   2. A trigger may silently correct what it did not refuse. "The write was
--      allowed" is not "the write happened", so anything that matters is read
--      back afterwards with `expect_value`.
--
--   3. A fixture that fails takes every later assertion with it, and the run
--      then reports a screen of passes that never ran. `fixture` isolates each
--      one in a subtransaction and says what it skipped.
--
-- psql prefixes errors with "file:line:", so grepping for '^ERROR' finds
-- nothing. The runner counts FAIL lines instead and sets its exit code from
-- the total, which is printed at the end.
-- ---------------------------------------------------------------------------

create schema if not exists t;

/* A statement that must be refused. Passes only if it raised. */
create or replace function t.expect_fail(p_sql text, p_label text)
returns text language plpgsql as $$
begin
  execute p_sql;
  return 'FAIL  ' || p_label || '  — it was allowed';
exception when others then
  return 'pass  ' || p_label;
end $$;

/* A statement that must be accepted. */
create or replace function t.expect_ok(p_sql text, p_label text)
returns text language plpgsql as $$
begin
  execute p_sql;
  return 'pass  ' || p_label;
exception when others then
  return 'FAIL  ' || p_label || '  — ' || sqlerrm;
end $$;

/* Accepted AND it changed what it was supposed to change. */
create or replace function t.expect_rows(p_sql text, p_label text, p_want integer)
returns text language plpgsql as $$
declare n integer;
begin
  execute p_sql;
  get diagnostics n = row_count;
  if n = p_want then return 'pass  ' || p_label; end if;
  return 'FAIL  ' || p_label || '  — changed ' || n || ', expected ' || p_want;
exception when others then
  return 'FAIL  ' || p_label || '  — ' || sqlerrm;
end $$;

/* What the row actually says now. The answer to "was it allowed" is not the
   answer to "did it happen". */
create or replace function t.expect_value(p_sql text, p_label text, p_want text)
returns text language plpgsql as $$
declare got text;
begin
  execute p_sql into got;
  if got is not distinct from p_want then return 'pass  ' || p_label; end if;
  return 'FAIL  ' || p_label || '  — got ' ||
         coalesce(quote_literal(got), 'null') || ', expected ' ||
         coalesce(quote_literal(p_want), 'null');
exception when others then
  return 'FAIL  ' || p_label || '  — ' || sqlerrm;
end $$;

/* A fixture that cannot take the run down with it. */
create or replace function t.fixture(p_sql text)
returns text language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return 'FAIL  fixture — ' || sqlerrm;
end $$;

/* Sign in as somebody, for the row-level policies and the JWT-reading guards. */
create or replace function t.act_as(p_user uuid, p_email text)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'email', p_email,
                      'role', 'authenticated')::text, true);
end $$;

create or replace function t.act_as_nobody()
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
end $$;

/*
 * The guard is attached to the table at all.
 *
 * Needed because `expect_fail` cannot tell "the rule refused me" from "the
 * table was empty and my UPDATE matched nothing" — both raise nothing, and the
 * second reads as a pass. Where a fixture row is cheap, the behavioural test
 * is better and is used instead. Where building one would mean inventing three
 * parent records, this checks the wiring, which is what actually goes missing:
 * a table added later and never listed.
 */
create or replace function t.expect_guarded(p_table text, p_section text)
returns text language plpgsql as $$
declare found text;
begin
  select g.tgname into found
    from pg_trigger g
   where g.tgrelid = ('public.' || p_table)::regclass
     and not g.tgisinternal
     and g.tgname = p_table || '_section_guard';
  if found is null then
    return 'FAIL  ' || p_table || ' carries no section guard';
  end if;
  return 'pass  ' || p_table || ' is guarded by ' || p_section;
end $$;
