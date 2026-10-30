-- After 001 and 002. Does not renumber existing jobs automatically.
begin;
alter table public.jobs add column if not exists xero_number_managed boolean not null default false;
alter table public.jobs add column if not exists xero_number_pending boolean not null default false;
alter table public.bf_xero_invoices add column if not exists use_xero_number boolean not null default false;
alter table public.bf_xero_invoices add column if not exists source_url text;
alter table public.bf_xero_invoices add column if not exists original_job_number text;
alter table public.bf_xero_invoices add column if not exists number_sync_error text;
grant select(use_xero_number,number_sync_error) on public.bf_xero_invoices to authenticated;

create or replace function public.bf_protect_xero_number()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 if auth.role() is distinct from 'service_role' then
  if new.xero_number_managed is distinct from old.xero_number_managed
   or new.xero_number_pending is distinct from old.xero_number_pending
   or (old.xero_number_managed and new.job_number is distinct from old.job_number) then
   raise exception 'This job number is controlled by its linked Xero invoice. Sync it from Xero instead.';
  end if;
 end if;return new;
end $$;
drop trigger if exists bf_protect_xero_number_trigger on public.jobs;
create trigger bf_protect_xero_number_trigger before update on public.jobs for each row execute function public.bf_protect_xero_number();

create or replace function public.bf_create_reviewed_job(p_request_id uuid,p_draft jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare existing bf_ai_requests; j uuid; sid uuid; fid uuid; hash text:=encode(sha256(convert_to(p_draft::text,'UTF8')),'hex');
begin
 if not public.is_admin() then raise exception 'Administrator access required';end if;
 select * into existing from bf_ai_requests where request_id=p_request_id;
 if found then
  if existing.user_id<>auth.uid() or existing.draft_hash<>hash then raise exception 'Request already used with different details';end if;
  return existing.job_id;
 end if;
 if (coalesce((p_draft->>'use_xero_number')::boolean,false)=false and coalesce(trim(p_draft->>'job_number'),'')='') or coalesce(trim(p_draft->>'customer'),'')='' then raise exception 'Job number and customer required';end if;
 if p_draft->>'flooring_type' not in ('LVT','Carpet','Vinyl','Latex / Prep','Mixed') or p_draft->>'flooring_type' is null then raise exception 'Choose a flooring type';end if;
 sid:=nullif(p_draft->>'site_id','')::uuid; fid:=nullif(p_draft->>'fitter_id','')::uuid;
 if sid is not null and not exists(select 1 from sites where id=sid) then raise exception 'Choose an existing site';end if;
 if fid is not null and not exists(select 1 from profiles where id=fid and role='fitter' and active=true) then raise exception 'Choose an active fitter';end if;
 if coalesce((p_draft->>'quantity')::numeric,0)<0 or coalesce((p_draft->>'contract_value')::numeric,0)<0 then raise exception 'Amounts cannot be negative';end if;
 insert into jobs(job_number,customer,site_id,plot,po_number,flooring_type,product_spec,quantity,quantity_unit,install_date,address,access_notes,instructions,contract_value,created_by,xero_number_pending)
 values(case when coalesce((p_draft->>'use_xero_number')::boolean,false) then 'AWAITING-'||p_request_id::text else trim(p_draft->>'job_number') end,trim(p_draft->>'customer'),sid,p_draft->>'plot',p_draft->>'po_number',p_draft->>'flooring_type',p_draft->>'product_spec',(p_draft->>'quantity')::numeric,p_draft->>'quantity_unit',nullif(p_draft->>'install_date','')::date,p_draft->>'address',p_draft->>'access_notes',p_draft->>'instructions',coalesce((p_draft->>'contract_value')::numeric,0),auth.uid(),coalesce((p_draft->>'use_xero_number')::boolean,false)) returning id into j;
 if fid is not null then insert into job_assignments(job_id,fitter_id) values(j,fid);end if;
 insert into bf_ai_requests values(p_request_id,auth.uid(),j,hash,now());return j;
end $$;


create or replace function public.bf_apply_xero_snapshot(p_job uuid,p_tenant uuid,p_invoice uuid,p_status text,p_number text,p_total numeric,p_paid numeric,p_credited numeric,p_due_amount numeric,p_due date)
returns void language plpgsql security definer set search_path=public as $$
declare prior bf_xero_invoices;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Server access required';end if;
 if not exists(select 1 from bf_xero_connection c join profiles p on p.id=c.connected_by where c.id=1 and c.tenant_id=p_tenant and p.role='admin' and p.active=true) then raise exception 'Wrong or inactive organisation';end if;
 select * into prior from bf_xero_invoices where job_id=p_job and tenant_id=p_tenant for update;
 if not found or (prior.invoice_id is not null and prior.invoice_id<>p_invoice) then raise exception 'Invoice link mismatch';end if;
 if p_status not in ('DRAFT','SUBMITTED','AUTHORISED','PAID','VOIDED','DELETED') or p_status is null or p_total is null or p_paid is null or p_credited is null or p_due_amount is null or p_total<0 or p_paid<0 or p_credited<0 or p_due_amount<0 then raise exception 'Invalid invoice snapshot';end if;
 update bf_xero_invoices set invoice_id=p_invoice,invoice_number=p_number,invoice_status=p_status,total=p_total,amount_paid=p_paid,amount_credited=p_credited,amount_due=p_due_amount,due_date=p_due,synced_at=now() where job_id=p_job;
 if prior.use_xero_number then
  update jobs set xero_number_managed=true,xero_number_pending=true where id=p_job;
  if nullif(trim(p_number),'') is null then
   update bf_xero_invoices set number_sync_error='Xero has not returned an invoice number. Sync again before printing.' where job_id=p_job;
  else
   begin
    update jobs set job_number=trim(p_number),xero_number_pending=false where id=p_job;
    update bf_xero_invoices set number_sync_error=null where job_id=p_job;
   exception when unique_violation then
    update bf_xero_invoices set number_sync_error='This Xero invoice number is already used by another job. Reconcile the existing job, then sync again.' where job_id=p_job;
   end;
  end if;
 end if;
 if p_status in ('AUTHORISED','PAID') then
  update jobs set invoiced_value=greatest(0,p_total-p_credited),paid_value=p_paid,
   status=case when p_status='PAID' then 'Payment Received'::job_status when status in ('Install Complete','Complete','Payment Received') then 'Invoiced'::job_status else status end where id=p_job;
 elsif p_status in ('VOIDED','DELETED') and prior.invoice_status in ('AUTHORISED','PAID') then
  update jobs set invoiced_value=0,paid_value=0,status=case when status in ('Invoiced','Payment Received') then 'Install Complete'::job_status else status end where id=p_job;
 end if;
end $$;

commit;
