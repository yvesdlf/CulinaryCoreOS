-- ---------------------------------------------------------------------------
-- One step back and one step forward
-- ---------------------------------------------------------------------------
-- Article 18 of Regulation (EC) 178/2002 asks a food business for two things
-- about anything it serves: who it came from, and where it went. The data for
-- both has been in this database since 0061 and 0096 — `stock_lots` holds the
-- supplier, the delivery and the dates, `lot_forward_trace` holds the
-- movements and the preparations — and there has never been a way to ask for
-- it as a document.
--
-- That is the gap this closes. Not a screen for browsing: a sheet somebody
-- hands to an environmental health officer, or works a recall from.
--
-- ── It reads as the caller, like every other report function ──────────────
--
-- `profit_trend` (0120) and `pour_variance` are invoker-rights, so row-level
-- security does the deciding and the function cannot become a way round it.
-- This is the same, and here it has a consequence worth naming.
--
-- `stock_lots` is shared — every member of the venue reads it, because a lot
-- code appears on a label and a delivery note. The *forward* trace is not:
-- `stock_movements` is gated on Inventory and `production_records` on
-- Production (`section_read_rules`, 0079). So a reader holding Traceability
-- and neither of those sees every lot and no trace at all.
--
-- Which looks exactly like a venue that has never used any of its stock.
--
-- So the report says so. `reader_sees_movements` and
-- `reader_sees_production` come back with every row, and the sheet turns them
-- into a sentence. An empty forward trace and a forward trace somebody is not
-- allowed to read are different facts, and on a document that gets filed for
-- two years they must not be the same blank column.
-- ---------------------------------------------------------------------------

create or replace function public.traceability_report(
  p_from date,
  p_to date
)
returns table (
  lot_id uuid,
  lot_code text,
  product_name text,
  supplier_name text,
  delivery_reference text,
  received_on date,
  expires_on date,
  expiry_kind text,
  receipt_temperature_c numeric,
  status text,
  status_reason text,
  quantity_received numeric,
  quantity_out numeric,
  movements integer,
  preparations integer,
  first_used_on date,
  last_used_on date,
  services text,
  concerns text[],
  reader_sees_movements boolean,
  reader_sees_production boolean
)
language plpgsql
stable
set search_path = ''
as $$
declare
  org uuid := public.auth_default_org_id();
  sees_movements boolean := public.can_read_section('INVENTORY', org, null);
  sees_production boolean := public.can_read_section('PRODUCTION', org, null);
begin
  if p_from is null or p_to is null then
    raise exception 'a traceability report needs a period'
      using hint = 'Both dates are required: the sheet is filed against them.';
  end if;
  if p_to < p_from then
    raise exception 'the period ends before it begins';
  end if;

  return query
  with received as (
    /*
     * The lots themselves. `received_on` rather than `created_at`: a delivery
     * entered on Monday for goods that arrived on Saturday belongs in
     * Saturday's report, and an inspector asking about a date means the date
     * the food was in the building.
     */
    select l.id, l.lot_code, l.product_id, l.supplier_id, l.delivery_reference,
           l.received_on, l.expires_on, l.expiry_kind::text as expiry_kind,
           l.receipt_temperature_c, l.status::text as status, l.status_reason
      from public.stock_lots l
     where l.received_on between p_from and p_to
  ),
  moved as (
    /*
     * What left the lot, and where it went. Empty for a reader without
     * Inventory — which is why the flags above travel with every row.
     */
    select t.lot_id,
           count(*)::integer                                   as movements,
           count(distinct t.sub_recipe_id)::integer             as preparations,
           min(t.occurred_at)::date                             as first_used_on,
           max(t.occurred_at)::date                             as last_used_on,
           sum(case when t.kind in ('USAGE', 'WASTE', 'TRANSFER', 'RETURN')
                    then abs(t.quantity) else 0 end)            as quantity_out,
           nullif(string_agg(distinct t.service, ', '
                             order by t.service), '')           as services
      from public.lot_forward_trace t
     group by t.lot_id
  ),
  arrived as (
    /*
     * From `stock_movements`, not from the trace view. That view joins
     * `m.quantity < 0` — it is the forward trace, so it carries only what
     * *left* the lot — and a receipt is positive, so reading receipts from it
     * returns nothing at all, for every lot, silently. Caught by a test
     * asking what had been received and getting a blank column.
     */
    select m.lot_id, sum(m.quantity) as quantity_received
      from public.stock_movements m
     where m.kind = 'RECEIPT' and m.lot_id is not null
     group by m.lot_id
  )
  select r.id,
         r.lot_code,
         p.name,
         s.name,
         r.delivery_reference,
         r.received_on,
         r.expires_on,
         r.expiry_kind,
         r.receipt_temperature_c,
         r.status,
         r.status_reason,
         a.quantity_received,
         coalesce(mv.quantity_out, 0),
         coalesce(mv.movements, 0),
         coalesce(mv.preparations, 0),
         mv.first_used_on,
         mv.last_used_on,
         mv.services,
         /*
          * What this row cannot answer, said on the row rather than totalled
          * at the bottom. A recall is worked lot by lot, and a line that is
          * missing its supplier is the line somebody has to telephone about.
          */
         array_remove(array[
           case when coalesce(btrim(r.lot_code), '') = ''
                then 'no lot code: this delivery cannot be told apart from another of the same product' end,
           case when r.supplier_id is null
                then 'no supplier recorded: one step back is not answerable for this lot' end,
           case when r.expires_on is null
                then 'no date given' end,
           case when r.expires_on is not null and r.expiry_kind is null
                then 'date given with no kind, so it cannot be judged safe or merely stale' end,
           case when r.status <> 'OK'
                then lower(r.status) || coalesce(': ' || r.status_reason, '') end,
           case when sees_movements and coalesce(mv.movements, 0) = 0
                then 'nothing was ever drawn from this lot' end
         ], null),
         sees_movements,
         sees_production
    from received r
    left join public.products  p on p.id = r.product_id
    left join public.suppliers s on s.id = r.supplier_id
    left join moved   mv on mv.lot_id = r.id
    left join arrived a  on a.lot_id  = r.id
   order by r.received_on desc, p.name, r.lot_code;
end $$;

comment on function public.traceability_report(date, date) is
  'One row per stock lot received in the period: where it came from, where it '
  'went, and what the record cannot answer. Reads as the caller, so the '
  'forward trace is empty without Inventory — which the row says out loud.';

/*
 * Invoker-rights, so the grant is the whole of the access decision and
 * row-level security does the rest. `anon` is not given it: 0123's rule is
 * that nothing in this schema is callable without signing in.
 */
revoke all on function public.traceability_report(date, date) from anon;
grant execute on function public.traceability_report(date, date) to authenticated;
