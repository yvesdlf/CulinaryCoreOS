-- ---------------------------------------------------------------------------
-- Sample takings, so the revenue side of the app has something to stand on
-- ---------------------------------------------------------------------------
-- The platform has known what everything costs since its first migration and
-- has known what anything earned since 0065 — but nothing has ever put a
-- figure in `daily_takings`, so four screens built on it have only ever been
-- seen empty: `revenue_daily`, `labour_cost_daily` against revenue,
-- `unit_profit_daily`, and now the sales forecast, which cannot produce a
-- number at all without a weekday to average.
--
-- Shaped rather than random, and the shape is the point. The forecast's whole
-- method is "the same weekday, averaged", so a venue whose Saturdays look
-- like its Tuesdays would make the method look pointless while proving
-- nothing. Here Friday and Saturday carry roughly twice a Monday, each unit
-- has its own level, and the figure drifts slowly upward over the ten weeks.
--
-- Deterministic: every figure comes from the date and the unit code, so
-- re-running produces the same history rather than a different one.
--
-- Marked `SAMPLE` in `source`, like the sample sales periods beside it, so
-- that the day a real till export arrives nobody has to wonder which weeks
-- were invented. Safe to re-run: it removes its own rows first and leaves
-- anything entered by hand alone.
-- ---------------------------------------------------------------------------

delete from daily_takings where source = 'SAMPLE';

do $$
declare
  org uuid;
  unit record;
  chan_till uuid;
  chan_delivery uuid;
  d date;
  dow integer;
  /* A weekday multiplier. Monday is quiet, the weekend is not. */
  weekday numeric;
  level numeric;
  drift numeric;
  base_covers numeric;
  covers integer;
  spend numeric;
begin
  select id into org from public.organizations where name = 'Demo Kitchen' limit 1;
  if org is null then
    raise notice 'No Demo Kitchen; nothing seeded.';
    return;
  end if;

  select id into chan_till from public.revenue_channels
   where org_id = org and code = 'TILL';
  select id into chan_delivery from public.revenue_channels
   where org_id = org and code = 'DELIVERY';

  for unit in
    select id, code, name from public.business_units
     where org_id = org and active
       /*
        * The outlets that actually serve somebody. Administration and
        * Housekeeping are cost centres: a spend per cover against
        * Housekeeping is not a small inaccuracy, it is a category error, and
        * it would appear on the revenue report looking like a figure.
        *
        * Named rather than excluded by a rule, because there is no column
        * that says "this unit sells to the public" — adding one to make this
        * seed tidier would be a schema change for a demo's benefit.
        */
       and code in ('KITCHEN', 'BAR', 'FOH')
     order by code
  loop
    /* A level per unit, from the code, so the Bar is not the Kitchen. */
    level := 0.6 + (abs(hashtext(unit.code)) % 70) / 100.0;

    for i in reverse 70 .. 1 loop
      d := current_date - i;
      dow := extract(dow from d);          -- 0 = Sunday
      weekday := case dow
        when 1 then 0.75   -- Monday
        when 2 then 0.80
        when 3 then 0.90
        when 4 then 1.00
        when 5 then 1.45   -- Friday
        when 6 then 1.60   -- Saturday
        else 1.10          -- Sunday lunch
      end;
      -- Ten weeks of slow growth, so a trend exists to be noticed. The
      -- forecast deliberately does not model it, and six weeks of sample is
      -- short enough that it does not need to.
      drift := 1 + (70 - i) * 0.0015;

      base_covers := 95 * level * weekday * drift;
      -- A little variation that is still the same every run: a venue whose
      -- Tuesdays are identical to five decimal places teaches nothing about
      -- how much evidence three days is.
      covers := round(base_covers * (1 + ((abs(hashtext(unit.code || d::text)) % 13) - 6) / 100.0));

      -- Spend per cover, in rupiah. The Bar's is lower than the Kitchen's for
      -- the same reason it is everywhere.
      spend := 145000 * (0.75 + (abs(hashtext(unit.code || 'spend')) % 50) / 100.0);

      insert into public.daily_takings
        (org_id, business_unit_id, channel_id, on_date, gross_amount, covers,
         source, recorded_by_email, note)
      values (org, unit.id, chan_till, d,
              round(covers * spend), covers, 'SAMPLE',
              'demo@culinarycore.local', 'Sample history');

      /*
       * Delivery, on the kitchen only, and only four days a week. This is the
       * fixture that matters: a second channel on some days and not others is
       * what separates "average the days" from "average the rows", and the
       * first draft of `build_sales_forecast` got that wrong in a way no
       * figure on screen would have shown.
       */
      if chan_delivery is not null and unit.code = 'KITCHEN' and dow in (4, 5, 6, 0) then
        insert into public.daily_takings
          (org_id, business_unit_id, channel_id, on_date, gross_amount,
           commission_amount, covers, source, recorded_by_email, note)
        values (org, unit.id, chan_delivery, d,
                round(covers * spend * 0.22),
                round(covers * spend * 0.22 * 0.25),   -- the platform's cut
                round(covers * 0.18), 'SAMPLE',
                'demo@culinarycore.local', 'Sample history');
      end if;
    end loop;
  end loop;
end $$;

/*
 * One event and the forecasts that follow from it.
 *
 * The forecast is built by calling `build_sales_forecast` rather than by
 * inserting rows that look like its output. The arithmetic is four lines and
 * that is exactly why a copy of it here would be tempting — and a copy is the
 * one that drifts, which is the whole reason the method lives in the database.
 *
 * The function asks who is calling, per outlet, so the seed signs in as the
 * venue's owner for the duration of the transaction. `set_config` with
 * `is_local` true means the claim does not outlive this file.
 */
do $$
declare
  org uuid;
  kitchen uuid;
  d date;
begin
  select id into org from public.organizations where name = 'Demo Kitchen' limit 1;
  if org is null then return; end if;

  select id into kitchen from public.business_units
   where org_id = org and code = 'KITCHEN';

  delete from public.known_events where note = 'Sample';

  /*
   * Clear what this seed made before remaking it.
   *
   * `build_sales_forecast` upserts, and an outlet with no history is skipped
   * rather than cleared — so narrowing which outlets get takings left
   * forecasts behind for Housekeeping, built from takings that no longer
   * existed. Keyed on who made them, which the function stamps from the
   * session, so it removes this seed's own rows and not a figure somebody
   * built by hand.
   */
  delete from public.sales_forecasts
   where org_id = org and made_by_email = 'demo@culinarycore.local';

  insert into public.known_events
    (org_id, business_unit_id, on_date, name, covers_extra, note)
  values (org, kitchen, current_date + 5, 'Harding wedding', 90, 'Sample');

  perform set_config('request.jwt.claims',
    json_build_object(
      'sub', '11111111-1111-4111-8111-111111111111',
      'email', 'demo@culinarycore.local',
      'role', 'authenticated')::text, true);

  -- The coming week, plus the last few days so there is something to measure
  -- the method against rather than only something to trust.
  for i in -4 .. 7 loop
    d := current_date + i;
    perform public.build_sales_forecast(org, d, null);
  end loop;

  perform set_config('request.jwt.claims', '', true);
end $$;

/*
 * What actually happened, on the days that have already passed.
 *
 * Read out of the takings rather than invented, so the accuracy figures on
 * screen are the real distance between this method and this history. Left
 * null for the future, which is what null means here.
 */
update sales_forecasts f
   set actual_covers = a.covers,
       actual_net_sales = a.net
  from (
    select t.business_unit_id, t.on_date,
           sum(t.covers) as covers, sum(t.net_amount) as net
      from daily_takings t
     where t.source = 'SAMPLE'
     group by t.business_unit_id, t.on_date
  ) a
 where a.business_unit_id = f.business_unit_id
   and a.on_date = f.forecast_for
   and f.forecast_for <= current_date;
