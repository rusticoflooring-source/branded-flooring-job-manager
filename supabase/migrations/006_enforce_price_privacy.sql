-- Apply AFTER the matching frontend is live; old frontends use SELECT *.
-- This completes the price-privacy rollout after the compatible 005 preparation.
begin;
-- RLS protects rows, not columns. Block direct reads of customer prices and use
-- checked functions for complete admin records / redacted assigned fitter records.
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
