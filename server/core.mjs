import { createCipheriv, createDecipheriv, randomBytes, createHash, timingSafeEqual } from 'node:crypto';
export class HttpError extends Error { constructor(status,message){super(message);this.status=status;} }
export function env(name){const v=process.env[name];if(!v)throw new HttpError(503,'Connection setup is incomplete. Please finish the server setup.');return v;}
export function equal(a,b){const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));return x.length===y.length&&timingSafeEqual(x,y);}
export const sha=value=>createHash('sha256').update(value).digest('hex');
export function encrypt(value){const key=Buffer.from(env('TOKEN_ENCRYPTION_KEY'),'base64');if(key.length!==32)throw new HttpError(503,'Token encryption needs a 32-byte key.');const iv=randomBytes(12);const cipher=createCipheriv('aes-256-gcm',key,iv);const data=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);return [iv,cipher.getAuthTag(),data].map(x=>x.toString('base64')).join('.');}
export function decrypt(value){const [iv,tag,data]=value.split('.').map(x=>Buffer.from(x,'base64'));const decipher=createDecipheriv('aes-256-gcm',Buffer.from(env('TOKEN_ENCRYPTION_KEY'),'base64'),iv);decipher.setAuthTag(tag);return JSON.parse(Buffer.concat([decipher.update(data),decipher.final()]).toString('utf8'));}
export function supabaseURL(){return (process.env.SUPABASE_URL||env('VITE_SUPABASE_URL')).replace(/\/$/,'');}
export async function requestJSON(url,options={},provider='Connection'){
 const response=await fetch(url,{...options,signal:options.signal||AbortSignal.timeout(25000)});
 let data;try{data=await response.json();}catch{data=null;}
 if(!response.ok){if(provider==='Database'&&data?.code==='23505')throw new HttpError(409,'This record already exists. Refresh before trying again.');throw new HttpError(provider==='Sign-in'&&[401,403].includes(response.status)?401:response.status===429?429:502,`${provider} request failed (${response.status}). Please retry or check the connection settings.`);}
 return data;
}
export async function db(path,options={},token=null){const key=env('SUPABASE_SERVICE_ROLE_KEY');return requestJSON(`${supabaseURL()}/rest/v1/${path}`,{...options,headers:{apikey:key,Authorization:`Bearer ${token||key}`,'Content-Type':'application/json',Prefer:'return=representation',...options.headers}},'Database');}
export async function requireAdmin(req){
 const token=(req.headers.authorization||'').replace(/^Bearer /i,'');if(!token)throw new HttpError(401,'Please sign in again.');
 const user=await requestJSON(`${supabaseURL()}/auth/v1/user`,{headers:{apikey:process.env.SUPABASE_ANON_KEY||env('VITE_SUPABASE_ANON_KEY'),Authorization:`Bearer ${token}`}},'Sign-in');
 const profiles=await db(`profiles?id=eq.${encodeURIComponent(user.id)}&select=id,role,active`);
 if(profiles?.[0]?.role!=='admin'||!profiles[0].active)throw new HttpError(403,'Administrator access is required.');
 return {id:user.id,token};
}
export async function requireActiveAdmin(id){const rows=await db(`profiles?id=eq.${encodeURIComponent(id)}&select=role,active`);if(rows?.[0]?.role!=='admin'||!rows[0].active)throw new HttpError(403,'The administrator connection is no longer active.');}
export function checkOrigin(req){if(req.headers.origin&&req.headers.origin!==new URL(env('APP_URL')).origin)throw new HttpError(403,'Please use the Job Manager website to make this request.');}
export function uuid(value){if(typeof value!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))throw new HttpError(400,'A valid record ID is required.');return value;}
export function date(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(new Date(value+'T12:00:00Z').getTime())||new Date(value+'T12:00:00Z').toISOString().slice(0,10)!==value)throw new HttpError(400,'Enter a valid date.');return value;}
export async function limited(user,bucket,limit=20){const ok=await db('rpc/bf_take_api_slot',{method:'POST',body:JSON.stringify({p_user:user,p_bucket:bucket,p_limit:limit})});if(!ok)throw new HttpError(429,'The hourly limit has been reached. Please try again later.');}
export async function withLock(key,fn){const owner=randomBytes(16).toString('hex');const got=await db('rpc/bf_acquire_lock',{method:'POST',body:JSON.stringify({p_key:key,p_owner:owner})});if(!got)throw new HttpError(409,'Another update is running. Please wait a moment and retry.');try{return await fn();}finally{await db(`bf_integration_locks?lock_key=eq.${encodeURIComponent(key)}&owner=eq.${owner}`,{method:'DELETE'}).catch(()=>{});}}
export function json(res,status,data){res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');return res.status(status).json(data);}
export async function rawBody(req,max=3900000){if(Number(req.headers['content-length']||0)>max)throw new HttpError(413,'Attachments are too large. Use up to 2.5 MB combined.');const parts=[];let n=0;for await(const part of req){const b=Buffer.isBuffer(part)?part:Buffer.from(part);n+=b.length;if(n>max)throw new HttpError(413,'Request is too large.');parts.push(b);}return Buffer.concat(parts);}
