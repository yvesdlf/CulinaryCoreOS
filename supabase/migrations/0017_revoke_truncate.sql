-- ---------------------------------------------------------------------------
-- Revoke TRUNCATE from the client roles
-- ---------------------------------------------------------------------------
-- Every table carried TRUNCATE for `anon` and `authenticated`, inherited from
-- the platform's default grants rather than from anything here.
--
-- It matters because PostgreSQL does not apply row-level security to TRUNCATE.
-- Each table's policies scope reads and writes to the caller's organization,
-- but a TRUNCATE ignores all of that and empties the table for every tenant.
-- One signed-in user of any organization could have cleared the catalogue,
-- the recipes and the ledgers.
--
-- TRIGGER and REFERENCES go the same way: neither is reachable from PostgREST,
-- and both let a client attach to tables it should only be reading.
--
-- Nothing in the application uses these — the client inserts, selects, updates
-- and deletes rows, which the per-table grants continue to allow.
-- ---------------------------------------------------------------------------

revoke truncate, trigger, references on all tables in schema public
  from anon, authenticated;

-- Future tables would otherwise arrive with the same grants.
alter default privileges in schema public
  revoke truncate, trigger, references on tables from anon, authenticated;
