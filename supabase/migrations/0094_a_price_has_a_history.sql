-- ---------------------------------------------------------------------------
-- A supplier price has a history
-- ---------------------------------------------------------------------------
-- `product_suppliers` holds one `pack_price` and one `price_updated_on`, both
-- overwritten on every change. So there is no price chart, no way to see
-- what a product cost in March, and nothing can notice that a price has
-- moved — because by the time anything looks, the old figure is gone.
--
-- That also quietly weakens costing. Every recipe is costed at today's
-- price, and a dish that was profitable all year because beef was cheap
-- until August reads as having always been what it is now.
--
-- So prices append, like every other ledger here (`AGENTS.md` §4):
-- `supplier_prices` has no update or delete grant, a correction is a new row
-- with a reason, and `product_suppliers` keeps the current figure as a cache
-- the trigger below maintains.
--
-- The alert is the second half and it is the reason the briefs ask for this.
-- A supplier moving a staple by fifteen percent is the single most common
-- way a food cost target is missed, and nobody finds out until the month is
-- closed. The threshold is a venue parameter rather than a constant, because
-- five percent on beef and five percent on truffle are different
-- conversations.
-- ---------------------------------------------------------------------------

alter type notification_kind add value if not exists 'PRICE_MOVED';

create table if not exists supplier_prices (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  product_supplier_id uuid not null
    references product_suppliers(id) on delete cascade,

  /*
   * The pack as well as the price.
   *
   * A supplier who moves from a 5 kg box to a 4 kg box at the same price has
   * raised it by a quarter, and a history that recorded only the price would
   * show a flat line. Both are snapshotted so a later reader can see which
   * of the two moved.
   */
  pack_price numeric(18,5) not null,
  pack_qty numeric(18,5),
  pack_unit text,
  price_per_unit numeric(18,5),
  currency text,

  valid_from date not null default current_date,
  source text not null default 'manual',
  note text,
  recorded_by_email text,
  created_at timestamptz not null default now(),

  constraint supplier_prices_positive check (pack_price >= 0),
  constraint supplier_prices_source
    check (source in ('manual', 'invoice', 'quote', 'import', 'contract'))
);

create index if not exists idx_supplier_prices_line
  on supplier_prices(product_supplier_id, valid_from desc, created_at desc);

create or replace function public.set_supplier_price_org()
returns trigger language plpgsql security definer set search_path = '' as $$
declare parent record;
begin
  select ps.org_id, ps.pack_qty, ps.pack_unit into parent
    from public.product_suppliers ps where ps.id = new.product_supplier_id;
  if parent.org_id is null then
    raise exception 'the supplier product this price belongs to does not exist';
  end if;
  new.org_id := parent.org_id;

  -- Fall back to the pack currently on record, so the common case — a new
  -- price for the same pack — does not have to repeat it.
  new.pack_qty  := coalesce(new.pack_qty, parent.pack_qty);
  new.pack_unit := coalesce(new.pack_unit, parent.pack_unit);
  if new.price_per_unit is null and new.pack_qty is not null and new.pack_qty <> 0 then
    new.price_per_unit := new.pack_price / new.pack_qty;
  end if;
  if auth.uid() is not null then
    new.recorded_by_email := auth.jwt() ->> 'email';
  end if;
  return new;
end $$;

drop trigger if exists supplier_prices_set_org on supplier_prices;
create trigger supplier_prices_set_org before insert on supplier_prices
  for each row execute function public.set_supplier_price_org();

/*
 * Keep the cache current, and say something when the move is large.
 *
 * `product_suppliers.pack_price` stays the current price because three
 * hundred policies, several views and the whole ordering surface read it;
 * turning every one of those into "the latest row of a history" is a change
 * of its own. The history is the truth, this is the index.
 *
 * Only a row that is actually the newest updates the cache — backfilling
 * last March's price must not overwrite today's.
 */
create or replace function public.apply_supplier_price()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  previous numeric;
  threshold numeric;
  moved numeric;
  newest boolean;
  label text;
begin
  select (new.valid_from >= coalesce(max(p.valid_from), new.valid_from))
    into newest
    from public.supplier_prices p
   where p.product_supplier_id = new.product_supplier_id
     and p.id <> new.id;

  if not coalesce(newest, true) then
    return new;                      -- A backfill. History only.
  end if;

  select ps.price_per_unit into previous
    from public.product_suppliers ps where ps.id = new.product_supplier_id;

  update public.product_suppliers
     set pack_price = new.pack_price,
         pack_qty = coalesce(new.pack_qty, pack_qty),
         pack_unit = coalesce(new.pack_unit, pack_unit),
         price_per_unit = new.price_per_unit,
         price_updated_on = new.valid_from,
         updated_at = now()
   where id = new.product_supplier_id;

  if previous is null or previous = 0 or new.price_per_unit is null then
    return new;                      -- Nothing to compare against.
  end if;

  select v.value into threshold
    from public.venue_parameters v
   where v.org_id = new.org_id and v.code = 'PRICE_MOVE_ALERT';
  threshold := coalesce(threshold, 5);

  moved := round((new.price_per_unit - previous) / previous * 100, 1);

  if abs(moved) >= threshold then
    select coalesce(p.name, 'a product') || ' from ' || coalesce(s.name, 'a supplier')
      into label
      from public.product_suppliers ps
      left join public.products p  on p.id = ps.product_id
      left join public.suppliers s on s.id = ps.supplier_id
     where ps.id = new.product_supplier_id;

    perform public.notify(
      new.org_id,
      'PRICE_MOVED'::public.notification_kind,
      case when moved > 0 then 'Price up ' else 'Price down ' end
        || abs(moved) || '% — ' || label,
      label || ' moved from ' || previous || ' to ' || new.price_per_unit
        || ' per unit, ' || moved || '%. Dishes using it have been re-costed.',
      'CHEF'::public.org_role,
      null,
      'product_suppliers',
      new.product_supplier_id);
  end if;

  return new;
end $$;

drop trigger if exists supplier_prices_apply on supplier_prices;
create trigger supplier_prices_apply after insert on supplier_prices
  for each row execute function public.apply_supplier_price();

/*
 * The threshold, as a seeder of its own.
 *
 * Not appended to `seed_venue_parameters`' VALUES list: five migrations
 * rewrote `seed_organization_defaults` that way and the fifth dropped the
 * fourth's line, which is why `organization_seeders` is a registry
 * (`AGENTS.md` §2 and §6). A migration that wants a new default registers a
 * function; it does not edit somebody else's.
 */
create or replace function public.seed_price_alert_parameter(p_org uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.venue_parameters
    (org_id, code, name, description, value, unit, min_value, max_value)
  values (p_org, 'PRICE_MOVE_ALERT', 'Price move alert',
          'How far a supplier price must move before anybody is told.',
          5, 'percent', 0.5, 100)
  on conflict (org_id, code) do nothing;
end $$;

/*
 * Not callable by a signed-in user.
 *
 * Every other seeder is revoked and 23_exposure.sql checks it; this one was
 * not, and that check went red within the minute of the first full run. A
 * seeder is security definer and writes defaults into a venue — left
 * executable it is a way for any member to put rows into a table their
 * section does not let them touch.
 */
revoke all on function public.seed_price_alert_parameter(uuid)
  from public, anon, authenticated;

insert into public.organization_seeders (ordinal, function_name, note)
select coalesce(max(ordinal), 0) + 1, 'seed_price_alert_parameter',
       'How far a supplier price must move before anybody is told (0094)'
  from public.organization_seeders
on conflict (function_name) do nothing;

-- And for the venues that already exist, since a seeder only fires on
-- creation. This is the half that AGENTS.md §6 says is always forgotten.
do $$
declare o record;
begin
  for o in select id from public.organizations loop
    perform public.seed_price_alert_parameter(o.id);
  end loop;
end $$;

alter table supplier_prices enable row level security;

drop policy if exists supplier_prices_read on supplier_prices;
create policy supplier_prices_read on supplier_prices for select to authenticated
  using (public.can_read_section('SUPPLIERS', org_id));
drop policy if exists supplier_prices_insert on supplier_prices;
create policy supplier_prices_insert on supplier_prices for insert to authenticated
  with check (public.auth_can_write(org_id));

-- Select and insert only. A price that was charged was charged; a correction
-- is a new row saying so.
grant select, insert on supplier_prices to authenticated;

drop trigger if exists supplier_prices_section_guard on supplier_prices;
create trigger supplier_prices_section_guard
  before insert or update or delete on supplier_prices
  for each row execute function public.require_section_write('SUPPLIERS');

delete from public.section_read_rules where table_name = 'supplier_prices';
insert into public.section_read_rules (table_name, section_code)
values ('supplier_prices', 'SUPPLIERS');

/*
 * The chart, with the step between each price and the one before it.
 *
 * `lag` over the history rather than a stored delta, so a backfilled row
 * recomputes the neighbours it sits between instead of leaving a figure that
 * was true when it was written and is not now.
 */
create or replace view supplier_price_history
with (security_invoker = true) as
  select
    sp.org_id,
    sp.product_supplier_id,
    ps.product_id,
    p.name                      as product_name,
    ps.supplier_id,
    s.name                      as supplier_name,
    sp.id                       as price_id,
    sp.valid_from,
    sp.pack_price,
    sp.pack_qty,
    sp.pack_unit,
    sp.price_per_unit,
    sp.source,
    sp.note,
    lag(sp.price_per_unit) over w                       as previous_per_unit,
    (sp.price_per_unit - lag(sp.price_per_unit) over w)::numeric(18,5)
                                                        as moved_by,
    case when lag(sp.price_per_unit) over w > 0
         then round((sp.price_per_unit - lag(sp.price_per_unit) over w)
                    / lag(sp.price_per_unit) over w * 100, 1)
    end                                                 as moved_percent
  from public.supplier_prices sp
  join public.product_suppliers ps on ps.id = sp.product_supplier_id
  left join public.products p  on p.id = ps.product_id
  left join public.suppliers s on s.id = ps.supplier_id
  window w as (partition by sp.product_supplier_id
               order by sp.valid_from, sp.created_at);

grant select on supplier_price_history to authenticated;

comment on table supplier_prices is
  'Every price a supplier has charged, append-only. product_suppliers keeps the latest as a cache. See 0094.';
comment on view supplier_price_history is
  'A supplier price over time with the step between each, recomputed rather than stored. See 0094.';
