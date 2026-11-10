begin;
create or replace function bf_private.require_approved_fitter_cost(p_job uuid,p_fitter uuid) returns void language plpgsql security definer set search_path='' as $$
declare cost numeric; base numeric; approved_once boolean;
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'Administrators only';end if;
 select fitting_cost into cost from public.job_assignments where job_id=p_job and fitter_id=p_fitter for update;
 if not found or cost is null then raise exception 'Set and approve the assigned fitting cost first';end if;
 select coalesce(sum(case when e.kind='Agreed cost' then e.amount when e.assignment_adjustment and e.kind='Extra' then e.amount when e.assignment_adjustment and e.kind='Deduction' then -e.amount else 0 end),0),coalesce(bool_or(e.kind='Agreed cost'),false) into base,approved_once from public.bf_fitter_entries e join public.bf_fitter_accounts a on a.id=e.account_id where a.job_id=p_job and a.fitter_id=p_fitter;
 if not approved_once or base<>cost then raise exception 'Assigned fitting cost awaits approval. Review it in Fitter payments before recording payment or approving extras.';end if;
end;$$;
revoke all on function bf_private.require_approved_fitter_cost(uuid,uuid) from public,anon,authenticated;
create or replace function bf_private.assignment_payment_sync() returns trigger language plpgsql security definer set search_path='' as $$
begin
 -- Assignment is a proposal. Approval happens only through an explicit admin action.
 if new.fitting_cost is null and TG_OP='UPDATE' and old.fitting_cost is not null and exists(select 1 from public.bf_fitter_accounts where job_id=new.job_id and fitter_id=new.fitter_id) then
  raise exception 'Enter an assigned fitting cost; a linked cost cannot be cleared';
 end if;
 return new;
end;$$;
create or replace function bf_private.approve_assigned_fitter_cost(p_job uuid,p_fitter uuid,p_amount numeric,p_expected_cost numeric) returns void language plpgsql security definer set search_path='' as $$
declare cost numeric;
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'Administrators only';end if;
 if p_amount is null or p_amount<0 or p_amount<>round(p_amount,2) or p_amount>9999999999.99 then raise exception 'Enter a valid fitting cost of zero or more';end if;
 select fitting_cost into cost from public.job_assignments where job_id=p_job and fitter_id=p_fitter for update;
 if not found then raise exception 'Assign this fitter to the job first';end if;
 if cost is distinct from p_expected_cost then raise exception 'The assigned cost has changed. Refresh and review it again.';end if;
 update public.job_assignments set fitting_cost=p_amount where job_id=p_job and fitter_id=p_fitter;
 perform bf_private.sync_fitter_cost(p_job,p_fitter);
end;$$;
revoke all on function bf_private.approve_assigned_fitter_cost(uuid,uuid,numeric,numeric) from public,anon;
grant execute on function bf_private.approve_assigned_fitter_cost(uuid,uuid,numeric,numeric) to authenticated;
create or replace function public.bf_approve_assigned_fitter_cost(p_job uuid,p_fitter uuid,p_amount numeric,p_expected_cost numeric) returns void language sql security invoker set search_path='' as $$select bf_private.approve_assigned_fitter_cost(p_job,p_fitter,p_amount,p_expected_cost);$$;
revoke all on function public.bf_approve_assigned_fitter_cost(uuid,uuid,numeric,numeric) from public,anon;
grant execute on function public.bf_approve_assigned_fitter_cost(uuid,uuid,numeric,numeric) to authenticated;
create or replace function bf_private.record_fitter_entry(p_id uuid,p_job uuid,p_fitter uuid,p_kind text,p_amount numeric,p_date date,p_reference text,p_reverses uuid default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare a uuid; approved numeric; paid numeric; original public.bf_fitter_entries; prior public.bf_fitter_entries;
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'Administrators only';end if;
 if p_amount is null or (p_amount<0 or (p_amount=0 and p_kind<>'Agreed cost')) or p_amount<>round(p_amount,2) or p_amount>9999999999.99 or p_date is null or p_date>current_date or p_reference is null or length(trim(p_reference)) not between 1 and 500 or p_kind is null or p_kind not in ('Agreed cost','Extra','Deduction','Payment','Payment reversal') then raise exception 'Check amount, date and reference';end if;
 if not exists(select 1 from public.profiles where id=p_fitter and role='fitter') then raise exception 'Choose a fitter';end if;
 -- Lock assignment before ledger, matching the approval operation.
 perform 1 from public.job_assignments where job_id=p_job and fitter_id=p_fitter for update;
 if p_kind='Payment' then perform bf_private.require_approved_fitter_cost(p_job,p_fitter);end if;
 perform pg_advisory_xact_lock(hashtextextended('bf_fitter_payments:'||p_fitter::text,0));
 insert into public.bf_fitter_accounts(job_id,fitter_id) values(p_job,p_fitter) on conflict(job_id,fitter_id) do nothing;
 select id into a from public.bf_fitter_accounts where job_id=p_job and fitter_id=p_fitter for update;
 select * into prior from public.bf_fitter_entries where id=p_id;
 if found then
  if prior.account_id=a and prior.kind=p_kind and prior.amount=p_amount and prior.entry_date=p_date and prior.reference=trim(p_reference) and prior.reverses is not distinct from p_reverses then return p_id;end if;
  raise exception 'Request already used; refresh';
 end if;
 select coalesce(sum(case when kind in ('Agreed cost','Extra') then amount when kind='Deduction' then -amount else 0 end),0),coalesce(sum(case when kind='Payment' then amount when kind='Payment reversal' then -amount else 0 end),0) into approved,paid from public.bf_fitter_entries where account_id=a;
 if p_kind='Agreed cost' and exists(select 1 from public.bf_fitter_entries where account_id=a and kind='Agreed cost') then raise exception 'Agreed cost already recorded. Use an extra or deduction with a reason.';end if;
 if p_kind<>'Agreed cost' and not exists(select 1 from public.bf_fitter_entries where account_id=a and kind='Agreed cost') then raise exception 'Approve the agreed cost first';end if;
 if p_kind='Payment' then
  if p_amount>approved-paid then raise exception 'Payment exceeds remaining approved balance';end if;
  if exists(select 1 from public.bf_fitter_entries where account_id in(select id from public.bf_fitter_accounts where fitter_id=p_fitter) and kind='Payment' and amount=p_amount and entry_date=p_date and lower(reference)=lower(trim(p_reference))) then raise exception 'Possible duplicate payment: check history and use a distinct reference for each allocation';end if;
 end if;
 if p_kind='Deduction' and approved-p_amount<paid then raise exception 'Deduction would reduce approved cost below payments already recorded';end if;
 if p_kind='Payment reversal' then
  select * into original from public.bf_fitter_entries where id=p_reverses and account_id=a and kind='Payment';
  if not found or original.amount<>p_amount or p_date<original.entry_date then raise exception 'Select the original payment to reverse in full';end if;
 elsif p_reverses is not null then raise exception 'Only reversals can reference another entry';end if;
 insert into public.bf_fitter_entries(id,account_id,kind,amount,entry_date,reference,actor,reverses) values(p_id,a,p_kind,p_amount,p_date,trim(p_reference),auth.uid(),p_reverses);
 return p_id;
end;$$;
create or replace function bf_private.approve_fitter_extra(p_variation uuid,p_fitter uuid,p_amount numeric) returns uuid language plpgsql security definer set search_path=public as $$
declare v public.variations; existing public.bf_fitter_extra_links; e uuid;
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'Administrators only';end if;
 select * into v from public.variations where id=p_variation for update;
 if not found or v.status<>'Approved' then raise exception 'Approve the extra work first';end if;
 if p_amount is null or p_amount<=0 or p_amount<>round(p_amount,2) or p_amount>9999999999.99 then raise exception 'Enter a valid fitter amount';end if;
 select * into existing from public.bf_fitter_extra_links where variation_id=p_variation and fitter_id=p_fitter;
 if found then
  if existing.amount=p_amount then return existing.entry_id;end if;
  raise exception 'This fitter extra is already linked. Record any correction in payment history.';
 end if;
 perform bf_private.require_approved_fitter_cost(v.job_id,p_fitter);
 e:=gen_random_uuid();
 perform bf_private.record_fitter_entry(e,v.job_id,p_fitter,'Extra',p_amount,current_date,'Approved fitter extra · '||v.id::text);
 insert into public.bf_fitter_extra_links(variation_id,fitter_id,entry_id,amount) values(p_variation,p_fitter,e,p_amount);
 return e;
end;$$;
create or replace function bf_private.review_fitter_extra(p_id uuid,p_approve boolean,p_amount numeric) returns uuid language plpgsql security definer set search_path=public as $$
declare r public.bf_fitter_extra_requests; e uuid;
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'Administrators only';end if;
 if p_approve is null then raise exception 'Choose approve or reject';end if;
 select * into r from public.bf_fitter_extra_requests where id=p_id for update;
 if not found then raise exception 'Request not found';end if;
 if r.status<>'Pending' then
  if (p_approve and r.status='Approved' and r.approved_amount=p_amount) or (not p_approve and r.status='Rejected') then return r.entry_id;end if;
  raise exception 'This request has already been reviewed. Use payment history for corrections.';
 end if;
 if p_approve then
  if p_amount is null or p_amount<=0 or p_amount<>round(p_amount,2) or p_amount>9999999999.99 then raise exception 'Enter the approved fitter amount';end if;
  perform bf_private.require_approved_fitter_cost(r.job_id,r.fitter_id);
  e:=gen_random_uuid();
  perform bf_private.record_fitter_entry(e,r.job_id,r.fitter_id,'Extra',p_amount,current_date,'Approved fitter request · '||r.id::text);
 end if;
 update public.bf_fitter_extra_requests set status=case when p_approve then 'Approved' else 'Rejected' end,approved_amount=case when p_approve then p_amount else null end,entry_id=e,reviewed_by=auth.uid(),reviewed_at=now() where id=p_id;
 return e;
end;$$;
commit;
