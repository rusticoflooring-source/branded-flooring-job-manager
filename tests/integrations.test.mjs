import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createHmac } from 'node:crypto';
import { buildInput, validateDraft, matchRecord, extractJobs, saveReviewedJob } from '../server/ai.mjs';
import { encrypt, decrypt, date, withLock } from '../server/core.mjs';
import { invoicePayload, createDraft, receiveWebhook, selectTenant, storeSnapshot, resetPending, finishConnection, findLinkedInvoices } from '../server/xero.mjs';
import { handler } from '../server/handler.mjs';
const originalFetch=globalThis.fetch;
afterEach(()=>{globalThis.fetch=originalFetch;});
const userId='11111111-1111-4111-8111-111111111111',jobId='22222222-2222-4222-8222-222222222222',tenantId='33333333-3333-4333-8333-333333333333',invoiceId='44444444-4444-4444-8444-444444444444';
Object.assign(process.env,{SUPABASE_URL:'https://database.example',SUPABASE_ANON_KEY:'test-anon',SUPABASE_SERVICE_ROLE_KEY:'test-service',APP_URL:'https://app.example',OPENAI_MODEL:'test-model',OPENAI_API_KEY:'test-ai-key',TOKEN_ENCRYPTION_KEY:Buffer.alloc(32,1).toString('base64'),XERO_CLIENT_ID:'test-client',XERO_CLIENT_SECRET:'test-secret',XERO_SCOPES:'offline_access accounting.invoices accounting.contacts.read accounting.settings.read',XERO_WEBHOOK_KEY:'test-webhook',CRON_SECRET:'test-cron'});
const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
const job={id:jobId,job_number:'BF-TEST',status:'Install Complete',customer:'Example Customer',po_number:'PO-TEST'};
const payload={contact_id:userId,invoice_date:'2026-10-30',due_date:'2026-11-30',amount:100,account_code:'200',tax_type:'OUTPUT2',description:'Example installation'};
const reviewed={job_number:'BF-TEST',customer:'Example Customer',flooring_type:'LVT',install_date:null,site_id:null,fitter_id:null,quantity:65,contract_value:null};
function req(path,body,headers={},method='POST'){const r=Readable.from(body===undefined?[]:[Buffer.from(JSON.stringify(body))]);Object.assign(r,{url:'/api/'+path,method,headers:{authorization:'Bearer test-session','content-type':'application/json',origin:'https://app.example',...headers}});return r;}
function res(){return {code:200,headers:{},setHeader(k,v){this.headers[k]=v;return this},status(n){this.code=n;return this},json(data){this.data=data;return this},end(){return this}};}
function authenticatedFetch(extra){globalThis.fetch=async(url,options={})=>{const u=String(url);if(u.endsWith('/auth/v1/user'))return reply({id:userId});if(u.includes('/rest/v1/profiles?'))return reply([{id:userId,role:'admin',active:true}]);if(extra)return extra(u,options);throw new Error('Unexpected request: '+u);};}

test('text extraction request cannot save a job',()=>{const input=buildInput({text:'Example installation',files:[]});assert.equal(input[0].type,'input_text');assert.equal(input.length,1)});
test('PDF, Word and photos use the documented file/image inputs',()=>{const data=Buffer.from('sample').toString('base64');const input=buildInput({text:'',files:[{name:'order.pdf',data},{name:'instructions.docx',data},{name:'site.png',data}]});assert.equal(input[1].type,'input_file');assert.equal(input[2].type,'input_file');assert.equal(input[3].type,'input_image')});
test('pasted email and email files remain source text',()=>{const input=buildInput({text:'Email from site manager',files:[{name:'job.eml',data:Buffer.from('Subject: Example job').toString('base64')}]});assert.match(input[1].text,/Subject: Example job/)});
test('unsupported and oversize files rejected before contacting AI',()=>{assert.throws(()=>buildInput({text:'job',files:[{name:'program.exe',data:'AAAA'}]}));assert.throws(()=>buildInput({text:'job',files:[{name:'large.pdf',data:Buffer.alloc(2500001).toString('base64')}]}));assert.throws(()=>buildInput({text:'',files:[]}))});
test('unknown and ambiguous sites/fitters are never created or silently matched',()=>{assert.equal(matchRecord('Bradley',[{id:'one',name:'Bradley'},{id:'two',name:'Bradley'}],'name'),null);assert.equal(matchRecord('Unknown',[{id:'one',name:'Bradley'}],'name'),null);assert.equal(matchRecord(' BRADLEY ',[{id:'one',name:'Bradley'}],'name'),'one')});
test('review validation retains missing dates and values rather than inventing them',()=>{const draft=validateDraft(reviewed);assert.equal(draft.install_date,null);assert.equal(draft.contract_value,null);assert.equal(draft.quantity,65)});
test('review validation rejects invalid IDs, impossible dates and negative quantities',()=>{for(const change of [{site_id:'fake'},{install_date:'2026-02-30'},{quantity:-1},{flooring_type:'Anything'},{customer:''}])assert.throws(()=>validateDraft({...reviewed,...change}));assert.throws(()=>date('2026-99-99'))});
test('reviewed save requires explicit confirmation before any database call',async()=>{let called=false;globalThis.fetch=async()=>{called=true;throw new Error('Unexpected call')};await assert.rejects(()=>saveReviewedJob({reviewed:false,job:reviewed},{id:userId}),/Confirm/);assert.equal(called,false)});
test('save invokes one atomic job-and-assignment RPC under the signed-in identity',async()=>{let calls=0;globalThis.fetch=async(url,options)=>{calls++;assert.match(url,/rpc\/bf_create_reviewed_job$/);assert.equal(options.headers.Authorization,'Bearer user-token');assert.equal(JSON.parse(options.body).p_request_id,jobId);return reply(jobId)};const saved=await saveReviewedJob({reviewed:true,job:reviewed,request_id:jobId},{id:userId,token:'user-token'});assert.equal(saved.job_id,jobId);assert.equal(calls,1)});
test('AI uses structured output, no tools, no response storage and returns drafts only',async()=>{const calls=[];globalThis.fetch=async(url,options)=>{calls.push(String(url));if(String(url).includes('bf_take_api_slot'))return reply(true);if(String(url).includes('/sites?'))return reply([{id:jobId,name:'Example Site',developer:'Example Customer'}]);if(String(url).includes('/profiles?'))return reply([{id:userId,full_name:'Example Fitter'}]);if(String(url).includes('openai.com')){const body=JSON.parse(options.body);assert.equal(body.store,false);assert.equal(body.text.format.strict,true);assert.equal(body.tools,undefined);return reply({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({jobs:[{...reviewed,site_name:'Example Site',fitter_name:'No match',missing_information:['install date']}],warnings:[]})}]}]})}throw new Error('Unexpected request')};const result=await extractJobs({text:'Example',files:[],today:'2026-10-30'},{id:userId});assert.equal(result.jobs[0].site_id,jobId);assert.equal(result.jobs[0].fitter_id,null);assert.equal(calls.some(x=>x.includes('/jobs')),false)});
test('unauthenticated requests rejected without provider calls',async()=>{let called=false;globalThis.fetch=async()=>{called=true;throw new Error()};const response=res();await handler(req('ai/extract',{}, {authorization:''}),response);assert.equal(response.code,401);assert.equal(called,false)});
test('fitter accounts cannot use AI or Xero server operations',async()=>{globalThis.fetch=async url=>String(url).endsWith('/auth/v1/user')?reply({id:userId}):reply([{id:userId,role:'fitter',active:true}]);const response=res();await handler(req('ai/extract',{text:'job',files:[]}),response);assert.equal(response.code,403)});
test('cross-origin requests rejected before account/provider access',async()=>{const response=res();await handler(req('xero/draft',{}, {origin:'https://other.example'}),response);assert.equal(response.code,403)});
test('Xero tokens are encrypted and tampering is rejected',()=>{const cipher=encrypt({refresh_token:'sensitive-example'});assert.equal(cipher.includes('sensitive-example'),false);assert.equal(decrypt(cipher).refresh_token,'sensitive-example');const parts=cipher.split('.');parts[2]=Buffer.alloc(Buffer.from(parts[2],'base64').length).toString('base64');assert.throws(()=>decrypt(parts.join('.')))});
test('invoice payload is always a GBP draft and ignores attempts to authorise/send',()=>{const p=invoicePayload(job,{...payload,Status:'AUTHORISED',send:true});assert.equal(p.Status,'DRAFT');assert.equal(p.CurrencyCode,'GBP');assert.equal(p.LineAmountTypes,'Exclusive');assert.match(p.Reference,new RegExp(jobId));assert.equal(p.LineItems[0].UnitAmount,100)});
test('invoice payload rejects guessed/invalid amount, tax and due dates',()=>{for(const change of [{amount:0},{amount:-10},{amount:NaN},{due_date:'2026-10-01'},{tax_type:''},{contact_id:'wrong'}])assert.throws(()=>invoicePayload(job,{...payload,...change}))});
test('invoice creation requires explicit review before acquiring a lock',async()=>{globalThis.fetch=async()=>{throw new Error('Should not be called')};await assert.rejects(()=>createDraft({job_id:jobId,reviewed:false},{}),/Review/)});
test('server serialises invoice creation; an existing linked invoice is reused',async()=>{let invoiceWrites=0;authenticatedFetch((url,options)=>{if(url.includes('bf_acquire_lock'))return reply(true);if(url.includes('/jobs?'))return reply([job]);if(url.includes('bf_xero_connection'))return reply([{tenant_id:tenantId}]);if(url.includes('bf_xero_invoices'))return reply([{job_id:jobId,tenant_id:tenantId,invoice_id:invoiceId}]);if(url.includes('bf_integration_locks'))return reply([]);if(url.includes('api.xero.com')){invoiceWrites++;return reply({})}throw new Error(url)});const result=await createDraft({...payload,job_id:jobId,reviewed:true},{id:userId});assert.equal(result.existing,true);assert.equal(result.invoice_id,invoiceId);assert.equal(invoiceWrites,0)});
test('an unknown job state cannot be invoiced',async()=>{authenticatedFetch((url)=>{if(url.includes('bf_acquire_lock'))return reply(true);if(url.includes('/jobs?'))return reply([{...job,status:'Not a job status'}]);if(url.includes('bf_integration_locks'))return reply([]);throw new Error(url)});await assert.rejects(()=>createDraft({...payload,job_id:jobId,reviewed:true},{id:userId}),/current state/)});
test('lock contention does not run a duplicate operation',async()=>{globalThis.fetch=async()=>reply(false);let ran=false;await assert.rejects(()=>withLock('same',async()=>{ran=true}),/Another update/);assert.equal(ran,false)});
test('organisation cannot change away from existing invoice links',async()=>{authenticatedFetch(url=>{if(url.includes('bf_acquire_lock'))return reply(true);if(url.includes('bf_xero_connection'))return reply([{tenant_id:null,tenants:[{id:tenantId,name:'Example'}]}]);if(url.includes('bf_xero_invoices'))return reply([{tenant_id:userId}]);if(url.includes('bf_integration_locks'))return reply([]);throw new Error(url)});await assert.rejects(()=>selectTenant(tenantId),/migration/)});
test('snapshots include credits and outstanding amounts and use atomic reconciliation',async()=>{globalThis.fetch=async(url,options)=>{assert.match(url,/bf_apply_xero_snapshot$/);const body=JSON.parse(options.body);assert.equal(body.p_credited,20);assert.equal(body.p_due_amount,50);assert.equal(body.p_paid,30);return reply(null)};await storeSnapshot({job_id:jobId,tenant_id:tenantId},{InvoiceID:invoiceId,Status:'AUTHORISED',Total:100,AmountPaid:30,AmountCredited:20,AmountDue:50})});
test('webhook rejects forged signatures without touching the database',async()=>{let calls=0;globalThis.fetch=async()=>{calls++;throw new Error()};await assert.rejects(()=>receiveWebhook({headers:{'x-xero-signature':'forged'}},Buffer.from('{}')),/signature/);assert.equal(calls,0)});
test('valid webhook handshake is acknowledged and does not create invoices',async()=>{globalThis.fetch=async url=>{assert.match(url,/bf_xero_connection/);return reply([])};const raw=Buffer.from('{"events":[]}');const signature=createHmac('sha256','test-webhook').update(raw).digest('base64');assert.deepEqual(await receiveWebhook({headers:{'x-xero-signature':signature}},raw),{received:true})});
test('cron requires its own secret',async()=>{const response=res();await handler(req('xero/sync-cron',undefined,{authorization:'Bearer wrong'},'GET'),response);assert.equal(response.code,401)});
test('OAuth callback requires browser-bound state before exchanging tokens',async()=>{globalThis.fetch=async()=>{throw new Error('Should not exchange tokens')};await assert.rejects(()=>finishConnection({headers:{cookie:'bf_xero_state=different'}},new URL('https://app.example/api/xero/callback?state=test&code=test'),res()),/expired/)});
test('pending reset requires confirmation',async()=>{await assert.rejects(()=>resetPending({job_id:jobId,confirmed:false}),/Check Xero/)});
test('a new reviewed invoice reaches Xero once as DRAFT with an idempotency key',async()=>{
 let link=null,posts=0,reconciled=false;
 const conn={tenant_id:tenantId,connected_by:userId,token_ciphertext:encrypt({access_token:'test-xero',refresh_token:'test-refresh'}),expires_at:new Date(Date.now()+3600000).toISOString()};
 authenticatedFetch((url,options)=>{
  if(url.includes('bf_acquire_lock'))return reply(true);
  if(url.includes('/jobs?'))return reply([job]);
  if(url.includes('bf_xero_connection'))return reply([conn]);
  if(url.includes('bf_xero_invoices')){if(options.method==='POST'){link={...JSON.parse(options.body),created_at:new Date().toISOString()};return reply([link])}return reply(link?[link]:[])}
  if(url.includes('bf_integration_locks'))return reply([]);
  if(url.includes('bf_apply_xero_snapshot')){reconciled=true;const p=JSON.parse(options.body);assert.equal(p.p_invoice,invoiceId);assert.equal(p.p_tenant,tenantId);return reply(null)}
  if(url.includes('/Invoices?'))return reply({Invoices:[]});
  if(url.includes('/Contacts?'))return reply({Contacts:[]});
  if(url.endsWith('/Accounts'))return reply({Accounts:[{Code:'200',Name:'Sales',Status:'ACTIVE',Type:'REVENUE'}]});
  if(url.endsWith('/TaxRates'))return reply({TaxRates:[{TaxType:'OUTPUT2',Name:'VAT',Status:'ACTIVE',EffectiveRate:20}]});
  if(url.endsWith('/Invoices')&&options.method==='POST'){posts++;assert.equal(options.headers['xero-tenant-id'],tenantId);assert.match(options.headers['Idempotency-Key'],/^[a-f0-9]{32}$/);assert.equal(JSON.parse(options.body).Invoices[0].Status,'DRAFT');return reply({Invoices:[{InvoiceID:invoiceId,Status:'DRAFT',Total:120,AmountPaid:0,AmountDue:120}]})}
  throw new Error('Unexpected request: '+url);
 });
 const result=await createDraft({...payload,job_id:jobId,reviewed:true},{id:userId});assert.equal(result.status,'DRAFT');assert.equal(posts,1);assert.equal(reconciled,true);
});
test('a provider-created invoice is recovered by stable reference after an ambiguous response',async()=>{
 const {sha}=await import('../server/core.mjs');let posted=false;
 const conn={tenant_id:tenantId,connected_by:userId,token_ciphertext:encrypt({access_token:'test-xero'}),expires_at:new Date(Date.now()+3600000).toISOString()};
 authenticatedFetch((url,options)=>{
  if(url.includes('bf_acquire_lock'))return reply(true);
  if(url.includes('/jobs?'))return reply([job]);
  if(url.includes('bf_xero_connection'))return reply([conn]);
  if(url.includes('bf_xero_invoices'))return reply([{job_id:jobId,tenant_id:tenantId,invoice_id:null,request_hash:sha(JSON.stringify(invoicePayload(job,payload))),reference:'stable-reference',created_at:new Date(Date.now()-3600000).toISOString()}]);
  if(url.includes('bf_integration_locks'))return reply([]);
  if(url.includes('bf_apply_xero_snapshot'))return reply(null);
  if(url.includes('/Invoices?'))return reply({Invoices:[{InvoiceID:invoiceId,Status:'DRAFT',Total:120,AmountPaid:0,AmountDue:120}]});
  if(options.method==='POST'&&url.includes('api.xero.com'))posted=true;
  throw new Error('Unexpected request: '+url);
 });
 const result=await createDraft({...payload,job_id:jobId,reviewed:true},{id:userId});assert.equal(result.invoice_id,invoiceId);assert.equal(posted,false);
});
test('snapshot rejects non-finite credit or due totals before database writes',async()=>{
 globalThis.fetch=async()=>{throw new Error('Should not write invalid totals')};await assert.rejects(()=>storeSnapshot({job_id:jobId,tenant_id:tenantId},{InvoiceID:invoiceId,Status:'PAID',Total:100,AmountPaid:100,AmountCredited:'bad',AmountDue:0}),/incomplete/);
});

test('Xero assigns the number; the exact PO is the reference, not the job ID',()=>{
 const p=invoicePayload(job,{...payload,use_xero_number:true,InvoiceNumber:'DO-NOT-USE'});
 assert.equal(p.InvoiceNumber,undefined);assert.equal(p.Reference,'PO-TEST');assert.equal(p.Reference.includes(jobId),false);assert.equal(p.Url,'https://app.example/?job='+jobId);assert.equal(p.Status,'DRAFT');
});
test('a long PO is rejected rather than silently truncated',()=>{
 assert.throws(()=>invoicePayload({...job,po_number:'x'.repeat(256)},{...payload,use_xero_number:true}),/too long/);
});
test('a reviewed job can await its Xero number without inventing one',()=>{
 const draft=validateDraft({...reviewed,job_number:null},true);assert.equal(draft.job_number,null);assert.equal(draft.po_number,null);
 assert.throws(()=>validateDraft({...reviewed,job_number:null},false),/Job number/);
});
test('reviewed AI save carries the numbering choice to the atomic job RPC',async()=>{
 globalThis.fetch=async(url,options)=>{assert.match(url,/bf_create_reviewed_job/);const body=JSON.parse(options.body);assert.equal(body.p_draft.use_xero_number,true);assert.equal(body.p_draft.job_number,null);return reply(jobId)};
 const result=await saveReviewedJob({reviewed:true,use_xero_number:true,job:{...reviewed,job_number:null},request_id:jobId},{id:userId,token:'user-token'});assert.equal(result.job_id,jobId);
});
test("booking creates a draft before installation and returns Xero's invoice number",async()=>{
 let link=null,writes=0,numberSeen=null;
 const conn={tenant_id:tenantId,connected_by:userId,token_ciphertext:encrypt({access_token:'test-xero'}),expires_at:new Date(Date.now()+3600000).toISOString()};
 authenticatedFetch((url,options)=>{
  if(url.includes('bf_acquire_lock'))return reply(true);
  if(url.includes('/jobs?'))return reply([{...job,status:'Booked',job_number:'AWAITING-'+jobId}]);
  if(url.includes('bf_xero_connection'))return reply([conn]);
  if(url.includes('bf_xero_invoices')){if(options.method==='POST'){link={...JSON.parse(options.body),created_at:new Date().toISOString()};assert.equal(link.use_xero_number,true);assert.equal(link.reference,'PO-TEST');assert.equal(link.source_url,'https://app.example/?job='+jobId);return reply([link])}return reply(link?[link]:[])}
  if(url.includes('bf_integration_locks'))return reply([]);
  if(url.includes('bf_apply_xero_snapshot')){numberSeen=JSON.parse(options.body).p_number;link.invoice_number=numberSeen;return reply(null)}
  if(url.includes('/Invoices?'))return reply({Invoices:[]});
  if(url.includes('/Contacts?'))return reply({Contacts:[]});
  if(url.endsWith('/Accounts'))return reply({Accounts:[{Code:'200',Name:'Sales',Status:'ACTIVE',Type:'REVENUE'}]});
  if(url.endsWith('/TaxRates'))return reply({TaxRates:[{TaxType:'OUTPUT2',Name:'VAT',Status:'ACTIVE',EffectiveRate:20}]});
  if(url.endsWith('/Invoices')&&options.method==='POST'){writes++;const invoice=JSON.parse(options.body).Invoices[0];assert.equal(invoice.Status,'DRAFT');assert.equal(invoice.Reference,'PO-TEST');assert.equal(invoice.InvoiceNumber,undefined);return reply({Invoices:[{InvoiceID:invoiceId,InvoiceNumber:'INV-0101',Status:'DRAFT',Total:120,AmountPaid:0,AmountDue:120}]})}
  throw new Error('Unexpected request '+url);
 });
 const result=await createDraft({...payload,job_id:jobId,reviewed:true,use_xero_number:true},{id:userId});assert.equal(writes,1);assert.equal(numberSeen,'INV-0101');assert.equal(result.invoice_number,'INV-0101');
});
test('shared PO references across plots are recovered by unique job link',async()=>{
 const source='https://app.example/?job='+jobId;
 const conn={tenant_id:tenantId,connected_by:userId,token_ciphertext:encrypt({access_token:'test-xero'}),expires_at:new Date(Date.now()+3600000).toISOString()};
 authenticatedFetch((url,options)=>{if(url.includes('bf_xero_connection'))return reply([conn]);if(url.includes('/Invoices?')){assert.match(url,/createdByMyApp=true/);assert.ok(options.headers['If-Modified-Since']);return reply({Invoices:[{InvoiceID:userId,Reference:'PO-TEST',InvoiceNumber:'INV-0100',Url:'https://app.example/?job='+userId},{InvoiceID:invoiceId,Reference:'PO-TEST',InvoiceNumber:'INV-0101',Url:source}]})}throw new Error(url)});
 const result=await findLinkedInvoices({source_url:source,reference:'PO-TEST',created_at:new Date().toISOString()});assert.equal(result.Invoices.length,1);assert.equal(result.Invoices[0].InvoiceID,invoiceId);
});
test('incomplete recovery search blocks creation rather than guessing from a PO',async()=>{
 const conn={tenant_id:tenantId,connected_by:userId,token_ciphertext:encrypt({access_token:'test-xero'}),expires_at:new Date(Date.now()+3600000).toISOString()};let pages=0;
 authenticatedFetch(url=>{if(url.includes('bf_xero_connection'))return reply([conn]);if(url.includes('/Invoices?')){pages++;return reply({Invoices:Array.from({length:100},()=>({InvoiceID:userId,Reference:'PO-TEST',Url:'https://app.example/?job='+userId}))})}throw new Error(url)});
 await assert.rejects(()=>findLinkedInvoices({source_url:'https://app.example/?job='+jobId,created_at:new Date().toISOString()}),/safely/);assert.equal(pages,10);
});
