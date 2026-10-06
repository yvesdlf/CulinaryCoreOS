-- ---------------------------------------------------------------------------
-- 0076 · The outbox's network extension is declared, not assumed
-- ---------------------------------------------------------------------------
-- 0070 drains the outbox with `net.http_post`, and no migration ever created
-- `pg_net`. The local image ships with it enabled, so every rebuild from empty
-- passed; a fresh hosted project does not, and there the drain job would have
-- failed every minute from the moment it was scheduled, with nobody told.
--
-- 0069 created `pg_cron` the same way. `if not exists` keeps this a no-op on
-- the local stack and on any project where somebody already ticked the box.
-- ---------------------------------------------------------------------------

create extension if not exists pg_net with schema extensions;
