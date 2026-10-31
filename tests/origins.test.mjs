import {test,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {trustedAppOrigin,checkOrigin} from '../server/core.mjs';
import {startConnection} from '../server/xero.mjs';
const originalFetch=globalThis.fetch;
Object.assign(process.env,{APP_URL:'https://primary.example',APP_ALLOWED_ORIGINS:'https://alias.example',SUPABASE_URL:'https://db.example',SUPABASE_SERVICE_ROLE_KEY:'fixture',XERO_CLIENT_ID:'fixture',XERO_SCOPES:'offline_access accounting.invoices'});
afterEach(()=>{globalThis.fetch=originalFetch;});
test('both configured app addresses are accepted and unrelated origins are rejected',()=>{
 assert.equal(trustedAppOrigin(),'https://primary.example');
 assert.equal(trustedAppOrigin('https://alias.example'),'https://alias.example');
 assert.doesNotThrow(()=>checkOrigin({headers:{origin:'https://alias.example'}}));
 assert.throws(()=>trustedAppOrigin('https://attacker.example'),/Job Manager/);
});
test('alias OAuth callback stays on its origin with a browser-bound state cookie',async()=>{
 globalThis.fetch=async()=>new Response('[]',{status:200,headers:{'content-type':'application/json'}});
 const headers={};const result=await startConnection({id:'test-user'},{setHeader(k,v){headers[k]=v}},'https://alias.example');
 const u=new URL(result.url);
 assert.equal(u.searchParams.get('redirect_uri'),'https://alias.example/api/xero/callback');
 const cookie=headers['Set-Cookie'].split(';')[0].slice('bf_xero_state='.length).split('.');
 assert.equal(cookie[0],u.searchParams.get('state'));
 assert.equal(Buffer.from(cookie[1],'base64url').toString(),'https://alias.example');
 assert.match(headers['Set-Cookie'],/HttpOnly; Secure; SameSite=Lax/);
});
