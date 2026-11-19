-- ---------------------------------------------------------------------------
-- Production: what the kitchen planned, and what it actually made
-- ---------------------------------------------------------------------------
-- The Production section has been storable since 0060 and has never had a
-- single demo row in it. The screen renders an empty state, the variance
-- derivation has nothing to derive from, and `production_report` (0130)
-- returns no rows — so nobody has ever seen either of them work.
--
-- A report with no data behind it is not a finished feature. This is the data.
--
-- ── What it has to contain to be worth seeding ────────────────────────────
--
-- Not "some production". The report exists to surface three disagreements
-- between the plan and the day, so the seed has to contain all three or the
-- report is shipped untested against its own purpose:
--
--   a service that was planned and nothing was made for,
--   preparation made with no plan behind it,
--   and a batch corrected after the fact.
--
-- Plus the ordinary case, in bulk, so the exceptions are a minority of the
-- rows rather than the whole report — a demo where every line is a problem
-- teaches the reader to ignore the column.
--
-- It also seeds one plan whose prep was done the night before. That is the
-- case the report's own join is built for: a batch counts against its plan
-- whatever day it was worked, and if that ever regresses this is the row that
-- turns red.
--
-- ── Deterministic, not random ─────────────────────────────────────────────
--
-- Every choice below is a modulus of the day index, never `random()`. The
-- visual regression baselines are screenshots of this database, and a seed
-- that produces a different kitchen each run would turn them red for no
-- reason — the exact failure `seed_local_demo.sh` was written to stop.
--
-- Dates are relative to `current_date`, like `seed_takings.sql`: a demo whose
-- newest service is eight months old reads as a dead system.
--
-- ── What this deliberately does not do ────────────────────────────────────
--
-- No stock movements. A completion record does not post consumption — 0060
-- derives theoretical usage as a view and leaves the ledger alone — and
-- inventing `USAGE` rows here would make the stock on hand disagree with the
-- opening balances `seed_stock.sql` posted, in a way no screen would explain.
--
-- Safe to run more than once: it clears its own rows first.
-- ---------------------------------------------------------------------------

do $$
declare
  org uuid;
  d date;
  i integer;
  k integer;
  n integer;
  svc text;
  services text[];
  plan uuid;
  prep record;
  rec record;
  n_preps integer;
  n_recipes integer;
  seen integer := 0;
  n_plans integer := 0;
  n_lines integer := 0;
  n_records integer := 0;
  n_loose integer := 0;
  n_corrections integer := 0;
  n_barren integer := 0;
  cooks text[] := array[
    'chef@venue.test', 'sous@venue.test', 'budi@venue.test', 'wayan@venue.test'];
begin
  /*
   * `into strict`, and the same rule in every seed file. See seed_stock.sql:
   * the failure to avoid is not "no venue", it is picking the wrong one
   * silently.
   */
  begin
    select id into strict org from public.organizations where name = 'Demo Kitchen';
  exception
    when no_data_found then
      raise exception 'no organisation called "Demo Kitchen"'
        using hint = 'Run seed.sql first, or rename the venue you want seeded.';
    when too_many_rows then
      raise exception 'more than one organisation is called "Demo Kitchen"'
        using hint = 'The seeds cannot tell which venue you mean. Rename all but one.';
  end;

  /*
   * Corrections first: `corrects_id` is `on delete restrict`, so a plain
   * delete of the whole table fails on whichever row the planner reaches
   * first. The section guard lets both through because there is no session —
   * this file is run by an administrator against their own database.
   */
  delete from public.production_records
   where org_id = org and corrects_id is not null;
  delete from public.production_records where org_id = org;
  delete from public.production_plans   where org_id = org;  -- lines cascade

  -- The preparations and dishes to draw from, numbered so the choices below
  -- can be a modulus rather than a sample.
  create temporary table _preps on commit drop as
    select (row_number() over (order by s.name)) - 1 as n,
           s.id, s.batch_yield_unit as unit
      from public.sub_recipes s
     where s.org_id = org
       and s.batch_yield_qty > 0
       and coalesce(btrim(s.batch_yield_unit), '') <> '';

  create temporary table _recipes on commit drop as
    select (row_number() over (order by r.name)) - 1 as n, r.id
      from public.recipes r
     where r.org_id = org;

  select count(*) into n_preps from _preps;
  select count(*) into n_recipes from _recipes;

  if n_preps = 0 or n_recipes = 0 then
    raise exception 'no preparations or no dishes to plan with'
      using hint = 'Run seed_catalogue.sql first.';
  end if;

  -- ── Four weeks of service ───────────────────────────────────────────────
  for i in 0..27 loop
    d := current_date - i;

    -- Dinner every night; lunch at the weekend, when the venue serves both.
    if extract(isodow from d) in (6, 7) then
      services := array['Lunch', 'Dinner'];
    else
      services := array['Dinner'];
    end if;

    foreach svc in array services loop
      insert into public.production_plans
        (org_id, planned_for, service, note, created_by_email)
      values (org, d, svc, null, 'chef@venue.test')
      returning id into plan;
      n_plans := n_plans + 1;

      /*
       * One plan in thirteen is saved and never filled in. It happens — a
       * sheet opened at the end of a shift and abandoned — and it is the only
       * thing that produces the 'a plan with no dishes on it' concern.
       */
      if i % 13 <> 7 then
        for k in 0 .. 2 + (i % 3) loop
          insert into public.production_plan_lines (plan_id, recipe_id, covers)
          select plan, r.id, 20 + ((i * 11 + k * 7) % 60)
            from _recipes r
           where r.n = (i * 5 + k * 17
                        + (case when svc = 'Lunch' then 3 else 0 end)) % n_recipes
          on conflict do nothing;  -- the modulus can land twice on one dish
          n_lines := n_lines + 1;
        end loop;
      end if;

      /*
       * One service in nine has nothing made against it. This is the line a
       * head of department is actually looking for at the Monday meeting.
       */
      if (i * 3 + (case when svc = 'Lunch' then 1 else 0 end)) % 9 = 4 then
        n_barren := n_barren + 1;
      else
        for k in 0 .. 1 + (i % 4) loop
          select p.id, p.unit into prep
            from _preps p where p.n = (i * 13 + k * 29) % n_preps;

          insert into public.production_records
            (plan_id, sub_recipe_id, batches, unit, occurred_at, produced_by_email)
          values (
            plan,
            prep.id,
            -- Quarter-batch granularity: a cook who made three quarters of a
            -- batch should be able to say so, and 0060 allows it.
            0.5 + 0.25 * ((i + k) % 7),
            prep.unit,
            /*
             * Built in UTC explicitly rather than from the session clock, so
             * the date the report groups on is the same on a laptop in
             * Denpasar and in the CI container.
             *
             * One plan in eleven is prepped the night before. That is the
             * case `production_report` joins on the plan rather than the date
             * for, and the row that turns red if it ever stops doing so.
             */
            (case when i % 11 = 2
                  then (d - 1)::timestamp + interval '21 hours'
                  else d::timestamp + interval '7 hours'
             end + (k * interval '45 minutes')) at time zone 'UTC',
            cooks[1 + ((i + k) % array_length(cooks, 1))]
          );
          n_records := n_records + 1;
        end loop;
      end if;
    end loop;

    /*
     * And the improvised half: a batch made because something ran out
     * mid-service, with no sheet behind it. 0060 allows a null plan on
     * purpose, and the report keeps these rather than dropping them — if it
     * dropped them it would agree with the plan by construction.
     */
    if i % 6 = 1 then
      for k in 0 .. (i % 2) loop
        select p.id, p.unit into prep
          from _preps p where p.n = (i * 31 + k * 43) % n_preps;

        insert into public.production_records
          (plan_id, sub_recipe_id, batches, unit, occurred_at, produced_by_email)
        values (
          null, prep.id, 0.5 + 0.25 * (i % 5), prep.unit,
          (d::timestamp + interval '19 hours' + (k * interval '30 minutes'))
            at time zone 'UTC',
          cooks[1 + ((i + k) % array_length(cooks, 1))]
        );
        n_loose := n_loose + 1;
      end loop;
    end if;
  end loop;

  /*
   * Corrections, last, over the records that now exist.
   *
   * The cursor's query is evaluated before the first insert, so the rows
   * added inside the loop are not themselves candidates — a correction of a
   * correction would be legal under 0060's one-successor index but is not
   * what this is demonstrating.
   */
  for rec in
    select r.id, r.plan_id, r.sub_recipe_id, r.batches, r.unit,
           r.occurred_at, r.produced_by_email
      from public.production_records r
     where r.org_id = org and r.corrects_id is null
     order by r.occurred_at, r.id
  loop
    seen := seen + 1;
    if seen % 23 = 5 then
      insert into public.production_records
        (plan_id, sub_recipe_id, batches, unit, occurred_at,
         produced_by_email, corrects_id, correction_reason)
      values (
        rec.plan_id, rec.sub_recipe_id,
        greatest(0.25, rec.batches - 0.5),
        rec.unit,
        rec.occurred_at + interval '3 hours',
        rec.produced_by_email,
        rec.id,
        'Counted the second tray twice when writing the sheet up.'
      );
      n_corrections := n_corrections + 1;
    end if;
  end loop;

  select count(*) into n from public.production_records where org_id = org;

  raise notice 'Production: % plans (% with no dishes), % plan lines', n_plans,
    (select count(*) from public.production_plans p
      where p.org_id = org
        and not exists (select 1 from public.production_plan_lines l
                         where l.plan_id = p.id)),
    n_lines;
  raise notice 'Production: % batches against a plan, % with none, % corrections',
    n_records, n_loose, n_corrections;
  raise notice 'Production: % services planned and not cooked for; % records in all',
    n_barren, n;
end $$;
