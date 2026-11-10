begin;
-- The invoice header remains one document. Allocations are the job-level amounts.
create table public.bf_fitter_invoice_jobs (
 invoice_id uuid not null references public.bf_fitter_invoices(id) on delete restrict,
 job_id uuid not null references public.jobs(id) on delete restrict,
 amount numeric(12,2) not null check(amount>0),
 primary key(invoice_id,job_id)
);
create index bf_fitter_invoice_jobs_job_idx on public.bf_fitter_invoice_jobs(job_id);
alter table public.bf_fitter_invoice_jobs enable row level security;
revoke all on public.bf_fitter_invoice_jobs from public,anon,authenticated;
grant select on public.bf_fitter_invoice_jobs to authenticated;
create policy fitter_invoice_jobs_read on public.bf_fitter_invoice_jobs for select to authenticated using(exists(select 1 from public.bf_fitter_invoices i where i.id=invoice_id));
insert into public.bf_fitter_invoice_jobs(invoice_id,job_id,amount) select id,job_id,amount from public.bf_fitter_invoices;
create or replace function bf_private.submit_fitter_invoice_jobs(p_id uuid,p_fitter uuid,p_number text,p_amount numeric,p_path text,p_filename text,p_jobs jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare prior public.bf_fitter_invoices; item record; total numeric:=0; anchor uuid; existing jsonb; proposed jsonb;
begin
 if auth.uid() is null or not (public.is_admin() or (auth.uid()=p_fitter and exists(select 1 from public.profiles where id=auth.uid() and role='fitter' and active))) then raise exception 'Only the assigned fitter or an administrator can upload an invoice';end if;
 if p_number is null or length(trim(p_number)) not between 1 and 100 or p_amount is null or p_amount<=0 or p_amount<>round(p_amount,2) or p_amount>9999999999.99 or p_filename is null or length(p_filename) not between 1 and 255 then raise exception 'Enter the invoice number, total payable and file';end if;
 if p_jobs is null or jsonb_typeof(p_jobs)<>'array' then raise exception 'Select the jobs listed on the invoice';end if;
 if jsonb_array_length(p_jobs) not between 1 and 100 then raise exception 'Choose between 1 and 100 jobs';end if;
 if exists(select 1 from jsonb_array_elements(p_jobs) x where jsonb_typeof(x)<>'object' or x->>'job_id' is null or x->>'amount' is null) then raise exception 'Each invoice job needs a job number and amount';end if;
 if (select count(distinct (x->>'job_id')::uuid) from jsonb_array_elements(p_jobs) x)<>jsonb_array_length(p_jobs) then raise exception 'Each job can only appear once on an invoice';end if;
 -- Deterministic row order also matches invoice review and wage approval lock order.
 for item in select (x->>'job_id')::uuid job_id,(x->>'amount')::numeric amount from jsonb_array_elements(p_jobs) x order by (x->>'job_id')::uuid loop
  if item.amount is null or item.amount<=0 or item.amount<>round(item.amount,2) or item.amount>9999999999.99 then raise exception 'Enter a positive amount to two decimal places for each job';end if;
  if not exists(select 1 from public.job_assignments where job_id=item.job_id and fitter_id=p_fitter) then raise exception 'Every invoice job must be assigned to this fitter';end if;
  total:=total+item.amount;
 end loop;
 if total<>p_amount then raise exception 'Job allocations must add up to the invoice total';end if;
 anchor:=(p_jobs->0->>'job_id')::uuid;
 if p_path is distinct from anchor::text||'/'||p_fitter::text||'/'||p_id::text or not exists(select 1 from storage.objects where bucket_id='fitter-invoices' and name=p_path) then raise exception 'Upload the invoice file first';end if;
 perform pg_advisory_xact_lock(hashtextextended('bf_fitter_invoice:'||p_fitter::text,0));
 select jsonb_agg(jsonb_build_object('job_id',(x->>'job_id')::uuid,'amount',(x->>'amount')::numeric) order by (x->>'job_id')::uuid) into proposed from jsonb_array_elements(p_jobs) x;
 select * into prior from public.bf_fitter_invoices where id=p_id;
 if found then
  select jsonb_agg(jsonb_build_object('job_id',job_id,'amount',amount) order by job_id) into existing from public.bf_fitter_invoice_jobs where invoice_id=p_id;
  if prior.fitter_id=p_fitter and prior.invoice_number=trim(p_number) and prior.amount=p_amount and prior.storage_path=p_path and existing=proposed then return p_id;end if;
  raise exception 'Invoice identifier already used';
 end if;
 if exists(select 1 from public.bf_fitter_invoices where fitter_id=p_fitter and lower(invoice_number)=lower(trim(p_number)) and status<>'Rejected') then raise exception 'This invoice number has already been uploaded. Check the existing invoice first.';end if;
 insert into public.bf_fitter_invoices(id,job_id,fitter_id,invoice_number,amount,storage_path,file_name,uploaded_by) values(p_id,anchor,p_fitter,trim(p_number),p_amount,p_path,p_filename,auth.uid());
 insert into public.bf_fitter_invoice_jobs(invoice_id,job_id,amount) select p_id,(x->>'job_id')::uuid,(x->>'amount')::numeric from jsonb_array_elements(p_jobs) x;
 return p_id;
end;$$;
revoke all on function bf_private.submit_fitter_invoice_jobs(uuid,uuid,text,numeric,text,text,jsonb) from public,anon;
grant execute on function bf_private.submit_fitter_invoice_jobs(uuid,uuid,text,numeric,text,text,jsonb) to authenticated;
create or replace function public.bf_submit_fitter_invoice_jobs(p_id uuid,p_fitter uuid,p_number text,p_amount numeric,p_path text,p_filename text,p_jobs jsonb) returns uuid language sql security invoker set search_path='' as $$select bf_private.submit_fitter_invoice_jobs(p_id,p_fitter,p_number,p_amount,p_path,p_filename,p_jobs);$$;
revoke all on function public.bf_submit_fitter_invoice_jobs(uuid,uuid,text,numeric,text,text,jsonb) from public,anon;
grant execute on function public.bf_submit_fitter_invoice_jobs(uuid,uuid,text,numeric,text,text,jsonb) to authenticated;
-- Preserve compatibility for a single-job upload from an older open app tab.
create or replace function bf_private.submit_fitter_invoice(p_id uuid,p_job uuid,p_fitter uuid,p_number text,p_amount numeric,p_path text,p_filename text) returns uuid language sql security invoker set search_path='' as $$select bf_private.submit_fitter_invoice_jobs(p_id,p_fitter,p_number,p_amount,p_path,p_filename,jsonb_build_array(jsonb_build_object('job_id',p_job,'amount',p_amount)));$$;
create or replace function bf_private.review_fitter_invoice(p_id uuid,p_approve boolean,p_note text) returns void language plpgsql security definer set search_path='' as $$
declare inv public.bf_fitter_invoices; item record; approved numeric; allocation_total numeric;
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'Administrators only';end if;
 if p_approve is null or length(coalesce(p_note,''))>1000 then raise exception 'Choose approve or reject and a note up to 1000 characters';end if;
 select * into inv from public.bf_fitter_invoices where id=p_id for update;
 if not found then raise exception 'Invoice not found';end if;
 if inv.status='Approved' and not p_approve then
  if nullif(trim(p_note),'') is null then raise exception 'Enter a reason for withdrawing invoice approval';end if;
 elsif inv.status<>'Received' then
  if inv.status=(case when p_approve then 'Approved' else 'Rejected' end) then return;end if;
  raise exception 'Invoice already reviewed';
 end if;
 -- Lock every allocation before the fitter ledger to make approval atomic.
 for item in select job_id from public.bf_fitter_invoice_jobs where invoice_id=p_id order by job_id loop
  perform 1 from public.job_assignments where job_id=item.job_id and fitter_id=inv.fitter_id for update;
 end loop;
 perform pg_advisory_xact_lock(hashtextextended('bf_fitter_payments:'||inv.fitter_id::text,0));
 if p_approve then
  select sum(amount) into allocation_total from public.bf_fitter_invoice_jobs where invoice_id=p_id;
  if allocation_total is null or allocation_total<>inv.amount then raise exception 'Job allocations must add up to the invoice total';end if;
  for item in select job_id,amount from public.bf_fitter_invoice_jobs where invoice_id=p_id order by job_id loop
   perform bf_private.require_approved_fitter_cost(item.job_id,inv.fitter_id);
   select coalesce(sum(case when e.kind in ('Agreed cost','Extra') then e.amount when e.kind='Deduction' then -e.amount else 0 end),0) into approved from public.bf_fitter_entries e join public.bf_fitter_accounts a on a.id=e.account_id where a.job_id=item.job_id and a.fitter_id=inv.fitter_id;
   if approved<>item.amount then raise exception 'Invoice job amount does not match the approved fitting cost and extras. Resolve the difference before approval.';end if;
   if exists(select 1 from public.bf_fitter_invoice_jobs ij join public.bf_fitter_invoices i on i.id=ij.invoice_id where ij.job_id=item.job_id and i.fitter_id=inv.fitter_id and i.status='Approved' and i.id<>p_id) then raise exception 'An invoice is already approved for this fitter and job';end if;
  end loop;
 end if;
 update public.bf_fitter_invoices set status=case when p_approve then 'Approved' else 'Rejected' end,reviewed_by=auth.uid(),reviewed_at=now(),review_note=nullif(trim(p_note),''),review_history=review_history||jsonb_build_array(jsonb_build_object('status',case when p_approve then 'Approved' else 'Rejected' end,'actor',auth.uid(),'at',now(),'note',p_note)) where id=p_id;
end;$$;
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
  if not exists(select 1 from public.bf_fitter_invoices i join public.bf_fitter_invoice_jobs ij on ij.invoice_id=i.id where ij.job_id=p_job and i.fitter_id=p_fitter and i.status='Approved' and ij.amount=approved) then raise exception 'Receive and approve a matching fitter invoice before recording payment';end if;
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
-- One actual bank payment may settle the remaining allocations of a whole invoice.
create table public.bf_fitter_invoice_payments (
 id uuid primary key,
 invoice_id uuid not null references public.bf_fitter_invoices(id) on delete restrict,
 amount numeric(12,2) not null check(amount>0),
 payment_date date not null,
 reference text not null,
 actor uuid not null references public.profiles(id),
 created_at timestamptz not null default now()
);
create index bf_fitter_invoice_payments_invoice_idx on public.bf_fitter_invoice_payments(invoice_id);
create index bf_fitter_invoice_payments_actor_idx on public.bf_fitter_invoice_payments(actor);
alter table public.bf_fitter_invoice_payments enable row level security;
revoke all on public.bf_fitter_invoice_payments from public,anon,authenticated;
grant select on public.bf_fitter_invoice_payments to authenticated;
create policy fitter_invoice_payments_admin on public.bf_fitter_invoice_payments for select to authenticated using((select public.is_admin()));
create or replace function bf_private.pay_fitter_invoice(p_id uuid,p_invoice uuid,p_expected_amount numeric,p_date date,p_reference text) returns void language plpgsql security definer set search_path='' as $$
declare inv public.bf_fitter_invoices; prior public.bf_fitter_invoice_payments; item record; approved numeric; paid numeric; total numeric:=0;
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'Administrators only';end if;
 if p_id is null or p_date is null or p_date>current_date or p_reference is null or length(trim(p_reference)) not between 1 and 250 or p_expected_amount is null or p_expected_amount<=0 then raise exception 'Enter the amount, actual payment date and bank reference';end if;
 select * into inv from public.bf_fitter_invoices where id=p_invoice for update;
 if not found then raise exception 'Invoice not found';end if;
 select * into prior from public.bf_fitter_invoice_payments where id=p_id;
 if found then
  if prior.invoice_id=p_invoice and prior.amount=p_expected_amount and prior.payment_date=p_date and prior.reference=trim(p_reference) then return;end if;
  raise exception 'Payment identifier already used';
 end if;
 if inv.status<>'Approved' then raise exception 'Approve the invoice before recording payment';end if;
 for item in select job_id from public.bf_fitter_invoice_jobs where invoice_id=p_invoice order by job_id loop
  perform 1 from public.job_assignments where job_id=item.job_id and fitter_id=inv.fitter_id for update;
 end loop;
 perform pg_advisory_xact_lock(hashtextextended('bf_fitter_payments:'||inv.fitter_id::text,0));
 for item in select job_id,amount from public.bf_fitter_invoice_jobs where invoice_id=p_invoice order by job_id loop
  perform bf_private.require_approved_fitter_cost(item.job_id,inv.fitter_id);
  select coalesce(sum(case when e.kind in ('Agreed cost','Extra') then e.amount when e.kind='Deduction' then -e.amount else 0 end),0),coalesce(sum(case when e.kind='Payment' then e.amount when e.kind='Payment reversal' then -e.amount else 0 end),0) into approved,paid from public.bf_fitter_entries e join public.bf_fitter_accounts a on a.id=e.account_id where a.job_id=item.job_id and a.fitter_id=inv.fitter_id;
  if approved<>item.amount then raise exception 'An invoice job amount has changed. Review the invoice again before payment';end if;
  total:=total+approved-paid;
 end loop;
 if total<=0 then raise exception 'This invoice is already settled';end if;
 if total<>p_expected_amount then raise exception 'The unpaid amount has changed. Refresh before recording payment';end if;
 insert into public.bf_fitter_invoice_payments(id,invoice_id,amount,payment_date,reference,actor) values(p_id,p_invoice,total,p_date,trim(p_reference),auth.uid());
 for item in select ij.job_id,ij.amount-coalesce(sum(case when e.kind='Payment' then e.amount when e.kind='Payment reversal' then -e.amount else 0 end),0) remaining from public.bf_fitter_invoice_jobs ij left join public.bf_fitter_accounts a on a.job_id=ij.job_id and a.fitter_id=inv.fitter_id left join public.bf_fitter_entries e on e.account_id=a.id where ij.invoice_id=p_invoice group by ij.job_id,ij.amount order by ij.job_id loop
  if item.remaining>0 then
   perform bf_private.record_fitter_entry(gen_random_uuid(),item.job_id,inv.fitter_id,'Payment',item.remaining,p_date,trim(p_reference)||' · invoice '||inv.invoice_number||' · job '||item.job_id::text);
  end if;
 end loop;
end;$$;
revoke all on function bf_private.pay_fitter_invoice(uuid,uuid,numeric,date,text) from public,anon;
grant execute on function bf_private.pay_fitter_invoice(uuid,uuid,numeric,date,text) to authenticated;
create or replace function public.bf_pay_fitter_invoice(p_id uuid,p_invoice uuid,p_expected_amount numeric,p_date date,p_reference text) returns void language sql security invoker set search_path='' as $$select bf_private.pay_fitter_invoice(p_id,p_invoice,p_expected_amount,p_date,p_reference);$$;
revoke all on function public.bf_pay_fitter_invoice(uuid,uuid,numeric,date,text) from public,anon;
grant execute on function public.bf_pay_fitter_invoice(uuid,uuid,numeric,date,text) to authenticated;
commit;
