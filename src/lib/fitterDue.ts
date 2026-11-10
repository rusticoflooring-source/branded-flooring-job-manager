// First Tuesday strictly after the last installation day, plus seven days.
export function fitterDueDate(finish:string|null|undefined):string|null {
 if(!finish||!/^\d{4}-\d{2}-\d{2}$/.test(finish))return null
 const d=new Date(finish+'T12:00:00Z')
 if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==finish)return null
 d.setUTCDate(d.getUTCDate()+((2-d.getUTCDay()+7)%7||7)+7)
 return d.toISOString().slice(0,10)
}
export function nextPayTuesday(today:string):string {
 const d=new Date(today+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+(2-d.getUTCDay()+7)%7);return d.toISOString().slice(0,10)
}
