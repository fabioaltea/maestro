import {useEffect,useRef,useState} from 'react';
import {record} from '../../shared/input.ts';
import type {Params} from '../../shared/bridge-contract.ts';
import type {Desktop} from '../state/desktop.ts';

const labels:Record<string,string>={QUEUED:'In coda',RESERVED:'Riservato',RUNNING:'In esecuzione',
 WAITING_RESOURCE:'In attesa di risorse',WAITING_PROVIDER:'In attesa del provider',WAITING_USER:'Richiede una decisione',
 PAUSED:'In pausa',CANCELLING:'Annullamento in corso',CANCELLED:'Annullato',SUCCEEDED:'Completato',FAILED:'Fallito',RECONCILING:'Da riconciliare'};

export function SessionQueue({desktop}:{desktop:Desktop}){
 const {core}=desktop,sequence=useRef(0);
 const [queue,setQueue]=useState<Params|null>(null),[loading,setLoading]=useState(false);
 async function load(cursor?:string){
   const version=++sequence.current;setLoading(true);
   try{
     const r=await core('listScheduledJobs',cursor?{cursor}:{});
     if(version!==sequence.current||r?.result!=='OK')return;
     setQueue(previous=>({...r.data,archiveFreshness:r.freshness,...(cursor&&previous?
       {jobs:[...previous.jobs as unknown[],...r.data.jobs as unknown[]]}:{})}));
   }finally{if(version===sequence.current)setLoading(false);}
 }
 useEffect(()=>{void load();return()=>{sequence.current++;};},[core]);
 const jobs=Array.isArray(queue?.jobs)?queue.jobs.map(record):[],policy=queue?.policy?record(queue.policy):null;
 const reservations=Array.isArray(queue?.reservations)?queue.reservations.length:0;
 return <section aria-label="Coda sessioni">
   <div className="toolbar">
     <button className="button subtle" type="button" disabled={loading} onClick={()=>void load()}>Aggiorna coda</button>
   </div>
   {queue?.archiveFreshness==='LAST_KNOWN'&&<p className="hint">Ultimo stato registrato. Servizio offline.</p>}
   {queue?.archiveFreshness==='LIVE'&&queue.dispatchAvailable===false&&<p className="hint">Avvio automatico in attesa di un executor qualificato.</p>}
   {policy&&<p>Reservation attive {reservations} su {String(record(policy.limits).global)}</p>}
   {queue&&jobs.length===0&&<p>Nessun job in coda.</p>}
   {jobs.length>0&&<table className="detail-panel">
     <thead><tr><th>Job</th><th>Stato</th><th>Priorità</th><th>Attesa</th></tr></thead>
     <tbody>{jobs.map(job=><tr key={String(job.jobId)}>
       <th scope="row">{String(job.type)} <span className="hint">{String(job.jobId)}</span></th>
       <td>{labels[String(job.state)]??String(job.state)}</td><td>{String(job.priority)}</td>
       <td>{typeof job.notBefore==='string'?new Date(job.notBefore).toLocaleString('it-IT'):String(job.reason??'—')}</td>
     </tr>)}</tbody>
   </table>}
   {typeof queue?.nextCursor==='string'&&<button className="button subtle" disabled={loading} onClick={()=>void load(String(queue.nextCursor))}>Altri job</button>}
 </section>;
}
