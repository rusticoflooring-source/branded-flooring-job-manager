import { randomBytes, createHmac } from 'node:crypto';
import { db, env, HttpError, encrypt, decrypt, equal, sha, uuid, date, requireActiveAdmin, requestJSON, withLock, trustedAppOrigin } from './core.mjs';
const api='https://api.xero.com/api.xro/2.0/';
const encode=encodeURIComponent;
const quoted=value=>'"'+String(value).replace(/\\/g,'\\\\').replace(/"/g,'\\"')+'"';
export async function connection(){return (await db('bf_xero_connection?id=eq.1&select=*'))?.[0]||null;}
export async function xeroStatus(){const c=await connection();return {configured:Boolean(process.env.XERO_CLIENT_ID&&process.env.XERO_CLIENT_SECRET&&process.env.TOKEN_ENCRYPTION_KEY&&process.env.APP_URL&&process.env.XERO_SCOPES),connected:Boolean(c?.tenant_id),tenant_name:c?.tenant_name||null,tenants:c?.tenants||[],last_synced_at:c?.last_synced_at||null};}
export async function startConnection(user,res,requestOrigin){
 const origin=trustedAppOrigin(requestOrigin);
 const state=randomBytes(32).toString('hex');const expires=new Date(Date.now()+10*60000).toISOString();
 await db('bf_oauth_states',{method:'POST',body:JSON.stringify({state_hash:sha(state),user_id:user.id,expires_at:expires})});
 res.setHeader('Set-Cookie',`bf_xero_state=${origin===new URL(env('APP_URL')).origin?state:state+'.'+Buffer.from(origin).toString('base64url')}; HttpOnly; Secure; SameSite=Lax; Path=/api/xero; Max-Age=600`);
 const params=new URLSearchParams({response_type:'code',client_id:env('XERO_CLIENT_ID'),redirect_uri:new URL('/api/xero/callback',origin).href,scope:env('XERO_SCOPES'),state});
 return {url:'https://login.xero.com/identity/connect/authorize?'+params};
}
export async function tokenRequest(data){return requestJSON('https://identity.xero.com/connect/token',{method:'POST',headers:{Authorization:'Basic '+Buffer.from(env('XERO_CLIENT_ID')+':'+env('XERO_CLIENT_SECRET')).toString('base64'),'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(data).toString()},'Xero authorisation');}
async function finishConnectionImpl(req,url,res){
 const state=url.searchParams.get('state');const cookie=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('bf_xero_state='))?.slice(14);
 const [cookieState,encodedOrigin,...extra]=(cookie||'').split('.');
 if(!state||extra.length||!equal(cookieState,state))throw new HttpError(400,'The Xero connection expired. Start again from Accounts.');
 const origin=trustedAppOrigin(encodedOrigin?Buffer.from(encodedOrigin,'base64url').toString('utf8'):undefined);
 res.setHeader('Set-Cookie','bf_xero_state=; HttpOnly; Secure; SameSite=Lax; Path=/api/xero; Max-Age=0');
 const states=await db(`bf_oauth_states?state_hash=eq.${sha(state)}&expires_at=gt.${encode(new Date().toISOString())}`,{method:'DELETE'});if(!states?.[0])throw new HttpError(400,'This connection request has expired or was already used.');
 if(url.searchParams.get('error'))throw new HttpError(400,'Xero connection was cancelled.');
 await requireActiveAdmin(states[0].user_id);const code=url.searchParams.get('code');if(!code)throw new HttpError(400,'Xero did not return an authorisation code.');
 const tokens=await tokenRequest({grant_type:'authorization_code',code,redirect_uri:new URL('/api/xero/callback',origin).href});
 const tenants=await requestJSON('https://api.xero.com/connections',{headers:{Authorization:`Bearer ${tokens.access_token}`}},'Xero');
 const current=await connection();const compatible=tenants.filter(x=>x.tenantType==='ORGANISATION');if(!compatible.length)throw new HttpError(400,'No Xero organisation was connected.');
 const stillLinked=current?.tenant_id?compatible.find(x=>x.tenantId===current.tenant_id):null;
 await db('bf_xero_connection?on_conflict=id',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=representation'},body:JSON.stringify({id:1,token_ciphertext:encrypt(tokens),expires_at:new Date(Date.now()+Number(tokens.expires_in)*1000).toISOString(),connected_by:states[0].user_id,tenants:compatible.map(t=>({id:t.tenantId,name:t.tenantName})),tenant_id:stillLinked?.tenantId||null,tenant_name:stillLinked?.tenantName||null})});
 res.setHeader('Referrer-Policy','no-referrer');return res.status(303).setHeader('Location',new URL('/?xero=connected',origin).href).end();
}
export async function selectTenant(id){uuid(id);return withLock('xero-organisation',async()=>{const c=await connection();const tenant=c?.tenants?.find(x=>x.id===id);if(!tenant)throw new HttpError(400,'Choose a connected organisation.');const links=await db('bf_xero_invoices?select=tenant_id&limit=1');if(links.length&&links[0].tenant_id!==id)throw new HttpError(409,'Existing invoices belong to the current organisation. Organisation changes require a migration.');await db('bf_xero_connection?id=eq.1',{method:'PATCH',body:JSON.stringify({tenant_id:id,tenant_name:tenant.name})});return {connected:true};});}
async function accessToken(){let c=await connection();if(!c?.tenant_id)throw new HttpError(409,'Connect Xero and select your organisation first.');await requireActiveAdmin(c.connected_by);if(new Date(c.expires_at).getTime()>Date.now()+60000)return {c,tokens:decrypt(c.token_ciphertext)};
 return withLock('xero-token-refresh',async()=>{c=await connection();if(new Date(c.expires_at).getTime()>Date.now()+60000)return {c,tokens:decrypt(c.token_ciphertext)};const old=decrypt(c.token_ciphertext);const tokens=await tokenRequest({grant_type:'refresh_token',refresh_token:old.refresh_token});await db('bf_xero_connection?id=eq.1',{method:'PATCH',body:JSON.stringify({token_ciphertext:encrypt(tokens),expires_at:new Date(Date.now()+Number(tokens.expires_in)*1000).toISOString()})});return {c,tokens};});
}
export async function xero(path,options={}){const {c,tokens}=await accessToken();return requestJSON(api+path,{...options,headers:{Authorization:`Bearer ${tokens.access_token}`,'xero-tenant-id':c.tenant_id,Accept:'application/json','Content-Type':'application/json',...options.headers}},'Xero');}
export async function invoiceOptions(search=''){
 if(typeof search!=='string'||search.length>80)throw new HttpError(400,'Use a shorter contact search.');
 const where=search?`&where=${encode('Name.ToLower().Contains('+quoted(search.toLowerCase())+')')}`:'';
 const [contacts,accounts,taxes]=await Promise.all([xero('Contacts?page=1'+where),xero('Accounts'),xero('TaxRates')]);
 return {contacts:(contacts.Contacts||[]).filter(c=>c.ContactStatus==='ACTIVE').map(c=>({id:c.ContactID,name:c.Name})),accounts:(accounts.Accounts||[]).filter(a=>a.Status==='ACTIVE'&&['REVENUE','SALES'].includes(a.Type)).map(a=>({code:a.Code,name:a.Name})),taxes:(taxes.TaxRates||[]).filter(t=>t.Status==='ACTIVE'&&t.CanApplyToRevenue!==false).map(t=>({code:t.TaxType,name:t.Name,rate:t.EffectiveRate}))};
}
export function invoicePayload(job,body){
 if(body.use_xero_number===true&&String(job.po_number||'').trim().length>255)throw new HttpError(400,'The PO reference is too long for Xero. Review it before creating the draft.');
 uuid(body.contact_id);date(body.invoice_date);date(body.due_date);if(body.due_date<body.invoice_date)throw new HttpError(400,'Due date must not precede the invoice date.');
 if(typeof body.amount!=='number'||!Number.isFinite(body.amount)||body.amount<=0||body.amount>100000000)throw new HttpError(400,'Confirm the agreed invoice amount.');
 for(const key of ['account_code','tax_type','description'])if(typeof body[key]!=='string'||!body[key].trim()||body[key].length>2000)throw new HttpError(400,'Confirm the invoice description, sales account and tax treatment.');
 return {Type:'ACCREC',Status:'DRAFT',Contact:{ContactID:body.contact_id},Date:body.invoice_date,DueDate:body.due_date,CurrencyCode:'GBP',LineAmountTypes:'Exclusive',Reference:body.use_xero_number===true?String(job.po_number||'').trim():`BF:${job.id} | ${job.job_number} | PO ${job.po_number||'-'}`.slice(0,255),...(body.use_xero_number===true?{Url:new URL('/?job='+job.id,env('APP_URL')).href}:{}),LineItems:[{Description:body.description,Quantity:1,UnitAmount:Math.round(body.amount*100)/100,AccountCode:body.account_code,TaxType:body.tax_type}]};
}
export async function createDraft(body,user){const jobId=uuid(body.job_id);if(body.reviewed!==true)throw new HttpError(400,'Review and confirm the invoice first.');
 return withLock('xero-organisation',()=>withLock('invoice-'+jobId,async()=>{
 const job=(await db(`jobs?id=eq.${jobId}&select=*`))[0];if(!job)throw new HttpError(404,'Job not found.');if(!['Booked','Prep','In Progress','Snag','Install Complete','Complete','Invoiced','Fitter Paid','Payment Received','Paid'].includes(job.status))throw new HttpError(409,'This job cannot be invoiced in its current state.');
 const c=await connection();if(!c?.tenant_id)throw new HttpError(409,'Select your Xero organisation first.');
 const payload=invoicePayload(job,body);const key=sha(JSON.stringify(body.use_xero_number===true?{payload,use_xero_number:true}:payload));let link=(await db(`bf_xero_invoices?job_id=eq.${jobId}&select=*`))[0];
 if(link?.invoice_id){if(link.tenant_id!==c.tenant_id)throw new HttpError(409,'This invoice belongs to another organisation.');return {invoice_id:link.invoice_id,invoice_number:link.invoice_number,existing:true};}if(link&&link.request_hash!==key)throw new HttpError(409,'A previous draft request needs reconciliation. Retry its original details before making changes.');
 if(!link){link=(await db('bf_xero_invoices',{method:'POST',body:JSON.stringify({job_id:jobId,tenant_id:c.tenant_id,request_hash:key,request_key:randomBytes(16).toString('hex'),reference:payload.Reference,source_url:payload.Url||null,use_xero_number:body.use_xero_number===true,original_job_number:job.job_number,created_by:user.id})}))[0];}
 if(link.tenant_id!==c.tenant_id)throw new HttpError(409,'This job is linked to a different Xero organisation.');
 const found=await findLinkedInvoices(link);
 if(found.Invoices?.length>1)throw new HttpError(409,'Several matching invoices exist in Xero. Reconcile them before continuing.');
 let invoice=found.Invoices?.[0];if(!invoice){if(Date.now()-new Date(link.created_at).getTime()>5*60000)throw new HttpError(409,'The previous request is older than five minutes. Check Xero and reconcile the pending link before retrying.');const options=await invoiceOptions();if(!options.accounts.some(a=>a.code===body.account_code)||!options.taxes.some(t=>t.code===body.tax_type))throw new HttpError(400,'Choose a valid sales account and tax rate.');const created=await xero('Invoices',{method:'POST',headers:{'Idempotency-Key':link.request_key},body:JSON.stringify({Invoices:[payload]})});invoice=created.Invoices?.[0];if(!invoice?.InvoiceID||invoice.HasErrors)throw new HttpError(422,'Xero could not create this draft. Check the contact, tax rate and invoice details.');}
 await storeSnapshot(link,invoice);const summary=(await db(`bf_xero_invoices?job_id=eq.${jobId}&select=invoice_number,number_sync_error`))[0];return {invoice_id:invoice.InvoiceID,invoice_number:summary?.invoice_number||invoice.InvoiceNumber||null,number_sync_error:summary?.number_sync_error||null,status:invoice.Status};
 }));
}
export async function storeSnapshot(link,invoice){
 if(!invoice?.InvoiceID||['Total','AmountPaid','AmountCredited','AmountDue'].some(k=>invoice[k]!=null&&(!Number.isFinite(Number(invoice[k]))||Number(invoice[k])<0))||invoice.Total==null)throw new HttpError(502,'Xero returned incomplete invoice totals.');
 await db('rpc/bf_apply_xero_snapshot',{method:'POST',body:JSON.stringify({p_job:link.job_id,p_tenant:link.tenant_id,p_invoice:invoice.InvoiceID,p_status:invoice.Status,p_number:invoice.InvoiceNumber||null,p_total:Number(invoice.Total),p_paid:Number(invoice.AmountPaid||0),p_credited:Number(invoice.AmountCredited||0),p_due_amount:Number(invoice.AmountDue??Math.max(0,Number(invoice.Total)-Number(invoice.AmountPaid||0)-Number(invoice.AmountCredited||0))),p_due:xeroDate(invoice.DueDateString||invoice.DueDate)})});
}
export async function syncInvoices(){return withLock('xero-organisation',()=>withLock('xero-sync',async()=>{const c=await connection();if(!c?.tenant_id)throw new HttpError(409,'Connect Xero first.');const links=await db(`bf_xero_invoices?tenant_id=eq.${c.tenant_id}&select=*&order=synced_at.asc.nullsfirst&limit=100`);let synced=0;const failed=[];const started=Date.now();let limited=links.length===100;
 for(const link of links){if(Date.now()-started>35000){limited=true;break;}try{const response=link.invoice_id?await xero('Invoices/'+link.invoice_id):await findLinkedInvoices(link);if(response.Invoices?.length===1){await storeSnapshot(link,response.Invoices[0]);synced++;}else if(!link.invoice_id){failed.push(link.job_id);}}catch{failed.push(link.job_id);}}
 if(failed.length===0&&!limited){await db('bf_xero_connection?id=eq.1',{method:'PATCH',body:JSON.stringify({last_synced_at:new Date().toISOString()})});await db(`bf_xero_events?tenant_id=eq.${c.tenant_id}`,{method:'DELETE'});}return {synced,failed,limited};}));}
export async function receiveWebhook(req,raw){const expected=createHmac('sha256',env('XERO_WEBHOOK_KEY')).update(raw).digest('base64');if(!equal(expected,req.headers['x-xero-signature']))throw new HttpError(401,'Invalid webhook signature.');let body;try{body=JSON.parse(raw.toString('utf8'));}catch{throw new HttpError(400,'Invalid webhook payload.');}
 const c=await connection();if(!Array.isArray(body.events))throw new HttpError(400,'Invalid webhook events.');const events=new Map();for(const event of body.events){if(event.eventCategory!=='INVOICE'||event.tenantId!==c?.tenant_id)continue;const event_hash=sha(JSON.stringify(event));events.set(event_hash,{event_hash,tenant_id:uuid(event.tenantId),invoice_id:uuid(event.resourceId)});}if(events.size)await db('bf_xero_events?on_conflict=event_hash',{method:'POST',headers:{Prefer:'resolution=ignore-duplicates,return=minimal'},body:JSON.stringify([...events.values()])});return {received:true};}
export async function resetPending(body){
 const job=uuid(body.job_id);if(body.confirmed!==true)throw new HttpError(400,'Check Xero before discarding a pending request.');
 return withLock('xero-organisation',()=>withLock('invoice-'+job,async()=>{
  const link=(await db(`bf_xero_invoices?job_id=eq.${job}&select=*`))[0];
  if(!link)return {cleared:true};if(link.invoice_id)throw new HttpError(409,'An invoice is already linked.');
  if(Date.now()-new Date(link.created_at).getTime()<5*60000)throw new HttpError(409,'Wait five minutes for the original request to settle, then sync and check Xero.');
  const c=await connection();if(c?.tenant_id!==link.tenant_id)throw new HttpError(409,'Connect the original Xero organisation first.');
  const found=await findLinkedInvoices(link);
  if(found.Invoices?.length)throw new HttpError(409,'A matching invoice exists in Xero. Use Sync invoice to recover its link.');
  await db(`bf_xero_invoices?job_id=eq.${job}&invoice_id=is.null`,{method:'DELETE'});return {cleared:true};
 }));
}

export async function finishConnection(req,url,res){
 const state=url.searchParams.get('state');const cookie=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('bf_xero_state='))?.slice(14);
 const [cookieState,encodedOrigin,...extra]=(cookie||'').split('.');
 if(!state||extra.length||!equal(cookieState,state))throw new HttpError(400,'The Xero connection expired. Start again from Accounts.');
 return withLock('xero-organisation',()=>finishConnectionImpl(req,url,res));
}

export function xeroDate(value){
 if(!value)return null;if(/^\d{4}-\d{2}-\d{2}/.test(String(value)))return date(String(value).slice(0,10));
 const match=String(value).match(/\/Date\((-?\d+)(?:[+-]\d+)?\)\//);if(match)return new Date(Number(match[1])).toISOString().slice(0,10);
 throw new HttpError(502,'Xero returned an unreadable due date.');
}

// The PO is the customer-facing reference and may cover several plots. The source
// URL binds recovery to the immutable job ID, even if the PO/number changes.
export async function findLinkedInvoices(link){
 if(!link.source_url)return xero('Invoices?where='+encode('Type=="ACCREC"&&Reference=='+quoted(link.reference)));
 const since=new Date(new Date(link.created_at).getTime()-5*60000);if(!Number.isFinite(since.getTime()))throw new HttpError(409,'The pending link needs reconciliation.');
 const matches=[];
 for(let page=1;page<=10;page++){
  const data=await xero('Invoices?createdByMyApp=true&page='+page,{headers:{'If-Modified-Since':since.toISOString().slice(0,19)}});
  const rows=data.Invoices||[];matches.push(...rows.filter(i=>i.Url===link.source_url));
  if(matches.length>1)throw new HttpError(409,'More than one invoice links to this job. Reconcile in Xero.');
  if(rows.length<100)return {Invoices:matches};
 }
 throw new HttpError(409,'Too many recent invoices to reconcile safely. Check Xero before retrying.');
}
