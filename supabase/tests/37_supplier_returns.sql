-- ---------------------------------------------------------------------------
-- Rejected goods become a return (0095)
-- ---------------------------------------------------------------------------
-- The assertion that matters most is the one about stock: goods refused at
-- the door never entered the ledger, so returning them must not take them
-- out of it. Getting that backwards invents a shortfall that a stocktake
-- then has to explain.
-- ---------------------------------------------------------------------------

begin;

select id as demo from organizations where name = 'Demo Kitchen' \gset

insert into products (id, org_id, name, category, pack_unit, status,
                      gross_unit, stock_unit)
values ('b0000000-0000-4000-8000-000000020001', :'demo', 'T-Lettuce',
        'Produce', 'kg', 'ACTIVE', 'g', 'g'),
       ('b0000000-0000-4000-8000-000000020002', :'demo', 'T-Cream',
        'Dairy', 'l', 'ACTIVE', 'ml', 'ml');
insert into suppliers (id, org_id, name)
values ('b0000000-0000-4000-8000-000000020003', :'demo', 'T-Greens-Co');

-- Stock already on the shelf, so a later return has something to take out.
insert into stock_movements (org_id, product_id, kind, quantity, unit, occurred_at)
values (:'demo', 'b0000000-0000-4000-8000-000000020002', 'RECEIPT', 5000, 'ml', now() - interval '2 days');

-- Both the reference and the stem: assign_receipt_reference keeps what it is
-- given only when the reference is already a well-formed number, and
-- recomputes from scratch otherwise. Setting the stem alone is not enough,
-- which is itself worth knowing about that trigger.
insert into goods_receipts (id, org_id, supplier_id, received_on,
                            reference, reference_stem)
values ('b0000000-0000-4000-8000-000000020010', :'demo',
        'b0000000-0000-4000-8000-000000020003', current_date,
        'GRN-KIT-260101-001', 'KIT-260101-001');

select '── a rejection drafts the return by itself' as "──";

-- Twenty kilos ordered, eighteen accepted, two refused as wilted.
insert into goods_receipt_lines (org_id, goods_receipt_id, product_id,
                                 quantity_received, quantity_rejected,
                                 rejection_reason, unit, line_number)
values (:'demo', 'b0000000-0000-4000-8000-000000020010',
        'b0000000-0000-4000-8000-000000020001',
        18000, 2000, 'wilted', 'g', 1);

select t.expect_value($$select count(*)::text from supplier_returns
                         where goods_receipt_id = 'b0000000-0000-4000-8000-000000020010'$$,
  'rejecting a line drafts a return without anybody opening a screen', '1');
select t.expect_value($$select status::text from supplier_returns
                         where goods_receipt_id = 'b0000000-0000-4000-8000-000000020010'$$,
  'as a draft, never sent on its own', 'DRAFT');
select t.expect_value($$select quantity::text from supplier_return_lines l
                          join supplier_returns r on r.id = l.return_id
                         where r.goods_receipt_id = 'b0000000-0000-4000-8000-000000020010'$$,
  'for the quantity refused, not the quantity delivered', '2000.00000');
select t.expect_value($$select from_stock::text from supplier_return_lines l
                          join supplier_returns r on r.id = l.return_id
                         where r.goods_receipt_id = 'b0000000-0000-4000-8000-000000020010'$$,
  'and marked as never having reached the shelf', 'false');

select t.expect_value($$select reference from supplier_returns
                         where goods_receipt_id = 'b0000000-0000-4000-8000-000000020010'$$,
  'carrying the same number as the delivery it came from', 'RET-KIT-260101-001');

-- A second rejected line on the same delivery joins the same return.
insert into goods_receipt_lines (org_id, goods_receipt_id, product_id,
                                 quantity_received, quantity_rejected,
                                 rejection_reason, unit, line_number)
values (:'demo', 'b0000000-0000-4000-8000-000000020010',
        'b0000000-0000-4000-8000-000000020002',
        1000, 500, 'short dated', 'ml', 2);
select t.expect_value($$select count(*)::text from supplier_returns
                         where goods_receipt_id = 'b0000000-0000-4000-8000-000000020010'$$,
  'a second rejection joins the same return, not a new one', '1');
select t.expect_value($$select count(*)::text from supplier_return_lines l
                          join supplier_returns r on r.id = l.return_id
                         where r.goods_receipt_id = 'b0000000-0000-4000-8000-000000020010'$$,
  'as a second line', '2');

-- An accepted line raises nothing.
insert into goods_receipt_lines (org_id, goods_receipt_id, product_id,
                                 quantity_received, quantity_rejected, unit, line_number)
values (:'demo', 'b0000000-0000-4000-8000-000000020010',
        'b0000000-0000-4000-8000-000000020001', 5000, 0, 'g', 3);
select t.expect_value($$select count(*)::text from supplier_return_lines l
                          join supplier_returns r on r.id = l.return_id
                         where r.goods_receipt_id = 'b0000000-0000-4000-8000-000000020010'$$,
  'and a line nobody rejected adds nothing', '2');

select '── posting it, and what does not move' as "──";

select id as ret from supplier_returns
 where goods_receipt_id = 'b0000000-0000-4000-8000-000000020010' \gset

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');

-- Both lines were refused at the door, so posting moves nothing at all.
select t.expect_value($$select post_supplier_return(
    (select id from supplier_returns
      where goods_receipt_id = 'b0000000-0000-4000-8000-000000020010'))::text$$,
  'posting goods refused at the door moves no stock', '0');

reset role;
select t.expect_value($$select count(*)::text from stock_movements where kind = 'RETURN'$$,
  'because they never entered the ledger to be taken out of',  '0');
select t.expect_value($$select on_hand::text from product_stock
                         where product_id = 'b0000000-0000-4000-8000-000000020002'$$,
  'so the cream on the shelf is untouched', '5000.00000');

select t.expect_value($$select status::text from supplier_returns
                         where goods_receipt_id = 'b0000000-0000-4000-8000-000000020010'$$,
  'the return is posted', 'POSTED');
select t.expect_value($$select status::text from supplier_credit_notes
                         where return_id = (select id from supplier_returns
                           where goods_receipt_id = 'b0000000-0000-4000-8000-000000020010')$$,
  'and a credit note is expected from the supplier', 'EXPECTED');
select t.expect_value($$select reference from supplier_credit_notes
                         where return_id = (select id from supplier_returns
                           where goods_receipt_id = 'b0000000-0000-4000-8000-000000020010')$$,
  'on the same number again', 'CN-KIT-260101-001');

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');
select t.expect_refused($$select post_supplier_return(
    (select id from supplier_returns
      where goods_receipt_id = 'b0000000-0000-4000-8000-000000020010'))$$,
  'and it posts once', 'already been posted');

select '── a return of stock that was accepted does move it' as "──";

select t.expect_rows($$
  insert into supplier_returns (org_id, supplier_id, reason)
  values ((select id from organizations where name = 'Demo Kitchen'),
          'b0000000-0000-4000-8000-000000020003', 'soured overnight')$$,
  'a return raised later needs no delivery', 1);

select t.expect_rows($$
  insert into supplier_return_lines (return_id, product_id, quantity, unit,
                                     unit_price, from_stock)
  values ((select id from supplier_returns where reason = 'soured overnight'),
          'b0000000-0000-4000-8000-000000020002', 1500, 'ml', 0.02, true)$$,
  'against stock that was put away', 1);

select t.expect_value($$select post_supplier_return(
    (select id from supplier_returns where reason = 'soured overnight'))::text$$,
  'posting it moves one line of stock', '1');

reset role;
select t.expect_value($$select quantity::text from stock_movements
                         where kind = 'RETURN' and product_id = 'b0000000-0000-4000-8000-000000020002'$$,
  'out of the ledger, negative', '-1500.00000');
select t.expect_value($$select on_hand::text from product_stock
                         where product_id = 'b0000000-0000-4000-8000-000000020002'$$,
  'and the cream on hand comes down', '3500.00000');
select t.expect_value($$select amount::text from supplier_credit_notes
                         where return_id = (select id from supplier_returns where reason = 'soured overnight')$$,
  'with a credit expected for what it was worth', '30.00000');

select '── what it refuses, and who may' as "──";

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');
select t.expect_rows($$
  insert into supplier_returns (org_id, supplier_id, reason)
  values ((select id from organizations where name = 'Demo Kitchen'),
          'b0000000-0000-4000-8000-000000020003', 'empty one')$$,
  'an empty return can be drafted', 1);
select t.expect_refused($$select post_supplier_return(
    (select id from supplier_returns where reason = 'empty one'))$$,
  'but not posted', 'no lines');
select t.expect_refused($$
  insert into supplier_return_lines (return_id, product_id, quantity, unit)
  values ((select id from supplier_returns where reason = 'empty one'),
          'b0000000-0000-4000-8000-000000020002', 0, 'ml')$$,
  'and a line of nothing is not a line', 'supplier_return_lines_qty');

select t.expect_value($$select (days_outstanding >= 0)::text from credit_notes_outstanding
                         where return_reference = 'RET-KIT-260101-001'$$,
  'an unsent credit is aged on the outstanding list', 'true');

/*
 * The id is captured here and passed as a literal below.
 *
 * Under nobody@'s policies the sub-select that found it returns no rows, so
 * the function would be handed null and refuse with "no such return" — which
 * reads as a pass and proves nothing about the section guard. The first
 * draft of this file did exactly that.
 */
reset role;
select id as empty_ret from supplier_returns where reason = 'empty one' \gset

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000003', 'nobody@test.local');
select t.expect_value($$select count(*)::text from supplier_returns$$,
  'somebody with no Purchasing access sees no returns', '0');
select t.expect_value($$select count(*)::text from credit_notes_outstanding$$,
  'nor what a supplier owes', '0');
select t.expect_refused(
  format($$select post_supplier_return(%L)$$, :'empty_ret'),
  'nor posts one, even given the id', 'PURCHASING');

reset role;
select t.expect_guarded('supplier_returns', 'PURCHASING');
select t.expect_guarded('supplier_return_lines', 'PURCHASING');
select t.expect_guarded('supplier_credit_notes', 'PURCHASING');

rollback;
