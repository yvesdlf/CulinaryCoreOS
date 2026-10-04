-- ---------------------------------------------------------------------------
-- What a department actually made
-- ---------------------------------------------------------------------------
-- Gap 22, the part of it the roadmap says Stage 4 delivers: profit per
-- department. The other two parts of that gap — recording payments against
-- supplier invoices, and an export to an accounting package — are not here, and
-- the last section of this file says so rather than leaving it to be noticed.
--
-- Three of the four numbers already exist. 0064 gave the platform what an hour
-- of work costs. 0065 gave it what a day earned, per department per channel.
-- The catalogue has known what everything costs since the first migration. The
-- missing join is the fourth: **which department consumed the stock.**
--
-- ## A movement happens somewhere
--
-- `stock_movements` has carried a product, a quantity, a cost, a lot and a
-- production record, and nothing about whose stock it was. So "what did the bar
-- spend on stock" has the same shape as the question 0058 was written to
-- answer, one table further down.
--
-- One nullable column. Null means nobody said — which is every movement
-- written before today, and is **not** redistributed, averaged or assigned to
-- the largest department. It is counted in its own column and shown. A margin
-- that quietly spreads unattributed cost across departments is a margin that is
-- wrong for every one of them and right in total, which is the most expensive
-- kind of wrong: it survives a check against the venue's own accounts.
--
-- ## Not a margin until it says what is in it
--
-- 0065 built `unit_labour_against_revenue` and refused to call it a margin,
-- because cost of goods was not in it. This adds the third number, and the view
-- below still does not say "profit" without qualification: it carries revenue,
-- labour, attributed cost of goods and the unattributed remainder as four
-- columns, and `gross_profit` is explicitly revenue less labour less
-- *attributed* goods. A venue with half its movements unattributed sees that in
-- the column beside it rather than in a figure that looks finished.
-- ---------------------------------------------------------------------------

alter table stock_movements
  add column if not exists business_unit_id uuid
    references business_units(id) on delete set null;

comment on column stock_movements.business_unit_id is
  'Whose stock it was. Null means nobody said, and is counted apart rather than spread across departments.';

create index if not exists idx_stock_movements_unit
  on stock_movements(business_unit_id, occurred_at desc)
  where business_unit_id is not null;

/*
 * A movement cannot name another venue's department.
 *
 * The foreign key says the department exists; it does not say it belongs here,
 * and `org_id` on the row would still read correctly. The same check 0058
 * wrote for eleven other tables, which is why it is one function call.
 */
create or replace function public.enforce_stock_movement_unit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.business_unit_id is not null
     and not public.business_unit_in_org(new.business_unit_id, new.org_id)
  then
    raise exception 'that department belongs to another organisation';
  end if;
  return new;
end;
$$;

create trigger stock_movements_unit
  before insert or update on stock_movements
  for each row execute function public.enforce_stock_movement_unit();

-- ── What it cost, per department per day ────────────────────────────────────

/*
 * Cost of goods: what left the shelf, at what it was worth.
 *
 * USAGE and WASTE, both of which are stock the venue no longer has and cannot
 * sell. RETURN is excluded because it goes back to the supplier and is
 * recovered; TRANSFER is excluded because it is still the venue's, in another
 * room; COUNT is an adjustment to the figure rather than a consumption of it,
 * and including it would double-count every discrepancy the counting was done
 * to find.
 *
 * `-quantity` because the ledger holds the sign: stock going out is negative,
 * and a cost of goods expressed as a negative number is a line nobody reads
 * correctly at the bottom of a report.
 */
create or replace view cost_of_goods_daily with (security_invoker = true) as
  /*
   * Rounded to five places, which is this schema's money. A quantity and a
   * unit cost are both numeric(18,5), so their product carries ten decimals
   * and every figure built on it inherits them — a cost of goods reported to
   * a ten-thousandth of a rupiah is noise that makes a report look like a
   * calculation nobody checked.
   */
  select
    m.org_id,
    m.business_unit_id,
    (m.occurred_at at time zone 'UTC')::date as on_date,
    round(sum((-m.quantity) * coalesce(m.unit_cost, 0))
          filter (where m.kind = 'USAGE'), 5)::numeric(18,5) as used_cost,
    round(sum((-m.quantity) * coalesce(m.unit_cost, 0))
          filter (where m.kind = 'WASTE'), 5)::numeric(18,5) as wasted_cost,
    round(sum((-m.quantity) * coalesce(m.unit_cost, 0)), 5)::numeric(18,5) as total_cost,
    count(*) filter (where m.unit_cost is null) as movements_with_no_cost
  from public.stock_movements m
  where m.kind in ('USAGE', 'WASTE')
    and m.quantity < 0
  group by m.org_id, m.business_unit_id, (m.occurred_at at time zone 'UTC')::date;

grant select on cost_of_goods_daily to authenticated;

/*
 * The four numbers in one line, and the fifth that says how much to trust it.
 *
 * Needs Pay, for the same reason `unit_labour_against_revenue` does and with
 * the same consequence: without it there is no row rather than a row with a
 * blank where the labour is. A report that lists every department and costs
 * none of them reads as a fact rather than as a refusal.
 *
 * `gross_profit` is revenue less labour less *attributed* cost of goods, and is
 * not called margin, profit before tax, or anything else that implies the rest
 * of a profit and loss. Rent, utilities, depreciation, finance and tax are not
 * in this platform; a venue reading this as its bottom line would be reading it
 * as something it is not, and the name is the only defence against that.
 */
create or replace view unit_profit_daily with (security_invoker = true) as
  with days as (
    select distinct business_unit_id, on_date from public.daily_takings
    union
    select distinct business_unit_id, on_date from public.labour_cost_daily
    union
    select distinct business_unit_id, on_date from public.cost_of_goods_daily
     where business_unit_id is not null
  ),
  revenue as (
    select business_unit_id, on_date,
           sum(gross_amount) as gross, sum(net_amount) as net, sum(covers) as covers
      from public.daily_takings group by 1, 2
  ),
  labour as (
    select business_unit_id, on_date, sum(cost) as cost, sum(hours) as hours
      from public.labour_cost_daily group by 1, 2
  ),
  goods as (
    select business_unit_id, on_date, sum(total_cost) as cost, sum(wasted_cost) as waste
      from public.cost_of_goods_daily where business_unit_id is not null group by 1, 2
  )
  select
    b.org_id,
    b.id as business_unit_id,
    b.code as unit_code,
    b.name as unit_name,
    d.on_date,
    r.gross as revenue_gross,
    r.net as revenue_net,
    r.covers,
    l.hours as labour_hours,
    l.cost as labour_cost,
    g.cost as goods_cost,
    g.waste as waste_cost,
    (coalesce(r.net, 0) - coalesce(l.cost, 0) - coalesce(g.cost, 0))::numeric(18,5)
      as gross_profit,
    case when coalesce(r.net, 0) > 0
         then round(100 * (coalesce(r.net, 0) - coalesce(l.cost, 0) - coalesce(g.cost, 0))
                        / r.net, 2) end as gross_profit_percent,
    /*
     * How much of the venue's stock cost that day could not be put to any
     * department. Repeated on every unit's row on purpose: it is a property of
     * the day, and a reader looking at one department has to see that the
     * figure in front of them is missing something.
     */
    (select sum(c.total_cost)::numeric(18,5) from public.cost_of_goods_daily c
      where c.org_id = b.org_id and c.on_date = d.on_date
        and c.business_unit_id is null) as unattributed_goods_cost
  from days d
  join public.business_units b on b.id = d.business_unit_id
  left join revenue r on r.business_unit_id = b.id and r.on_date = d.on_date
  left join labour l on l.business_unit_id = b.id and l.on_date = d.on_date
  left join goods g on g.business_unit_id = b.id and g.on_date = d.on_date
  where public.can_read_section('PAY', b.org_id, null::uuid);

grant select on unit_profit_daily to authenticated;

-- ── An export, rather than an accounting package ────────────────────────────
/*
 * Gap 22 says "an export to an accounting package rather than building an
 * accounting package", and that distinction is the whole of this section.
 *
 * One row per department per day with the four figures, in the shape a journal
 * import wants: a date, a cost-centre code, an account label and an amount.
 * Nothing here posts, balances, or knows what a nominal ledger is — a venue's
 * accountant maps the four labels to their own chart of accounts once, and the
 * platform stops at the boundary where it would otherwise have to become a
 * second accounting system that disagrees with the first.
 *
 * Revenue is the **net**, because that is what the venue banked and what the
 * bank statement will show. The commission a delivery platform withheld is its
 * own line, so the two reconcile to the gross without anybody subtracting.
 */
create or replace view accounting_export with (security_invoker = true) as
  select on_date, unit_code, account, amount, org_id from (
    select t.org_id, t.on_date, b.code as unit_code,
           'REVENUE' as account, sum(t.net_amount) as amount
      from public.daily_takings t join public.business_units b on b.id = t.business_unit_id
     group by 1, 2, 3
    union all
    select t.org_id, t.on_date, b.code,
           'CHANNEL_COMMISSION', sum(coalesce(t.commission_amount, 0))
      from public.daily_takings t join public.business_units b on b.id = t.business_unit_id
     group by 1, 2, 3 having sum(coalesce(t.commission_amount, 0)) <> 0
    union all
    select c.org_id, c.on_date, coalesce(b.code, 'UNALLOCATED'),
           'COST_OF_GOODS', sum(c.used_cost)::numeric(18,5)
      from public.cost_of_goods_daily c
      left join public.business_units b on b.id = c.business_unit_id
     group by 1, 2, 3 having sum(c.used_cost) <> 0
    union all
    select c.org_id, c.on_date, coalesce(b.code, 'UNALLOCATED'),
           'WASTE', sum(c.wasted_cost)::numeric(18,5)
      from public.cost_of_goods_daily c
      left join public.business_units b on b.id = c.business_unit_id
     group by 1, 2, 3 having sum(c.wasted_cost) <> 0
    union all
    select l.org_id, l.on_date, b.code, 'LABOUR', sum(l.cost)
      from public.labour_cost_daily l
      join public.business_units b on b.id = l.business_unit_id
     group by 1, 2, 3
  ) x
  where x.amount is not null;

grant select on accounting_export to authenticated;

comment on view cost_of_goods_daily is
  'What left the shelf and could not be sold, at what it was worth. Returns and transfers are not consumption.';
comment on view unit_profit_daily is
  'Revenue, labour and goods per department per day. Gross profit only — rent, utilities and tax are not in this platform.';
comment on view accounting_export is
  'One line per department per day per account, for a journal import. Nothing here posts anything.';

-- ── What is deliberately not built ──────────────────────────────────────────
/*
 * **Payments against supplier invoices are not here.** Gap 22 lists them and
 * this does not do them: an invoice can be matched, approved and disputed, and
 * nothing records that it was paid. That is a real hole — a venue cannot answer
 * "what do we owe" from this platform — and it is a different piece of work
 * from this one, because a payment needs a bank account, a date, a method and a
 * reconciliation against a statement, none of which exist here yet.
 *
 * Recorded as an assertion in `20_profit.sql` rather than only as a comment, so
 * the day somebody builds it the suite fails and this paragraph has to go.
 */
