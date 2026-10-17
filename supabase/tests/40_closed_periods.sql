-- ---------------------------------------------------------------------------
-- A closed period stays closed (0098)
-- ---------------------------------------------------------------------------
-- The block has to hold against the API, not just against a screen, and
-- reopening has to be possible but loud. Both are asserted by trying them.
-- ---------------------------------------------------------------------------

begin;

select id as demo from organizations where name = 'Demo Kitchen' \gset

insert into suppliers (id, org_id, name)
values ('b0000000-0000-4000-8000-000000050001', :'demo', 'T-Closed-Co');

insert into accounting_periods (id, org_id, starts_on, ends_on)
values ('b0000000-0000-4000-8000-000000050010', :'demo',
        date '2026-03-01', date '2026-03-31');

select '── closing it' as "──";

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');

select t.expect_rows($$
  insert into supplier_invoices (org_id, supplier_id, invoice_number, invoice_date, total_amount)
  values ((select id from organizations where name='Demo Kitchen'),
          'b0000000-0000-4000-8000-000000050001', 'T-INV-MAR', date '2026-03-15', 500000)$$,
  'March is open, so a March invoice lands', 1);

select t.expect_rows($$
  update accounting_periods set status = 'CLOSED'
   where id = 'b0000000-0000-4000-8000-000000050010'$$,
  'the period is closed', 1);
select t.expect_value($$select closed_by_email from accounting_periods
                         where id = 'b0000000-0000-4000-8000-000000050010'$$,
  'recorded against whoever closed it, from the session', 'chef@test.local');

select '── and nothing moves in it afterwards' as "──";

select t.expect_refused($$
  insert into supplier_invoices (org_id, supplier_id, invoice_number, invoice_date, total_amount)
  values ((select id from organizations where name='Demo Kitchen'),
          'b0000000-0000-4000-8000-000000050001', 'T-INV-LATE', date '2026-03-20', 900000)$$,
  'a second March invoice is refused', 'closed period');
select t.expect_refused($$
  update supplier_invoices set total_amount = 1
   where invoice_number = 'T-INV-MAR'$$,
  'and the one already there cannot be edited', 'closed period');

/*
 * Deleting changes the month as surely as adding. A block that only stopped
 * inserts would let somebody tidy a closed month away.
 */
select t.expect_refused($$
  delete from supplier_invoices where invoice_number = 'T-INV-MAR'$$,
  'nor removed', 'closed period');

select t.expect_rows($$
  insert into supplier_invoices (org_id, supplier_id, invoice_number, invoice_date, total_amount)
  values ((select id from organizations where name='Demo Kitchen'),
          'b0000000-0000-4000-8000-000000050001', 'T-INV-APR', date '2026-04-02', 300000)$$,
  'but April is untouched', 1);

-- The same guard, on the other two dated documents.
select t.expect_refused($$
  insert into goods_receipts (org_id, supplier_id, received_on)
  values ((select id from organizations where name='Demo Kitchen'),
          'b0000000-0000-4000-8000-000000050001', date '2026-03-10')$$,
  'a delivery cannot be dated into it either', 'closed period');

select '── reopening is possible, and loud' as "──";

select t.expect_refused($$
  update accounting_periods set status = 'OPEN'
   where id = 'b0000000-0000-4000-8000-000000050010'$$,
  'reopening with no reason is refused', 'say why');

/*
 * The ADMIN branch, tested against somebody who actually reaches the row.
 *
 * The first draft used nobody@, who holds NONE everywhere — so the UPDATE
 * matched no rows at all under their policies, raised nothing, and
 * expect_refused read that as "it was allowed". The first false pass in
 * _harness.sql, arriving from the other direction. Reopening is a
 * purchasing write gated on administration, so the person who proves it is
 * one with purchasing and without administration.
 */
reset role;
insert into member_access (org_id, user_id, section_code, level)
values ((select id from organizations where name='Demo Kitchen'),
        'a0000000-0000-0000-0000-000000000003', 'PURCHASING', 'WRITE')
on conflict (org_id, user_id, section_code) where business_unit_id is null
  do update set level = 'WRITE';

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000003', 'nobody@test.local');
select t.expect_refused($$
  update accounting_periods set status = 'OPEN', reopen_reason = 'sneaking'
   where id = 'b0000000-0000-4000-8000-000000050010'$$,
  'purchasing access alone does not reopen a closed month', 'administration');

reset role;
select t.expect_value($$select status::text from accounting_periods
                         where id = 'b0000000-0000-4000-8000-000000050010'$$,
  'and it is still closed afterwards', 'CLOSED');

set local role authenticated;

select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');
select t.expect_rows($$
  update accounting_periods set status = 'OPEN',
         reopen_reason = 'invoice arrived late from the supplier'
   where id = 'b0000000-0000-4000-8000-000000050010'$$,
  'with a reason and the access, it reopens', 1);
select t.expect_value($$select reopened_by_email from accounting_periods
                         where id = 'b0000000-0000-4000-8000-000000050010'$$,
  'and who did it is kept', 'chef@test.local');
select t.expect_rows($$
  insert into supplier_invoices (org_id, supplier_id, invoice_number, invoice_date, total_amount)
  values ((select id from organizations where name='Demo Kitchen'),
          'b0000000-0000-4000-8000-000000050001', 'T-INV-REOPEN', date '2026-03-25', 120000)$$,
  'and March accepts the late invoice', 1);

select '── what is owed, and how late' as "──";

reset role;
update supplier_invoices
   set status = 'APPROVED_FOR_PAYMENT', due_date = current_date - 45
 where invoice_number = 'T-INV-MAR';
update supplier_invoices
   set status = 'APPROVED_FOR_PAYMENT', due_date = current_date + 10
 where invoice_number = 'T-INV-APR';
update supplier_invoices
   set status = 'EXCEPTION', due_date = current_date - 5
 where invoice_number = 'T-INV-REOPEN';

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');

select t.expect_value($$select bucket from ap_aging where invoice_number = 'T-INV-MAR'$$,
  'forty-five days late lands in the right bucket', '31 to 60');
select t.expect_value($$select bucket from ap_aging where invoice_number = 'T-INV-APR'$$,
  'and one not yet due says so', 'not yet due');

select t.expect_value($$select approved_to_pay::text from ap_by_supplier
                         where supplier_name = 'T-Closed-Co'$$,
  'only what is approved for payment counts as owed', '800000.00000');

/*
 * A balance of zero means something different when invoices are stuck, so
 * the count sits beside the total rather than being left to inference.
 */
select t.expect_value($$select stuck::text from ap_by_supplier
                         where supplier_name = 'T-Closed-Co'$$,
  'and an invoice in exception is counted as stuck, not as owed', '1');

reset role;
insert into supplier_credit_notes (org_id, supplier_id, status, amount)
values (:'demo', 'b0000000-0000-4000-8000-000000050001', 'RECEIVED', 50000);

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');
select t.expect_value($$select net_payable::text from ap_by_supplier
                         where supplier_name = 'T-Closed-Co'$$,
  'a credit the supplier owes nets off what we owe them', '750000.00000');

reset role;
select t.expect_guarded('accounting_periods', 'PURCHASING');

rollback;
