// A strict, standalone wage statement is the only permitted monetary note.
export function fitterSafeText(value:string|null|undefined):boolean{
 const text=(value||'').trim()
 if(/^(?:fitters?['’]?\s+(?:wage|money))\s*:?\s*£?\s*\d+(?:[.,]\d{1,2})?\s*(?:gbp|pounds?)?\.?$/i.test(text))return true
 return !/(?:[£$€]|\b(?:gbp|pounds?|price|priced|pricing|cost|costs|costing|costings|charge|charges|charged|invoice|invoiced|quote|quotation|profit|margin|vat|revenue|contract value|per\s+(?:m2|m²|metre|meter))\b|\d[\d,.]*\s*(?:pounds?|gbp|per\s+(?:m2|m²|metre|meter)))/i.test(text)
}
export const fitterText=(value:string|null|undefined)=>fitterSafeText(value)?value:'[Admin-only financial information]'
