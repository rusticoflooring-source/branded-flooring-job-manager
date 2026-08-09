-- BRANDED FLOORING JOB MANAGER
-- Run this entire file once in the Supabase SQL Editor.

create extension if not exists pgcrypto;

create type public.app_role as enum ('admin','fitter');
create type public.job_status as enum ('Booked','Prep','In Progress','Snag','Complete','Invoiced','Paid');
create type public.fitter_payment_status as enum ('Due','Approved','Paid');
create type public.variation_status as enum ('Pending','Approved','Rejected');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role public.app_role not null default 'fitter',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.sites (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  developer text,
  address text,
  created_at timestamptz not null default now()
);

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  job_number text not null unique,
  customer text not null,
  site_id uuid references public.sites(id) on delete set null,
  plot text,
  po_number text,
  flooring_type text not null default 'LVT',
  status public.job_status not null default 'Booked',
  install_date date,
  due_date date,
  address text,
  access_notes text,
  instructions text,
  contract_value numeric(12,2) not null default 0,
  extras_value numeric(12,2) not null default 0,
  invoiced_value numeric(12,2) not null default 0,
  paid_value numeric(12,2) not null default 0,
  fitter_payment_due numeric(12,2) not null default 0,
  fitter_payment_status public.fitter_payment_status not null default 'Due',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.job_assignments (
  job_id uuid not null references public.jobs(id) on delete cascade,
  fitter_id uuid not null references public.profiles(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  primary key (job_id,fitter_id)
);

create table public.job_notes (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  body text not null,
  visibility text not null default 'team' check (visibility in ('team','internal')),
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.variations (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  description text not null,
  quantity numeric(12,2),
  unit text,
  amount numeric(12,2) not null default 0,
  status public.variation_status not null default 'Pending',
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.job_files (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  category text not null,
  file_name text not null,
  storage_path text not null unique,
  note text,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.job_checklist_items (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  item_key text not null,
  label text not null,
  completed boolean not null default false,
  completed_by uuid references auth.users(id),
  completed_at timestamptz,
  unique(job_id,item_key)
);

create index jobs_install_date_idx on public.jobs(install_date);
create index jobs_site_idx on public.jobs(site_id);
create index assignments_fitter_idx on public.job_assignments(fitter_id);
create index notes_job_idx on public.job_notes(job_id);
create index variations_job_idx on public.variations(job_id);
create index files_job_idx on public.job_files(job_id);

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from public.profiles where id=auth.uid() and role='admin' and active=true); $$;

create or replace function public.assigned_to_job(j uuid)
returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from public.job_assignments where job_id=j and fitter_id=auth.uid()); $$;

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at=now(); return new; end $$;

create trigger jobs_touch_updated before update on public.jobs for each row execute procedure public.touch_updated_at();

-- Defence-in-depth: fitters may update operational job fields, but can never
-- alter pricing, invoicing, fitter pay, customer/site identity, PO or programme fields.
create or replace function public.protect_admin_job_fields()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if not public.is_admin() then
    if new.job_number is distinct from old.job_number
       or new.customer is distinct from old.customer
       or new.site_id is distinct from old.site_id
       or new.plot is distinct from old.plot
       or new.po_number is distinct from old.po_number
       or new.flooring_type is distinct from old.flooring_type
       or new.install_date is distinct from old.install_date
       or new.due_date is distinct from old.due_date
       or new.address is distinct from old.address
       or new.contract_value is distinct from old.contract_value
       or new.extras_value is distinct from old.extras_value
       or new.invoiced_value is distinct from old.invoiced_value
       or new.paid_value is distinct from old.paid_value
       or new.fitter_payment_due is distinct from old.fitter_payment_due
       or new.fitter_payment_status is distinct from old.fitter_payment_status
       or new.created_by is distinct from old.created_by then
      raise exception 'Fitter accounts cannot alter protected job fields';
    end if;
  end if;
  return new;
end $$;

create trigger protect_admin_job_fields_trigger
before update on public.jobs
for each row execute procedure public.protect_admin_job_fields();

alter table public.profiles enable row level security;
alter table public.sites enable row level security;
alter table public.jobs enable row level security;
alter table public.job_assignments enable row level security;
alter table public.job_notes enable row level security;
alter table public.variations enable row level security;
alter table public.job_files enable row level security;
alter table public.job_checklist_items enable row level security;

-- Profiles
create policy "users read own profile" on public.profiles for select using (id=auth.uid() or public.is_admin());
create policy "admins manage profiles" on public.profiles for all using (public.is_admin()) with check (public.is_admin());

-- Sites: assigned fitters may read sites through their jobs; admins manage all
create policy "admins manage sites" on public.sites for all using (public.is_admin()) with check (public.is_admin());
create policy "authenticated read sites" on public.sites for select to authenticated using (true);

-- Jobs
create policy "admins manage jobs" on public.jobs for all using (public.is_admin()) with check (public.is_admin());
create policy "fitters read assigned jobs" on public.jobs for select using (public.assigned_to_job(id));
create policy "fitters update assigned jobs" on public.jobs for update using (public.assigned_to_job(id))
with check (public.assigned_to_job(id));

-- Assignments
create policy "admins manage assignments" on public.job_assignments for all using (public.is_admin()) with check (public.is_admin());
create policy "fitters read own assignments" on public.job_assignments for select using (fitter_id=auth.uid());

-- Notes
create policy "admins manage notes" on public.job_notes for all using (public.is_admin()) with check (public.is_admin());
create policy "fitters read team notes" on public.job_notes for select using (public.assigned_to_job(job_id) and visibility='team');
create policy "fitters add team notes" on public.job_notes for insert with check (public.assigned_to_job(job_id) and visibility='team' and created_by=auth.uid());

-- Variations
create policy "admins manage variations" on public.variations for all using (public.is_admin()) with check (public.is_admin());
create policy "fitters read variations" on public.variations for select using (public.assigned_to_job(job_id));
create policy "fitters report variations" on public.variations for insert with check (public.assigned_to_job(job_id) and status='Pending' and created_by=auth.uid());

-- Files metadata
create policy "admins manage file records" on public.job_files for all using (public.is_admin()) with check (public.is_admin());
create policy "fitters read job files" on public.job_files for select using (public.assigned_to_job(job_id));
create policy "fitters add job files" on public.job_files for insert with check (public.assigned_to_job(job_id) and created_by=auth.uid());

-- Checklist
create policy "admins manage checklists" on public.job_checklist_items for all using (public.is_admin()) with check (public.is_admin());
create policy "fitters read checklists" on public.job_checklist_items for select using (public.assigned_to_job(job_id));
create policy "fitters add checklist" on public.job_checklist_items for insert with check (public.assigned_to_job(job_id));
create policy "fitters update checklist" on public.job_checklist_items for update using (public.assigned_to_job(job_id)) with check (public.assigned_to_job(job_id));

-- Private storage bucket for site photos, PDFs and signatures
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('job-files','job-files',false,10485760,array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do update set public=false;

-- storage path always starts with job UUID
create policy "admins read job storage" on storage.objects for select to authenticated
using (bucket_id='job-files' and public.is_admin());

create policy "admins upload job storage" on storage.objects for insert to authenticated
with check (bucket_id='job-files' and public.is_admin());

create policy "admins update job storage" on storage.objects for update to authenticated
using (bucket_id='job-files' and public.is_admin());

create policy "admins delete job storage" on storage.objects for delete to authenticated
using (bucket_id='job-files' and public.is_admin());

create policy "fitters read assigned job storage" on storage.objects for select to authenticated
using (
  bucket_id='job-files'
  and public.assigned_to_job(((storage.foldername(name))[1])::uuid)
);

create policy "fitters upload assigned job storage" on storage.objects for insert to authenticated
with check (
  bucket_id='job-files'
  and public.assigned_to_job(((storage.foldername(name))[1])::uuid)
);

-- When a checklist item becomes completed, stamp the user and time.
create or replace function public.checklist_stamp()
returns trigger language plpgsql as $$
begin
  if new.completed=true and (old.completed is distinct from true) then
    new.completed_by=auth.uid();
    new.completed_at=now();
  elsif new.completed=false then
    new.completed_by=null;
    new.completed_at=null;
  end if;
  return new;
end $$;

create trigger checklist_stamp_trigger before update on public.job_checklist_items
for each row execute procedure public.checklist_stamp();

-- Optional sample site. Delete if not wanted.
insert into public.sites(name,developer,address)
values ('Ash Court','T West',null)
on conflict do nothing;
