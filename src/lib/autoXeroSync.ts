export const XERO_SYNC_INTERVAL=5*60*1000
export function createAutoXeroSync({api,refresh,report,now=Date.now}:{api:(path:string,body?:unknown)=>Promise<any>;refresh:()=>Promise<void>;report:(message:string)=>void;now?:()=>number}){
 let running=false,lastAttempt:number|null=null,stopped=false
 return {stop(){stopped=true},async tick(visible=true){
  if(stopped||!visible||running||(lastAttempt!==null&&now()-lastAttempt<XERO_SYNC_INTERVAL))return
  running=true;lastAttempt=now()
  try{const status=await api('integrations/status');if(stopped)return
   if(!status.xero?.connected){report('Xero is not connected. Connect it in Accounts & AI to update linked invoice amounts and payments automatically.');return}
   report('Updating linked invoice amounts and payments from Xero…')
   const result=await api('xero/sync',{});if(stopped)return
   await refresh();if(stopped)return
   report(result.failed?.length?'Some Xero invoices could not refresh. Open Accounts & AI to check the connection.':result.limited?'Xero sync is continuing in batches. More invoices will refresh on the next check.':'Linked Xero invoices and payments updated. Automatic checks run every five minutes while this app is open.')
  }catch{if(!stopped)report('Automatic Xero sync could not finish. Open Accounts & AI to check the connection; displayed amounts may be out of date.')}finally{running=false}
 }}
}
