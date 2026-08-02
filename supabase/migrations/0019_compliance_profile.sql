-- ---------------------------------------------------------------------------
-- Compliance profile — jurisdiction, tax and food-law regime per organisation
-- ---------------------------------------------------------------------------
-- Until now the jurisdiction was a comment in a constants file: 21% described
-- as "11% Indonesian PPN + 10% service charge", a currency of IDR, and an
-- allergen list that happens to be the EU's fourteen.
--
-- Those are three different decisions and they were tangled into one. A venue
-- operating under EU food law is not necessarily invoicing in euro, and a tax
-- percentage means nothing without knowing whether it is VAT, a service
-- charge, or both added together — the arithmetic is identical and the legal
-- meaning is not. A service charge is the venue's revenue and is itself
-- taxable; VAT is collected for the state. Adding them into one number works
-- only until somebody has to file a return or reclaim input tax.
--
-- So they become explicit fields, and the rates stay configurable rather than
-- compiled in. EU VAT is not one rate: most member states put restaurant food
-- on a reduced rate and alcohol on the standard rate, so a single figure
-- cannot be right for a venue that serves both.
-- ---------------------------------------------------------------------------

alter table organizations
  -- ISO 3166-1 alpha-2, or 'EU' where a specific member state is not yet set.
  add column if not exists country_code text not null default 'EU',
  -- Which food-information law the allergen and labelling rules follow.
  add column if not exists food_regime text not null default 'EU_1169_2011',
  add column if not exists currency_code text not null default 'IDR',

  -- The rate charged on things that are not reduced-rated: alcohol, and food
  -- in the member states that do not reduce it.
  add column if not exists standard_vat_percent numeric(6,3) not null default 21,
  -- Restaurant and catering services, where the member state reduces them.
  -- Null means this venue has no reduced rate and everything is standard.
  add column if not exists reduced_vat_percent numeric(6,3),

  -- Charged on top of the menu price and kept by the venue. Not a tax, and in
  -- most of the EU it is itself subject to VAT — which is exactly why it can
  -- no longer be folded into the tax percentage.
  add column if not exists service_charge_percent numeric(6,3) not null default 0,

  -- Menu prices are held excluding tax throughout the costing chain. Recorded
  -- rather than assumed, because a venue quoting tax-inclusive prices needs
  -- every derived figure to run the other way.
  add column if not exists prices_include_tax boolean not null default false;

comment on column organizations.food_regime is
  'Food information law followed: EU_1169_2011 for the EU 14 allergens and their labelling rules.';
comment on column organizations.standard_vat_percent is
  'Standard VAT rate. Applies to alcohol, and to food where the member state does not reduce it.';
comment on column organizations.reduced_vat_percent is
  'Reduced VAT rate for restaurant and catering services. Null where the venue has none.';
comment on column organizations.service_charge_percent is
  'Service charge kept by the venue. Not a tax; usually itself subject to VAT.';

-- The demo organisation operates under EU food law at the EU standard rate.
-- The reduced rate is deliberately left null: which one applies depends on the
-- member state, and guessing it would understate tax on every food line.
update organizations
   set country_code = 'EU',
       food_regime = 'EU_1169_2011',
       standard_vat_percent = 21,
       service_charge_percent = 0;
