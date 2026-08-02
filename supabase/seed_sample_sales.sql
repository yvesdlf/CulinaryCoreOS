-- ---------------------------------------------------------------------------
-- Sample sales, for exercising menu engineering before the venue trades
-- ---------------------------------------------------------------------------
-- Manuza is not open, so there is no POS and no sales history. Menu
-- engineering cannot be seen working without units sold per dish, so these are
-- invented.
--
-- Every period is marked SAMPLE, and the page says so in as many words. The
-- point of the flag is that the day a real export arrives, nobody has to
-- wonder which of these months were real.
--
-- The shape is deliberate rather than random: category decides appetite, price
-- suppresses volume, each dish takes a stable personality from its id so the
-- same dishes stay favourites across all three months, and the season climbs
-- into June. Uniform noise would put every dish on the popularity line at once
-- and the four quadrants would be meaningless.
--
-- Safe to re-run: it removes its own periods first and leaves imports alone.
-- ---------------------------------------------------------------------------

delete from sales_periods where source = 'SAMPLE';

do $$
declare
  org uuid;
  p_id uuid;
  m record;
  r record;
  appetite numeric;
  base numeric;
  units numeric;
begin
  select id into org from organizations order by created_at limit 1;
  if org is null then
    raise notice 'no organization; nothing seeded';
    return;
  end if;

  for m in
    select * from (values
      ('April 2025', date '2025-04-01', date '2025-04-30', 1.00),
      ('May 2025',   date '2025-05-01', date '2025-05-31', 1.18),
      ('June 2025',  date '2025-06-01', date '2025-06-30', 1.35)
    ) as t(nm, s, e, season)
  loop
    insert into sales_periods (org_id, name, starts_on, ends_on, source, actor_email)
      values (org, m.nm, m.s, m.e, 'SAMPLE', 'sample-data@culinarycore.local')
      returning id into p_id;

    for r in select id, name, category, menu_price from recipes where menu_price > 0 loop
      -- Roughly how many covers a month a typical dish in this category takes.
      appetite := case r.category
        when 'Starters' then 190 when 'Sides' then 150 when 'Dips' then 120
        when 'Salads' then 95    when 'Desserts' then 130 when 'Sunset Menu' then 85
        when 'Crudos' then 70    when 'Maki' then 60     when 'Nigiri' then 55
        when 'Pasta' then 45     when 'Main Seafood' then 40 when 'Main Meat' then 38
        when 'Sashimi' then 35   when 'Sharing Platter' then 14
        when 'Caviar Menu' then 8 when 'Signature' then 25 else 30 end;

      base := appetite
              -- Stable per dish, so a favourite stays a favourite.
              * (1 + 0.6 * (('x' || substr(md5(r.id::text), 1, 8))::bit(32)::bigint % 1000) / 1000.0)
              -- Expensive plates sell fewer, within limits.
              * greatest(0.25, least(1.6, 400000 / greatest(r.menu_price, 30000)))
              * m.season;

      units := round(greatest(0, base
               * (0.8 + 0.4 * (('x' || substr(md5(r.id::text || m.nm), 1, 8))::bit(32)::bigint % 1000) / 1000.0)));

      if units > 0 then
        -- Net of the discounting any venue does; menu price excludes tax.
        insert into sales_lines (org_id, period_id, recipe_id, units_sold, net_sales)
          values (org, p_id, r.id, units, round(units * r.menu_price * 0.94, 2));
      end if;
    end loop;
  end loop;
end $$;
