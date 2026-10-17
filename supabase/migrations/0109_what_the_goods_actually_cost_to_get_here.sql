-- ---------------------------------------------------------------------------
-- What the goods actually cost to get here
-- ---------------------------------------------------------------------------
-- Every cost in this system is the supplier's price and nothing else. Freight,
-- duty, clearance and handling are paid, and are invisible — so a product
-- landed at a 12% uplift is costed as though it arrived by itself, and every
-- recipe built on it is wrong by that amount in the direction that flatters.
--
-- Two things had to be true before this was possible and only one of them was.
--
-- A receipt line carried no price at all. The price lived on the purchase
-- order line, which is the right place for what was *ordered*, and nowhere for
-- what was *received* — so a delivery at a different price than the order had
-- nowhere to say so, and `recordGoodsReceipt` posted every stock movement with
-- a null cost. `unit_price` is on the line now, defaulted from the order line
-- when it is not given, and it is also what makes a value-based allocation
-- possible at all.
--
-- The second is the shape of the thing. A freight invoice arrives days after
-- the pallet, which means the uplift is a *later fact* about a receipt that
-- has already posted. Rewriting the movement's cost would be editing an
-- append-only ledger (AGENTS.md §4) and, worse, rewriting a figure a stock
-- valuation has already been run on. So the allocation is its own record and
-- the landed cost is a view over both, which is also the only way the two
-- figures stay separately legible: "we paid the supplier this, and it cost
-- that much more to get here" is the sentence somebody wants.
--
-- The basis is per charge and not per receipt, because the honest basis
-- differs by charge: duty follows value, a pallet charge follows weight, a
-- per-case handling fee follows quantity. Spreading freight by value makes
-- the expensive saffron carry the cost of moving the potatoes.
--
-- What this refuses to do is guess. A weight basis where a line has no weight
-- is refused rather than quietly falling back to value, and a value basis on
-- a receipt whose lines are all priced at zero is refused rather than spread
-- evenly: an even spread is not a cautious answer, it is a fabricated one
-- that looks exactly like a real allocation afterwards.
-- ---------------------------------------------------------------------------

do $$ begin
  create type charge_kind as enum
    ('FREIGHT', 'DUTY', 'INSURANCE', 'CLEARANCE', 'HANDLING', 'OTHER');
exception when duplicate_object then null; end $$;

do $$ begin
  create type charge_basis as enum ('VALUE', 'QUANTITY', 'WEIGHT');
exception when duplicate_object then null; end $$;

/*
 * What the line actually cost, as received.
 *
 * Nullable, because receipts written before this migration have no answer and
 * inventing one would be worse than the gap. `landed_cost_ready` below names
 * the receipts that cannot be costed, so the hole is visible rather than
 * silently zero.
 */
alter table goods_receipt_lines
  add column if not exists unit_price numeric(18,5);
alter table goods_receipt_lines
  add column if not exists line_weight_kg numeric(18,5);

do $$ begin
  alter table goods_receipt_lines
    add constraint goods_receipt_lines_price_sane
    check (unit_price is null or unit_price >= 0);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table goods_receipt_lines
    add constraint goods_receipt_lines_weight_sane
    check (line_weight_kg is null or line_weight_kg >= 0);
exception when duplicate_object then null; end $$;

/*
 * The price falls back to the order line when the receipt does not say.
 *
 * A delivery at the ordered price is the ordinary case and making somebody
 * retype it invites a typo in the one figure everything downstream is built
 * on. A delivery at a *different* price is the interesting case, and saying
 * so is then a deliberate act rather than the default.
 */
create or replace function public.default_receipt_line_price()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.unit_price is null and new.purchase_order_line_id is not null then
    select l.unit_price into new.unit_price
      from public.purchase_order_lines l
     where l.id = new.purchase_order_line_id;
  end if;
  return new;
end $$;

drop trigger if exists goods_receipt_lines_price on goods_receipt_lines;
create trigger goods_receipt_lines_price
  before insert on goods_receipt_lines
  for each row execute function public.default_receipt_line_price();

create table if not exists receipt_charges (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  goods_receipt_id uuid not null references goods_receipts(id) on delete cascade,

  kind charge_kind not null default 'FREIGHT',
  basis charge_basis not null default 'VALUE',
  amount numeric(18,5) not null,

  /* Who charged it, which is usually not the supplier of the goods. */
  supplier_id uuid references suppliers(id) on delete set null,
  invoice_reference text,
  note text,

  created_at timestamptz not null default now(),
  created_by_email text,

  constraint receipt_charges_amount check (amount >= 0)
);

create index if not exists idx_receipt_charges_receipt
  on receipt_charges(goods_receipt_id);

/*
 * The allocation itself, as rows.
 *
 * A table and not a calculation in a view, for the reason the whole file
 * exists: the allocation is a decision taken on a day, with a basis chosen by
 * a person, and recomputing it later against a receipt whose lines have since
 * been corrected would silently produce a different history. It is rewritten
 * only by re-running the allocation, which says so.
 */
create table if not exists receipt_line_charges (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  receipt_charge_id uuid not null references receipt_charges(id) on delete cascade,
  goods_receipt_line_id uuid not null references goods_receipt_lines(id) on delete cascade,

  amount numeric(18,5) not null,
  basis charge_basis not null,
  allocated_at timestamptz not null default now(),

  constraint receipt_line_charges_once
    unique (receipt_charge_id, goods_receipt_line_id)
);

create index if not exists idx_receipt_line_charges_line
  on receipt_line_charges(goods_receipt_line_id);

/*
 * Spread a receipt's charges across its lines.
 *
 * Returns how many lines were written, so "nothing to allocate" and "it
 * worked" are different answers to the caller.
 *
 * Rounding is the part worth reading. Allocating a charge proportionally and
 * rounding each share leaves a remainder — three lines sharing 100.00000 by
 * thirds is 33.33333 each and a hundred-thousandth short — and an allocation
 * that does not sum to the charge is a reconciliation somebody will spend an
 * afternoon on. The remainder goes to the largest share, which is both the
 * conventional treatment and the one where it is proportionally smallest.
 */
create or replace function public.allocate_receipt_charges(p_receipt uuid)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  the_org uuid;
  ch record;
  ln record;
  total_weight numeric;
  share numeric;
  running numeric;
  biggest uuid;
  written integer := 0;
begin
  select r.org_id into the_org from public.goods_receipts r where r.id = p_receipt;
  if the_org is null then
    raise exception 'there is no such goods receipt';
  end if;

  if not public.can_write_section('PURCHASING', the_org) then
    raise exception 'you do not have edit access to Purchasing'
      using errcode = '42501';
  end if;

  for ch in
    select * from public.receipt_charges c where c.goods_receipt_id = p_receipt
  loop
    /*
     * Only what became stock. Rejected goods went back on the van and will
     * come off the invoice as a credit; carrying freight on them would put
     * the cost of a crate the venue does not have onto the one it does.
     */
    create temporary table if not exists _alloc (
      line_id uuid, weight numeric
    ) on commit drop;
    delete from _alloc;

    insert into _alloc (line_id, weight)
    select l.id,
           case ch.basis
             when 'VALUE'    then (l.quantity_received - l.quantity_rejected) * l.unit_price
             when 'QUANTITY' then (l.quantity_received - l.quantity_rejected)
             when 'WEIGHT'   then l.line_weight_kg
           end
      from public.goods_receipt_lines l
     where l.goods_receipt_id = p_receipt
       and (l.quantity_received - l.quantity_rejected) > 0;

    if exists (select 1 from _alloc where weight is null) then
      raise exception
        'cannot spread % by %: at least one line has no % to spread it over',
        lower(ch.kind::text), lower(ch.basis::text),
        case ch.basis when 'VALUE' then 'price'
                      when 'WEIGHT' then 'weight'
                      else 'quantity' end
        using hint = 'Record the missing figure, or choose a basis the lines can carry.';
    end if;

    select coalesce(sum(weight), 0) into total_weight from _alloc;

    if total_weight = 0 then
      raise exception 'cannot spread % over a receipt whose lines total zero %',
        lower(ch.kind::text), lower(ch.basis::text)
        using hint = 'Spreading it evenly would invent a figure that reads like a real one.';
    end if;

    delete from public.receipt_line_charges
     where receipt_charge_id = ch.id;

    select line_id into biggest from _alloc order by weight desc, line_id limit 1;

    running := 0;
    for ln in select * from _alloc where line_id <> biggest loop
      share := round(ch.amount * ln.weight / total_weight, 5);
      running := running + share;
      insert into public.receipt_line_charges
        (org_id, receipt_charge_id, goods_receipt_line_id, amount, basis)
      values (the_org, ch.id, ln.line_id, share, ch.basis);
      written := written + 1;
    end loop;

    -- The remainder, so the parts sum to the whole exactly.
    insert into public.receipt_line_charges
      (org_id, receipt_charge_id, goods_receipt_line_id, amount, basis)
    values (the_org, ch.id, biggest, ch.amount - running, ch.basis);
    written := written + 1;
  end loop;

  return written;
end $$;

revoke all on function public.allocate_receipt_charges(uuid) from public;
grant execute on function public.allocate_receipt_charges(uuid) to authenticated;

/*
 * Re-spread whenever the charges change, so the two cannot drift.
 *
 * A charge added and never allocated is the failure this is guarding: the
 * receipt looks complete, the landed cost view silently reports the goods
 * price, and nothing anywhere says a figure is missing.
 */
create or replace function public.reallocate_after_charge_change()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  the_receipt uuid := coalesce(new.goods_receipt_id, old.goods_receipt_id);
begin
  /*
   * A receipt being deleted takes its charges with it, and this trigger then
   * fires for each one — for a receipt that is already gone. Without this
   * line `allocate_receipt_charges` raises "there is no such goods receipt"
   * and the delete is refused, which means a delivery with freight on it can
   * never be removed at all.
   *
   * Found by running the seed twice, which is the only reason it was found:
   * the first run has nothing to clean up.
   */
  if not exists (
    select 1 from public.goods_receipts r where r.id = the_receipt
  ) then
    return coalesce(new, old);
  end if;

  perform public.allocate_receipt_charges(the_receipt);
  return coalesce(new, old);
end $$;

drop trigger if exists zz_receipt_charges_reallocate on receipt_charges;
create trigger zz_receipt_charges_reallocate
  after insert or update or delete on receipt_charges
  for each row execute function public.reallocate_after_charge_change();

drop trigger if exists receipt_charges_set_org on receipt_charges;
create trigger receipt_charges_set_org before insert on receipt_charges
  for each row execute function public.set_org_id();
drop trigger if exists receipt_line_charges_set_org on receipt_line_charges;
create trigger receipt_line_charges_set_org before insert on receipt_line_charges
  for each row execute function public.set_org_id();

alter table receipt_charges enable row level security;
alter table receipt_line_charges enable row level security;

drop policy if exists receipt_charges_read on receipt_charges;
create policy receipt_charges_read on receipt_charges for select to authenticated
  using (public.can_read_section('PURCHASING', org_id));
drop policy if exists receipt_charges_write on receipt_charges;
create policy receipt_charges_write on receipt_charges for all to authenticated
  using (public.auth_can_write(org_id)
         and public.can_read_section('PURCHASING', org_id))
  with check (public.auth_can_write(org_id));

drop policy if exists receipt_line_charges_read on receipt_line_charges;
create policy receipt_line_charges_read on receipt_line_charges for select to authenticated
  using (public.can_read_section('PURCHASING', org_id));
drop policy if exists receipt_line_charges_write on receipt_line_charges;
create policy receipt_line_charges_write on receipt_line_charges for all to authenticated
  using (public.auth_can_write(org_id)
         and public.can_read_section('PURCHASING', org_id))
  with check (public.auth_can_write(org_id));

grant select, insert, update, delete on receipt_charges to authenticated;
grant select on receipt_line_charges to authenticated;

drop trigger if exists receipt_charges_section_guard on receipt_charges;
create trigger receipt_charges_section_guard
  before insert or update or delete on receipt_charges
  for each row execute function public.require_section_write('PURCHASING');

delete from public.section_read_rules
 where table_name in ('receipt_charges', 'receipt_line_charges');
insert into public.section_read_rules (table_name, section_code) values
  ('receipt_charges', 'PURCHASING'),
  ('receipt_line_charges', 'PURCHASING');

/*
 * What each line landed at.
 *
 * The goods price and the charges are separate columns and the uplift is
 * stated as a percentage, because the number people act on is not the landed
 * cost — it is "this supplier's cheap price is 14% dearer by the time it is
 * in the store", which a single blended figure hides completely.
 */
create or replace view receipt_line_landed_cost
with (security_invoker = true) as
  select
    l.org_id,
    l.id                                   as goods_receipt_line_id,
    l.goods_receipt_id,
    r.reference                            as receipt_reference,
    r.received_on,
    l.product_id,
    p.name                                 as product_name,
    (l.quantity_received - l.quantity_rejected)::numeric(18,5) as quantity,
    l.unit,
    l.unit_price,
    ((l.quantity_received - l.quantity_rejected) * l.unit_price)::numeric(18,5)
                                           as goods_value,
    coalesce(c.charges, 0)::numeric(18,5)  as charges,
    (((l.quantity_received - l.quantity_rejected) * l.unit_price)
      + coalesce(c.charges, 0))::numeric(18,5) as landed_value,
    case when (l.quantity_received - l.quantity_rejected) > 0
         then ((((l.quantity_received - l.quantity_rejected) * l.unit_price)
                + coalesce(c.charges, 0))
               / (l.quantity_received - l.quantity_rejected))::numeric(18,5)
    end                                    as landed_unit_cost,
    case when (l.quantity_received - l.quantity_rejected) * l.unit_price > 0
         then round(coalesce(c.charges, 0)
              / ((l.quantity_received - l.quantity_rejected) * l.unit_price) * 100, 2)
    end                                    as uplift_percent,
    -- Null, not zero: a line with no price cannot be landed at all, and a
    -- landed cost of nothing is a different claim from "we do not know".
    (l.unit_price is null)                 as price_missing
  from public.goods_receipt_lines l
  join public.goods_receipts r on r.id = l.goods_receipt_id
  left join public.products p on p.id = l.product_id
  left join (
    select lc.goods_receipt_line_id, sum(lc.amount) as charges
      from public.receipt_line_charges lc
     group by lc.goods_receipt_line_id
  ) c on c.goods_receipt_line_id = l.id;

grant select on receipt_line_landed_cost to authenticated;

/*
 * Which receipts cannot be landed, and why.
 *
 * Its own view because the useful question is the negative one. A landed cost
 * report that silently omits the receipts it could not compute reads as though
 * everything is accounted for.
 */
create or replace view landed_cost_ready
with (security_invoker = true) as
  select
    r.org_id,
    r.id                as goods_receipt_id,
    r.reference,
    r.received_on,
    count(l.id)                                        as lines,
    count(l.id) filter (where l.unit_price is null)     as lines_without_a_price,
    coalesce(ch.charges, 0)                             as charges_recorded,
    coalesce(ch.charge_count, 0)                        as charge_lines,
    (count(l.id) filter (where l.unit_price is null) = 0) as can_be_landed
  from public.goods_receipts r
  left join public.goods_receipt_lines l on l.goods_receipt_id = r.id
  left join (
    select c.goods_receipt_id, sum(c.amount) as charges, count(*) as charge_count
      from public.receipt_charges c group by c.goods_receipt_id
  ) ch on ch.goods_receipt_id = r.id
  group by r.org_id, r.id, r.reference, r.received_on, ch.charges, ch.charge_count;

grant select on landed_cost_ready to authenticated;

/*
 * The latest landed cost per product, beside the price it was bought at.
 *
 * This is the figure the catalogue would want, and it deliberately does not
 * write it there. `products.gross_price_per_unit` is what the venue has
 * decided a product costs; a receipt is evidence about one delivery. Letting
 * a delivery overwrite the catalogue would move every recipe's cost silently
 * on the day a pallet arrived.
 */
create or replace view product_landed_cost
with (security_invoker = true) as
  select distinct on (ll.org_id, ll.product_id)
    ll.org_id,
    ll.product_id,
    ll.product_name,
    ll.received_on          as landed_on,
    ll.receipt_reference,
    ll.unit_price           as supplier_price,
    ll.landed_unit_cost,
    ll.uplift_percent,
    p.gross_price_per_unit  as catalogue_price
  from public.receipt_line_landed_cost ll
  left join public.products p on p.id = ll.product_id
 where ll.product_id is not null
   and ll.unit_price is not null
 order by ll.org_id, ll.product_id, ll.received_on desc, ll.receipt_reference desc;

grant select on product_landed_cost to authenticated;

comment on table receipt_charges is
  'Freight, duty and the rest, per delivery. The basis is per charge because duty follows value and a pallet charge follows weight. See 0109.';
comment on table receipt_line_charges is
  'The allocation as rows, not as a recomputation: it was a decision taken on a day with a basis a person chose. See 0109.';
comment on view product_landed_cost is
  'What a delivery really cost per unit, beside the catalogue price. Deliberately does not write back to the catalogue. See 0109.';
