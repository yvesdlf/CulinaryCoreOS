-- ---------------------------------------------------------------------------
-- The grant that was never revoked
-- ---------------------------------------------------------------------------
-- Found by pointing the control suite at a hosted staging project for the
-- first time: 1,397 checks, 19 failing there and none failing locally.
--
-- One habit, repeated across the migrations. A table is created, then granted
-- what its callers need — `grant select on ai_allowances to authenticated` —
-- with no `revoke` first, because locally a new table starts with no
-- privileges and the grant is the whole story. On hosted Supabase it is not:
-- `alter default privileges ... grant all on tables to anon, authenticated`
-- is part of a hosted project's setup, so the table is born writable by
-- everybody who can sign in and the grant adds nothing. 34 of 121 migrations
-- revoke.
--
-- Measured against the local database, which is the one the suite verifies:
-- 148 of 163 tables differed. `anon` had gained SELECT on 145 of them;
-- `authenticated` had gained DELETE on 51, UPDATE on 25 and INSERT on 14.
-- Nothing had been lost anywhere.
--
-- ── What it was, and was not ──────────────────────────────────────────────
--
-- Not a breach, and that was tested rather than assumed. Row-level security
-- is on for every table an authenticated user can write to, with no
-- exceptions, and it held in every probe: an owner rewriting their own AI
-- allowance changed 0 rows, the parameter audit trail refused outright, and a
-- signed-out visitor reading employees, takings, suppliers and organisations
-- got 0 rows from each. Three policies in the whole schema are reachable by
-- `anon`, all three the allergen registry, which is public reference data.
--
-- The loss was depth. The model here is that a privilege and a policy must
-- both agree before a write lands; on hosted only the policy was arguing.
-- Twelve append-only tables — parameter_changes, work_order_events and
-- payroll_lines among them — are protected locally by the absent grant alone,
-- their update policies never reached. On hosted those policies carry the
-- weight, and `parameter_changes`' is `using (auth_can_write(org_id))`, true
-- for most of the staff. That table's privilege happened not to have been
-- granted. That is luck, and luck is not a control.
--
-- ── Two drafts that were wrong, and why this one is shaped as it is ───────
--
-- The first revoked everything from both roles and granted a full matrix
-- back, so the file would state the boundary in one place. It broke nine
-- checks: `grant select on all tables in schema public` reaches views as well
-- as tables and exposed the scheduler's job list, and a matrix derived from
-- `has_table_privilege` is blind to column-level grants. A verification that
-- compared four privilege bits per table called that rewrite a perfect no-op.
-- It was not.
--
-- The second revoked only the privileges the local database does not grant,
-- which is a no-op here by construction. It broke six, all on `employees`.
-- `has_table_privilege(…, 'employees', 'UPDATE')` is false, so the list
-- included it — but `employees` grants UPDATE on 24 named columns, and a
-- table-level `revoke update` takes a column-level grant with it. The table
-- privilege being absent is exactly what a column-granted table looks like.
--
-- So this one revokes a privilege on a table only where the local database
-- grants it neither on the table nor on any column of it. Anything managed
-- per column is left alone, views are never named, and no other privilege
-- type is touched. It cannot take away what it does not name.
-- ---------------------------------------------------------------------------

-- ── A signed-out visitor reaches the registry and nothing else ────────────
/*
 * The one place a blanket revoke is right, because the correct answer for
 * `anon` is "nothing" with named exceptions rather than a list to maintain.
 * Checked against both traps above: `anon` holds no privilege on any view
 * here and no column-level grant anywhere, so the sweep takes nothing away
 * that it should not.
 *
 * The exceptions carry no venue's data — the allergen substances and the
 * profiles saying which must be declared are the same for every venue.
 */
revoke all on all tables in schema public from anon;
grant select on allergen_substances, allergen_profiles, allergen_declarations
  to anon;

-- ── A member cannot write what a member may not write ─────────────────────
/*
 * Append-only ledgers, prices that were charged, the platform's own tables
 * and the section grid. Locally none of these is granted, on the table or on
 * any column; on a hosted project all of them were.
 */
revoke insert on
  ai_allowances, ai_usage, allergen_declarations, allergen_profiles,
  allergen_substances, app_sections, document_sequences, leave_carryover,
  message_channel_secrets, message_deliveries, message_endpoint_origins,
  organization_seeders, organizations, parameter_changes, payroll_lines,
  payroll_runs, plan_sections, plans, privacy_actions, receipt_line_charges,
  request_events, room_state_events, section_read_rules, storage_api,
  storage_deletions, subscription_packs, subscriptions, takings_changes,
  work_order_events
  from authenticated;

revoke update on
  ai_allowances, ai_usage, allergen_declarations, allergen_profiles,
  allergen_substances, app_sections, approval_events, attachments,
  cooling_readings, document_sequences, exchange_rates,
  housekeeping_inspections, hr_case_participants, label_prints,
  leave_carryover, message_channel_secrets, message_deliveries,
  message_endpoint_origins, meter_readings, organization_seeders,
  parameter_changes, payroll_lines, payroll_runs, plan_sections, plans,
  privacy_actions, product_aliases, production_plan_lines,
  production_records, receipt_line_charges, recipe_status_events,
  request_events, room_state_events, sales_lines, section_read_rules,
  staff_availability, stock_movements, storage_api, storage_deletions,
  subscription_packs, subscriptions, supplier_prices, takings_changes,
  work_order_events
  from authenticated;

revoke delete on
  accounting_periods, ai_allowances, ai_usage, allergen_declarations,
  allergen_profiles, allergen_substances, app_sections, approval_events,
  attachments, checklist_answers, checklist_forms, checklist_runs,
  cooling_logs, cooling_readings, document_sequences, employee_private,
  exchange_rates, haccp_records, hiring_requests, housekeeping_inspections,
  hr_case_participants, hr_cases, incidents, label_prints,
  leave_attachments, leave_carryover, lost_property,
  message_channel_secrets, message_deliveries, message_endpoint_origins,
  meter_readings, notifications, observation_checklists,
  organization_invitations, organization_seeders, organizations,
  parameter_changes, payroll_lines, payroll_runs, plan_sections, plans,
  privacy_actions, production_records, quiz_written_answers,
  receipt_line_charges, recipe_status_events, request_events, requests,
  room_state_events, section_read_rules, shift_swap_requests,
  staff_requests, stock_lots, stock_movements, stocktake_lines, stocktakes,
  storage_api, storage_deletions, subscription_packs, subscriptions,
  supplier_credit_notes, supplier_prices, supplier_returns, supplier_users,
  takings_changes, time_corrections, time_entries, venue_parameters,
  work_order_events, work_orders
  from authenticated;

-- ── The next table should not be born writable ────────────────────────────
/*
 * Only partly within this migration's reach, and worth stating plainly rather
 * than leaving as a false reassurance.
 *
 * Default privileges belong to the role that will create the object. This
 * removes those owned by the role running the migration, so a table created
 * by a future migration inherits nothing. The grant that caused all of this,
 * though, is owned by `supabase_admin` — a hosted project's own setup — which
 * this role cannot alter, and a table created by that role will still be born
 * writable.
 *
 * `63_the_privilege_boundary.sql` is the real guard. Its first assertion
 * sweeps every table in the schema rather than a list, so a table born with
 * the hosted defaults shows up the first time the suite runs against that
 * database. Which only helps if the suite is pointed at one: see DEPLOY.md §1.
 */
alter default privileges in schema public
  revoke all on tables from anon, authenticated;
