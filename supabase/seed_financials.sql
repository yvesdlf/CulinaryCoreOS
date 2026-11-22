-- ---------------------------------------------------------------------------
-- The cost side of the P&L: what the staff were paid, and when they worked
-- ---------------------------------------------------------------------------
-- The demo has revenue and no costs: 250 takings over seventy dates, but no
-- clock-ins and no pay rates, so `labour_cost_daily` is empty and every
-- financial report — labour against revenue, profit by outlet, the new
-- dashboard comparison — reads 100% margin. The reporting is correct; the
-- demo never exercised the cost side.
--
-- This seeds the labour half, which is clean arithmetic: a pay rate per
-- person and a clock-in per working day, and `labour_cost_daily` does the
-- rest (hours from the clock, cost from `pay_rate_on`). The employees already
-- carry the business unit that earns the revenue — the kitchen brigade on
-- KITCHEN, the bar on BAR, the floor on FOH — so their labour lands against
-- the takings it belongs to and shows up in the per-outlet P&L, not just the
-- venue total.
--
-- ── Why not the goods half ────────────────────────────────────────────────
--
-- Cost of goods needs a cost *per stock unit* for each product consumed, and
-- the demo has a landed cost for nine of the three hundred and sixty-one
-- products sold — the rest were never received against a purchase order. The
-- catalogue price is in the buying unit, not the stock unit, so valuing usage
-- from it would be out by a pack size. Posting usage at a wrong cost would
-- make cost of goods and margin wrong, which is worse than leaving them thin.
-- The honest fix is either full receipts or the recipe-costing engine's
-- per-product conversion, and that is its own piece. Labour stands on its own
-- and is what payroll and productivity are built from.
--
-- Deterministic, not random. Safe to run more than once.
-- ---------------------------------------------------------------------------

do $$
declare
  org uuid;
  e record;
  d date;
  n_rates integer := 0;
  n_clocks integer := 0;
  rate numeric;
  start_h integer;
  shift_hours integer;
begin
  begin
    select id into strict org from public.organizations where name = 'Demo Kitchen';
  exception
    when no_data_found then
      raise exception 'no organisation called "Demo Kitchen"'
        using hint = 'Run seed.sql first.';
    when too_many_rows then
      raise exception 'more than one organisation is called "Demo Kitchen"';
  end;

  delete from public.time_entries where org_id = org and note = 'seed_financials';
  delete from public.pay_rates where org_id = org and note = 'seed_financials';

  -- ── A rate for everyone ─────────────────────────────────────────────────
  /*
   * Hourly, by role, in rupiah. These are plausible Bali wages rather than a
   * number reverse-engineered to hit a target labour percentage: the point of
   * the report is to show what the percentage actually is, not to make it come
   * out at thirty.
   */
  for e in
    select emp.id, coalesce(jr.title, '') as title
      from public.employees emp
      left join public.job_roles jr on jr.id = emp.job_role_id
     where emp.org_id = org
  loop
    rate := case e.title
      when 'General Manager'    then 150000
      when 'Executive Chef'     then 110000
      when 'Restaurant Manager' then 90000
      when 'Bar Manager'        then 90000
      when 'Sous Chef'          then 85000
      when 'Head Housekeeper'   then 70000
      when 'Chef de Partie'     then 65000
      when 'Bartender'          then 48000
      when 'Waiter'             then 42000
      when 'Commis Chef'        then 40000
      when 'Kitchen Porter'     then 30000
      when 'Room Attendant'     then 28000
      else 45000
    end;
    insert into public.pay_rates
      (org_id, employee_id, basis, amount, effective_from, note, set_by_email)
    values (org, e.id, 'HOURLY', rate, date '2026-01-01', 'seed_financials',
            'gm@venue.test');
    n_rates := n_rates + 1;
  end loop;

  -- ── A clock-in per working day, for the revenue brigades ────────────────
  /*
   * Only the staff whose business unit earns revenue — KITCHEN, BAR, FOH.
   * Housekeeping has a rate (for payroll) but no takings to attribute its
   * labour against, so clocking them in would add cost to an outlet that has
   * no revenue line and read as a loss that is really just the model: the
   * rooms side of the business is not in `daily_takings` at all.
   *
   * On every date the venue took money. Managers work the longer day.
   */
  for e in
    select emp.id, coalesce(jr.title, '') as title
      from public.employees emp
      left join public.job_roles jr on jr.id = emp.job_role_id
      join public.business_units b on b.id = emp.business_unit_id
     where emp.org_id = org
       and b.code in ('KITCHEN', 'BAR', 'FOH')
  loop
    shift_hours := case when e.title like '%Manager%' or e.title like '%Chef%'
                        then 9 else 8 end;
    for d in
      select distinct on_date from public.daily_takings
       where org_id = org order by on_date
    loop
      -- The kitchen starts before service, the floor with it.
      start_h := case when e.title like '%Chef%' then 10 else 12 end;
      insert into public.time_entries
        (org_id, employee_id, clock_in_at, clock_out_at, break_minutes,
         source, recorded_by_email, note)
      values (
        org, e.id,
        (d::timestamp + make_interval(hours => start_h)) at time zone 'UTC',
        (d::timestamp + make_interval(hours => start_h + shift_hours))
          at time zone 'UTC',
        30, 'MANAGER', 'gm@venue.test', 'seed_financials'
      );
      n_clocks := n_clocks + 1;
    end loop;
  end loop;

  raise notice 'Financials: % pay rates, % clock-ins over % trading days',
    n_rates, n_clocks,
    (select count(distinct on_date) from public.daily_takings where org_id = org);
  -- `labour_cost_daily` is not counted here: it filters on `can_read_section`,
  -- which is false for a sessionless seed, so it would always report nought.
  -- The labour is real and shows once somebody with Pay access reads it.
end $$;
