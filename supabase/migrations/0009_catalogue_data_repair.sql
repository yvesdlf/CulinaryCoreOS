-- ---------------------------------------------------------------------------
-- Catalogue data repair
-- ---------------------------------------------------------------------------
-- The COGS V5 import was deliberately literal: it never guessed at a match and
-- never invented a value, so gaps in the workbook arrived as gaps in CCOS.
-- This closes the ones that are objectively wrong rather than merely
-- surprising, and marks its own inferences so they can be reviewed.
--
-- What this does NOT do: change a portion size. Squid & Guanciale costs 87,7%
-- of its menu price because it carries 100 g of guanciale at Rp 590.000/kg,
-- which is a kitchen decision and not a data defect. Quietly re-portioning it
-- would hide exactly the finding this app exists to surface. Same for the
-- other seven dishes outside the 20-35% band.
--
-- Anything inferred rather than matched is left with status 'PENDING', so the
-- app can show it as needing a human rather than presenting a guess as fact.
-- ---------------------------------------------------------------------------

-- ── A. Units ────────────────────────────────────────────────────────────────
-- Egg Yolk was priced per EA (Rp 1.500 a yolk) while six sub-recipes order it
-- by weight — 0,08 KG in Caesar-Miso Dressing, and so on. The engine multiplied
-- 0,08 x 1.500 and charged 120 rupiah for what is about five yolks, roughly a
-- 59x undercharge that then flowed into every dish using those preparations.
--
-- Re-expressing the product in KG fixes all six at once and keeps the
-- quantities the kitchen actually wrote. The rate is their own price carried
-- across at 17 g a yolk (a large egg): 1.500 / 0,017 = 88.235,29 per kg.
update products
   set total_unit             = 'KG',
       units_per_pack_unit    = 'KG',
       pack_unit              = 'KG',
       gross_unit             = 'KG',
       nett_unit              = 'KG',
       waste_unit             = 'KG',
       buying_price_per_pack  = 88235.29,
       buying_price_per_unit  = 88235.29,
       gross_price_per_unit   = 88235.29,
       nett_price_per_unit    = 88235.29,
       status                 = 'PENDING'
 where name = 'Egg Yolk';

-- Label-only corrections. "PORTION" on a line whose product is sold by the
-- kilo was never a portion: the quantity was already being read against a
-- per-kilo rate, so the cost is unchanged and only the displayed unit was
-- lying. Same for the two lines reading KG against a product sold by the
-- litre, where cream and wine are close enough to 1 kg/l that the figure
-- stands.
update recipe_lines l
   set nett_unit = p.total_unit, gross_unit = p.total_unit
  from products p
 where p.id = l.product_id
   and upper(l.nett_unit) <> upper(p.total_unit);

update sub_recipe_lines l
   set nett_unit = p.total_unit, gross_unit = p.total_unit
  from products p
 where p.id = l.product_id
   and upper(l.nett_unit) <> upper(p.total_unit);

-- ── B. Unmatched references ─────────────────────────────────────────────────
-- 22 ingredient names in the dish sheets matched nothing in the ingredient
-- list, so the importer minted placeholders carrying the line's own rate.
-- That kept the costs honest but left the allergens empty, which is the
-- dangerous half: "Beer Batter" and "Sourdough bread" declared nothing at all.

-- Three spellings of one preparation that already exists as a sub-recipe.
-- Repointing is better than copying a rate: the dish now inherits Sourdough's
-- gluten declaration and re-costs when its recipe changes.
update recipe_lines
   set sub_recipe_id = (select id from sub_recipes where name = 'Sourdough'),
       product_id    = null
 where product_id in (
   select id from products
    where name in ('Sourdough Base', 'Sourdough bread', 'Sourdough Bread Base')
 );

update sub_recipe_lines
   set child_sub_recipe_id = (select id from sub_recipes where name = 'Sourdough'),
       product_id          = null
 where product_id in (
   select id from products
    where name in ('Sourdough Base', 'Sourdough bread', 'Sourdough Bread Base')
 );

-- A misspelling, not a different ingredient. Both sit at Rp 40.000/kg, and the
-- real row already declares celery — an allergen the placeholder was silently
-- dropping from every dish that used it.
update recipe_lines
   set product_id = (select id from products where name = 'Celery')
 where product_id = (select id from products where name = 'Cellery');

update sub_recipe_lines
   set product_id = (select id from products where name = 'Celery')
 where product_id = (select id from products where name = 'Cellery');

delete from products
 where name in ('Sourdough Base', 'Sourdough bread', 'Sourdough Bread Base', 'Cellery');

-- The rest are genuine items the ingredient list simply never carried. They
-- keep the rate the dish was already paying; what changes is that they stop
-- being invisible and start declaring what is in them.
--
-- Allergens below are stated only where the name settles the question — beer
-- batter is beer and flour, a cashew sauce has cashews in it. Where a
-- preparation could plausibly go either way it is left undeclared rather than
-- guessed at, because a wrong "contains" and a wrong "free from" are both
-- failures and only one of them is obvious.
update products set category = 'Fruit & Vegetables', status = 'PENDING'
 where name in ('carrots', 'Green beans', 'Wing beans');

update products set category = 'Dry Goods', status = 'PENDING'
 where name = 'Dried Oregano';

update products set category = 'Pastry', status = 'PENDING',
       allergens = '{EU14_GLUTEN_CEREALS}'
 where name = 'Bao Bread';

update products set category = 'Sub Recipes', status = 'PENDING',
       allergens = '{EU14_GLUTEN_CEREALS}'
 where name = 'Beer Batter';

update products set category = 'Sub Recipes', status = 'PENDING',
       allergens = '{EU14_TREE_NUTS}'
 where name = 'Herb & Cashew Sauce';

-- Both are built on fermented seafood as a matter of course — shrimp paste in
-- tom yum, salted shrimp or fish sauce in kimchi. Under-declaring these two
-- would put crustacean and fish allergens in dishes that claim neither.
update products set category = 'Sub Recipes', status = 'PENDING',
       allergens = '{EU14_CRUSTACEANS,EU14_FISH}'
 where name in ('Tom Yum Paste', 'Kimchi sauce');

-- Indonesian marinades and glazes are kecap-manis based, and soy sauce is
-- brewed with wheat.
update products set category = 'Sub Recipes', status = 'PENDING',
       allergens = '{EU14_SOYBEANS,EU14_GLUTEN_CEREALS}'
 where name in ('Beef Glaze', 'Duck Marinade', 'Duck Satay Glaze',
                'Prawn Glaze', 'Soft Shell Crab Marinade');

update products set category = 'Sub Recipes', status = 'PENDING'
 where name in ('Dabu Dabu Salsa', 'Frito Verde Dressing', 'Red Paprika Oil',
                'Spiced Syrup');

-- ── C. Missing ingredient lines ─────────────────────────────────────────────
-- Three burgers were costed without a bun. The dish therefore came out cheap
-- and, worse, read as gluten-free and dairy-free: the Burger Buns sub-recipe
-- already exists and already declares gluten, eggs, milk and sesame — nothing
-- referenced it.
--
-- One bun is about 90 g. This is an inference about their recipe, but a burger
-- with no bread in it is not a defensible reading of the source either.
insert into recipe_lines (
  recipe_id, line_number, sub_recipe_id, nett_qty, nett_unit,
  ref_percent, gross_qty, gross_unit, cost_per_unit, line_cost
)
select r.id,
       (select coalesce(max(line_number), 0) + 1 from recipe_lines where recipe_id = r.id),
       b.id, 0.09, 'KG', 0, 0.09, 'KG', b.cost_per_unit, round(0.09 * b.cost_per_unit, 5)
  from recipes r
 cross join (select id, cost_per_unit from sub_recipes where name = 'Burger Buns') b
 where r.name in ('Beef burger', 'Mahi-Mahi Burger', 'Tuna Burger')
   and not exists (
     select 1 from recipe_lines l where l.recipe_id = r.id and l.sub_recipe_id = b.id
   );

-- ── D. Re-derive ────────────────────────────────────────────────────────────
-- Allergens follow from the lines, so they are recomputed rather than patched.
-- Costs are re-derived by the app (pnpm --filter web recost), which runs the
-- one engine instead of reimplementing it here.
select * from derive_allergens();
