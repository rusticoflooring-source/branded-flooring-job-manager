begin;
create schema if not exists bf_private;
revoke all on schema bf_private from public,anon;
grant usage on schema bf_private to authenticated;
create table if not exists public.bf_fitter_accounts (
 id uuid primary key default gen_random_uuid(),
 job_id uuid not null references public.jobs(id) on delete restrict,
 fitter_id uuid not null references public.profiles(id) on delete restrict,
 unique(job_id,fitter_id)
);
create table if not exists public.bf_fitter_entries (
 id uuid primary key,
 account_id uuid not null references public.bf_fitter_accounts(id) on delete restrict,
 kind text not null check(kind in ('Agreed cost','Extra','Deduction','Payment','Payment reversal')),
 amount numeric(12,2) not null check(amount>0),
 entry_date date not null,
 reference text not null check(length(trim(reference)) between 1 and 500),
 actor uuid not null references public.profiles(id),
 reverses uuid unique references public.bf_fitter_entries(id),
 created_at timestamptz not null default now()
);
create index if not exists bf_fitter_entries_account_idx on public.bf_fitter_entries(account_id);
create index if not exists bf_fitter_accounts_fitter_idx on public.bf_fitter_accounts(fitter_id);
create index if not exists bf_fitter_entries_actor_idx on public.bf_fitter_entries(actor);
alter table public.bf_fitter_accounts enable row level security;
alter table public.bf_fitter_entries enable row level security;
revoke all on public.bf_fitter_accounts,public.bf_fitter_entries from public,anon,authenticated;
grant select on public.bf_fitter_accounts,public.bf_fitter_entries to authenticated;
drop policy if exists fitter_accounts_admin on public.bf_fitter_accounts;
create policy fitter_accounts_admin on public.bf_fitter_accounts for select to authenticated using((select public.is_admin()));
drop policy if exists fitter_entries_admin on public.bf_fitter_entries;
create policy fitter_entries_admin on public.bf_fitter_entries for select to authenticated using((select public.is_admin()));
create or replace function bf_private.record_fitter_entry(p_id uuid,p_job uuid,p_fitter uuid,p_kind text,p_amount numeric,p_date date,p_reference text,p_reverses uuid default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare a uuid; approved numeric; paid numeric; original public.bf_fitter_entries; prior public.bf_fitter_entries;
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'Administrators only';end if;
 if p_amount is null or p_amount<=0 or p_amount<>round(p_amount,2) or p_amount>9999999999.99 or p_date is null or p_date>current_date or p_reference is null or length(trim(p_reference)) not between 1 and 500 or p_kind is null or p_kind not in ('Agreed cost','Extra','Deduction','Payment','Payment reversal') then raise exception 'Check amount, date and reference';end if;
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
revoke all on function bf_private.record_fitter_entry(uuid,uuid,uuid,text,numeric,date,text,uuid) from public,anon;
grant execute on function bf_private.record_fitter_entry(uuid,uuid,uuid,text,numeric,date,text,uuid) to authenticated;
create or replace function public.bf_record_fitter_entry(p_id uuid,p_job uuid,p_fitter uuid,p_kind text,p_amount numeric,p_date date,p_reference text,p_reverses uuid default null)
returns uuid language sql security invoker set search_path='' as $$
 select bf_private.record_fitter_entry(p_id,p_job,p_fitter,p_kind,p_amount,p_date,p_reference,p_reverses);
$$;
revoke all on function public.bf_record_fitter_entry(uuid,uuid,uuid,text,numeric,date,text,uuid) from public,anon;
grant execute on function public.bf_record_fitter_entry(uuid,uuid,uuid,text,numeric,date,text,uuid) to authenticated;
commit;
