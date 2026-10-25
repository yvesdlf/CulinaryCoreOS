-- ---------------------------------------------------------------------------
-- Which allergens a venue must declare (0119)
-- ---------------------------------------------------------------------------
-- The dangerous direction is a substance going quiet.
--
-- Celery, mustard, lupin, sulphites and molluscs are not regulated allergens
-- in the United States. A profile that filtered them out of the data would
-- make a celery-containing dish show nothing against it on a US venue's
-- screen — and silence is not a free-from claim in any jurisdiction. So every
-- assertion about the US profile below is paired with one proving the
-- substance is still there.
--
-- The second is gluten, where both obvious answers are wrong. The EU declares
-- cereals containing gluten; the United States declares wheat. A record
-- saying "a gluten cereal" cannot be narrowed to wheat — nobody wrote down
-- which cereal — and dropping it is worse than over-declaring it. It is
-- declared, and marked as broader than the evidence.
-- ---------------------------------------------------------------------------

begin;

select '── the vocabulary has no jurisdiction in it' as "──";

select t.expect_value($$
  select count(*)::text from allergen_substances where id like 'EU%'$$,
  'no substance id carries a jurisdiction', '0');

select t.expect_value($$
  select count(*)::text from allergen_substances$$,
  'the union of both lists, plus wheat as its own substance', '15');

select '── what each profile declares' as "──";

select t.expect_value($$
  select count(*)::text from allergen_declarations where profile_code = 'EU_FIC'$$,
  'the EU declares fifteen, counting wheat as a gluten cereal', '15');

/*
 * Nine substances, ten rows. The United States' major allergens are the big
 * nine — milk, eggs, fish, crustacean shellfish, tree nuts, peanuts, wheat,
 * soybeans and sesame — and the tenth row is the ambiguous gluten record
 * also declaring as wheat. Counting rows and calling it nine would hide
 * exactly the case this design exists for.
 */
select t.expect_value($$
  select count(distinct declared_as)::text from allergen_declarations
   where profile_code = 'US_FDA'$$,
  'the United States declares nine distinct allergens', '9');

select t.expect_value($$
  select count(*)::text from allergen_declarations where profile_code = 'US_FDA'$$,
  'in ten rows, because an ambiguous gluten record also declares as wheat', '10');

select t.expect_value($$
  select declared_as from allergen_declarations
   where profile_code = 'US_FDA' and substance_id = 'CRUSTACEANS'$$,
  'and names crustaceans differently from the EU', 'Crustacean shellfish');

select t.expect_value($$
  select declared_as from allergen_declarations
   where profile_code = 'EU_FIC' and substance_id = 'CRUSTACEANS'$$,
  'which is why the wording is data and not the substance name', 'Crustaceans');

select '── a substance a profile does not regulate is still in the food' as "──";

/*
 * The assertion this file exists for. Celery is not a US allergen. A US
 * venue must still see that the dish contains it.
 */
select t.expect_value($$
  select declared::text from public.allergens_under_profile(
    'US_FDA', array['CELERY'])$$,
  'celery is not declarable in the United States', 'false');

select t.expect_value($$
  select count(*)::text from public.allergens_under_profile(
    'US_FDA', array['CELERY'])$$,
  'and it is still returned, not filtered away', '1');

select t.expect_value($$
  select substance_name from public.allergens_under_profile(
    'US_FDA', array['CELERY'])$$,
  'under its written name, because a code never replaces one', 'Celery');

select t.expect_value($$
  select string_agg(substance_id, ',' order by substance_id)
    from public.allergens_under_profile(
      'US_FDA', array['CELERY','MUSTARD','LUPIN','SULPHITES','MOLLUSCS'])
   where not declared$$,
  'the five the United States does not regulate are all still present',
  'CELERY,LUPIN,MOLLUSCS,MUSTARD,SULPHITES');

select t.expect_value($$
  select count(*)::text from public.allergens_under_profile(
    'EU_FIC', array['CELERY','MUSTARD','LUPIN','SULPHITES','MOLLUSCS'])
   where not declared$$,
  'and all five are declarable in the EU', '0');

select '── gluten, where neither obvious answer is right' as "──";

select t.expect_value($$
  select declared::text || '/' || declared_as
    from public.allergens_under_profile('EU_FIC', array['GLUTEN_CEREALS'])$$,
  'the EU declares the family as the family',
  'true/Cereals containing gluten');

/*
 * Not narrowed to wheat in the data — nobody wrote down which cereal — and
 * not dropped either. Declared as wheat, and flagged as broader than the
 * evidence, because an unnecessary declaration inconveniences somebody and a
 * missing one harms them.
 */
select t.expect_value($$
  select declared::text || '/' || declared_as || '/' || over_inclusive::text
    from public.allergens_under_profile('US_FDA', array['GLUTEN_CEREALS'])$$,
  'the United States declares it as wheat, marked broader than the record',
  'true/Wheat/true');

select t.expect_value($$
  select (over_inclusive_note is not null)::text
    from public.allergens_under_profile('US_FDA', array['GLUTEN_CEREALS'])$$,
  'with a note saying why, which a constraint requires', 'true');

select t.expect_refused($$
  insert into allergen_declarations
    (profile_code, substance_id, declared_as, over_inclusive)
  values ('US_FDA', 'CELERY', 'Celery', true)$$,
  'an over-inclusive declaration without a note is refused',
  'allergen_declarations_note_present');

select t.expect_value($$
  select over_inclusive::text
    from public.allergens_under_profile('US_FDA', array['WHEAT'])$$,
  'a record that actually says wheat is not over-inclusive at all', 'false');

select '── an allergen nobody recognises' as "──";

/*
 * Kept, flagged, never dropped. An allergen the registry does not know is
 * still an allergen, and tidying it out of a column is the failure this
 * whole area exists to prevent.
 */
select t.expect_value($$
  select recognised::text || '/' || substance_name
    from public.allergens_under_profile('EU_FIC', array['buckwheat'])$$,
  'an unrecognised declaration survives and says it is unrecognised',
  'false/buckwheat');

select t.expect_value($$
  select count(*)::text from public.allergens_under_profile(
    'EU_FIC', array['MILK','buckwheat'])$$,
  'beside the ones that are recognised', '2');

select '── what was already stored' as "──";

/*
 * The invariant is "normalised", not "recognised".
 *
 * An allergen the registry does not know is still stored — dropping it to
 * tidy a column is the failure this whole area exists to prevent — so the
 * thing to assert is that nothing stored differs from its own normalised
 * form. That covers the unrecognised values too, since they normalise to
 * themselves.
 */
select t.expect_value($$
  select count(*)::text from (
    select unnest(allergens) a from products
    union all select unnest(allergens) from sub_recipes
    union all select unnest(allergens) from recipes
    union all select unnest(allergens) from incidents
  ) x where a is distinct from public.normalise_allergen(a)$$,
  'nothing stored is left in a form the registry would rewrite', '0');

select t.expect_value($$
  select (count(*) > 0)::text from products where allergens @> array['MILK']$$,
  'and the informal tokens became ids rather than being lost', 'true');

/*
 * Held by a trigger rather than by the one-time pass, because `db reset`
 * runs the migrations and then loads the seeds: normalising once ran against
 * an empty catalogue and the tokens arrived afterwards.
 */
select t.expect_rows($$
  insert into products (org_id, name, category, pack_unit, status, allergens)
  select id, 'T-Normalise-Me', 'Dry', 'kg', 'ACTIVE', array['dairy','SHELLFISH']
    from organizations where name = 'Demo Kitchen'$$,
  'a product written with informal tokens', 1);

select t.expect_value($$
  select array_to_string(allergens, ',') from products
   where name = 'T-Normalise-Me'$$,
  'is stored normalised, whatever the caller sent', 'CRUSTACEANS,MILK');

select t.expect_rows($$
  update products set allergens = array['buckwheat']
   where name = 'T-Normalise-Me'$$,
  'and an allergen nobody has mapped', 1);
select t.expect_value($$
  select array_to_string(allergens, ',') from products
   where name = 'T-Normalise-Me'$$,
  'passes through unchanged rather than being refused or dropped', 'buckwheat');

select '── a venue picks one, and cannot edit the rules' as "──";

select t.expect_value($$
  select allergen_profile_code from organizations where name = 'Demo Kitchen'$$,
  'a venue defaults to the EU profile it was built under', 'EU_FIC');

set local role authenticated;
select t.act_as('a0000000-0000-0000-0000-000000000002', 'chef@test.local');

select t.expect_value($$
  select count(*)::text from allergen_declarations where profile_code = 'US_FDA'$$,
  'anybody signed in can read the rules', '10');

/*
 * A venue that could edit this could quietly stop declaring peanuts.
 */
select t.expect_fail($$
  delete from allergen_declarations
   where profile_code = 'US_FDA' and substance_id = 'PEANUTS'$$,
  'and nobody can change them through the API');
select t.expect_fail($$
  update allergen_substances set name = 'Not peanuts' where id = 'PEANUTS'$$,
  'nor rename a substance');

reset role;
rollback;
