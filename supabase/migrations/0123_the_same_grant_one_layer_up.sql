-- ---------------------------------------------------------------------------
-- The same grant, one layer up
-- ---------------------------------------------------------------------------
-- 0122 fixed the tables and the staging run went from 19 failures to 4. Three
-- of the four were the identical bug on functions:
--
--     attempt_delivery   local: postgres, service_role
--                      hosted: postgres, service_role, authenticated
--
-- PostgreSQL grants EXECUTE on a new function to PUBLIC by default, and a
-- hosted project adds its own grants on top, so a migration that writes
-- `grant execute on function f to authenticated, service_role` without
-- revoking first is again describing a privilege the function already had.
-- Locally the same line is the whole story, so the suite agreed with itself
-- and nobody looked.
--
-- What this reaches that 0122 did not: `drain_outbox` and `attempt_delivery`
-- send the venue's messages, and `authenticated` could call both. Not a read
-- of anybody's data, but any signed-in user could drain the outbox or force a
-- delivery attempt — the scheduler's job, taken out of the scheduler's hands.
--
-- Shaped like 0122: a function is named here only where the local database
-- withholds EXECUTE from `authenticated`, so this file is a no-op locally by
-- construction and cannot take away anything it does not name. Functions are
-- revoked by identity arguments because an overload is a different function
-- and `revoke ... on function f` without them is ambiguous.
--
-- `anon` is left alone deliberately. It may execute exactly two functions
-- locally — `allergens_under_profile` and `apply_venue_timezone`, both pure
-- and holding no venue data — and both are reachable on hosted too, so there
-- is nothing to correct.
-- ---------------------------------------------------------------------------

revoke execute on function public.attempt_delivery(p_delivery uuid) from authenticated;
revoke execute on function public.chase_unanswered_requests(p_now timestamp with time zone, p_limit integer) from authenticated;
revoke execute on function public.drain_outbox(p_now timestamp with time zone, p_limit integer) from authenticated;
revoke execute on function public.escalation_chain(p_unit uuid) from authenticated;
revoke execute on function public.expired_attachments(p_limit integer) from authenticated;
revoke execute on function public.link_employee_record(p_user uuid, p_email text) from authenticated;
revoke execute on function public.notify(p_org uuid, p_kind notification_kind, p_subject text, p_body text, p_role org_role, p_supplier uuid, p_entity_type text, p_entity_id uuid) from authenticated;
revoke execute on function public.reconcile_deliveries() from authenticated;
revoke execute on function public.refresh_section_unit_scoping() from authenticated;
revoke execute on function public.require_employee() from authenticated;
revoke execute on function public.seed_business_units(p_org uuid) from authenticated;
revoke execute on function public.seed_cooling_parameters(p_org uuid) from authenticated;
revoke execute on function public.seed_delivery_temperature_parameter(p_org uuid) from authenticated;
revoke execute on function public.seed_forecast_parameter(p_org uuid) from authenticated;
revoke execute on function public.seed_haccp_forms(p_org uuid) from authenticated;
revoke execute on function public.seed_haccp_forms_on_create() from authenticated;
revoke execute on function public.seed_housekeeping_defaults(p_org uuid) from authenticated;
revoke execute on function public.seed_leave_carryover_parameter(p_org uuid) from authenticated;
revoke execute on function public.seed_maintenance_defaults(p_org uuid) from authenticated;
revoke execute on function public.seed_media_defaults(p_org uuid) from authenticated;
revoke execute on function public.seed_member_access() from authenticated;
revoke execute on function public.seed_notification_rules(p_org uuid) from authenticated;
revoke execute on function public.seed_organization_defaults(p_org uuid) from authenticated;
revoke execute on function public.seed_organization_on_create() from authenticated;
revoke execute on function public.seed_people_defaults(p_org uuid) from authenticated;
revoke execute on function public.seed_prep_label_parameter(p_org uuid) from authenticated;
revoke execute on function public.seed_price_alert_parameter(p_org uuid) from authenticated;
revoke execute on function public.seed_production_defaults(p_org uuid) from authenticated;
revoke execute on function public.seed_purchasing_defaults(p_org uuid) from authenticated;
revoke execute on function public.seed_request_types(p_org uuid) from authenticated;
revoke execute on function public.seed_revenue_channels(p_org uuid) from authenticated;
revoke execute on function public.seed_scorecard_parameters(p_org uuid) from authenticated;
revoke execute on function public.seed_tax_and_channels(p_org uuid) from authenticated;
revoke execute on function public.seed_venue_parameters(p_org uuid) from authenticated;
revoke execute on function public.seed_venue_parameters_on_create() from authenticated;

/*
 * No `alter default privileges` here, unlike 0122, and the first draft of
 * this migration was wrong to add one.
 *
 * Revoking the function default from `authenticated` turned
 * `23_exposure.sql` red: it creates a function and asserts that a new one is
 * *not* executable by `anon` but *is* by a signed-in user. That is the
 * intended default and an earlier migration already establishes it — the
 * `anon` half was never broken. Taking the default away from `authenticated`
 * would mean every function added from here on needed an explicit grant, and
 * the first one to forget would fail at runtime rather than in the suite.
 *
 * So the table defaults are corrected in 0122 and the function defaults are
 * left exactly as they are.
 */
