-- Disable assigned access immediately when a profile is deactivated.
-- No jobs, photos, signatures or financial records are modified.
begin;
create or replace function public.bf_active_user()
returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.profiles where id=auth.uid() and active=true);
$$;
create or replace function public.assigned_to_job(j uuid)
returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.job_assignments a join public.profiles p on p.id=a.fitter_id
 where a.job_id=j and a.fitter_id=auth.uid() and p.active=true and p.role='fitter');
$$;
-- Use a checked function because direct job-column reads are restricted.
create or replace function public.bf_can_access_site(s uuid)
returns boolean language sql stable security definer set search_path=public as $$
 select public.is_admin() or exists(select 1 from public.jobs j
 where j.site_id=s and public.assigned_to_job(j.id));
$$;
revoke all on function public.bf_active_user(),public.assigned_to_job(uuid),public.bf_can_access_site(uuid) from public,anon;
grant execute on function public.bf_active_user(),public.assigned_to_job(uuid),public.bf_can_access_site(uuid) to authenticated,service_role;
-- Restrictive policies also constrain any historical permissive policies.
do $$ declare t text; begin
 foreach t in array array['sites','jobs','job_assignments','job_notes','variations','job_files','job_checklist_items'] loop
 execute format('drop policy if exists "active accounts only" on public.%I',t);
 execute format('create policy "active accounts only" on public.%I as restrictive for all to authenticated using(public.bf_active_user()) with check(public.bf_active_user())',t);
 end loop;
end $$;
drop policy if exists "authenticated read sites" on public.sites;
drop policy if exists "assigned sites only" on public.sites;
create policy "assigned sites only" on public.sites as restrictive for select to authenticated
 using(public.bf_can_access_site(id));
drop policy if exists "assigned fitters read sites" on public.sites;
create policy "assigned fitters read sites" on public.sites for select to authenticated
 using(public.bf_can_access_site(id));
drop policy if exists "active job storage accounts only" on storage.objects;
create policy "active job storage accounts only" on storage.objects as restrictive for all to authenticated
 using(bucket_id<>'job-files' or public.bf_active_user())
 with check(bucket_id<>'job-files' or public.bf_active_user());
commit;
