-- ---------------------------------------------------------------------------
-- A FOR ALL policy is a read policy too
-- ---------------------------------------------------------------------------
-- 0107 gave `sales_forecasts` the pair this schema uses everywhere: a read
-- policy gated on the section, and a write policy gated on `auth_can_write`.
-- The write one was written `for all`, which is how most of the others are
-- written, and that is the defect.
--
-- `for all` means every command, SELECT included, and policies are OR'd. So
-- the read policy's `can_read_section('REVENUE', ...)` was one of two routes
-- in, and the other asked only whether the caller was a member who may write
-- something — which every chef is. A member with Revenue explicitly set to
-- NONE read all of it.
--
-- It passed its own tests and 25_section_reads.sql for the same reason: the
-- table was empty, and nobody had any reason to notice until a seed put rows
-- in it. That is the first false pass in `_harness.sql` — an empty table and
-- a refusal are indistinguishable — reached this time through a policy rather
-- than an UPDATE.
--
-- The fix is the shape `daily_takings` has had since 0065, whose author
-- evidently met this: the write policy's USING carries the section check as
-- well, so neither route in skips it. WITH CHECK stays as it was, because
-- what may be *written* is a question about writing.
-- ---------------------------------------------------------------------------

drop policy if exists sales_forecasts_write on sales_forecasts;
create policy sales_forecasts_write on sales_forecasts for all to authenticated
  using (
    public.auth_can_write(org_id)
    and public.can_read_section('REVENUE', org_id)
  )
  with check (public.auth_can_write(org_id));

comment on table sales_forecasts is
  'Stored rather than recomputed, so a roster built against Tuesday''s forecast is still explicable in March. Readable only with Revenue; see 0108 for why the write policy says so too.';
