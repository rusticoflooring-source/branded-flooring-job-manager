import { jsPDF } from 'jspdf'
export type QuoteInput={reference:string;date:string;customer:string;email:string;site:string;description:string;amount:number;vat:number;terms:string;logo:string;customerAddress?:string;contact?:string;details?:{label:string;value:string}[]}
export const quoteMoney=(value:number)=>new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP'}).format(value)
export const quoteMessage='Hi,\n\nPlease find our attached quote. If you have any queries, please don’t hesitate to get in touch.\n\nKind regards,\nSteve\nBranded Flooring & Interiors Ltd'
export function createQuotePdf(q:QuoteInput){
 const doc=new jsPDF(),blue='#507e8e',ink='#30363b',pale='#e9f0f3';let y=80
 const text=(s:string,x:number,at:number,size=10,bold=false,colour=ink,align:'left'|'right'='left')=>{doc.setFont('helvetica',bold?'bold':'normal');doc.setFontSize(size);doc.setTextColor(colour);doc.text(s,x,at,{align})}
 const rule=(at:number)=>{doc.setDrawColor('#a7c1cb');doc.setLineWidth(.2);doc.line(14,at,196,at)}
 const header=(continued=false)=>{doc.addImage(q.logo,'PNG',14,17,61,22.6);text('Branded Flooring & Interiors Ltd',80,19,12,true,blue);['Unit 36, Benedict Square','Werrington Industrial Estate','Peterborough, Cambridgeshire','PE4 6GD'].forEach((s,i)=>text(s,80,25+i*4.6,9));text('info@brandedfloorsltd.co.uk',14,48,9);text('www.brandedfloorsltd.co.uk',14,53,9);text('QUOTATION',196,49,18,true,blue,'right');text(q.date,196,55,9,false,'#667780','right');rule(60);text(q.reference+(continued?' - continued':''),14,67,9,false,'#667780');y=77}
 const space=(height:number)=>{if(y+height>268){doc.addPage();header(true)}}
 const paragraph=(s:string,size=10,bold=false,colour=ink)=>{doc.setFont('helvetica',bold?'bold':'normal');doc.setFontSize(size);const lines=doc.splitTextToSize(s,178) as string[];for(const line of lines){space(6);text(line,14,y,size,bold,colour);y+=size<=9?4.2:5}y+=size<=9?1.5:3}
 header();paragraph('FLOORING QUOTATION',13,true,blue);paragraph(`Prepared for: ${q.customer}`);if(q.email)paragraph(q.email,9);if(q.contact?.trim())paragraph(`Contact: ${q.contact}`,9);if(q.customerAddress?.trim())paragraph(`Customer address: ${q.customerAddress}`,9);if(q.site)paragraph(`Site / plot: ${q.site}`,9);for(const detail of q.details||[]){if(detail.value.trim())paragraph(`${detail.label}: ${detail.value}`,9)}y+=4;space(22);doc.setFillColor(pale);doc.rect(14,y-4,182,9,'F');text('DESCRIPTION',17,y+2,9,true,blue);text('PRICE EXCL. VAT',193,y+2,9,true,blue,'right');y+=14
 // Long descriptions continue across pages without splitting totals or footer.
 paragraph(q.description);space(12);text(quoteMoney(q.amount),193,y,10,false,ink,'right');y+=6;rule(y);y+=15
 space(43);const tax=Math.round(q.amount*q.vat)/100,total=Math.round((q.amount+tax)*100)/100
 text('Subtotal excluding VAT',104,y,10);text(quoteMoney(q.amount),193,y,10,false,ink,'right');y+=9;text(`VAT at ${q.vat}%`,104,y,10);text(quoteMoney(tax),193,y,10,false,ink,'right');y+=8;doc.setFillColor(pale);doc.rect(102,y-3,94,12,'F');text('TOTAL INCLUDING VAT',105,y+4,10,true,blue);text(quoteMoney(total),193,y+4,11,true,blue,'right');y+=22
 if(q.terms.trim()){paragraph('Terms / exclusions',10,true,blue);paragraph(q.terms,9)}
 const count=doc.getNumberOfPages();for(let i=1;i<=count;i++){doc.setPage(i);text('Please contact us to accept this quotation or discuss any changes.',14,274,8,false,'#667780');rule(278);text('Company registration: 12073839  |  VAT registration: 328805977',14,284,7,false,'#667780');text(`Page ${i} of ${count}`,196,284,7,false,'#667780','right')}
 return doc
}
export function quoteEmailDraft(reference:string,email:string,pdfBase64:string){
 if(/[\r\n]/.test(reference+email))throw Error('Invalid email fields')
 const boundary='BrandedQuote_'+reference.replace(/[^a-zA-Z0-9]/g,'')
 const body=quoteMessage.replace('don’t',"don't")
 return [`To: ${email}`,`Subject: Branded Flooring quotation ${reference}`,'X-Unsent: 1','MIME-Version: 1.0',`Content-Type: multipart/mixed; boundary="${boundary}"`,'',`--${boundary}`,'Content-Type: text/plain; charset=utf-8','Content-Transfer-Encoding: 8bit','',body,`--${boundary}`,'Content-Type: application/pdf',`Content-Disposition: attachment; filename="${reference}.pdf"`,'Content-Transfer-Encoding: base64','',pdfBase64.match(/.{1,76}/g)?.join('\r\n')||'',`--${boundary}--`,''].join('\r\n')
}
