-- ---------------------------------------------------------------------------
-- Method
-- ---------------------------------------------------------------------------
-- Until now a recipe has been a list of ingredients with costs against it,
-- which is a costing rather than a recipe. The sheets that go on a pass are
-- read by someone cooking, and nothing in the model told them what to do.
--
-- Stored as ordered text steps rather than one blob. A step is the unit a cook
-- works in — followed, timed, ticked off — and a paragraph cannot be numbered
-- on a printed sheet or, later, checked off on a screen. Kept as a plain array
-- rather than its own table because a step has no identity of its own: it
-- belongs to exactly one recipe, is never referenced, and reordering a table
-- would cost a position column and a join to save nothing.
--
-- Two more fields the print template (DOC4 §11.3) calls for and the model
-- lacked: prep and cook time, which is what a section head schedules against.
-- ---------------------------------------------------------------------------

alter table recipes
  add column if not exists method text[] not null default '{}',
  add column if not exists prep_minutes int,
  add column if not exists cook_minutes int,
  -- Distinct from method: things that must not reach a printed sheet, like
  -- "supplier substitutes cheaper cream — watch it".
  add column if not exists internal_notes text;

alter table sub_recipes
  add column if not exists method text[] not null default '{}',
  add column if not exists prep_minutes int,
  add column if not exists cook_minutes int,
  add column if not exists internal_notes text;

comment on column recipes.method is
  'Ordered preparation steps. One entry per step, so a sheet can number them.';
comment on column recipes.internal_notes is
  'Not printed. Kitchen-internal remarks that should not reach a guest-facing '
  'or supplier-facing sheet.';
