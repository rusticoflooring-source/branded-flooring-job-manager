import { FormEvent, useEffect, useMemo, useState } from 'react'
import {
  BriefcaseBusiness, Building2, Camera, CheckCircle2, ClipboardCheck, CreditCard,
  FileText, LogOut, Menu, Plus, Search, Users, Wallet, X, MapPin, CalendarDays, AlertTriangle, Play
} from 'lucide-react'
import { configured, supabase } from './lib/supabase'
import type { Assignment, Job, JobFile, Note, Profile, Site, Variation } from './types'
import SignaturePad from './components/SignaturePad'

type Page='dashboard'|'jobs'|'completed'|'sites'|'fitters'|'payments'|'job'
type Tab='details'|'notes'|'photos'|'variations'|'payments'|'checklist'|'signoff'

const checklistSets:Record<string,string[]>={
  LVT:[
    'Subfloor checked, sound, smooth and suitable for LVT',
    'Moisture / condition checks completed where required',
    'Correct preparation system and primer confirmed',
    'Latex / smoothing compound finished to acceptable standard',
    'Correct LVT product, batch and laying direction confirmed',
    'Setting-out, borders / feature areas checked where applicable',
    'Adhesive and installation method confirmed',
    'Cuts, joints, edges, thresholds and doorways checked',
    'Installation rolled / finished in accordance with product requirements',
    'Finished floor visually inspected and cleaned',
    'Completion photographs uploaded',
    'Snags / defects recorded or confirmed none',
    'Site manager / customer sign-off obtained where required'
  ],
  Carpet:[
    'Subfloor and access route checked and suitable',
    'Correct carpet, colour and quantity confirmed',
    'Underlay / gripper / accessories confirmed where required',
    'Seams and joins positioned and completed correctly',
    'Doorways, thresholds and transitions checked',
    'Carpet stretched / secured and edges finished correctly',
    'Doors and surrounding finishes checked for damage',
    'Waste removed and area vacuumed / left clean',
    'Completion photographs uploaded',
    'Snags / defects recorded or confirmed none',
    'Site manager / customer sign-off obtained where required'
  ],
  Vinyl:[
    'Subfloor checked, smooth and suitable for sheet vinyl',
    'Moisture / condition checks completed where required',
    'Correct preparation and smoothing completed',
    'Correct vinyl product and laying direction confirmed',
    'Sheet set out to minimise / correctly position joins',
    'Adhesive and installation method confirmed',
    'Perimeter cuts, sanitary areas and thresholds checked',
    'Seams / joins finished correctly where applicable',
    'Finished floor visually inspected and cleaned',
    'Completion photographs uploaded',
    'Snags / defects recorded or confirmed none',
    'Site manager / customer sign-off obtained where required'
  ],
  'Latex / Prep':[
    'Subfloor inspected and defects recorded before preparation',
    'Area clean, dry and free from contamination',
    'Moisture / condition checks completed where required',
    'Correct primer / preparation system confirmed',
    'Mix ratio and product requirements followed',
    'Required depth / build-up achieved',
    'Finished surface smooth and suitable for floor covering',
    'Drying / curing restrictions communicated',
    'Preparation photographs uploaded',
    'Snags / defects recorded or confirmed none'
  ]
}
const defaultChecklist=[
  'Subfloor checked and suitable','Moisture / condition checks completed where required','Floor preparation completed',
  'Correct product and installation method confirmed','Installation visually inspected','Edges, trims and doorways checked',
  'Waste removed and area left clean','Completion photographs uploaded','Snags or defects recorded','Site manager / customer sign-off obtained where required'
]
const checklistFor=(flooring:string)=>checklistSets[flooring]||defaultChecklist

const money=(n:number|string|null|undefined)=>new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP'}).format(Number(n||0))
const niceDate=(v:string|null|undefined)=>v?new Date(v+'T12:00:00').toLocaleDateString('en-GB'):'—'

export default function App(){
  const [sessionUser,setSessionUser]=useState<string|null>(null)
  const [profile,setProfile]=useState<Profile|null>(null)
  const [loading,setLoading]=useState(true)
  const [page,setPage]=useState<Page>('dashboard')
  const [tab,setTab]=useState<Tab>('details')
  const [jobs,setJobs]=useState<Job[]>([])
  const [sites,setSites]=useState<Site[]>([])
  const [profiles,setProfiles]=useState<Profile[]>([])
  const [selected,setSelected]=useState<Job|null>(null)
  const [search,setSearch]=useState('')
  const [mobileNav,setMobileNav]=useState(false)

  useEffect(()=>{
    if(!configured){setLoading(false);return}
    supabase!.auth.getSession().then(({data})=>{
      setSessionUser(data.session?.user.id||null)
      if(!data.session)setLoading(false)
    })
    const {data:{subscription}}=supabase!.auth.onAuthStateChange((_e,s)=>{
      setSessionUser(s?.user.id||null)
      if(!s){setProfile(null);setLoading(false)}
    })
    return ()=>subscription.unsubscribe()
  },[])

  useEffect(()=>{
    if(!sessionUser)return
    ;(async()=>{
      const {data,error}=await supabase!.from('profiles').select('*').eq('id',sessionUser).single()
      if(error){console.error(error);setLoading(false);return}
      setProfile(data)
      await refresh(data.role)
      setLoading(false)
    })()
  },[sessionUser])

  async function refresh(role=profile?.role){
    if(!supabase)return
    const [j,s,p]=await Promise.all([
      supabase.from('jobs').select('*, sites(name)').order('install_date',{ascending:true,nullsFirst:false}),
      supabase.from('sites').select('*').order('name'),
      role==='admin'?supabase.from('profiles').select('*').order('full_name'):Promise.resolve({data:[],error:null} as any)
    ])
    setJobs((j.data||[]).map((x:any)=>({...x,site_name:x.sites?.name||''})))
    setSites(s.data||[])
    setProfiles(p.data||[])
  }

  if(loading)return <div className="center-screen"><div className="spinner"/><p>Loading Branded Flooring…</p></div>
  if(!configured)return <SetupScreen/>
  if(!sessionUser)return <Login/>
  if(!profile)return <div className="center-screen card narrow"><h2>Account not configured</h2><p>Your login exists, but there is no matching profile/role. Run the setup SQL and add this user to the profiles table.</p><button className="button" onClick={()=>supabase!.auth.signOut()}>Sign out</button></div>

  const admin=profile.role==='admin'
  const filtered=jobs.filter(j=>!j.archived&&[j.job_number,j.customer,j.site_name,j.plot,j.po_number,j.flooring_type].join(' ').toLowerCase().includes(search.toLowerCase()))
const completed=jobs.filter(j=>j.archived)
const openJob=(j:Job)=>{setSelected(j);setTab('details');setPage('job')}
  const nav=(p:Page)=>{setPage(p);setMobileNav(false)}

  return <div className="shell">
    <aside className={mobileNav?'sidebar open':'sidebar'}>
      <div className="brand"><div className="brand-mark">BF</div><div><strong>BRANDED FLOORING</strong><small>Job Manager</small></div></div>
      <nav>
        <NavButton icon={<BriefcaseBusiness/>} label={admin?'Dashboard':'My Jobs'} active={page==='dashboard'} onClick={()=>nav('dashboard')}/>
        <NavButton icon={<ClipboardCheck/>} label="Jobs" active={page==='jobs'}
 onClick={()=>nav('jobs')}/>
{admin&&<NavButton icon={<ClipboardCheck/>} label="Completed" active={page==='completed'} onClick={()=>nav('completed')}/>}
        {admin&&<><NavButton icon={<Building2/>} label="Sites & Plots" active={page==='sites'} onClick={()=>nav('sites')}/>
        <NavButton icon={<Users/>} label="Fitters" active={page==='fitters'} onClick={()=>nav('fitters')}/>
        <NavButton icon={<Wallet/>} label="Payments" active={page==='payments'} onClick={()=>nav('payments')}/></>}
      </nav>
      <div className="sidebar-footer"><div><strong>{profile.full_name}</strong><small>{profile.role==='admin'?'Administrator':'Fitter account'}</small></div><button className="icon-btn" title="Sign out" onClick={()=>supabase!.auth.signOut()}><LogOut size={18}/></button></div>
    </aside>
    {mobileNav&&<div className="backdrop" onClick={()=>setMobileNav(false)}/>}
    <main className="main">
      <header className="topbar"><button className="icon-btn menu" onClick={()=>setMobileNav(!mobileNav)}>{mobileNav?<X/>:<Menu/>}</button><div><strong>Branded Flooring & Interiors Ltd</strong><span>{admin?'Admin portal':'Fitter portal'}</span></div></header>
      <div className="content">
        {page==='dashboard'&&<Dashboard jobs={jobs} admin={admin} openJob={openJob}/>}
        {page==='jobs'&&<JobsPage jobs={filtered} sites={sites} admin={admin} search={search} setSearch={setSearch} openJob={openJob} onCreated={async()=>refresh()}/>}
{page==='completed'&&admin&&<CompletedJobsPage jobs={completed} sites={sites} search={search} setSearch={setSearch} openJob={openJob}/>}
        {page==='sites'&&admin&&<SitesPage sites={sites} jobs={jobs} onRefresh={async()=>refresh()}/>}
        {page==='fitters'&&admin&&<FittersPage profiles={profiles}/>}
        {page==='payments'&&admin&&<PaymentsPage jobs={jobs} openJob={openJob}/>}
        {page==='job'&&selected&&<JobPage job={selected} admin={admin} profiles={profiles} sites={sites} tab={tab} setTab={setTab}
          onBack={()=>nav(selected.archived?'completed':'jobs')} onRefresh={async()=>{await refresh(); const {data}=await supabase!.from('jobs').select('*, sites(name)').eq('id',selected.id).single(); if(data)setSelected({...data,site_name:(data as any).sites?.name||''})}}/>}
      </div>
    </main>
  </div>
}

function SetupScreen(){
  return <div className="center-screen setup">
    <div className="card narrow">
      <div className="brand large"><div className="brand-mark">BF</div><div><strong>BRANDED FLOORING</strong><small>Cloud Job Manager</small></div></div>
      <h1>Ready to connect</h1>
      <p>This production app is built, but it needs your Supabase project credentials before it can store real company data.</p>
      <ol><li>Create a Supabase project.</li><li>Run <code>supabase/schema.sql</code> in its SQL editor.</li><li>Copy <code>.env.example</code> to <code>.env.local</code> and add the project URL + anon key.</li><li>Run <code>npm install</code> then <code>npm run dev</code>.</li></ol>
      <p className="muted">The included DEPLOYMENT.md walks through the exact deployment steps.</p>
    </div>
  </div>
}

function Login(){
  const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false)
  const submit=async(e:FormEvent)=>{
    e.preventDefault();setBusy(true);setError('')
    const {error}=await supabase!.auth.signInWithPassword({email,password})
    if(error)setError(error.message)
    setBusy(false)
  }
  return <div className="center-screen login-bg"><form className="card login" onSubmit={submit}>
    <div className="brand large">
  <img
    src="/company-logo.png"
    alt="Branded Flooring & Interiors"
    style={{ width: '100%', maxWidth: '420px', height: 'auto', display: 'block' }}
  />
</div>
    <h1>Sign in</h1><p className="muted">Admin and fitter accounts use the same secure login.</p>
    <label>Email<input type="email" value={email} onChange={e=>setEmail(e.target.value)} required/></label>
    <label>Password<input type="password" value={password} onChange={e=>setPassword(e.target.value)} required/></label>
    {error&&<div className="error">{error}</div>}
    <button className="button wide" disabled={busy}>{busy?'Signing in…':'Sign in'}</button>
  </form></div>
}

function Dashboard({jobs,admin,openJob}:{jobs:Job[],admin:boolean,openJob:(j:Job)=>void}){
  if(!admin)return <FitterDashboard jobs={jobs} openJob={openJob}/>
  const activeJobs=jobs.filter(j=>!j.archived)
  const active=activeJobs.length
  const complete=activeJobs.filter(j=>j.status==='Install Complete').length
  const outstanding=jobs.reduce((a,j)=>a+Math.max(0,Number(j.invoiced_value)-Number(j.paid_value)),0)
  const fitterDue=jobs.filter(j=>j.fitter_payment_status!=='Paid').reduce((a,j)=>a+Number(j.fitter_payment_due||0),0)
  const today=new Date().toISOString().slice(0,10)
  const todayJobs=activeJobs.filter(j=>j.install_date===today)
  const nextJobs=activeJobs.filter(j=>!j.install_date||j.install_date>=today).slice(0,10)
  return <>
    <div className="page-title"><div><h1>Operations Dashboard</h1><p>Live installation, payment and snag overview.</p></div></div>
    <div className="metrics"><Metric label="Active jobs" value={String(active)}/><Metric label="Install complete" value={String(complete)}/><Metric label="Outstanding invoices" value={money(outstanding)}/><Metric label="Fitter payments due" value={money(fitterDue)}/></div>
    <section className="panel"><div className="panel-head"><div><h2>{todayJobs.length?'Today’s jobs':'Upcoming jobs — next 7 days'}</h2><p>{todayJobs.length?`${todayJobs.length} scheduled today`:'Next jobs in the programme'}</p></div></div><JobTable jobs={todayJobs.length?todayJobs:nextJobs} openJob={openJob}/></section>
  </>
}

function FitterDashboard({jobs,openJob}:{jobs:Job[],openJob:(j:Job)=>void}){
  const activeJobs=jobs.filter(j=>!j.archived)
  const today=new Date().toISOString().slice(0,10)
  const todayJobs=activeJobs.filter(j=>j.install_date===today)
  const upcoming=activeJobs.filter(j=>!j.install_date || j.install_date>=today)
  const installComplete=activeJobs.filter(j=>j.status==='Install Complete').length
  const focus=todayJobs.length?todayJobs:upcoming.slice(0,8)
  return <>
    <div className="page-title fitter-title"><div><h1>{todayJobs.length?'Today’s work':'My jobs'}</h1><p>{todayJobs.length?'Everything assigned to you for today.':'Your assigned upcoming installations.'}</p></div></div>
    <div className="fitter-summary"><div><CalendarDays/><strong>{todayJobs.length}</strong><span>Today</span></div><div><BriefcaseBusiness/><strong>{upcoming.length}</strong><span>Upcoming</span></div><div><CheckCircle2/><strong>{installComplete}</strong><span>Install complete</span></div></div>
    <div className="fitter-job-list">{focus.map(j=><FitterJobCard key={j.id} job={j} openJob={openJob}/>)}{!focus.length&&<section className="panel fitter-empty"><CheckCircle2/><h2>No jobs waiting</h2><p>You have no assigned upcoming jobs.</p></section>}</div>
  </>
}

function FitterJobCard({job,openJob}:{job:Job,openJob:(j:Job)=>void}){
  const maps=()=>job.address&&window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(job.address)}`,'_blank')
  return <section className="panel fitter-job-card"><div className="fitter-card-top"><div><span className="eyebrow">{niceDate(job.install_date)} • {job.flooring_type}</span><h2>{job.site_name||job.customer}{job.plot?` — Plot ${job.plot}`:''}</h2><p><strong>{job.job_number}</strong>{job.po_number?` • PO ${job.po_number}`:''}</p></div><Status value={job.status}/></div>
    {job.address&&<div className="fitter-address"><MapPin size={18}/><span>{job.address}</span></div>}
    {job.instructions&&<div className="fitter-instruction"><strong>Instructions</strong><p>{job.instructions}</p></div>}
    <div className="fitter-card-actions">{job.address&&<button className="button secondary" onClick={maps}><MapPin size={17}/>Directions</button>}<button className="button fitter-open" onClick={()=>openJob(job)}>Open job →</button></div></section>
}

function Metric({label,value}:{label:string,value:string}){return <div className="metric"><span>{label}</span><strong>{value}</strong></div>}

function JobsPage({jobs,sites,admin,search,setSearch,openJob,onCreated}:{jobs:Job[],sites:Site[],admin:boolean,search:string,setSearch:(s:string)=>void,openJob:(j:Job)=>void,onCreated:()=>Promise<void>}){
  const [creating,setCreating]=useState(false)
  return <>
    <div className="page-title"><div><h1>{admin?'Jobs':'My Jobs'}</h1><p>{admin?'Create, schedule and manage installations.':'Open a job to upload photos, notes and complete your checklist.'}</p></div>
      {admin&&<button className="button" onClick={()=>setCreating(true)}><Plus size={18}/>New job</button>}</div>
    <div className="search"><Search size={18}/><input placeholder="Search job, customer, site, plot, PO…" value={search} onChange={e=>setSearch(e.target.value)}/></div>
    {admin?<section className="panel"><JobTable jobs={jobs} openJob={openJob}/></section>:<div className="fitter-job-list">{jobs.map(j=><FitterJobCard key={j.id} job={j} openJob={openJob}/>)}{!jobs.length&&<section className="panel fitter-empty"><p>No assigned jobs found.</p></section>}</div>}
    {creating&&<NewJobModal sites={sites} onClose={()=>setCreating(false)} onDone={async()=>{setCreating(false);await onCreated()}}/>}
  </>
}

function CompletedJobsPage({jobs,sites,search,setSearch,openJob}:{jobs:Job[],sites:Site[],search:string,setSearch:(s:string)=>void,openJob:(j:Job)=>void}){
  const siteById=new Map(sites.map(s=>[s.id,s]))
  const query=search.trim().toLowerCase()
  const visibleJobs=jobs.filter(job=>{
    const site=job.site_id?siteById.get(job.site_id):undefined
    const builder=site?.developer||job.customer||''
    const siteName=site?.name||job.site_name||''
    return !query||[job.job_number,job.customer,builder,siteName,job.plot,job.po_number,job.flooring_type,job.status].join(' ').toLowerCase().includes(query)
  })
  const grouped=visibleJobs.reduce((builders,job)=>{
    const site=job.site_id?siteById.get(job.site_id):undefined
    const builder=(site?.developer||job.customer||'Private / Direct').trim()||'Private / Direct'
    const siteName=(site?.name||job.site_name||'Private / Direct').trim()||'Private / Direct'
    builders[builder]??={}
    builders[builder][siteName]??=[]
    builders[builder][siteName].push(job)
    return builders
  },{} as Record<string,Record<string,Job[]>>)

  const builders=Object.keys(grouped).sort((a,b)=>a.localeCompare(b))

  return <>
    <div className="page-title"><div><h1>Completed Jobs</h1><p>Archived jobs filed by builder, then by site.</p></div></div>
    <div className="search"><Search size={18}/><input placeholder="Search completed job, builder, site, plot, PO…" value={search} onChange={e=>setSearch(e.target.value)}/></div>
    {!builders.length&&<section className="panel"><p className="empty">No completed jobs found.</p></section>}
    {builders.map(builder=>{
      const builderTotal=Object.keys(grouped[builder]).reduce((n,siteName)=>n+grouped[builder][siteName].length,0)
      return <details key={builder} className="panel" open>
        <summary style={{cursor:'pointer',fontWeight:800,fontSize:'1.05rem'}}>{builder} — {builderTotal} completed job{builderTotal===1?'':'s'}</summary>
        <div style={{display:'grid',gap:'12px',marginTop:'14px'}}>
          {Object.keys(grouped[builder]).sort((a,b)=>a.localeCompare(b)).map(siteName=>{
            const siteJobs=[...grouped[builder][siteName]].sort((a,b)=>(b.install_date||'').localeCompare(a.install_date||''))
            return <details key={siteName} style={{border:'1px solid rgba(148,163,184,.25)',borderRadius:'10px',padding:'10px 12px'}}>
              <summary style={{cursor:'pointer',fontWeight:700}}>{siteName} — {siteJobs.length} job{siteJobs.length===1?'':'s'}</summary>
              <div style={{marginTop:'10px'}}><JobTable jobs={siteJobs} openJob={openJob}/></div>
            </details>
          })}
        </div>
      </details>
    })}
  </>
}

function JobTable({jobs,openJob}:{jobs:Job[],openJob:(j:Job)=>void}){
 return <div className="table-wrap"><table><thead><tr><th>Job</th><th>Customer / Site</th><th>Plot</th><th>Install</th><th>Flooring</th><th>Status</th><th></th></tr></thead>
 <tbody>{jobs.map(j=><tr key={j.id}><td><strong>{j.job_number}</strong><small>{j.po_number||'No PO'}</small></td><td>{j.customer}<small>{j.site_name||'Private / direct'}</small></td><td>{j.plot||'—'}</td><td>{niceDate(j.install_date)}</td><td>{j.flooring_type}</td><td><Status value={j.status}/></td><td><button className="button small secondary" onClick={()=>openJob(j)}>Open</button></td></tr>)}
 {!jobs.length&&<tr><td colSpan={7} className="empty">No jobs found.</td></tr>}</tbody></table></div>
}

function NewJobModal({sites,onClose,onDone}:{sites:Site[],onClose:()=>void,onDone:()=>Promise<void>}){
 const [form,setForm]=useState({job_number:'',customer:'',site_id:'',plot:'',po_number:'',flooring_type:'LVT',status:'Booked',install_date:'',address:'',instructions:''})
 const [busy,setBusy]=useState(false),[error,setError]=useState('')
 const set=(k:string,v:string)=>setForm(f=>({...f,[k]:v}))
 const save=async(e:FormEvent)=>{e.preventDefault();setBusy(true);setError('')
   const payload={...form,site_id:form.site_id||null,install_date:form.install_date||null,plot:form.plot||null,po_number:form.po_number||null}
   const {error}=await supabase!.from('jobs').insert(payload)
   if(error){setError(error.message);setBusy(false)} else await onDone()
 }
 return <div className="modal-bg"><form className="modal card" onSubmit={save}><div className="panel-head"><h2>New job</h2><button type="button" className="icon-btn" onClick={onClose}><X/></button></div>
   <div className="form-grid"><label>Job number<input value={form.job_number} onChange={e=>set('job_number',e.target.value)} placeholder="BF-1032" required/></label>
   <label>Customer / developer<input value={form.customer} onChange={e=>set('customer',e.target.value)} required/></label>
   <label>Site<select value={form.site_id} onChange={e=>set('site_id',e.target.value)}><option value="">Private / no site</option>{sites.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
   <label>Plot<input value={form.plot} onChange={e=>set('plot',e.target.value)}/></label>
   <label>PO number<input value={form.po_number} onChange={e=>set('po_number',e.target.value)}/></label>
   <label>Install date<input type="date" value={form.install_date} onChange={e=>set('install_date',e.target.value)}/></label>
   <label>Flooring<select value={form.flooring_type} onChange={e=>set('flooring_type',e.target.value)}><option>LVT</option><option>Carpet</option><option>Vinyl</option><option>Latex / Prep</option><option>Mixed</option></select></label>
   <label>Status<select value={form.status} onChange={e=>set('status',e.target.value)}><option>Booked</option><option>Prep</option><option>In Progress</option><option>Snag</option><option>Install Complete</option><option>Invoiced</option><option>Fitter Paid</option><option>Payment Received</option></select></label>
   <label className="span2">Address<input value={form.address} onChange={e=>set('address',e.target.value)}/></label>
   <label className="span2">Instructions<textarea value={form.instructions} onChange={e=>set('instructions',e.target.value)}/></label></div>
   {error&&<div className="error">{error}</div>}<div className="row end gap"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button className="button" disabled={busy}>{busy?'Creating…':'Create job'}</button></div>
 </form></div>
}

function SitesPage({sites,jobs,onRefresh}:{sites:Site[],jobs:Job[],onRefresh:()=>Promise<void>}){
 const [name,setName]=useState(''),[developer,setDeveloper]=useState(''),[address,setAddress]=useState('')
 const add=async(e:FormEvent)=>{e.preventDefault();if(!name.trim())return;await supabase!.from('sites').insert({name,developer:developer||null,address:address||null});setName('');setDeveloper('');setAddress('');await onRefresh()}

const deleteSite=async(site:Site)=>{
const siteJobs=jobs.filter(j=>j.site_id===site.id)

if(siteJobs.length>0){
  alert(`You cannot delete ${site.name} because it has ${siteJobs.length} job(s) attached. Delete or move those jobs first.`)
  return
}
  const confirmed=window.confirm(
    `Permanently delete site ${site.name}? This cannot be undone.`
  )
  if(!confirmed)return

  const {error}=await supabase!
    .from('sites')
    .delete()
    .eq('id',site.id)

  if(error){
    alert(error.message)
    return
  }

  await onRefresh()
}
 return <><div className="page-title"><div><h1>Sites & developments</h1><p>Create the development once, then attach multiple plots/jobs to it.</p></div></div>
 <section className="panel"><form className="inline-form" onSubmit={add}><input placeholder="Development / site name" value={name} onChange={e=>setName(e.target.value)} required/><input placeholder="Developer" value={developer} onChange={e=>setDeveloper(e.target.value)}/><input placeholder="Address" value={address} onChange={e=>setAddress(e.target.value)}/><button className="button"><Plus size={17}/>Add site</button></form></section>
 <div className="cards">{sites.map(s=><section className="panel" key={s.id}><div className="site-card"><Building2/><div><h3>{s.name}</h3><button
  type="button"
  className="button secondary danger-outline"
  onClick={()=>deleteSite(s)}
>
  Delete site
</button>
<p>{s.developer||'No developer set'}</p><small>{s.address||'No address set'}</small></div><strong>{jobs.filter(j=>j.site_id===s.id).length} jobs</strong></div></section>)}</div></>
}

function FittersPage({profiles}:{profiles:Profile[]}){
 const fitters=profiles.filter(p=>p.role==='fitter')
 return <><div className="page-title"><div><h1>Fitters</h1><p>Fitter users are created securely in Supabase Auth, then given a fitter profile.</p></div></div>
 <section className="panel"><div className="table-wrap"><table><thead><tr><th>Name</th><th>Role</th><th>Status</th></tr></thead><tbody>{fitters.map(f=><tr key={f.id}><td><strong>{f.full_name}</strong></td><td>Fitter</td><td>{f.active?'Active':'Disabled'}</td></tr>)}{!fitters.length&&<tr><td colSpan={3} className="empty">No fitter accounts yet. Follow DEPLOYMENT.md to create the first one.</td></tr>}</tbody></table></div></section></>
}

function PaymentsPage({jobs,openJob}:{jobs:Job[],openJob:(j:Job)=>void}){
 const invoiced=jobs.reduce((a,j)=>a+Number(j.invoiced_value||0),0),paid=jobs.reduce((a,j)=>a+Number(j.paid_value||0),0)
 const due=jobs.filter(j=>j.fitter_payment_status!=='Paid').reduce((a,j)=>a+Number(j.fitter_payment_due||0),0)
 return <><div className="page-title"><div><h1>Payments</h1><p>Customer receipts and fitter labour due by job.</p></div></div>
 <div className="metrics"><Metric label="Customer invoiced" value={money(invoiced)}/><Metric label="Customer received" value={money(paid)}/><Metric label="Customer outstanding" value={money(invoiced-paid)}/><Metric label="Fitter payments due" value={money(due)}/></div>
 <section className="panel"><div className="table-wrap"><table><thead><tr><th>Job</th><th>Customer</th><th>Invoiced</th><th>Paid</th><th>Outstanding</th><th>Fitters due</th><th></th></tr></thead><tbody>{jobs.map(j=><tr key={j.id}><td>{j.job_number}</td><td>{j.customer}</td><td>{money(j.invoiced_value)}</td><td>{money(j.paid_value)}</td><td>{money(Number(j.invoiced_value)-Number(j.paid_value))}</td><td>{money(j.fitter_payment_due)}</td><td><button className="button small secondary" onClick={()=>openJob(j)}>Open</button></td></tr>)}</tbody></table></div></section></>
}

function JobPage({job,admin,profiles,sites,tab,setTab,onBack,onRefresh}:{job:Job,admin:boolean,profiles:Profile[],sites:Site[],tab:Tab,setTab:(t:Tab)=>void,onBack:()=>void,onRefresh:()=>Promise<void>}){
 const archiveJob=async()=>{
  if(!supabase)return
  if(!window.confirm('Move this job to Completed?'))return
  const {error}=await supabase.from('jobs').update({archived:true}).eq('id',job.id)
  if(error){alert(error.message);return}
  await onRefresh()
  onBack()
}

const tabs: {id:Tab,label:string,icon:any}[]=[
  {id:'details',label:'Details',icon:FileText},{id:'notes',label:'Notes',icon:FileText},{id:'photos',label:'Photos',icon:Camera},
  {id:'variations',label:'Extras',icon:Plus},{id:'payments',label:'Payments',icon:CreditCard},{id:'checklist',label:'Checklist',icon:ClipboardCheck},{id:'signoff',label:'Sign-off',icon:CheckCircle2}
 ]
 return <>
   <div className="job-head">
  <button className="button secondary" onClick={onBack}>← {admin?'Jobs':'My Jobs'}</button>
  <div>
    <h1>{job.job_number} <Status value={job.status}/></h1>
    <p>{job.customer}{job.site_name?' • '+job.site_name:''}{job.plot?' • Plot '+job.plot:''}</p>
  </div>
  {admin&&<button className="button secondary print-hide" onClick={()=>window.print()}>Print completion pack</button>}
  {admin&&!job.archived&&<button className="button" onClick={archiveJob}>Move to Completed</button>}
</div>
   {!admin&&<FitterJobActions job={job} onRefresh={onRefresh}/>} 
   <div className="tabs">{tabs.filter(x=>admin||x.id!=='payments').map(x=><button key={x.id} className={tab===x.id?'active':''} onClick={()=>setTab(x.id)}><x.icon size={16}/>{x.label}</button>)}</div>
   {tab==='details'&&<DetailsTab job={job} admin={admin} profiles={profiles} sites={sites} onRefresh={onRefresh}/>}
   {tab==='notes'&&<NotesTab job={job} admin={admin}/>}
   {tab==='photos'&&<PhotosTab job={job} admin={admin}/>}
   {tab==='variations'&&<VariationsTab job={job} admin={admin} onRefresh={onRefresh}/>}
   {tab==='payments'&&admin&&<JobPayments job={job} onRefresh={onRefresh}/>}
   {tab==='checklist'&&<ChecklistTab job={job}/>}
   {tab==='signoff'&&<SignoffTab job={job}/>}
 </>
}

function FitterJobActions({job,onRefresh}:{job:Job,onRefresh:()=>Promise<void>}){
 const update=async(status:'In Progress'|'Snag'|'Install Complete')=>{const {error}=await supabase!.from('jobs').update({status}).eq('id',job.id);if(error)alert(error.message);else await onRefresh()}
 return <section className="fitter-action-strip"><button className="button secondary" onClick={()=>update('In Progress')}><Play size={17}/>Start job</button><button className="button secondary danger-outline" onClick={()=>update('Snag')}><AlertTriangle size={17}/>Report snag</button><button className="button" onClick={()=>update('Install Complete')}><CheckCircle2 size={17}/>Install complete</button></section>
}

function DetailsTab({job,admin,profiles,sites,onRefresh}:{job:Job,admin:boolean,profiles:Profile[],sites:Site[],onRefresh:()=>Promise<void>}){
 const [form,setForm]=useState({...job,site_id:job.site_id||''})
 const [assignments,setAssignments]=useState<Assignment[]>([])
 const [fitter,setFitter]=useState('')
 useEffect(()=>{supabase!.from('job_assignments').select('job_id,fitter_id,profiles(full_name)').eq('job_id',job.id).then(({data})=>setAssignments((data||[]).map((x:any)=>({...x,fitter_name:x.profiles?.full_name}))))},[job.id])
 const save=async()=>{const {site_name,created_at,...payload}=form as any;await supabase!.from('jobs').update({...payload,site_id:payload.site_id||null}).eq('id',job.id);await onRefresh()}
 const assign=async()=>{if(!fitter)return;await supabase!.from('job_assignments').upsert({job_id:job.id,fitter_id:fitter});setFitter('');const {data}=await supabase!.from('job_assignments').select('job_id,fitter_id,profiles(full_name)').eq('job_id',job.id);setAssignments((data||[]).map((x:any)=>({...x,fitter_name:x.profiles?.full_name})))}
const unassign=async(fitterId:string)=>{
  await supabase!.from('job_assignments')
    .delete()
    .eq('job_id',job.id)
    .eq('fitter_id',fitterId)

  const {data}=await supabase!
    .from('job_assignments')
    .select('job_id,fitter_id,profiles(full_name)')
    .eq('job_id',job.id)

  setAssignments((data||[]).map((x:any)=>({
    ...x,
    fitter_name:x.profiles?.full_name
  })))


};const deleteJob=async()=>{
  const confirmed=window.confirm(
    `Permanently delete job ${job.job_number}? This cannot be undone.`
  )
  if(!confirmed)return

  const {error}=await supabase!
    .from('jobs')
    .delete()
    .eq('id',job.id)

  if(error){
    alert(error.message)
    return
  }

  await onRefresh()
  window.location.reload()
}

 return <section className="panel">
   <div className="form-grid">
    <label>Job number<input disabled={!admin} value={form.job_number} onChange={e=>setForm({...form,job_number:e.target.value})}/></label>
   {admin ? (
  <details className="status-dropdown">
    <summary>Status: {form.status}</summary>

    <div className="status-checklist">
      {['Booked','Prep','In Progress','Install Complete','Invoiced','Fitter Paid','Payment Received'].map((status,index,stages)=>(
        <label key={status}>
          <input
            type="checkbox"
            checked={stages.indexOf(form.status)>=index}
            onChange={()=>setForm({...form,status:status as typeof form.status})}
          />
          {status}
        </label>
      ))}
    </div>
  </details>
) : (
  <div><strong>Status:</strong> {form.status}</div>
)}

    <label>Install date<input disabled={!admin} type="date" value={form.install_date||''} onChange={e=>setForm({...form,install_date:e.target.value})}/></label>
    <label>Customer<input disabled={!admin} value={form.customer} onChange={e=>setForm({...form,customer:e.target.value})}/></label>
    <label>Site<select disabled={!admin} value={form.site_id||''} onChange={e=>setForm({...form,site_id:e.target.value})}><option value="">Private / no site</option>{sites.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
    <label>Plot<input disabled={!admin} value={form.plot||''} onChange={e=>setForm({...form,plot:e.target.value})}/></label>
    <label>PO number<input disabled={!admin} value={form.po_number||''} onChange={e=>setForm({...form,po_number:e.target.value})}/></label>
    <label>Flooring<input disabled={!admin} value={form.flooring_type} onChange={e=>setForm({...form,flooring_type:e.target.value})}/></label>
    <label className="span2">Address<input disabled={!admin} value={form.address||''} onChange={e=>setForm({...form,address:e.target.value})}/></label>
    <label className="span2">Access notes<textarea value={form.access_notes||''} onChange={e=>setForm({...form,access_notes:e.target.value})}/></label>
    <label className="span2">Installation instructions<textarea value={form.instructions||''} onChange={e=>setForm({...form,instructions:e.target.value})}/></label>
   </div>
   <div className="row gap wrap"><button className="button" onClick={save}>Save changes</button>{admin&&<button className="button secondary danger-outline" onClick={deleteJob}>Delete job</button>}</div>
   {admin&&<div className="subsection"><h3>Assigned fitters</h3><div className="chips">{assignments.map(a=><span className="chip" key={a.fitter_id}>{a.fitter_name||a.fitter_id}<button type="button" onClick={()=>unassign(a.fitter_id)} style={{marginLeft:'10px',padding:'4px 10px',border:'1px solid #dc2626',borderRadius:'6px',background:'#dc2626',color:'white',cursor:'pointer',fontWeight:700}}>Remove</button></span>)}</div><div className="row gap"><select value={fitter} onChange={e=>setFitter(e.target.value)}><option value="">Choose fitter…</option>{profiles.filter(p=>p.role==='fitter'&&p.active).map(p=><option value={p.id} key={p.id}>{p.full_name}</option>)}</select><button className="button secondary" onClick={assign}>Assign</button></div></div>}
 </section>
}

function NotesTab({job,admin}:{job:Job,admin:boolean}){
 const [notes,setNotes]=useState<Note[]>([]),[body,setBody]=useState(''),[visibility,setVisibility]=useState<'team'|'internal'>('team')
 const load=()=>supabase!.from('job_notes').select('*').eq('job_id',job.id).order('created_at',{ascending:false}).then(({data})=>setNotes(data||[]))
 useEffect(()=>{load()},[job.id])
 const deleteNote=async(id:string)=>{
  if(!admin)return
  const confirmed=window.confirm('Permanently delete this note? This cannot be undone.')
  if(!confirmed)return

  const {error}=await supabase!
    .from('job_notes')
    .delete()
    .eq('id',id)

  if(error){
    alert(error.message)
    return
  }

  load()
}
const add=async()=>{if(!body.trim())return;await supabase!.from('job_notes').insert({job_id:job.id,body,visibility:admin?visibility:'team'});setBody('');load()}
 return <section className="panel"><div className="form-grid"><label className="span2">Add job note<textarea value={body} onChange={e=>setBody(e.target.value)} placeholder="Site update, issue, instruction, access note…"/></label>{admin&&<label>Visibility<select value={visibility} onChange={e=>setVisibility(e.target.value as any)}><option value="team">Team</option><option value="internal">Internal only</option></select></label>}</div><button className="button" onClick={add}>Add note</button>
 <div className="timeline">{notes.map(n=><article key={n.id}><span>{new Date(n.created_at).toLocaleString('en-GB')}</span><p>{n.body}</p><small>{n.visibility==='internal'?'Internal only':'Visible to assigned team'}</small>
{admin&&<button
  type="button"
  className="button secondary danger-outline"
  onClick={()=>deleteNote(n.id)}
>
  Delete note
</button>}</article>)}{!notes.length&&<p className="empty">No notes yet.</p>}</div></section>
}

function PhotosTab({job,admin}:{job:Job,admin:boolean}){
 const [files,setFiles]=useState<JobFile[]>([]),[category,setCategory]=useState('Before Installation'),[note,setNote]=useState(''),[busy,setBusy]=useState(false)
 const load=()=>supabase!.from('job_files').select('*').eq('job_id',job.id).order('created_at',{ascending:false}).then(({data})=>setFiles(data||[]))
 useEffect(()=>{load()},[job.id])
 const upload=async(e:React.ChangeEvent<HTMLInputElement>)=>{
   const file=e.target.files?.[0];if(!file)return;setBusy(true)
   try{
     const safe=file.name.replace(/[^a-zA-Z0-9._-]/g,'_'),path=`${job.id}/${crypto.randomUUID()}-${safe}`
     const {error}=await supabase!.storage.from('job-files').upload(path,file,{upsert:false})
     if(error)throw error
     const {error:dbErr}=await supabase!.from('job_files').insert({job_id:job.id,category,file_name:file.name,storage_path:path,note:note||null})
     if(dbErr)throw dbErr
     setNote('');await load()
   }catch(err:any){alert(err.message)}finally{setBusy(false);e.target.value=''}
 }
 const open=async(f:JobFile)=>{const {data,error}=await supabase!.storage.from('job-files').createSignedUrl(f.storage_path,60);if(error)alert(error.message);else window.open(data.signedUrl,'_blank')}
const deletePhoto=async(f:JobFile)=>{
  if(!admin)return

  const confirmed=window.confirm('Permanently delete this photo? This cannot be undone.')
  if(!confirmed)return

  const {error:storageError}=await supabase!.storage
    .from('job-files')
    .remove([f.storage_path])

  if(storageError){
    alert(storageError.message)
    return
  }

  const {error}=await supabase!
    .from('job_files')
    .delete()
    .eq('id',f.id)

  if(error){
    alert(error.message)
    return
  }

  await load()
} 
return <section className="panel"><div className="upload-row"><label>Category<select value={category} onChange={e=>setCategory(e.target.value)}><option>Before Installation</option><option>Preparation</option><option>Installation</option><option>Completed Work</option><option>Snags / Problems</option><option>Document</option></select></label><label>Note<input value={note} onChange={e=>setNote(e.target.value)} placeholder="Optional description"/></label><label className="file-button button">{busy?'Uploading…':'Upload photo / file'}<input type="file" accept="image/*,.pdf" onChange={upload} disabled={busy}/></label></div>
 <div className="file-grid">{files.map(f=><div key={f.id} className="file-card" onClick={()=>open(f)}><Camera/><div><strong>{f.category}</strong><span>{f.file_name}</span><small>{f.note||new Date(f.created_at).toLocaleString('en-GB')}</small>{admin&&<button
  type="button"
  className="button secondary danger-outline"
  onClick={(e)=>{
    e.stopPropagation()
    deletePhoto(f)
  }}
>
  Delete photo
</button>}</div></div>)}{!files.length&&<p className="empty">No photos or files uploaded yet.</p>}</div></section>
}

function VariationsTab({job,admin,onRefresh}:{job:Job,admin:boolean,onRefresh:()=>Promise<void>}){
 const [items,setItems]=useState<Variation[]>([]),[description,setDescription]=useState(''),[amount,setAmount]=useState('0')
 const load=()=>supabase!.from('variations').select('*').eq('job_id',job.id).order('created_at',{ascending:false}).then(({data})=>setItems(data||[]))
 useEffect(()=>{load()},[job.id])
 const add=async()=>{if(!description.trim())return;await supabase!.from('variations').insert({job_id:job.id,description,amount:Number(amount||0),status:'Pending'});setDescription('');setAmount('0');load()}
 const status=async(id:string,s:string)=>{await supabase!.from('variations').update({status:s}).eq('id',id);load();await onRefresh()}
 return <section className="panel"><div className="form-grid"><label className="span2">Extra work / variation<textarea value={description} onChange={e=>setDescription(e.target.value)} placeholder="e.g. Additional latex required due to subfloor condition"/></label><label>Value (£)<input type="number" step="0.01" value={amount} onChange={e=>setAmount(e.target.value)}/></label></div><button className="button" onClick={add}>Report extra work</button>
 <div className="timeline">{items.map(v=><article key={v.id}><span>{new Date(v.created_at).toLocaleString('en-GB')}</span><p><strong>{v.description}</strong> — {money(v.amount)}</p><div className="row gap"><Status value={v.status}/>{admin&&v.status==='Pending'&&<><button className="button small" onClick={()=>status(v.id,'Approved')}>Approve</button><button className="button small secondary" onClick={()=>status(v.id,'Rejected')}>Reject</button></>}</div></article>)}{!items.length&&<p className="empty">No variations recorded.</p>}</div></section>
}

function JobPayments({job,onRefresh}:{job:Job,onRefresh:()=>Promise<void>}){
 const [f,setF]=useState(job)
 const save=async()=>{const {site_name,created_at,...rest}=f as any;await supabase!.from('jobs').update({contract_value:rest.contract_value,extras_value:rest.extras_value,invoiced_value:rest.invoiced_value,paid_value:rest.paid_value,fitter_payment_due:rest.fitter_payment_due,fitter_payment_status:rest.fitter_payment_status}).eq('id',job.id);await onRefresh()}
 return <section className="panel"><div className="metrics mini"><Metric label="Job total" value={money(Number(f.contract_value)+Number(f.extras_value))}/><Metric label="Customer outstanding" value={money(Number(f.invoiced_value)-Number(f.paid_value))}/><Metric label="Fitters due" value={money(f.fitter_payment_due)}/></div>
 <div className="form-grid">{[['Contract value','contract_value'],['Extras / variations','extras_value'],['Invoiced','invoiced_value'],['Customer paid','paid_value'],['Fitter payment due','fitter_payment_due']].map(([label,key])=><label key={key}>{label} (£)<input type="number" step="0.01" value={(f as any)[key]} onChange={e=>setF({...f,[key]:Number(e.target.value)})}/></label>)}<label>Fitter payment status<select value={f.fitter_payment_status} onChange={e=>setF({...f,fitter_payment_status:e.target.value as any})}><option>Due</option><option>Approved</option><option>Paid</option></select></label></div><button className="button" onClick={save}>Save payments</button></section>
}

function ChecklistTab({job}:{job:Job}){
 const [state,setState]=useState<Record<string,boolean>>({})
 const items=checklistFor(job.flooring_type)
 const prefix=job.flooring_type.toLowerCase().replace(/[^a-z0-9]+/g,'_')
 useEffect(()=>{supabase!.from('job_checklist_items').select('*').eq('job_id',job.id).then(({data})=>{const s:Record<string,boolean>={};(data||[]).forEach((x:any)=>s[x.item_key]=x.completed);setState(s)})},[job.id])
 const toggle=async(i:number,v:boolean)=>{const key=`${prefix}_${i}`;setState(s=>({...s,[key]:v}));const {error}=await supabase!.from('job_checklist_items').upsert({job_id:job.id,item_key:key,label:items[i],completed:v},{onConflict:'job_id,item_key'});if(error)alert(error.message)}
 const done=items.filter((_,i)=>Boolean(state[`${prefix}_${i}`])).length
 const pct=Math.round(done/items.length*100)
 return <section className="panel"><div className="panel-head"><div><h2>{job.flooring_type} completion checklist</h2><p>{done} of {items.length} checks complete</p></div><strong className="progress-num">{pct}%</strong></div><div className="progress"><span style={{width:`${pct}%`}}/></div>
 <div className="checklist">{items.map((x,i)=><label key={i}><input type="checkbox" checked={Boolean(state[`${prefix}_${i}`])} onChange={e=>toggle(i,e.target.checked)}/><span>{x}</span></label>)}</div></section>
}

function SignoffTab({job}:{job:Job}){
 const [saved,setSaved]=useState<JobFile[]>([])
 const load=()=>supabase!.from('job_files').select('*').eq('job_id',job.id).eq('category','Signature').order('created_at',{ascending:false}).then(({data})=>setSaved(data||[]))
 useEffect(()=>{load()},[job.id])
 const save=async(blob:Blob)=>{const path=`${job.id}/signatures/${crypto.randomUUID()}.png`;const {error}=await supabase!.storage.from('job-files').upload(path,blob,{contentType:'image/png'});if(error)throw error;await supabase!.from('job_files').insert({job_id:job.id,category:'Signature',file_name:'completion-signature.png',storage_path:path,note:'Completion sign-off'});await load()}
 return <section className="panel"><h2>Completion sign-off</h2><p>Ask the customer or site manager to sign below. The signature is stored securely against this job.</p><SignaturePad onSave={save}/>{saved.length>0&&<div className="success"><CheckCircle2/> {saved.length} signature{saved.length===1?'':'s'} saved against this job.</div>}</section>
}

function Status({value}:{value:string}){return <span className={'status s-'+value.toLowerCase().replaceAll(' ','-')}>{value}</span>}
function NavButton({icon,label,active,onClick}:{icon:any,label:string,active:boolean,onClick:()=>void}){return <button className={active?'nav active':'nav'} onClick={onClick}>{icon}<span>{label}</span></button>}