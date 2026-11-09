import type { Job } from '../types'
type Invoice={job_id:string;invoice_id?:string|null;invoice_number?:string|null;invoice_status?:string;amount_due?:number|null;total?:number|null}
export function getAccountsWork(jobs:Job[],invoices:Invoice[],tracking:{job_id:string;install_complete:boolean}[]){
 const installed=new Set(tracking.filter(t=>t.install_complete).map(t=>t.job_id))
 const links=new Map(invoices.map(i=>[i.job_id,i]))
 const complete=jobs.filter(j=>j.archived||installed.has(j.id)||['Install Complete','Complete','Invoiced','Fitter Paid','Payment Received','Paid'].includes(j.status))
 const issued=(i:Invoice|undefined)=>!!i?.invoice_id&&['AUTHORISED','PAID'].includes(i.invoice_status||'')
 const waiting=complete.filter(j=>!(Number(j.invoiced_value)>0)&&!issued(links.get(j.id))&&!['DRAFT','SUBMITTED'].includes(links.get(j.id)?.invoice_status||''))
 const readyToSend=invoices.filter(i=>!!i.invoice_id&&['DRAFT','SUBMITTED'].includes(i.invoice_status||'')&&complete.some(j=>j.id===i.job_id))
 const unpaid=complete.map(job=>{const link=links.get(job.id);const due=Number(job.invoiced_value)>0?Math.max(0,Number(job.invoiced_value)-Number(job.paid_value||0)):issued(link)?Math.max(0,Number(link?.amount_due||0)):0;return {job,due}}).filter(row=>row.due>0)
 return {waiting,readyToSend,unpaid}
}
