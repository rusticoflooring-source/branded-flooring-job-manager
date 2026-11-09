-- Apply after migration 005. Also enforces the column restrictions from 006. No notes, jobs or files are deleted.
begin;
create or replace function public.bf_fitter_safe_text(value text)
returns boolean language sql immutable set search_path=public as $$
 select coalesce(trim(value),'') ~* '^(fitters?[''’]?[[:space:]]+(wage|money))[[:space:]]*:?[[:space:]]*£?[[:space:]]*[0-9]+([.,][0-9]{1,2})?[[:space:]]*(gbp|pounds?)?\.?$'
 or coalesce(value,'') !~* '([£$€]|\m(gbp|pounds?|price|priced|pricing|cost|costs|costing|costings|charge|charges|charged|invoice|invoiced|quote|quotation|profit|margin|vat|revenue|contract value|per[[:space:]]+(m2|m²|metre|meter))\M)';
$$;
alter table public.job_notes alter column visibility set default 'internal';
-- Existing admin-authored notes require an explicit fresh sharing decision.
update public.job_notes set visibility='internal' where visibility='team'
 and exists(select 1 from public.profiles p where p.id=created_by and p.role='admin');
drop policy if exists "financial notes are admin only" on public.job_notes;
create policy "financial notes are admin only" on public.job_notes as restrictive for select to authenticated
 using(public.is_admin() or (visibility='team' and public.bf_fitter_safe_text(body)));
alter table public.job_files add column if not exists fitter_shared boolean not null default false;
-- Existing attachments stay private until reviewed by an administrator.
drop policy if exists "reviewed fitter files only" on public.job_files;
create policy "reviewed fitter files only" on public.job_files as restrictive for select to authenticated
 using(public.is_admin() or (fitter_shared and public.bf_fitter_safe_text(note) and public.bf_fitter_safe_text(file_name)));
drop policy if exists "reviewed fitter storage only" on storage.objects;
create policy "reviewed fitter storage only" on storage.objects as restrictive for select to authenticated
 using(bucket_id<>'job-files' or public.is_admin() or exists(select 1 from public.job_files f where f.storage_path=name and f.fitter_shared and public.assigned_to_job(f.job_id) and public.bf_fitter_safe_text(f.note) and public.bf_fitter_safe_text(f.file_name)));
-- Redact financial prose as well as numeric customer amounts in fitter RPCs.
create or replace function public.bf_read_jobs(p_job uuid default null)
returns setof jsonb language sql stable security definer set search_path=public as $$
 select (case when public.is_admin() then to_jsonb(j)
 else (select jsonb_object_agg(e.key,case when jsonb_typeof(e.value)='string' and not public.bf_fitter_safe_text(e.value#>>'{}') then to_jsonb('[Admin-only financial information]'::text) else e.value end)
 from jsonb_each(to_jsonb(j)-array['contract_value','extras_value','invoiced_value','paid_value','fitter_payment_due']) e)
 ||jsonb_build_object('fitting_cost',(select fitting_cost from public.job_assignments where job_id=j.id and fitter_id=auth.uid())) end)
 ||jsonb_build_object('site_name',case when public.is_admin() or public.bf_fitter_safe_text(s.name) then coalesce(s.name,'') else '[Admin-only financial information]' end)
 from public.jobs j left join public.sites s on s.id=j.site_id
 where (p_job is null or j.id=p_job)
 and exists(select 1 from public.profiles where id=auth.uid() and active=true)
 and (public.is_admin() or public.assigned_to_job(j.id)) order by j.install_date nulls last,j.created_at;
$$;
create or replace function public.bf_read_variations(p_job uuid)
returns setof jsonb language sql stable security definer set search_path=public as $$
 select case when public.is_admin() then to_jsonb(v) else (to_jsonb(v)-'amount')||jsonb_build_object('description',case when public.bf_fitter_safe_text(v.description) then v.description else '[Admin-only financial information]' end) end
 from public.variations v where v.job_id=p_job
 and exists(select 1 from public.profiles where id=auth.uid() and active=true)
 and (public.is_admin() or public.assigned_to_job(v.job_id)) order by v.created_at desc;
$$;
revoke select on public.jobs,public.variations from public,anon,authenticated;
-- Remove historical column grants too, then allow only the id needed by inserts.
do $$ declare c record; begin
 for c in select table_name,column_name from information_schema.columns
 where table_schema='public' and table_name in ('jobs','variations') loop
 execute format('revoke select (%I) on public.%I from public,anon,authenticated',c.column_name,c.table_name);
 end loop;
end $$;
grant select(id) on public.jobs to authenticated;


commit;
