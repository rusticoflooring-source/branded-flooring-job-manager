import { supabase } from './supabase'
export async function integrationApi<T=any>(path:string,body?:unknown):Promise<T>{
 const {data}=await supabase!.auth.getSession()
 if(!data.session)throw new Error('Please sign in again.')
 const response=await fetch('/api/'+path,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${data.session.access_token}`,...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)})
 let result:any;try{result=await response.json()}catch{throw new Error('This connection needs server setup. Your existing jobs are still available.')}
 if(!response.ok)throw new Error(result.error||'The connection could not finish. Please retry.')
 return result
}
export function localToday(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}