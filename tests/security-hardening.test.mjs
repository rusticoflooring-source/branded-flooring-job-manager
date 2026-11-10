import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const admin='00000000-0000-0000-0000-000000000001', fitter='00000000-0000-0000-0000-000000000002', job='00000000-0000-0000-0000-000000000003',site='00000000-0000-0000-0000-000000000004';
test('active assigned access, inactive denial, site isolation and admin-only photo deletion',async()=>{
 const db=new PGlite();try{
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(name text,bucket_id text);alter table storage.objects enable row level security;grant usage on schema storage to authenticated;grant select,insert,update,delete on storage.objects to authenticated;create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;insert into auth.users values('${admin}'),('${fitter}');`);
 const schema=await readFile(new URL('../schema.sql',import.meta.url),'utf8');await db.exec(schema.replace('create extension if not exists pgcrypto;',''));
 await db.exec(`grant usage on schema public to authenticated;grant select,insert,update,delete on all tables in schema public to authenticated;insert into profiles(id,full_name,role) values('${admin}','Admin','admin'),('${fitter}','Fitter','fitter');insert into sites(id,name) values('${site}','Assigned site');insert into jobs(id,job_number,customer,site_id) values('${job}','1','Customer','${site}');insert into job_assignments(job_id,fitter_id) values('${job}','${fitter}');insert into job_files(job_id,category,file_name,storage_path,created_by) values('${job}','Completed Work','photo.png','${job}/photo.png','${admin}');insert into storage.objects values('${job}/photo.png','job-files');`);
 for(const name of ['005_admin_overview_price_privacy','006_enforce_price_privacy','007_financial_text_privacy','010_security_hardening'])await db.exec(await readFile(new URL('../supabase/migrations/'+name+'.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../supabase/migrations/010_security_hardening.sql',import.meta.url),'utf8'));
 await db.exec(`update job_files set fitter_shared=true;set role authenticated;select set_config('request.jwt.claim.sub','${fitter}',false);`);
 assert.equal((await db.query('select * from sites')).rows.length,1);
 assert.equal((await db.query('select * from job_files')).rows.length,1);
 assert.equal((await db.query('select * from storage.objects')).rows.length,1);
 assert.equal((await db.query('delete from job_files returning id')).rows.length,0);
 assert.equal((await db.query('delete from storage.objects returning name')).rows.length,0);
 await db.exec(`insert into job_notes(job_id,body,visibility) values('${job}','Site checked','team');update jobs set status='In Progress' where id='${job}';reset role;update profiles set active=false where id='${fitter}';set role authenticated;`);
 for(const table of ['sites','job_assignments','job_notes','job_files','job_checklist_items','storage.objects'])assert.equal((await db.query('select * from '+table)).rows.length,0,table);
 assert.equal((await db.query('select * from bf_read_jobs()')).rows.length,0);
 assert.equal((await db.query(`update jobs set status='Snag' where id='${job}' returning id`)).rows.length,0);
 await assert.rejects(db.query(`insert into job_notes(job_id,body,visibility) values('${job}','Inactive note','team')`),/row-level security/);
 await assert.rejects(db.query(`insert into storage.objects values('${job}/new.png','job-files')`),/row-level security/);
 await db.exec(`select set_config('request.jwt.claim.sub','${admin}',false)`);
 assert.equal((await db.query('select * from sites')).rows.length,2);
 assert.equal((await db.query('select * from bf_read_jobs()')).rows.length,1);
 assert.equal((await db.query('delete from job_files returning id')).rows.length,1);
 assert.equal((await db.query('delete from storage.objects returning name')).rows.length,1);
 }finally{await db.close()}
});
