-- Apply before releasing the matching frontend. Preserves all existing job values.
-- Then deploy the frontend, then apply 006 to enforce price read restrictions.
begin;
alter table public.job_assignments add column if not exists fitting_cost numeric(12,2) check(fitting_cost>=0);
create table if not exists public.job_admin_tracking (
 job_id uuid primary key references public.jobs(id) on delete cascade,
 materials_ordered boolean not null default false,
 po_received boolean not null default false,
 install_complete boolean not null default false,
 snagging_outstanding boolean not null default false,
 issues_notes text not null default '' check(length(issues_notes)<=10000)
);
alter table public.job_admin_tracking enable row level security;
revoke all on public.job_admin_tracking from public,anon,authenticated;
grant select,insert,update,delete on public.job_admin_tracking to authenticated;
drop policy if exists "admins manage overview" on public.job_admin_tracking;
create policy "admins manage overview" on public.job_admin_tracking to authenticated
 using(public.is_admin()) with check(public.is_admin());

create or replace function public.bf_read_jobs(p_job uuid default null)
returns setof jsonb language sql stable security definer set search_path=public as $$
 select (case when public.is_admin() then to_jsonb(j)
 else to_jsonb(j)-array['contract_value','extras_value','invoiced_value','paid_value','fitter_payment_due'] ||jsonb_build_object('fitting_cost',(select fitting_cost from public.job_assignments where job_id=j.id and fitter_id=auth.uid())) end)
 ||jsonb_build_object('site_name',coalesce(s.name,''))
 from public.jobs j left join public.sites s on s.id=j.site_id
 where (p_job is null or j.id=p_job)
 and exists(select 1 from public.profiles where id=auth.uid() and active=true)
 and (public.is_admin() or public.assigned_to_job(j.id))
 order by j.install_date nulls last,j.created_at;
$$;
create or replace function public.bf_read_variations(p_job uuid)
returns setof jsonb language sql stable security definer set search_path=public as $$
 select case when public.is_admin() then to_jsonb(v) else to_jsonb(v)-'amount' end
 from public.variations v where v.job_id=p_job
 and exists(select 1 from public.profiles where id=auth.uid() and active=true)
 and (public.is_admin() or public.assigned_to_job(v.job_id))
 order by v.created_at desc;
$$;
revoke all on function public.bf_read_jobs(uuid),public.bf_read_variations(uuid) from public,anon;
grant execute on function public.bf_read_jobs(uuid),public.bf_read_variations(uuid) to authenticated;
commit;
