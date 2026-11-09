-- Add VAT records, extend existing materials tracking, and add fitter diary dates/time off.
-- Existing job prices, invoices and installation dates are preserved.
begin;
create table if not exists public.bf_vat_returns (
 id uuid primary key default gen_random_uuid(),
 period_start date not null,
 period_end date not null check(period_end>=period_start),
 filing_due date not null,
 payment_due date not null,
 amount numeric(12,2),
 amount_basis text not null default 'Estimated' check(amount_basis in ('Estimated','Confirmed')),
 source text not null default '' check(length(source)<=1000),
 submitted_on date,
 settled_amount numeric(12,2) not null default 0 check(settled_amount>=0),
 notes text not null default '' check(length(notes)<=5000),
 revision integer not null default 1,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(period_start,period_end),
 check(amount_basis<>'Confirmed' or (amount is not null and length(trim(source))>0)),
 check(submitted_on is null or amount_basis='Confirmed'),
 check(settled_amount=0 or (amount_basis='Confirmed' and amount is not null and settled_amount<=abs(amount)))
);
create table if not exists public.bf_vat_events (
 id bigint generated always as identity primary key,
 return_id uuid not null references public.bf_vat_returns(id) on delete restrict,
 actor uuid references public.profiles(id),
 snapshot jsonb not null,
 created_at timestamptz not null default now()
);
alter table public.bf_vat_returns enable row level security;
alter table public.bf_vat_events enable row level security;
revoke all on public.bf_vat_returns,public.bf_vat_events from public,anon,authenticated;
grant select,insert,update on public.bf_vat_returns to authenticated;
grant select on public.bf_vat_events to authenticated;
drop policy if exists vat_admin on public.bf_vat_returns;
create policy vat_admin on public.bf_vat_returns to authenticated using(public.is_admin()) with check(public.is_admin());
drop policy if exists vat_history_admin on public.bf_vat_events;
create policy vat_history_admin on public.bf_vat_events for select to authenticated using(public.is_admin());
create or replace function public.bf_vat_touch() returns trigger language plpgsql set search_path=public as $$
begin
 if TG_OP='INSERT' then new.revision:=1;new.created_at:=now();else new.revision:=old.revision+1;new.created_at:=old.created_at;end if;
 new.updated_at:=now();return new;
end;$$;
create or replace function public.bf_vat_audit() returns trigger language plpgsql security definer set search_path=public as $$
begin insert into public.bf_vat_events(return_id,actor,snapshot) values(new.id,auth.uid(),to_jsonb(new));return new;end;$$;
revoke all on function public.bf_vat_touch(),public.bf_vat_audit() from public,anon,authenticated;
drop trigger if exists bf_vat_touch on public.bf_vat_returns;
create trigger bf_vat_touch before insert or update on public.bf_vat_returns for each row execute function public.bf_vat_touch();
drop trigger if exists bf_vat_audit on public.bf_vat_returns;
create trigger bf_vat_audit after insert or update on public.bf_vat_returns for each row execute function public.bf_vat_audit();

alter table public.job_admin_tracking add column if not exists delivery_date date;
alter table public.job_admin_tracking add column if not exists materials_delivered boolean not null default false;
alter table public.job_admin_tracking add column if not exists supplier text not null default '' check(length(supplier)<=500);
alter table public.job_admin_tracking add column if not exists order_reference text not null default '' check(length(order_reference)<=500);
alter table public.job_admin_tracking add column if not exists shortages text not null default '' check(length(shortages)<=5000);
alter table public.job_admin_tracking add column if not exists revision integer not null default 1;
alter table public.job_admin_tracking add column if not exists updated_at timestamptz not null default now();
create or replace function public.bf_tracking_touch() returns trigger language plpgsql set search_path=public as $$
begin
 if TG_OP='INSERT' then new.revision:=1;else new.revision:=old.revision+1;end if;
 if not new.materials_ordered then new.materials_delivered:=false;end if;
 new.updated_at:=now();return new;
end;$$;
revoke all on function public.bf_tracking_touch() from public,anon,authenticated;
drop trigger if exists bf_tracking_touch on public.job_admin_tracking;
create trigger bf_tracking_touch before insert or update on public.job_admin_tracking for each row execute function public.bf_tracking_touch();

alter table public.jobs add column if not exists install_end_date date check(install_end_date is null or (install_date is not null and install_end_date>=install_date));
create or replace function public.bf_protect_install_end() returns trigger language plpgsql set search_path=public as $$
begin
 if new.install_end_date is distinct from old.install_end_date and not public.is_admin() then raise exception 'Only administrators can change installation end dates';end if;
 return new;
end;$$;
revoke all on function public.bf_protect_install_end() from public,anon,authenticated;
drop trigger if exists bf_protect_install_end on public.jobs;
create trigger bf_protect_install_end before update on public.jobs for each row execute function public.bf_protect_install_end();
create table if not exists public.bf_fitter_time_off (
 id uuid primary key default gen_random_uuid(),
 fitter_id uuid not null references public.profiles(id),
 start_date date not null,
 end_date date not null check(end_date>=start_date),
 reason text not null default '' check(length(reason)<=500),
 cancelled boolean not null default false,
 created_at timestamptz not null default now()
);
alter table public.bf_fitter_time_off enable row level security;
revoke all on public.bf_fitter_time_off from public,anon,authenticated;
grant select,insert,update on public.bf_fitter_time_off to authenticated;
drop policy if exists time_off_admin on public.bf_fitter_time_off;
create policy time_off_admin on public.bf_fitter_time_off to authenticated using(public.is_admin()) with check(public.is_admin());
commit;
