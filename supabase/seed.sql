-- CulinaryCoreOS seed data — GENERATED, do not edit by hand.
-- Regenerate with: pnpm --filter web seed:generate
--
-- Idempotent: truncating first means `supabase db reset` and a re-run of
-- this file both land on the same state.
--
-- LOCAL DEVELOPMENT ONLY. This creates a user with a known password so the
-- seeded catalogue can be signed into. Never load it into a hosted project.

truncate table recipe_lines, sub_recipe_lines, recipes, sub_recipes, products cascade;

-- Demo organization -------------------------------------------------------
insert into organizations (id, name, slug) values
  ('a7d63561-c014-53f4-9bd1-4273d5625836', 'Demo Kitchen', 'demo')
on conflict (id) do nothing;

-- Demo user ---------------------------------------------------------------
-- GoTrue reads these token columns as NOT NULL strings; leaving them NULL
-- makes every sign-in fail with 'converting NULL to string is unsupported'.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change_token_new,
  email_change_token_current, email_change, phone_change,
  phone_change_token, reauthentication_token
) values (
  '00000000-0000-0000-0000-000000000000',
  '11111111-1111-4111-8111-111111111111', 'authenticated', 'authenticated', 'demo@culinarycore.local',
  crypt('demo-password-123', gen_salt('bf')),
  now(), now(), now(),
  '{"provider":"email","providers":["email"]}', '{}',
  '', '', '', '', '', '', '', ''
) on conflict (id) do nothing;

insert into auth.identities (
  provider_id, user_id, identity_data, provider,
  last_sign_in_at, created_at, updated_at
) values (
  '11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111',
  jsonb_build_object('sub', '11111111-1111-4111-8111-111111111111', 'email', 'demo@culinarycore.local', 'email_verified', true),
  'email', now(), now(), now()
) on conflict (provider, provider_id) do nothing;

-- handle_new_user() gave the user its own organization; drop that and put
-- them in the demo org so they see the seeded catalogue.
delete from organizations
 where slug <> 'demo'
   and id in (select organization_id from organization_members
              where user_id = '11111111-1111-4111-8111-111111111111');

insert into organization_members (organization_id, user_id, role) values
  ('a7d63561-c014-53f4-9bd1-4273d5625836', '11111111-1111-4111-8111-111111111111', 'OWNER')
on conflict (organization_id, user_id) do update set role = 'OWNER';

-- Products
insert into products (id, category, supplier, name, brand, pack_qty, pack_unit, units_per_pack, units_per_pack_unit, total_qty, total_unit, buying_price_per_pack, buying_price_per_unit, gross_price_per_unit, nett_price_per_unit, gross_qty, gross_unit, waste_qty, waste_unit, nett_qty, nett_unit, ref_percent, yield_percent, status, fat_g, carbs_g, protein_g, vit_a_mg, vit_c_mg, calcium_mg, iron_mg, sodium_mg, kcal, allergens, org_id) values
  ('0ea4c89b-e9b8-569c-a127-2085667cb022', 'Dairy', 'Al Rawabi', 'Butter (Unsalted)', 'Lurpak', 1, 'blk', 10000, 'g', 10000, 'g', 755510, 75.55100, 75.55100, 75.55100, 1000, 'g', 0, 'g', 1000, 'g', 0, 100, 'ACTIVE', 81, 0.1, 0.9, 0.68, 0, 24, 0, 11, 717, '{"dairy"}', 'a7d63561-c014-53f4-9bd1-4273d5625836'),
  ('29b42821-af66-56fe-9407-bf8de3bfce05', 'Dairy', 'Al Rawabi', 'Heavy Cream 35%', 'President', 1, 'ctn', 1000, 'ml', 1000, 'ml', 79550, 79.55000, 79.55000, 79.55000, 1000, 'ml', 0, 'ml', 1000, 'ml', 0, 100, 'ACTIVE', 35, 3.2, 2.1, 0.4, 0.6, 65, 0, 38, 337, '{"dairy"}', 'a7d63561-c014-53f4-9bd1-4273d5625836'),
  ('6a23b6ca-1cc7-55f9-b72b-55aa2ab02ae9', 'Dairy', 'Metro Foods', 'Mozzarella (Fior di Latte)', 'Galbani', 1, 'bag', 1000, 'g', 1000, 'g', 180600, 180.60000, 180.60000, 180.60000, 1000, 'g', 50, 'g', 950, 'g', 5, 95, 'ACTIVE', 22, 2.2, 22, 0.18, 0, 505, 0.4, 627, 300, '{"dairy"}', 'a7d63561-c014-53f4-9bd1-4273d5625836'),
  ('16493a87-dd13-509d-8f95-58fb7e3200c3', 'Dairy', 'Metro Foods', 'Parmesan (Parmigiano Reggiano)', 'Zanetti', 1, 'whl', 2000, 'g', 2000, 'g', 795500, 397.75000, 397.75000, 397.75000, 1000, 'g', 100, 'g', 900, 'g', 10, 90, 'ACTIVE', 29, 3.2, 36, 0.21, 0, 1184, 0.8, 1602, 420, '{"dairy"}', 'a7d63561-c014-53f4-9bd1-4273d5625836'),
  ('304509b5-58ca-59b8-9a73-68abc6b7507d', 'Meat', 'Bidfood', 'Beef Tenderloin', 'Black Angus', 1, 'pc', 2500, 'g', 2500, 'g', 1612500, 645.00000, 645.00000, 806.25000, 1000, 'g', 200, 'g', 800, 'g', 20, 80, 'ACTIVE', 6, 0, 26, 0, 0, 7, 3.4, 54, 158, '{}', 'a7d63561-c014-53f4-9bd1-4273d5625836'),
  ('30fc0d91-0517-554d-9768-2fad6d929e09', 'Meat', 'Bidfood', 'Ground Beef (80/20)', null, 1, 'bag', 5000, 'g', 5000, 'g', 838500, 167.70000, 167.70000, 167.70000, 1000, 'g', 0, 'g', 1000, 'g', 0, 100, 'ACTIVE', 20, 0, 17, 0, 0, 18, 2.1, 66, 254, '{}', 'a7d63561-c014-53f4-9bd1-4273d5625836'),
  ('5e372da7-ef28-5d0f-b39a-bde889242030', 'Meat', 'Bidfood', 'Lamb Rack (Frenched)', 'Australian', 1, 'pc', 1200, 'g', 1200, 'g', 722400, 602.00000, 602.00000, 752.50000, 1000, 'g', 200, 'g', 800, 'g', 20, 80, 'ACTIVE', 25, 0, 21, 0, 0, 17, 1.9, 65, 309, '{}', 'a7d63561-c014-53f4-9bd1-4273d5625836'),
  ('9f67351b-f67f-5a75-9b65-1be5a0dfc1e2', 'Poultry', 'Al Islami', 'Chicken Breast (Boneless)', 'Al Islami', 1, 'bag', 2500, 'g', 2500, 'g', 290250, 116.10000, 116.10000, 129.00000, 1000, 'g', 100, 'g', 900, 'g', 10, 90, 'ACTIVE', 3.6, 0, 31, 0, 0, 15, 1, 74, 165, '{}', 'a7d63561-c014-53f4-9bd1-4273d5625836'),
  ('7598406e-2fc7-52d1-8d04-c52a980d0b3a', 'Seafood', 'Seafood Souq', 'Salmon Fillet (Norwegian)', null, 1, 'pc', 1500, 'g', 1500, 'g', 580500, 387.00000, 387.00000, 455.28400, 1000, 'g', 150, 'g', 850, 'g', 15, 85, 'ACTIVE', 13, 0, 20, 0.04, 0, 12, 0.8, 44, 208, '{"fish"}', 'a7d63561-c014-53f4-9bd1-4273d5625836'),
  ('57c74690-8205-5d5c-8b35-66821450ff85', 'Seafood', 'Seafood Souq', 'Prawns (16/20, Head-Off)', null, 1, 'bag', 1000, 'g', 1000, 'g', 408500, 408.50000, 408.50000, 510.84000, 1000, 'g', 200, 'g', 800, 'g', 20, 80, 'ACTIVE', 0.3, 0.2, 24, 0, 2, 52, 0.2, 111, 99, '{"shellfish"}', 'a7d63561-c014-53f4-9bd1-4273d5625836'),
  ('e261f11e-b6a3-5f12-b77e-0ac3883a7d2b', 'Produce', 'Local Farm', 'Tomato (Vine-Ripened)', null, 1, 'box', 5000, 'g', 5000, 'g', 107500, 21.50000, 21.50000, 23.90800, 1000, 'g', 100, 'g', 900, 'g', 10, 90, 'ACTIVE', 0.2, 3.9, 0.9, 0.04, 14, 10, 0.3, 5, 18, '{}', 'a7d63561-c014-53f4-9bd1-4273d5625836'),
  ('b32aba2e-3228-506c-8b66-55d453f632ad', 'Produce', 'Local Farm', 'Onion (Yellow)', null, 1, 'bag', 5000, 'g', 5000, 'g', 51600, 10.32000, 10.32000, 11.48100, 1000, 'g', 100, 'g', 900, 'g', 10, 90, 'ACTIVE', 0.1, 9.3, 1.1, 0, 7.4, 23, 0.2, 4, 40, '{}', 'a7d63561-c014-53f4-9bd1-4273d5625836'),
  ('1bc43d98-0e14-58db-877e-b71d12b1b79c', 'Produce', 'Local Farm', 'Garlic', null, 1, 'bag', 1000, 'g', 1000, 'g', 64500, 64.50000, 64.50000, 75.89500, 1000, 'g', 150, 'g', 850, 'g', 15, 85, 'ACTIVE', 0.5, 33, 6.4, 0, 31.2, 181, 1.7, 17, 149, '{}', 'a7d63561-c014-53f4-9bd1-4273d5625836'),
  ('5fb304a5-aee2-5a29-8942-c6b6dbe564ce', 'Produce', 'Local Farm', 'Lemon', null, 1, 'box', 3000, 'g', 3000, 'g', 77400, 25.80000, 25.80000, 32.25000, 1000, 'g', 200, 'g', 800, 'g', 20, 80, 'ACTIVE', 0.3, 9.3, 1.1, 0, 53, 26, 0.6, 2, 29, '{}', 'a7d63561-c014-53f4-9bd1-4273d5625836'),
  ('8b9551e1-7eb9-56cc-a215-8dae42138a0e', 'Produce', 'Local Farm', 'Avocado (Hass)', null, 1, 'box', 4000, 'g', 4000, 'g', 309600, 77.40000, 77.40000, 110.55300, 1000, 'g', 300, 'g', 700, 'g', 30, 70, 'ACTIVE', 15, 8.5, 2, 0.01, 10, 12, 0.6, 7, 160, '{}', 'a7d63561-c014-53f4-9bd1-4273d5625836'),
  ('c3343dbc-33b4-5b87-a992-713fe786fa26', 'Dry Goods', 'Bidfood', 'All-Purpose Flour', 'KFMB', 1, 'bag', 25000, 'g', 25000, 'g', 180600, 7.22400, 7.22400, 7.22400, 1000, 'g', 0, 'g', 1000, 'g', 0, 100, 'ACTIVE', 1, 76, 10, 0, 0, 15, 4.6, 2, 364, '{"gluten"}', 'a7d63561-c014-53f4-9bd1-4273d5625836'),
  ('43a30f32-6b94-52d6-b86b-1b2051ec36d5', 'Dry Goods', 'Bidfood', 'Fine Sea Salt', 'Cerebos', 1, 'bag', 1000, 'g', 1000, 'g', 23650, 23.65000, 23.65000, 23.65000, 1000, 'g', 0, 'g', 1000, 'g', 0, 100, 'ACTIVE', 0, 0, 0, 0, 0, 24, 0.3, 38758, 0, '{}', 'a7d63561-c014-53f4-9bd1-4273d5625836'),
  ('55c8184e-4fc3-568b-9364-f24cad4cae88', 'Oils & Vinegars', 'Metro Foods', 'Extra Virgin Olive Oil', 'Filippo Berio', 1, 'btl', 5000, 'ml', 5000, 'ml', 382700, 76.54000, 76.54000, 76.54000, 1000, 'ml', 0, 'ml', 1000, 'ml', 0, 100, 'ACTIVE', 100, 0, 0, 0, 0, 1, 0.6, 2, 884, '{}', 'a7d63561-c014-53f4-9bd1-4273d5625836'),
  ('e5b6788d-51d7-534f-ab2c-9c5f184a4b62', 'Dry Goods', 'Bidfood', 'Black Pepper (Ground)', 'McCormick', 1, 'jar', 500, 'g', 500, 'g', 150500, 301.00000, 301.00000, 301.00000, 1000, 'g', 0, 'g', 1000, 'g', 0, 100, 'ACTIVE', 3.3, 64, 10, 0, 0, 443, 9.7, 20, 251, '{}', 'a7d63561-c014-53f4-9bd1-4273d5625836'),
  ('9846b377-cd3c-5981-87d0-fd55a216ba25', 'Spices', 'Metro Foods', 'Paprika (Smoked)', 'McCormick', 1, 'jar', 500, 'g', 500, 'g', 120400, 240.80000, 240.80000, 240.80000, 1000, 'g', 0, 'g', 1000, 'g', 0, 100, 'ACTIVE', 13, 54, 14, 0, 0, 229, 21.1, 68, 282, '{}', 'a7d63561-c014-53f4-9bd1-4273d5625836');

-- Sub-recipes
insert into sub_recipes (id, name, category, status, batch_yield_qty, batch_yield_unit, total_cost, cost_per_unit, security_margin_percent, fat_g, carbs_g, protein_g, vit_a_mg, vit_c_mg, calcium_mg, iron_mg, sodium_mg, kcal, allergens, version, org_id) values
  ('d65a0fbe-013a-5f6f-9a47-2a5b598c9e72', 'Chimichurri Base', 'Sauce', 'ACTUAL', 2000, 'g', 71476, 35.73806, 5, 40, 2.5, 0.8, 0, 12, 8, 0.4, 3, 370, '{}', 1, 'a7d63561-c014-53f4-9bd1-4273d5625836'),
  ('e9564d14-c770-53fc-a747-55c0baa709f6', 'Pizza Dough', 'Bakery', 'ACTUAL', 3000, 'g', 16138, 5.37930, 5, 2.5, 50, 8, 0, 0, 12, 3.2, 380, 260, '{"gluten"}', 1, 'a7d63561-c014-53f4-9bd1-4273d5625836'),
  ('3f981e8e-95df-5a62-8ea3-18465ea379c7', 'Mashed Potato', 'Sides', 'ACTUAL', 2000, 'g', 39330, 19.66498, 5, 8, 15, 2, 0.1, 8, 20, 0.3, 250, 140, '{"dairy"}', 1, 'a7d63561-c014-53f4-9bd1-4273d5625836'),
  ('183a1fcd-7123-5dbd-8196-81c3efa46016', 'Chocolate Ganache', 'Pastry', 'ACTUAL', 1000, 'g', 43671, 43.67080, 5, 22, 35, 4, 0.05, 0, 40, 2.5, 15, 360, '{"dairy"}', 1, 'a7d63561-c014-53f4-9bd1-4273d5625836'),
  ('c2dcb806-7a8a-5dbb-a9e5-0532d7d41895', 'Burger Sauce', 'Sauce', 'ACTUAL', 500, 'g', 3058, 6.11696, 5, 18, 12, 1.5, 0, 4, 15, 0.2, 520, 220, '{"egg"}', 1, 'a7d63561-c014-53f4-9bd1-4273d5625836');

-- Sub-recipe lines
insert into sub_recipe_lines (sub_recipe_id, line_number, product_id, nett_qty, nett_unit, ref_percent, gross_qty, gross_unit, cost_per_unit, line_cost, child_sub_recipe_id) values
  ('d65a0fbe-013a-5f6f-9a47-2a5b598c9e72', 1, '1bc43d98-0e14-58db-877e-b71d12b1b79c', 50, 'g', 15, 58.82, 'g', 64.50000, 3794, null),
  ('d65a0fbe-013a-5f6f-9a47-2a5b598c9e72', 2, '55c8184e-4fc3-568b-9364-f24cad4cae88', 800, 'ml', 0, 800, 'ml', 76.54000, 61232, null),
  ('d65a0fbe-013a-5f6f-9a47-2a5b598c9e72', 3, '5fb304a5-aee2-5a29-8942-c6b6dbe564ce', 200, 'g', 20, 250, 'g', 25.80000, 6450, null),
  ('e9564d14-c770-53fc-a747-55c0baa709f6', 1, 'c3343dbc-33b4-5b87-a992-713fe786fa26', 1500, 'g', 0, 1500, 'g', 7.22400, 10836, null),
  ('e9564d14-c770-53fc-a747-55c0baa709f6', 2, '43a30f32-6b94-52d6-b86b-1b2051ec36d5', 30, 'g', 0, 30, 'g', 23.65000, 710, null),
  ('e9564d14-c770-53fc-a747-55c0baa709f6', 3, '55c8184e-4fc3-568b-9364-f24cad4cae88', 60, 'ml', 0, 60, 'ml', 76.54000, 4592, null),
  ('3f981e8e-95df-5a62-8ea3-18465ea379c7', 1, '0ea4c89b-e9b8-569c-a127-2085667cb022', 200, 'g', 0, 200, 'g', 75.55100, 15110, null),
  ('3f981e8e-95df-5a62-8ea3-18465ea379c7', 2, '29b42821-af66-56fe-9407-bf8de3bfce05', 300, 'ml', 0, 300, 'ml', 79.55000, 23865, null),
  ('3f981e8e-95df-5a62-8ea3-18465ea379c7', 3, '43a30f32-6b94-52d6-b86b-1b2051ec36d5', 15, 'g', 0, 15, 'g', 23.65000, 355, null),
  ('183a1fcd-7123-5dbd-8196-81c3efa46016', 1, '29b42821-af66-56fe-9407-bf8de3bfce05', 500, 'ml', 0, 500, 'ml', 79.55000, 39775, null),
  ('183a1fcd-7123-5dbd-8196-81c3efa46016', 2, '0ea4c89b-e9b8-569c-a127-2085667cb022', 50, 'g', 0, 50, 'g', 75.55100, 3778, null),
  ('183a1fcd-7123-5dbd-8196-81c3efa46016', 3, '43a30f32-6b94-52d6-b86b-1b2051ec36d5', 5, 'g', 0, 5, 'g', 23.65000, 118, null),
  ('c2dcb806-7a8a-5dbb-a9e5-0532d7d41895', 1, 'b32aba2e-3228-506c-8b66-55d453f632ad', 50, 'g', 10, 55.56, 'g', 10.32000, 573, null),
  ('c2dcb806-7a8a-5dbb-a9e5-0532d7d41895', 2, '1bc43d98-0e14-58db-877e-b71d12b1b79c', 20, 'g', 15, 23.53, 'g', 64.50000, 1518, null),
  ('c2dcb806-7a8a-5dbb-a9e5-0532d7d41895', 3, '5fb304a5-aee2-5a29-8942-c6b6dbe564ce', 30, 'g', 20, 37.5, 'g', 25.80000, 968, null);

-- Recipes
insert into recipes (id, name, category, status, yield_qty, yield_unit, price_incl_vat, price_excl_vat, total_cost, total_cost_with_margin, gross_contribution_margin, food_cost_percent, currency, fat_g, carbs_g, protein_g, vit_a_mg, vit_c_mg, calcium_mg, iron_mg, sodium_mg, kcal, gluten_free, dairy_free, vegetarian, vegan, nuts_free, soy_free, sulfites_free, allergens, version, org_id) values
  ('b9e9f52d-f76c-56fd-aa68-67e21327df9f', 'Tenderloin Pepper', '05.MAINS', 'ACTUAL', 1, 'por', 795500, 716667, 191444, 201016, 515651, 28, 'IDR', 38, 16, 62, 0.12, 8, 55, 8.2, 380, 650, true, false, false, false, true, true, true, '{"dairy"}', 1, 'a7d63561-c014-53f4-9bd1-4273d5625836'),
  ('f0fcf78e-c9db-5277-87ec-a9b9624a7b70', 'Grilled Salmon', '05.MAINS', 'ACTUAL', 1, 'por', 623500, 561712, 95462, 100235, 461476, 17.8, 'IDR', 32, 4, 44, 0.04, 18, 30, 2.1, 280, 480, true, true, false, false, true, true, true, '{"fish"}', 1, 'a7d63561-c014-53f4-9bd1-4273d5625836'),
  ('58f1a7fc-ce61-553a-a309-b0e70e684999', 'Caesar Salad', '02.SALADS', 'ACTUAL', 1, 'por', 279500, 251802, 32192, 33801, 218001, 13.4, 'IDR', 18, 6, 52, 0.05, 14, 340, 2.4, 520, 395, true, false, false, false, true, true, true, '{"dairy"}', 1, 'a7d63561-c014-53f4-9bd1-4273d5625836'),
  ('19904224-c420-5f0e-b03e-a61d81394095', 'Margherita Pizza', '09.PIZZA', 'ACTUAL', 1, 'por', 322500, 290541, 28668, 30101, 260440, 10.4, 'IDR', 16, 72, 28, 0.1, 12, 520, 4.8, 850, 545, false, false, true, false, true, true, true, '{"gluten","dairy"}', 1, 'a7d63561-c014-53f4-9bd1-4273d5625836'),
  ('d61b9cda-c05f-5a71-b6e2-ddfb4de030d5', 'Chocolate Fondant', '10.DESSERT', 'ACTUAL', 4, 'por', 236500, 213063, 26968, 28316, 184747, 13.3, 'IDR', 28, 32, 5, 0.15, 0, 45, 3.2, 45, 400, false, false, true, false, true, true, true, '{"dairy","gluten"}', 1, 'a7d63561-c014-53f4-9bd1-4273d5625836');

-- Recipe lines
insert into recipe_lines (recipe_id, line_number, product_id, nett_qty, nett_unit, ref_percent, gross_qty, gross_unit, cost_per_unit, line_cost, sub_recipe_id) values
  ('b9e9f52d-f76c-56fd-aa68-67e21327df9f', 1, '304509b5-58ca-59b8-9a73-68abc6b7507d', 220, 'g', 20, 275, 'g', 645.00000, 177375, null),
  ('b9e9f52d-f76c-56fd-aa68-67e21327df9f', 2, '0ea4c89b-e9b8-569c-a127-2085667cb022', 30, 'g', 0, 30, 'g', 75.55100, 2267, null),
  ('b9e9f52d-f76c-56fd-aa68-67e21327df9f', 3, 'e5b6788d-51d7-534f-ab2c-9c5f184a4b62', 5, 'g', 0, 5, 'g', 301.00000, 1505, null),
  ('b9e9f52d-f76c-56fd-aa68-67e21327df9f', 4, '29b42821-af66-56fe-9407-bf8de3bfce05', 80, 'ml', 0, 80, 'ml', 79.55000, 6364, null),
  ('b9e9f52d-f76c-56fd-aa68-67e21327df9f', 5, null, 200, 'g', 0, 200, 'g', 19.66498, 3933, '3f981e8e-95df-5a62-8ea3-18465ea379c7'),
  ('f0fcf78e-c9db-5277-87ec-a9b9624a7b70', 1, '7598406e-2fc7-52d1-8d04-c52a980d0b3a', 200, 'g', 15, 235.29, 'g', 387.00000, 91059, null),
  ('f0fcf78e-c9db-5277-87ec-a9b9624a7b70', 2, '5fb304a5-aee2-5a29-8942-c6b6dbe564ce', 30, 'g', 20, 37.5, 'g', 25.80000, 968, null),
  ('f0fcf78e-c9db-5277-87ec-a9b9624a7b70', 3, '55c8184e-4fc3-568b-9364-f24cad4cae88', 20, 'ml', 0, 20, 'ml', 76.54000, 1531, null),
  ('f0fcf78e-c9db-5277-87ec-a9b9624a7b70', 4, '43a30f32-6b94-52d6-b86b-1b2051ec36d5', 5, 'g', 0, 5, 'g', 23.65000, 118, null),
  ('f0fcf78e-c9db-5277-87ec-a9b9624a7b70', 5, null, 50, 'g', 0, 50, 'g', 35.73806, 1787, 'd65a0fbe-013a-5f6f-9a47-2a5b598c9e72'),
  ('58f1a7fc-ce61-553a-a309-b0e70e684999', 1, '9f67351b-f67f-5a75-9b65-1be5a0dfc1e2', 150, 'g', 10, 166.67, 'g', 116.10000, 19350, null),
  ('58f1a7fc-ce61-553a-a309-b0e70e684999', 2, '16493a87-dd13-509d-8f95-58fb7e3200c3', 25, 'g', 10, 27.78, 'g', 397.75000, 11049, null),
  ('58f1a7fc-ce61-553a-a309-b0e70e684999', 3, '5fb304a5-aee2-5a29-8942-c6b6dbe564ce', 20, 'g', 20, 25, 'g', 25.80000, 645, null),
  ('58f1a7fc-ce61-553a-a309-b0e70e684999', 4, '55c8184e-4fc3-568b-9364-f24cad4cae88', 15, 'ml', 0, 15, 'ml', 76.54000, 1148, null),
  ('19904224-c420-5f0e-b03e-a61d81394095', 1, null, 280, 'g', 0, 280, 'g', 5.37930, 1506, 'e9564d14-c770-53fc-a747-55c0baa709f6'),
  ('19904224-c420-5f0e-b03e-a61d81394095', 2, 'e261f11e-b6a3-5f12-b77e-0ac3883a7d2b', 150, 'g', 10, 166.67, 'g', 21.50000, 3583, null),
  ('19904224-c420-5f0e-b03e-a61d81394095', 3, '6a23b6ca-1cc7-55f9-b72b-55aa2ab02ae9', 120, 'g', 5, 126.32, 'g', 180.60000, 22813, null),
  ('19904224-c420-5f0e-b03e-a61d81394095', 4, '55c8184e-4fc3-568b-9364-f24cad4cae88', 10, 'ml', 0, 10, 'ml', 76.54000, 765, null),
  ('d61b9cda-c05f-5a71-b6e2-ddfb4de030d5', 1, null, 400, 'g', 0, 400, 'g', 43.67080, 17468, '183a1fcd-7123-5dbd-8196-81c3efa46016'),
  ('d61b9cda-c05f-5a71-b6e2-ddfb4de030d5', 2, '0ea4c89b-e9b8-569c-a127-2085667cb022', 120, 'g', 0, 120, 'g', 75.55100, 9066, null),
  ('d61b9cda-c05f-5a71-b6e2-ddfb4de030d5', 3, 'c3343dbc-33b4-5b87-a992-713fe786fa26', 60, 'g', 0, 60, 'g', 7.22400, 433, null);
