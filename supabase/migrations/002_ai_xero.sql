-- Run after 001 has committed. Back up and review in staging first.
begin;
alter table public.jobs add column if not exists archived boolean not null default false;
alter table public.jobs add column if not exists product_spec text;
alter table public.jobs add column if not exists quantity numeric(12,3);
alter table public.jobs add column if not exists quantity_unit text;

create table if not exists public.bf_ai_requests(request_id uuid primary key,user_id uuid not null references public.profiles(id),job_id uuid not null references public.jobs(id) on delete cascade,draft_hash text not null,created_at timestamptz not null default now());
create table if not exists public.bf_oauth_states(state_hash text primary key,user_id uuid not null references public.profiles(id),expires_at timestamptz not null);
create table if not exists public.bf_api_usage(user_id uuid not null,bucket text not null,window_start timestamptz not null,hits integer not null,primary key(user_id,bucket,window_start));
create table if not exists public.bf_integration_locks(lock_key text primary key,owner text not null,expires_at timestamptz not null);
create table if not exists public.bf_xero_connection(id integer primary key check(id=1),token_ciphertext text not null,expires_at timestamptz not null,connected_by uuid not null references public.profiles(id),tenants jsonb not null default '[]',tenant_id uuid,tenant_name text,last_synced_at timestamptz);
create table if not exists public.bf_xero_invoices(job_id uuid primary key references public.jobs(id) on delete cascade,tenant_id uuid not null,invoice_id uuid,invoice_number text,request_hash text not null,request_key text not null,reference text not null,invoice_status text,total numeric(12,2),amount_paid numeric(12,2),amount_credited numeric(12,2),amount_due numeric(12,2),due_date date,created_by uuid references public.profiles(id),created_at timestamptz not null default now(),synced_at timestamptz,unique(tenant_id,invoice_id));
create table if not exists public.bf_xero_events(event_hash text primary key,tenant_id uuid not null,invoice_id uuid not null,received_at timestamptz not null default now());

alter table public.bf_ai_requests enable row level security;
alter table public.bf_oauth_states enable row level security;
alter table public.bf_api_usage enable row level security;
alter table public.bf_integration_locks enable row level security;
alter table public.bf_xero_connection enable row level security;
alter table public.bf_xero_invoices enable row level security;
alter table public.bf_xero_events enable row level security;
revoke all on public.bf_ai_requests,public.bf_oauth_states,public.bf_api_usage,public.bf_integration_locks,public.bf_xero_connection,public.bf_xero_invoices,public.bf_xero_events from anon,authenticated;
grant all on public.bf_ai_requests,public.bf_oauth_states,public.bf_api_usage,public.bf_integration_locks,public.bf_xero_connection,public.bf_xero_invoices,public.bf_xero_events to service_role;
grant select(job_id,tenant_id,invoice_id,invoice_number,reference,invoice_status,total,amount_paid,amount_credited,amount_due,due_date,created_at,synced_at) on public.bf_xero_invoices to authenticated;
drop policy if exists "admins read Xero invoice summaries" on public.bf_xero_invoices;
create policy "admins read Xero invoice summaries" on public.bf_xero_invoices for select to authenticated using(public.is_admin());

create or replace function public.bf_take_api_slot(p_user uuid,p_bucket text,p_limit integer)
returns boolean language plpgsql security definer set search_path=public as $$
declare n integer; w timestamptz:=date_trunc('hour',now());
begin
 if p_limit<1 or p_limit>1000 then raise exception 'Invalid limit'; end if;
 insert into bf_api_usage(user_id,bucket,window_start,hits) values(p_user,p_bucket,w,1)
 on conflict(user_id,bucket,window_start) do update set hits=bf_api_usage.hits+1 returning hits into n;
 delete from bf_api_usage where window_start<now()-interval '2 days';
 return n<=p_limit;
end $$;
create or replace function public.bf_acquire_lock(p_key text,p_owner text)
returns boolean language plpgsql security definer set search_path=public as $$
declare n integer;
begin
 insert into bf_integration_locks values(p_key,p_owner,now()+interval '10 minutes')
 on conflict(lock_key) do update set owner=excluded.owner,expires_at=excluded.expires_at where bf_integration_locks.expires_at<now();
 get diagnostics n=row_count; return n=1;
end $$;

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
 if coalesce(trim(p_draft->>'job_number'),'')='' or coalesce(trim(p_draft->>'customer'),'')='' then raise exception 'Job number and customer required';end if;
 if p_draft->>'flooring_type' not in ('LVT','Carpet','Vinyl','Latex / Prep','Mixed') or p_draft->>'flooring_type' is null then raise exception 'Choose a flooring type';end if;
 sid:=nullif(p_draft->>'site_id','')::uuid; fid:=nullif(p_draft->>'fitter_id','')::uuid;
 if sid is not null and not exists(select 1 from sites where id=sid) then raise exception 'Choose an existing site';end if;
 if fid is not null and not exists(select 1 from profiles where id=fid and role='fitter' and active=true) then raise exception 'Choose an active fitter';end if;
 if coalesce((p_draft->>'quantity')::numeric,0)<0 or coalesce((p_draft->>'contract_value')::numeric,0)<0 then raise exception 'Amounts cannot be negative';end if;
 insert into jobs(job_number,customer,site_id,plot,po_number,flooring_type,product_spec,quantity,quantity_unit,install_date,address,access_notes,instructions,contract_value,created_by)
 values(trim(p_draft->>'job_number'),trim(p_draft->>'customer'),sid,p_draft->>'plot',p_draft->>'po_number',p_draft->>'flooring_type',p_draft->>'product_spec',(p_draft->>'quantity')::numeric,p_draft->>'quantity_unit',nullif(p_draft->>'install_date','')::date,p_draft->>'address',p_draft->>'access_notes',p_draft->>'instructions',coalesce((p_draft->>'contract_value')::numeric,0),auth.uid()) returning id into j;
 if fid is not null then insert into job_assignments(job_id,fitter_id) values(j,fid);end if;
 insert into bf_ai_requests values(p_request_id,auth.uid(),j,hash,now());return j;
end $$;

-- Preserve the original protected-field checks, adding the new admin fields.
-- Trusted server reconciliation uses service_role; browser fitters cannot use it.
create or replace function public.protect_admin_job_fields()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 if auth.role()='service_role' then return new;end if;
 if not public.is_admin() then
  if new.job_number is distinct from old.job_number or new.customer is distinct from old.customer
   or new.site_id is distinct from old.site_id or new.plot is distinct from old.plot
   or new.po_number is distinct from old.po_number or new.flooring_type is distinct from old.flooring_type
   or new.install_date is distinct from old.install_date or new.due_date is distinct from old.due_date
   or new.address is distinct from old.address or new.contract_value is distinct from old.contract_value
   or new.extras_value is distinct from old.extras_value or new.invoiced_value is distinct from old.invoiced_value
   or new.paid_value is distinct from old.paid_value or new.fitter_payment_due is distinct from old.fitter_payment_due
   or new.fitter_payment_status is distinct from old.fitter_payment_status or new.created_by is distinct from old.created_by
   or new.archived is distinct from old.archived or new.product_spec is distinct from old.product_spec
   or new.quantity is distinct from old.quantity or new.quantity_unit is distinct from old.quantity_unit then
   raise exception 'Fitter accounts cannot alter protected job fields';
  end if;
 end if;return new;
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
 if p_status in ('AUTHORISED','PAID') then
  update jobs set invoiced_value=greatest(0,p_total-p_credited),paid_value=p_paid,
   status=case when p_status='PAID' then 'Payment Received'::job_status when status in ('Install Complete','Complete','Payment Received') then 'Invoiced'::job_status else status end where id=p_job;
 elsif p_status in ('VOIDED','DELETED') and prior.invoice_status in ('AUTHORISED','PAID') then
  update jobs set invoiced_value=0,paid_value=0,status=case when status in ('Invoiced','Payment Received') then 'Install Complete'::job_status else status end where id=p_job;
 end if;
end $$;
revoke all on function public.bf_take_api_slot(uuid,text,integer),public.bf_acquire_lock(text,text),public.bf_apply_xero_snapshot(uuid,uuid,uuid,text,text,numeric,numeric,numeric,numeric,date) from public,anon,authenticated;
grant execute on function public.bf_take_api_slot(uuid,text,integer),public.bf_acquire_lock(text,text),public.bf_apply_xero_snapshot(uuid,uuid,uuid,text,text,numeric,numeric,numeric,numeric,date) to service_role;
revoke all on function public.bf_create_reviewed_job(uuid,jsonb) from public,anon;
grant execute on function public.bf_create_reviewed_job(uuid,jsonb) to authenticated;
commit;