-- ---------------------------------------------------------------------------
-- Remove everything that was invented for testing
-- ---------------------------------------------------------------------------
-- Run this once, before real data goes in. It removes only what this project
-- generated to demonstrate features working, and leaves the catalogue —
-- ingredients, recipes and preparations — untouched, because that is real.
--
-- Deliberately not automatic and not part of a migration: deleting data should
-- be a decision somebody makes, not something that happens on deploy.
--
--   psql "$DATABASE_URL" -f supabase/purge_sample_data.sql
-- ---------------------------------------------------------------------------

begin;

-- Invented sales, and the menu-engineering analysis built on them.
delete from sales_periods where source = 'SAMPLE';

-- Sample workforce. Certifications and leave cascade from the employees.
delete from employees
 where employee_number in ('E-001','E-002','E-003','E-004','E-005');

-- Purchasing worked through by hand while building.
delete from supplier_invoices where invoice_number like 'SINV-%';
delete from goods_receipts where reference like 'GRN-TEST%';
delete from purchase_orders where reference like 'PO-TEST%';
delete from requisitions where reference like 'REQ-%';

-- Stock invented to show the inventory and traceability pages working. The
-- ledger is append-only in normal use; this is the one sanctioned exception,
-- and it happens before the ledger means anything.
delete from stock_movements where lot_id in (select id from stock_lots where lot_code like 'L____-%')
   or note like 'Receipt GRN-TEST%';
delete from stock_lots where lot_code like 'L____-%' or lot_code like 'TEST-%';
delete from stock_movements where actor_email = 'chef@manuza.test';

-- Par levels were set on a handful of ingredients to demonstrate reordering.
update products set par_level = null, reorder_point = null, stock_unit = null
 where name in ('Guanciale','Salmon Fillet','Shallot','Truffle Oil');

commit;

-- What is left should be the catalogue and nothing else.
select 'products'      as kind, count(*) from products
union all select 'recipes',        count(*) from recipes
union all select 'sub_recipes',    count(*) from sub_recipes
union all select 'suppliers',      count(*) from suppliers
union all select 'stock_movements',count(*) from stock_movements
union all select 'employees',      count(*) from employees
union all select 'sales_periods',  count(*) from sales_periods
union all select 'requisitions',   count(*) from requisitions;
