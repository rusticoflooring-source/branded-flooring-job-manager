import { useEffect, useRef, useState } from 'react'

export default function SignaturePad({ onSave }:{ onSave:(blob:Blob)=>Promise<void> }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [drawing,setDrawing] = useState(false)
  const [busy,setBusy] = useState(false)

  useEffect(()=>{
    const canvas=ref.current
    if(!canvas)return
    const resize=()=>{
      const rect=canvas.getBoundingClientRect()
      const ratio=window.devicePixelRatio || 1
      canvas.width=rect.width*ratio
      canvas.height=180*ratio
      const ctx=canvas.getContext('2d')!
      ctx.scale(ratio,ratio)
      ctx.lineWidth=2
      ctx.lineCap='round'
    }
    resize()
  },[])

  const point=(e:React.PointerEvent<HTMLCanvasElement>)=>{
    const r=e.currentTarget.getBoundingClientRect()
    return {x:e.clientX-r.left,y:e.clientY-r.top}
  }
  const down=(e:React.PointerEvent<HTMLCanvasElement>)=>{
    e.currentTarget.setPointerCapture(e.pointerId)
    const p=point(e),ctx=e.currentTarget.getContext('2d')!
    ctx.beginPath();ctx.moveTo(p.x,p.y);setDrawing(true)
  }
  const move=(e:React.PointerEvent<HTMLCanvasElement>)=>{
    if(!drawing)return
    const p=point(e),ctx=e.currentTarget.getContext('2d')!
    ctx.lineTo(p.x,p.y);ctx.stroke()
  }
  const clear=()=>{
    const c=ref.current;if(!c)return
    c.getContext('2d')!.clearRect(0,0,c.width,c.height)
  }
  const save=async()=>{
    const c=ref.current;if(!c)return
    setBusy(true)
    try{
      const blob=await new Promise<Blob>((resolve,reject)=>c.toBlob(b=>b?resolve(b):reject(new Error('Could not create signature')),'image/png'))
      await onSave(blob)
      clear()
    }finally{setBusy(false)}
  }

  return <div>
    <canvas ref={ref} className="signature" onPointerDown={down} onPointerMove={move}
      onPointerUp={()=>setDrawing(false)} onPointerCancel={()=>setDrawing(false)} />
    <div className="row gap">
      <button className="button secondary" onClick={clear}>Clear</button>
      <button className="button" disabled={busy} onClick={save}>{busy?'Saving…':'Save signature'}</button>
    </div>
  </div>
}
