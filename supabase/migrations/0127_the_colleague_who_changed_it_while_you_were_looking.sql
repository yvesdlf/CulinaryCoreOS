-- ---------------------------------------------------------------------------
-- The colleague who changed it while you were looking
-- ---------------------------------------------------------------------------
-- Reads are hydrate-once at sign-in plus a refresh when the tab regains
-- focus. Two people on the same screen therefore do not see each other: a
-- chef costing a dish works from the price a manager corrected an hour ago,
-- and nothing on the screen says so.
--
-- This was tried before and backed out, with a note saying the channel
-- subscribed without error and delivered nothing. It delivers. Reproducing
-- the old result found the reason it looked otherwise, and it is the first
-- false pass in `_harness.sql`: **the UPDATE used to test it matched no
-- rows.** An UPDATE that changes nothing writes nothing to the WAL, and a
-- realtime channel that correctly reports no change is indistinguishable
-- from one that is broken. Measured this time by counting the rows the
-- update touched before believing anything about the events.
--
-- ── What is published, and what is not ─────────────────────────────────────
--
-- The three catalogue tables, and not their line tables. A change to a
-- recipe's ingredients rewrites that recipe's costs through the cascade —
-- `0117` made sure the parent row joins the same transaction — so the recipe
-- row changes too and the line tables would only duplicate the signal at
-- several times the WAL volume.
--
-- Nothing in People, Pay or HR cases is published, and that is a decision
-- rather than an omission. The staleness this fixes is a costing problem; a
-- rota is read when somebody opens it. Publishing a table is not free and is
-- not reversible in a reader's favour — see the next section.
--
-- ── `replica identity full`, and what it costs ─────────────────────────────
--
-- Without it, a DELETE reaches the WAL as a primary key and nothing else, so
-- Realtime cannot evaluate `org_id in (select auth_org_ids())` against the
-- row that has gone and drops the event for everybody. A deletion is the
-- change a colleague most needs to see — the product they are costing from
-- no longer exists — so the old row travels in full.
--
-- The cost is real: every UPDATE on these tables writes the whole previous
-- row to the WAL rather than the changed columns. `products` is 40 columns
-- wide and a price edit rewrites six of them through the cascade. Accepted
-- for three tables, which is also why the list is three.
--
-- ── What a signed-out listener can see ─────────────────────────────────────
--
-- Nothing of the row, and the fact that one changed. Realtime evaluates the
-- table's policies as the subscriber's role before sending: a member of
-- another venue receives no message at all, and a client that never signed
-- in receives `{"new":{},"old":{},"errors":["Error 401: Unauthorized"]}` —
-- the event's existence and its table, with no content and no venue.
--
-- That residual signal is the platform's behaviour and is written down here
-- rather than discovered later: an unauthenticated socket can tell that some
-- venue edited some product at some moment. It cannot tell which venue, which
-- product or what changed. `apps/web/scripts/realtime-probe.mjs` asserts all
-- three of those sentences against a running stack, and CI runs it.
-- ---------------------------------------------------------------------------

/*
 * §6: as a function, because `alter publication ... add table` raises if the
 * table is already a member, and this has to survive `supabase db reset`,
 * a re-run on staging, and a fourth table being added to the list next year.
 */
create or replace function public.publish_catalogue_changes()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  t text;
  n integer := 0;
begin
  foreach t in array array['products', 'recipes', 'sub_recipes'] loop
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
    execute format('alter table public.%I replica identity full', t);
    n := n + 1;
  end loop;
  return n;
end $$;

revoke all on function public.publish_catalogue_changes() from anon, authenticated;

select public.publish_catalogue_changes();

comment on function public.publish_catalogue_changes() is
  'Puts the catalogue tables in the supabase_realtime publication with full '
  'replica identity. Re-runnable; run it after adding a table to the list.';
