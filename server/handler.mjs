import { HttpError, env, equal, rawBody, json, checkOrigin, requireAdmin, limited, db } from './core.mjs';
import { extractJobs, saveReviewedJob } from './ai.mjs';
import { xeroStatus, startConnection, finishConnection, selectTenant, invoiceOptions, createDraft, syncInvoices, receiveWebhook, resetPending } from './xero.mjs';
export async function handler(req,res){
 try{
  const url=new URL(req.url,process.env.APP_URL||'http://localhost:3000');const route=url.searchParams.get('_bf_route')||url.pathname.replace(/^\/api\//,'');
  if(route==='xero/callback'&&req.method==='GET')return await finishConnection(req,url,res);
  if(route==='xero/webhook'&&req.method==='POST'){await receiveWebhook(req,await rawBody(req,500000));return json(res,200,{received:true});}
  if(route==='xero/sync-cron'&&req.method==='GET'){
   if(!equal(req.headers.authorization,`Bearer ${env('CRON_SECRET')}`))throw new HttpError(401,'Not authorised.');
   await db('bf_oauth_states?expires_at=lt.'+encodeURIComponent(new Date().toISOString()),{method:'DELETE'});
   const status=await xeroStatus();return json(res,200,status.connected?await syncInvoices():{synced:0,not_connected:true});
  }
  if(!['GET','POST'].includes(req.method))throw new HttpError(405,'Method not allowed.');
  checkOrigin(req);const user=await requireAdmin(req);
  if(req.method==='GET'){
   if(route==='integrations/status')return json(res,200,{ai_configured:Boolean(process.env.OPENAI_API_KEY&&process.env.OPENAI_MODEL),xero:await xeroStatus()});
   if(route==='xero/options'){await limited(user.id,'xero-options',120);return json(res,200,await invoiceOptions(url.searchParams.get('search')||''));}
   throw new HttpError(404,'Not found.');
  }
  if(!(req.headers['content-type']||'').startsWith('application/json'))throw new HttpError(415,'JSON input is required.');
  let body;try{body=JSON.parse((await rawBody(req)).toString('utf8')||'{}');}catch(error){if(error instanceof HttpError)throw error;throw new HttpError(400,'Invalid input.');}
  if(route==='ai/extract')return json(res,200,await extractJobs(body,user));
  if(route==='ai/save')return json(res,200,await saveReviewedJob(body,user));
  if(route==='xero/connect')return json(res,200,await startConnection(user,res,req.headers.origin));
  if(route==='xero/select-tenant')return json(res,200,await selectTenant(body.tenant_id));
  if(route==='xero/draft'){await limited(user.id,'xero-draft',60);return json(res,200,await createDraft(body,user));}
  if(route==='xero/reset-pending')return json(res,200,await resetPending(body));
  if(route==='xero/sync'){await limited(user.id,'xero-sync',30);return json(res,200,await syncInvoices());}
  throw new HttpError(404,'Not found.');
 }catch(error){return json(res,error instanceof HttpError?error.status:503,{error:error instanceof HttpError?error.message:'The connection could not finish. Please retry. If it continues, check the server setup.'});}
}