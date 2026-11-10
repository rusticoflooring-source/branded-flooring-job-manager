begin;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('fitter-invoices','fitter-invoices',false,15728640,array['application/pdf','image/jpeg','image/png','image/webp']) on conflict(id) do nothing;
create table public.bf_fitter_invoices (
 id uuid primary key,
 job_id uuid not null references public.jobs(id) on delete restrict,
 fitter_id uuid not null references public.profiles(id) on delete restrict,
 invoice_number text not null check(length(trim(invoice_number)) between 1 and 100),
 amount numeric(12,2) not null check(amount>0),
 storage_path text not null unique,
 file_name text not null,
 status text not null default 'Received' check(status in ('Received','Approved','Rejected')),
 uploaded_by uuid not null references public.profiles(id),
 received_at timestamptz not null default now(),
 reviewed_by uuid references public.profiles(id),
 reviewed_at timestamptz,
 review_note text,
 review_history jsonb not null default '[]'::jsonb,
 check((status='Received' and reviewed_by is null and reviewed_at is null) or (status in ('Approved','Rejected') and reviewed_by is not null and reviewed_at is not null))
);
create index bf_fitter_invoices_job_fitter_idx on public.bf_fitter_invoices(job_id,fitter_id);
create index bf_fitter_invoices_fitter_idx on public.bf_fitter_invoices(fitter_id);
create index bf_fitter_invoices_uploader_idx on public.bf_fitter_invoices(uploaded_by);
create index bf_fitter_invoices_reviewer_idx on public.bf_fitter_invoices(reviewed_by);
alter table public.bf_fitter_invoices enable row level security;
revoke all on public.bf_fitter_invoices from public,anon,authenticated;
grant select on public.bf_fitter_invoices to authenticated;
create policy fitter_invoices_read on public.bf_fitter_invoices for select to authenticated using((select public.is_admin()) or (fitter_id=(select auth.uid()) and exists(select 1 from public.profiles where id=(select auth.uid()) and role='fitter' and active)));
create policy fitter_invoice_upload on storage.objects for insert to authenticated with check(bucket_id='fitter-invoices' and ((select public.is_admin()) or ((storage.foldername(name))[2]=(select auth.uid())::text and exists(select 1 from public.job_assignments a join public.profiles p on p.id=a.fitter_id where a.job_id::text=(storage.foldername(name))[1] and p.id=(select auth.uid()) and p.role='fitter' and p.active))));
create policy fitter_invoice_download on storage.objects for select to authenticated using(bucket_id='fitter-invoices' and ((select public.is_admin()) or ((storage.foldername(name))[2]=(select auth.uid())::text and exists(select 1 from public.profiles where id=(select auth.uid()) and role='fitter' and active))));
create or replace function bf_private.submit_fitter_invoice(p_id uuid,p_job uuid,p_fitter uuid,p_number text,p_amount numeric,p_path text,p_filename text) returns uuid language plpgsql security definer set search_path='' as $$
declare prior public.bf_fitter_invoices;
begin
 if auth.uid() is null or not (public.is_admin() or (auth.uid()=p_fitter and exists(select 1 from public.profiles where id=auth.uid() and role='fitter' and active))) then raise exception 'Only the assigned fitter or an administrator can upload an invoice';end if;
 if not exists(select 1 from public.job_assignments where job_id=p_job and fitter_id=p_fitter) then raise exception 'This fitter is not assigned to the job';end if;
 if p_number is null or length(trim(p_number)) not between 1 and 100 or p_amount is null or p_amount<=0 or p_amount<>round(p_amount,2) or p_amount>9999999999.99 or p_filename is null or length(p_filename) not between 1 and 255 then raise exception 'Enter the invoice number, total payable and file';end if;
 if p_path is distinct from p_job::text||'/'||p_fitter::text||'/'||p_id::text or not exists(select 1 from storage.objects where bucket_id='fitter-invoices' and name=p_path) then raise exception 'Upload the invoice file first';end if;
 perform pg_advisory_xact_lock(hashtextextended('bf_fitter_invoice:'||p_fitter::text,0));
 select * into prior from public.bf_fitter_invoices where id=p_id;
 if found then
  if prior.job_id=p_job and prior.fitter_id=p_fitter and prior.invoice_number=trim(p_number) and prior.amount=p_amount and prior.storage_path=p_path then return p_id;end if;
  raise exception 'Invoice identifier already used';
 end if;
 if exists(select 1 from public.bf_fitter_invoices where fitter_id=p_fitter and lower(invoice_number)=lower(trim(p_number)) and status<>'Rejected') then raise exception 'This invoice number has already been uploaded. Check the existing invoice first.';end if;
 insert into public.bf_fitter_invoices(id,job_id,fitter_id,invoice_number,amount,storage_path,file_name,uploaded_by) values(p_id,p_job,p_fitter,trim(p_number),p_amount,p_path,p_filename,auth.uid());
 return p_id;
end;$$;
revoke all on function bf_private.submit_fitter_invoice(uuid,uuid,uuid,text,numeric,text,text) from public,anon;
grant execute on function bf_private.submit_fitter_invoice(uuid,uuid,uuid,text,numeric,text,text) to authenticated;
create or replace function public.bf_submit_fitter_invoice(p_id uuid,p_job uuid,p_fitter uuid,p_number text,p_amount numeric,p_path text,p_filename text) returns uuid language sql security invoker set search_path='' as $$select bf_private.submit_fitter_invoice(p_id,p_job,p_fitter,p_number,p_amount,p_path,p_filename);$$;
revoke all on function public.bf_submit_fitter_invoice(uuid,uuid,uuid,text,numeric,text,text) from public,anon;
grant execute on function public.bf_submit_fitter_invoice(uuid,uuid,uuid,text,numeric,text,text) to authenticated;
create or replace function bf_private.review_fitter_invoice(p_id uuid,p_approve boolean,p_note text) returns void language plpgsql security definer set search_path='' as $$
declare inv public.bf_fitter_invoices; approved numeric;
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'Administrators only';end if;
 if p_approve is null or length(coalesce(p_note,''))>1000 then raise exception 'Choose approve or reject and a note up to 1000 characters';end if;
 select * into inv from public.bf_fitter_invoices where id=p_id for update;
 if not found then raise exception 'Invoice not found';end if;
 if inv.status='Approved' and not p_approve then
  if nullif(trim(p_note),'') is null then raise exception 'Enter a reason for withdrawing invoice approval';end if;
  perform 1 from public.job_assignments where job_id=inv.job_id and fitter_id=inv.fitter_id for update;
  perform pg_advisory_xact_lock(hashtextextended('bf_fitter_payments:'||inv.fitter_id::text,0));
 elsif inv.status<>'Received' then
  if inv.status=(case when p_approve then 'Approved' else 'Rejected' end) then return;end if;
  raise exception 'Invoice already reviewed';
 end if;
 if p_approve then
  perform bf_private.require_approved_fitter_cost(inv.job_id,inv.fitter_id);
  perform pg_advisory_xact_lock(hashtextextended('bf_fitter_payments:'||inv.fitter_id::text,0));
  select coalesce(sum(case when e.kind in ('Agreed cost','Extra') then e.amount when e.kind='Deduction' then -e.amount else 0 end),0) into approved from public.bf_fitter_entries e join public.bf_fitter_accounts a on a.id=e.account_id where a.job_id=inv.job_id and a.fitter_id=inv.fitter_id;
  if approved<>inv.amount then raise exception 'Invoice total does not match the approved fitting cost and extras. Resolve the difference before approval.';end if;
  if exists(select 1 from public.bf_fitter_invoices where job_id=inv.job_id and fitter_id=inv.fitter_id and status='Approved') then raise exception 'An invoice is already approved for this fitter and job';end if;
 end if;
 update public.bf_fitter_invoices set status=case when p_approve then 'Approved' else 'Rejected' end,reviewed_by=auth.uid(),reviewed_at=now(),review_note=nullif(trim(p_note),''),review_history=review_history||jsonb_build_array(jsonb_build_object('status',case when p_approve then 'Approved' else 'Rejected' end,'actor',auth.uid(),'at',now(),'note',p_note)) where id=p_id;
end;$$;
revoke all on function bf_private.review_fitter_invoice(uuid,boolean,text) from public,anon;
grant execute on function bf_private.review_fitter_invoice(uuid,boolean,text) to authenticated;
create or replace function public.bf_review_fitter_invoice(p_id uuid,p_approve boolean,p_note text) returns void language sql security invoker set search_path='' as $$select bf_private.review_fitter_invoice(p_id,p_approve,p_note);$$;
revoke all on function public.bf_review_fitter_invoice(uuid,boolean,text) from public,anon;
grant execute on function public.bf_review_fitter_invoice(uuid,boolean,text) to authenticated;
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
  if not exists(select 1 from public.bf_fitter_invoices where job_id=p_job and fitter_id=p_fitter and status='Approved' and amount=approved) then raise exception 'Receive and approve a matching fitter invoice before recording payment';end if;
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
commit;
