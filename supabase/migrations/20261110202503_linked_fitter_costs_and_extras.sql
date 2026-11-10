begin;
alter table public.bf_fitter_entries drop constraint bf_fitter_entries_amount_check;
alter table public.bf_fitter_entries add constraint bf_fitter_entries_amount_check check(amount>0 or (amount=0 and kind='Agreed cost'));
create or replace function bf_private.record_fitter_entry(p_id uuid,p_job uuid,p_fitter uuid,p_kind text,p_amount numeric,p_date date,p_reference text,p_reverses uuid default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare a uuid; approved numeric; paid numeric; original public.bf_fitter_entries; prior public.bf_fitter_entries;
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'Administrators only';end if;
 if p_amount is null or (p_amount<0 or (p_amount=0 and p_kind<>'Agreed cost')) or p_amount<>round(p_amount,2) or p_amount>9999999999.99 or p_date is null or p_date>current_date or p_reference is null or length(trim(p_reference)) not between 1 and 500 or p_kind is null or p_kind not in ('Agreed cost','Extra','Deduction','Payment','Payment reversal') then raise exception 'Check amount, date and reference';end if;
 if not exists(select 1 from public.profiles where id=p_fitter and role='fitter') then raise exception 'Choose a fitter';end if;
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

alter table public.bf_fitter_entries add column if not exists assignment_adjustment boolean not null default false;
create table if not exists public.bf_fitter_extra_links (
 variation_id uuid not null references public.variations(id) on delete restrict,
 fitter_id uuid not null references public.profiles(id) on delete restrict,
 entry_id uuid not null unique references public.bf_fitter_entries(id) on delete restrict,
 amount numeric(12,2) not null check(amount>0),
 primary key(variation_id,fitter_id)
);
create index if not exists bf_fitter_extra_links_fitter_idx on public.bf_fitter_extra_links(fitter_id);
alter table public.bf_fitter_extra_links enable row level security;
revoke all on public.bf_fitter_extra_links from public,anon,authenticated;
grant select on public.bf_fitter_extra_links to authenticated;
create policy fitter_extra_links_admin on public.bf_fitter_extra_links for select to authenticated using((select public.is_admin()));
create or replace function bf_private.sync_fitter_cost(p_job uuid,p_fitter uuid) returns void language plpgsql security definer set search_path=public as $$
declare cost numeric; base numeric; a uuid; e uuid;
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'Administrators only';end if;
 -- Same lock order as the assignment trigger: assignment row, then fitter ledger.
 select fitting_cost into cost from public.job_assignments where job_id=p_job and fitter_id=p_fitter for update;
 if not found then raise exception 'Assign this fitter to the job first';end if;
 if cost is null then raise exception 'Set the assigned fitting cost first';end if;
 perform pg_advisory_xact_lock(hashtextextended('bf_fitter_payments:'||p_fitter::text,0));
 select id into a from public.bf_fitter_accounts where job_id=p_job and fitter_id=p_fitter;
 if not exists(select 1 from public.bf_fitter_entries where account_id=a and kind='Agreed cost') then
  perform bf_private.record_fitter_entry(gen_random_uuid(),p_job,p_fitter,'Agreed cost',cost,current_date,'Agreed fitting cost from job assignment');
  return;
 end if;
 select coalesce(sum(case when kind='Agreed cost' then amount when assignment_adjustment and kind='Extra' then amount when assignment_adjustment and kind='Deduction' then -amount else 0 end),0) into base from public.bf_fitter_entries where account_id=a;
 if cost<>base then
  e:=gen_random_uuid();
  perform bf_private.record_fitter_entry(e,p_job,p_fitter,case when cost>base then 'Extra' else 'Deduction' end,abs(cost-base),current_date,'Agreed fitting cost updated from job assignment');
  update public.bf_fitter_entries set assignment_adjustment=true where id=e;
 end if;
end;$$;
revoke all on function bf_private.sync_fitter_cost(uuid,uuid) from public,anon;
grant execute on function bf_private.sync_fitter_cost(uuid,uuid) to authenticated;
create or replace function public.bf_sync_fitter_cost(p_job uuid,p_fitter uuid) returns void language sql security invoker set search_path='' as $$select bf_private.sync_fitter_cost(p_job,p_fitter);$$;
revoke all on function public.bf_sync_fitter_cost(uuid,uuid) from public,anon;
grant execute on function public.bf_sync_fitter_cost(uuid,uuid) to authenticated;
create or replace function bf_private.assignment_payment_sync() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.fitting_cost is null then
  if TG_OP='UPDATE' and old.fitting_cost is not null and exists(select 1 from public.bf_fitter_accounts where job_id=new.job_id and fitter_id=new.fitter_id) then raise exception 'Enter an agreed fitting cost; a linked cost cannot be cleared';end if;
  return new;
 end if;
 perform bf_private.sync_fitter_cost(new.job_id,new.fitter_id);return new;
end;$$;
revoke all on function bf_private.assignment_payment_sync() from public,anon,authenticated;
create trigger bf_assignment_payment_sync after insert or update of fitting_cost on public.job_assignments for each row execute function bf_private.assignment_payment_sync();
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
 perform bf_private.sync_fitter_cost(v.job_id,p_fitter);
 e:=gen_random_uuid();
 perform bf_private.record_fitter_entry(e,v.job_id,p_fitter,'Extra',p_amount,current_date,'Approved fitter extra · '||v.id::text);
 insert into public.bf_fitter_extra_links(variation_id,fitter_id,entry_id,amount) values(p_variation,p_fitter,e,p_amount);
 return e;
end;$$;
revoke all on function bf_private.approve_fitter_extra(uuid,uuid,numeric) from public,anon;
grant execute on function bf_private.approve_fitter_extra(uuid,uuid,numeric) to authenticated;
create or replace function public.bf_approve_fitter_extra(p_variation uuid,p_fitter uuid,p_amount numeric) returns uuid language sql security invoker set search_path='' as $$select bf_private.approve_fitter_extra(p_variation,p_fitter,p_amount);$$;
revoke all on function public.bf_approve_fitter_extra(uuid,uuid,numeric) from public,anon;
grant execute on function public.bf_approve_fitter_extra(uuid,uuid,numeric) to authenticated;
create or replace function bf_private.protect_linked_extra() returns trigger language plpgsql set search_path=public as $$
begin
 if new.status<>'Approved' and exists(select 1 from public.bf_fitter_extra_links where variation_id=old.id) then raise exception 'A fitter payment is linked. Record a correction before changing the approval.';end if;return new;
end;$$;
revoke all on function bf_private.protect_linked_extra() from public,anon,authenticated;
create trigger bf_protect_linked_extra before update of status on public.variations for each row execute function bf_private.protect_linked_extra();
create table public.bf_fitter_extra_requests (
 id uuid primary key,
 job_id uuid not null references public.jobs(id) on delete restrict,
 fitter_id uuid not null references public.profiles(id) on delete restrict,
 description text not null check(length(trim(description)) between 1 and 2000),
 requested_amount numeric(12,2) not null check(requested_amount>0),
 approved_amount numeric(12,2),
 status text not null default 'Pending' check(status in ('Pending','Approved','Rejected')),
 entry_id uuid unique references public.bf_fitter_entries(id) on delete restrict,
 reviewed_by uuid references public.profiles(id),
 reviewed_at timestamptz,
 created_at timestamptz not null default now(),
 check((status='Pending' and approved_amount is null and entry_id is null and reviewed_by is null and reviewed_at is null) or (status='Rejected' and approved_amount is null and entry_id is null and reviewed_by is not null and reviewed_at is not null) or (status='Approved' and approved_amount>0 and entry_id is not null and reviewed_by is not null and reviewed_at is not null))
);
create index bf_fitter_extra_requests_job_idx on public.bf_fitter_extra_requests(job_id);
create index bf_fitter_extra_requests_fitter_idx on public.bf_fitter_extra_requests(fitter_id);
create index bf_fitter_extra_requests_reviewer_idx on public.bf_fitter_extra_requests(reviewed_by);
alter table public.bf_fitter_extra_requests enable row level security;
revoke all on public.bf_fitter_extra_requests from public,anon,authenticated;
grant select on public.bf_fitter_extra_requests to authenticated;
create policy fitter_extra_requests_read on public.bf_fitter_extra_requests for select to authenticated using((select public.is_admin()) or (fitter_id=(select auth.uid()) and exists(select 1 from public.profiles where id=(select auth.uid()) and role='fitter' and active)));
create or replace function bf_private.request_fitter_extra(p_id uuid,p_job uuid,p_description text,p_amount numeric) returns uuid language plpgsql security definer set search_path=public as $$
declare old public.bf_fitter_extra_requests;
begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and role='fitter' and active) or not exists(select 1 from public.job_assignments where job_id=p_job and fitter_id=auth.uid()) then raise exception 'Only an active assigned fitter can submit extra work';end if;
 if p_description is null or length(trim(p_description)) not between 1 and 2000 or p_amount is null or p_amount<=0 or p_amount<>round(p_amount,2) or p_amount>9999999999.99 then raise exception 'Enter a description and valid fitter amount';end if;
 insert into public.bf_fitter_extra_requests(id,job_id,fitter_id,description,requested_amount) values(p_id,p_job,auth.uid(),trim(p_description),p_amount) on conflict(id) do nothing;
 select * into old from public.bf_fitter_extra_requests where id=p_id;
 if old.job_id<>p_job or old.fitter_id<>auth.uid() or old.description<>trim(p_description) or old.requested_amount<>p_amount then raise exception 'Request identifier already used';end if;
 return p_id;
end;$$;
revoke all on function bf_private.request_fitter_extra(uuid,uuid,text,numeric) from public,anon;
grant execute on function bf_private.request_fitter_extra(uuid,uuid,text,numeric) to authenticated;
create or replace function public.bf_request_fitter_extra(p_id uuid,p_job uuid,p_description text,p_amount numeric) returns uuid language sql security invoker set search_path='' as $$select bf_private.request_fitter_extra(p_id,p_job,p_description,p_amount);$$;
revoke all on function public.bf_request_fitter_extra(uuid,uuid,text,numeric) from public,anon;
grant execute on function public.bf_request_fitter_extra(uuid,uuid,text,numeric) to authenticated;
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
  perform bf_private.sync_fitter_cost(r.job_id,r.fitter_id);
  e:=gen_random_uuid();
  perform bf_private.record_fitter_entry(e,r.job_id,r.fitter_id,'Extra',p_amount,current_date,'Approved fitter request · '||r.id::text);
 end if;
 update public.bf_fitter_extra_requests set status=case when p_approve then 'Approved' else 'Rejected' end,approved_amount=case when p_approve then p_amount else null end,entry_id=e,reviewed_by=auth.uid(),reviewed_at=now() where id=p_id;
 return e;
end;$$;
revoke all on function bf_private.review_fitter_extra(uuid,boolean,numeric) from public,anon;
grant execute on function bf_private.review_fitter_extra(uuid,boolean,numeric) to authenticated;
create or replace function public.bf_review_fitter_extra(p_id uuid,p_approve boolean,p_amount numeric) returns uuid language sql security invoker set search_path='' as $$select bf_private.review_fitter_extra(p_id,p_approve,p_amount);$$;
revoke all on function public.bf_review_fitter_extra(uuid,boolean,numeric) from public,anon;
grant execute on function public.bf_review_fitter_extra(uuid,boolean,numeric) to authenticated;
commit;
