-- ---------------------------------------------------------------------------
-- An approval records who pressed it
-- ---------------------------------------------------------------------------
-- 0054 found this exact mistake in staff request decisions and on the
-- community board, named it, and fixed it in both places: a control that
-- reads who the caller is from a column the caller writes. It did not reach
-- purchasing approvals, which is where it mattered most.
--
-- `enforce_approval_rules` took the submitter from the document and the
-- approver from the row being written. Both checks it then performed —
-- segregation of duties, and whether the approver's role clears the amount —
-- were made against the name the client had typed.
--
-- Found by trying it, as a CHEF against a seeded venue:
--
--   -- refused, correctly
--   insert into approval_events (..., actor_id, actor_email)
--   values (..., '<the chef>', 'chef@…');
--   ERROR:  the person who raised this cannot approve it
--
--   -- allowed
--   insert into approval_events (..., actor_id, actor_email)
--   values (..., '<the owner>', 'owner@…');
--   INSERT 0 1
--
-- That second statement cleared a 99,000,000 requisition against a policy
-- requiring OWNER, raised by the same chef who approved it, and wrote the
-- owner's address into the audit trail as the approver. No role was needed:
-- the trigger looked up the role of the person *named in the row*, found
-- OWNER, and was satisfied.
--
-- So every purchasing control in this system — the self-approval ban, the
-- amount thresholds in `approval_policies`, the whole segregation-of-duties
-- story — was advisory for anyone who could call the API. Both gap briefs
-- describe this engine as the product's main advantage over every project
-- they studied.
--
-- The fix is 0054's: stop reading the field. Where there is a signed-in
-- caller the event is recorded as theirs and whatever the client sent is
-- discarded. The columns remain writable only with no session at all — a
-- migration, or an administrator at the console, where there is no JWT to
-- take a name from.
--
-- Two changes beyond the minimum, both because the minimum would leave the
-- same hole half-open:
--
--   - The stamping happens before the early return for non-APPROVED actions.
--     Otherwise SUBMITTED, REJECTED and CANCELLED events keep accepting a
--     forged actor, and the audit trail is corruptible everywhere except the
--     one row somebody checked.
--   - `actor_role` is derived for every action, not only approvals. It is the
--     column a reader trusts to say what authority was exercised.
-- ---------------------------------------------------------------------------

create or replace function public.enforce_approval_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  submitter uuid;
  submitter_email text;
  doc_amount numeric;
  caller_role public.org_role;
  needed public.org_role;
  rank_of jsonb := '{"VIEWER":0,"CHEF":1,"ADMIN":2,"OWNER":3}'::jsonb;
begin
  /*
   * Who is doing this. Not who the row says is doing this.
   *
   * Before the early return below, so that the rest of the audit trail is
   * held to the same standard as the approvals.
   */
  if auth.uid() is not null then
    new.actor_id := auth.uid();
    new.actor_email := auth.jwt() ->> 'email';
  end if;

  select m.role into caller_role
    from public.organization_members m
   where m.organization_id = new.org_id
     and m.user_id = new.actor_id;

  new.actor_role := caller_role;

  if new.action <> 'APPROVED' then
    return new;
  end if;

  if new.document_type = 'REQUISITION' then
    select r.requested_by, r.requested_by_email, r.total_amount
      into submitter, submitter_email, doc_amount
      from public.requisitions r where r.id = new.document_id;
  else
    select p.created_by, p.created_by_email, p.total_amount
      into submitter, submitter_email, doc_amount
      from public.purchase_orders p where p.id = new.document_id;
  end if;

  if doc_amount is null then
    raise exception 'document % not found', new.document_id;
  end if;

  -- Segregation of duties. Matched on both id and email so that a record
  -- raised before the person had an account is still caught.
  if (submitter is not null and new.actor_id is not null and submitter = new.actor_id)
     or (submitter_email is not null and new.actor_email is not null
         and lower(submitter_email) = lower(new.actor_email))
  then
    raise exception 'the person who raised this cannot approve it'
      using hint = 'Segregation of duties: ask someone else to approve.';
  end if;

  if caller_role is null then
    raise exception 'approver is not a member of this organization';
  end if;

  -- The strictest rule the amount reaches.
  select p.required_role into needed
    from public.approval_policies p
   where p.org_id = new.org_id
     and p.document_type = new.document_type
     and p.min_amount <= doc_amount
   order by p.min_amount desc
   limit 1;

  if needed is not null
     and (rank_of ->> caller_role::text)::int < (rank_of ->> needed::text)::int
  then
    raise exception 'approving % at this amount requires the % role',
      lower(new.document_type), needed
      using hint = 'Approval authority is set by the organisation''s policy.';
  end if;

  new.amount := doc_amount;
  return new;
end;
$$;

comment on function public.enforce_approval_rules() is
  'Segregation of duties and approval thresholds, against the signed-in caller rather than the actor columns the client sent. See 0085.';
