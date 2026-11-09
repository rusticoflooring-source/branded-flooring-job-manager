-- Saved quotations and audit history. Additive; no existing jobs or invoices change.
begin;
create table if not exists public.bf_quotes (
 id uuid primary key default gen_random_uuid(),
 job_id uuid not null references public.jobs(id) on delete restrict,
 reference text not null unique check(length(reference) between 1 and 100),
 status text not null default 'Draft' check(status in ('Draft','Sent','Accepted','Declined')),
 payload jsonb not null check(jsonb_typeof(payload)='object' and octet_length(payload::text)<=150000),
 net numeric(12,2) not null check(net>0),
 vat_code text not null check(vat_code in ('0','5','20','reverse20')),
 quote_date date not null default current_date,
 revision integer not null default 1,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table if not exists public.bf_quote_events (
 id bigint generated always as identity primary key,
 quote_id uuid not null references public.bf_quotes(id) on delete restrict,
 actor uuid references public.profiles(id),
 previous_status text,
 status text not null,
 revision integer not null,
 snapshot jsonb not null,
 created_at timestamptz not null default now()
);
alter table public.bf_quotes enable row level security;
alter table public.bf_quote_events enable row level security;
revoke all on public.bf_quotes,public.bf_quote_events from public,anon,authenticated;
grant select,insert,update on public.bf_quotes to authenticated;
grant select on public.bf_quote_events to authenticated;
drop policy if exists quotes_admin on public.bf_quotes;
create policy quotes_admin on public.bf_quotes to authenticated using(public.is_admin()) with check(public.is_admin());
drop policy if exists quote_history_admin on public.bf_quote_events;
create policy quote_history_admin on public.bf_quote_events for select to authenticated using(public.is_admin());
create or replace function public.bf_quote_guard() returns trigger language plpgsql set search_path=public as $$
declare item jsonb;field text;
begin
 foreach field in array array['customer','email','contact','customerAddress','description','terms'] loop
  if jsonb_typeof(new.payload->field) is distinct from 'string' or length(new.payload->>field)>10000 then raise exception 'Invalid quotation field: %',field;end if;
 end loop;
 if length(trim(new.payload->>'customer'))=0 or length(trim(new.payload->>'description'))=0 or jsonb_typeof(new.payload->'details') is distinct from 'array' then raise exception 'Customer, description and details are required';end if;
 if jsonb_array_length(new.payload->'details')>30 then raise exception 'Too many quotation detail fields';end if;
 for item in select value from jsonb_array_elements(new.payload->'details') loop
  if jsonb_typeof(item->'label') is distinct from 'string' or jsonb_typeof(item->'value') is distinct from 'string' or length(item->>'label')>200 or length(item->>'value')>10000 then raise exception 'Invalid quotation detail';end if;
 end loop;
 if TG_OP='INSERT' then
  if new.status<>'Draft' then raise exception 'New quotations must start as Draft';end if;
  new.revision:=1;new.created_at:=now();
 else
  if new.id<>old.id or new.job_id<>old.job_id or new.reference<>old.reference or new.quote_date<>old.quote_date or new.created_at<>old.created_at then raise exception 'Quotation identity cannot change';end if;
  if old.status<>'Draft' and (new.payload is distinct from old.payload or new.net<>old.net or new.vat_code<>old.vat_code) then raise exception 'Create a new draft to revise an issued quotation';end if;
  if new.status<>old.status and not ((old.status='Draft' and new.status='Sent') or (old.status='Sent' and new.status in ('Accepted','Declined'))) then raise exception 'Invalid quotation status change';end if;
  new.revision:=old.revision+1;
 end if;
 new.updated_at:=now();return new;
end;$$;
create or replace function public.bf_quote_audit() returns trigger language plpgsql security definer set search_path=public as $$
begin
 insert into public.bf_quote_events(quote_id,actor,previous_status,status,revision,snapshot) values(new.id,auth.uid(),case when TG_OP='UPDATE' then old.status else null end,new.status,new.revision,jsonb_build_object('payload',new.payload,'net',new.net,'vat_code',new.vat_code,'quote_date',new.quote_date));
 return new;
end;$$;
revoke all on function public.bf_quote_guard(),public.bf_quote_audit() from public,anon,authenticated;
drop trigger if exists bf_quote_guard on public.bf_quotes;
create trigger bf_quote_guard before insert or update on public.bf_quotes for each row execute function public.bf_quote_guard();
drop trigger if exists bf_quote_audit on public.bf_quotes;
create trigger bf_quote_audit after insert or update on public.bf_quotes for each row execute function public.bf_quote_audit();
commit;
