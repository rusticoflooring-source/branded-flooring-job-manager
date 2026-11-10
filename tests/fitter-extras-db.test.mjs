import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {PGlite} from '@electric-sql/pglite';
const admin='00000000-0000-0000-0000-000000000001',fitter='00000000-0000-0000-0000-000000000002',job='00000000-0000-0000-0000-000000000003',v='00000000-0000-0000-0000-000000000004';
test('assignment costs and separately approved fitter extras share the ledger without copying customer prices or duplicating amounts',async()=>{const db=new PGlite();try{
 await db.exec(`create role anon;create role authenticated;create schema auth;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create table profiles(id uuid primary key,role text,active boolean);insert into profiles values('${admin}','admin',true),('${fitter}','fitter',true);create function is_admin() returns boolean language sql stable security definer as $$select exists(select 1 from profiles where id=auth.uid() and role='admin' and active)$$;create table jobs(id uuid primary key);insert into jobs values('${job}');create table job_assignments(job_id uuid references jobs(id),fitter_id uuid references profiles(id),fitting_cost numeric(12,2) check(fitting_cost>=0),primary key(job_id,fitter_id));create table variations(id uuid primary key,job_id uuid references jobs(id),status text,description text,amount numeric);insert into variations values('${v}','${job}','Pending','Extra preparation',800);grant select,insert,update on job_assignments,variations to authenticated;grant select on profiles to authenticated;grant usage on schema auth to authenticated;`);
 for(const file of ['011_fitter_payment_ledger.sql','20261110202503_linked_fitter_costs_and_extras.sql'])await db.exec(await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
 await db.exec(`set role authenticated;select set_config('request.jwt.claim.sub','${admin}',false);insert into job_assignments values('${job}','${fitter}',100);`);
 const bal=async()=>Number((await db.query("select sum(case when kind in ('Agreed cost','Extra') then amount when kind='Deduction' then -amount else 0 end) as total from bf_fitter_entries")).rows[0].total);
 assert.equal(await bal(),100);
 const approve=amount=>db.query('select bf_approve_fitter_extra($1,$2,$3)',[v,fitter,amount]);await assert.rejects(approve(50),/Approve the extra work first/);
 await db.exec(`update variations set status='Approved' where id='${v}'`);await approve(50);await approve(50);assert.equal(await bal(),150);assert.equal((await db.query('select count(*)::int n from bf_fitter_extra_links')).rows[0].n,1);assert.equal(Number((await db.query('select amount from variations')).rows[0].amount),800);
 await assert.rejects(approve(60),/already linked/);await db.exec(`update job_assignments set fitting_cost=120`);assert.equal(await bal(),170);await db.exec(`update job_assignments set fitting_cost=120`);assert.equal(await bal(),170);
 await db.exec(`select bf_record_fitter_entry(gen_random_uuid(),'${job}','${fitter}','Payment',160,current_date,'Bank paid')`);
 await assert.rejects(db.exec('update job_assignments set fitting_cost=100'),/below payments/);assert.equal(Number((await db.query('select fitting_cost from job_assignments')).rows[0].fitting_cost),120);
 await assert.rejects(db.exec(`update variations set status='Rejected'`),/fitter payment is linked/);await assert.rejects(db.exec('delete from bf_fitter_extra_links'),/permission denied/);
 await db.exec(`select set_config('request.jwt.claim.sub','${fitter}',false)`);assert.equal((await db.query('select * from bf_fitter_extra_links')).rows.length,0);await assert.rejects(approve(50),/Administrators only/);
 await db.exec(`select set_config('request.jwt.claim.sub','${admin}',false);`);
 const j2='00000000-0000-0000-0000-000000000005';await db.exec(`reset role;insert into jobs values('${j2}');set role authenticated;insert into job_assignments values('${j2}','${fitter}',0)`);assert.equal((await db.query("select count(*)::int n from bf_fitter_entries where kind='Agreed cost' and amount=0")).rows[0].n,1);

 const request='00000000-0000-0000-0000-000000000006',reject='00000000-0000-0000-0000-000000000007';
 await db.exec(`select set_config('request.jwt.claim.sub','${fitter}',false)`);

 await db.query('select bf_request_fitter_extra($1,$2,$3,$4)',[request,j2,'Additional subfloor preparation',30]);
 await db.query('select bf_request_fitter_extra($1,$2,$3,$4)',[request,j2,'Additional subfloor preparation',30]);
 assert.equal((await db.query('select * from bf_fitter_extra_requests')).rows.length,1);
 await assert.rejects(db.query("update bf_fitter_extra_requests set status='Approved'"),/permission denied/);
 await assert.rejects(db.query('select bf_review_fitter_extra($1,true,30)',[request]),/Administrators only/);
 await db.exec(`select set_config('request.jwt.claim.sub','${admin}',false)`);
 assert.equal(await bal(),170); // Pending request has not increased the approved balance.
 await db.query('select bf_review_fitter_extra($1,true,20)',[request]);await db.query('select bf_review_fitter_extra($1,true,20)',[request]);
 assert.equal(Number((await db.query('select approved_amount from bf_fitter_extra_requests where id=$1',[request])).rows[0].approved_amount),20);
 await assert.rejects(db.query('select bf_review_fitter_extra($1,true,30)',[request]),/already been reviewed/);
 assert.equal(Number((await db.query('select amount from bf_fitter_entries where id=(select entry_id from bf_fitter_extra_requests where id=$1)',[request])).rows[0].amount),20);
 await db.exec(`select set_config('request.jwt.claim.sub','${fitter}',false)`);
 await db.query('select bf_request_fitter_extra($1,$2,$3,$4)',[reject,j2,'Other work',15]);
 await db.exec(`select set_config('request.jwt.claim.sub','${admin}',false)`);const n=(await db.query('select count(*)::int n from bf_fitter_entries')).rows[0].n;
 await db.query('select bf_review_fitter_extra($1,false,null)',[reject]);assert.equal((await db.query('select count(*)::int n from bf_fitter_entries')).rows[0].n,n);
 }finally{await db.close()}});
