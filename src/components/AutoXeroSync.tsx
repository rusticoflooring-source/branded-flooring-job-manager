import { useEffect, useRef, useState } from 'react'
import { integrationApi } from '../lib/integrationApi'
import { createAutoXeroSync, XERO_SYNC_INTERVAL } from '../lib/autoXeroSync'
export default function AutoXeroSync({userId,onRefresh}:{userId:string;onRefresh:()=>Promise<void>}){
 const refresh=useRef(onRefresh);refresh.current=onRefresh
 const [message,setMessage]=useState('Checking Xero connection…')
 useEffect(()=>{const controller=createAutoXeroSync({api:integrationApi,refresh:()=>refresh.current(),report:setMessage});const update=()=>{void controller.tick(!document.hidden)};update();const timer=window.setInterval(update,XERO_SYNC_INTERVAL);document.addEventListener('visibilitychange',update);window.addEventListener('focus',update);return()=>{controller.stop();window.clearInterval(timer);document.removeEventListener('visibilitychange',update);window.removeEventListener('focus',update)}},[userId])
 return <p className="muted" role="status">{message}</p>
}
