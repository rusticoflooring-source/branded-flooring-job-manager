export type QuoteStatus='Draft'|'Sent'|'Accepted'|'Declined'
export type QuotePayload={customer:string;email:string;contact:string;customerAddress:string;description:string;terms:string;details:{label:string;value:string}[]}
export type SavedQuote={id:string;job_id:string;reference:string;status:QuoteStatus;payload:QuotePayload;net:number;vat_code:string;quote_date:string;revision:number;updated_at:string}
export const quoteStatuses:QuoteStatus[]=['Draft','Sent','Accepted','Declined']
export const quoteTotal=(q:SavedQuote)=>Math.round(Number(q.net)*(q.vat_code==='reverse20'?1:1+Number(q.vat_code)/100)*100)/100
