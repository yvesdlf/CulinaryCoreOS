-- ---------------------------------------------------------------------------
-- Allergen review flag
-- ---------------------------------------------------------------------------
-- 0009 inferred allergens for imported ingredients whose names settled the
-- question — beer batter has flour in it, a cashew sauce has cashews. That was
-- the right call for the obvious cases and the wrong shape for all of them,
-- because it presented an inference as a declaration.
--
-- Whether a tom yum paste contains shrimp, or a kecap manis is brewed with
-- wheat, is a property of the brand and the batch sitting on the shelf, not of
-- the words "Tom Yum Paste". Only someone holding the jar can close that
-- question. What the app can do is refuse to let it go unasked.
--
-- So the inferred declarations stay — under-declaring is the more dangerous
-- error — but they are now marked as unverified, with a note saying what to
-- check. The flag is separate from `status`: a product can be perfectly ACTIVE
-- and still have an allergen list nobody has confirmed.
-- ---------------------------------------------------------------------------

alter table products
  add column if not exists allergens_need_review boolean not null default false,
  add column if not exists allergen_review_note  text;

comment on column products.allergens_need_review is
  'Allergen list has not been checked against the product actually purchased.';

-- Products whose allergens 0009 inferred from the name rather than read from
-- the ingredient list.
update products
   set allergens_need_review = true,
       allergen_review_note  =
         'Fermented seafood is standard in this preparation — check the brand '
         'for shrimp paste, fish sauce and anchovy before serving to a guest '
         'with a crustacean or fish allergy.'
 where name in ('Tom Yum Paste', 'Kimchi sauce');

update products
   set allergens_need_review = true,
       allergen_review_note  =
         'Indonesian glazes and marinades are usually kecap manis based, and '
         'soy sauce is normally brewed with wheat. Confirm soy and gluten '
         'against the brand used.'
 where name in ('Beef Glaze', 'Duck Marinade', 'Duck Satay Glaze',
                'Prawn Glaze', 'Soft Shell Crab Marinade');

update products
   set allergens_need_review = true,
       allergen_review_note  =
         'Imported without an allergen declaration. Confirm what is in it '
         'against the recipe or the label before relying on this list.'
 where name in ('Bao Bread', 'Beer Batter', 'Herb & Cashew Sauce',
                'Dabu Dabu Salsa', 'Frito Verde Dressing', 'Red Paprika Oil',
                'Spiced Syrup', 'carrots', 'Green beans', 'Wing beans',
                'Dried Oregano');

-- Anything else that came in with no allergen information at all and is not a
-- plain single ingredient is worth a look too, but that is a judgement the
-- kitchen makes — this migration only marks what it actually inferred.
