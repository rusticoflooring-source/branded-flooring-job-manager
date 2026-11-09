export type InvoiceSnapshot={job_id:string;invoice_status?:string;total?:number|null;amount_due?:number|null;amount_paid?:number|null;synced_at?:string|null;[key:string]:any}
export const invoiceColumns='job_id,tenant_id,invoice_id,invoice_number,reference,invoice_status,total,amount_paid,amount_credited,amount_due,due_date,created_at,synced_at,use_xero_number,number_sync_error'
export function invoiceStatusLabel(invoice:InvoiceSnapshot|undefined){
 if(!invoice)return 'Not linked to Xero'
 switch(invoice.invoice_status){
 case 'DRAFT':return 'Draft'
 case 'SUBMITTED':return 'Awaiting approval'
 case 'AUTHORISED':return Number(invoice.amount_due)>0?(Number(invoice.amount_paid)>0?'Part paid':'Awaiting payment'):'Settled'
 case 'PAID':return 'Paid'
 case 'VOIDED':return 'Voided'
 case 'DELETED':return 'Deleted'
 default:return 'Awaiting Xero sync'
 }
}
export function overviewInvoice(invoice:InvoiceSnapshot|undefined,manualAmount:number){
 const draft=invoice?.invoice_status==='DRAFT'||invoice?.invoice_status==='SUBMITTED'
 return {amount:draft?Number(invoice?.total||0):Number(manualAmount||0),label:invoiceStatusLabel(invoice),draft}
}
