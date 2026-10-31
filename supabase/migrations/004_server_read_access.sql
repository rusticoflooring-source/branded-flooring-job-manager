-- Older projects may have removed default service_role table privileges.
-- Only server-side reads needed by this integration are added here.
begin;
grant usage on schema public to service_role;
grant select (id,role,active,full_name) on public.profiles to service_role;
grant select (id,name,developer) on public.sites to service_role;
grant select on public.jobs to service_role;
commit;
