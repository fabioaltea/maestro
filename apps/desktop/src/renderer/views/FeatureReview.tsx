import {useEffect,useRef,useState} from 'react';
import type {Params} from '../../shared/bridge-contract.ts';
import {record} from '../../shared/input.ts';
import type {Desktop} from '../state/desktop.ts';

const stateLabels:Record<string,string>={
 DRAFT:'Bozza',CHECKING:'Controlli in corso',CHANGES_REQUESTED:'Modifiche richieste',
 READY_FOR_APPROVAL:'Attende approvazione',BLOCKED:'Bloccata',STALE:'Superata',APPROVED:'Approvata',
};
const rows=(v:unknown)=>Array.isArray(v)?v.map(record):[];

export function FeatureReview({desktop}:{desktop:Desktop}){
 const {core}=desktop;
 const [projects,setProjects]=useState<Params[]>([]),[projectId,setProjectId]=useState('');
 const [items,setItems]=useState<Params[]>([]),[selected,setSelected]=useState('');
 const [nextCursor,setNextCursor]=useState<string|null>(null),[detail,setDetail]=useState<Params|null>(null);
 const [freshness,setFreshness]=useState<string|null>(null),[loading,setLoading]=useState(false);
 const [diff,setDiff]=useState<{id:string;offset:number;text:string;cursor:string|null}|null>(null);
 const generation=useRef(0);
 useEffect(()=>{
   let alive=true;
   void core('listProjects',{limit:25}).then(reply=>{
     if(!alive||reply?.result!=='OK')return;
     const page=rows(reply.data.projects);setProjects(page);setProjectId(String(page[0]?.projectId??''));
   });
   return()=>{alive=false;generation.current++;};
 },[core]);
 useEffect(()=>{
   setDetail(null);setDiff(null);setItems([]);setSelected('');setFreshness(null);setNextCursor(null);
   if(projectId)void list(projectId);
 },[projectId]);
 async function list(projectId:string,cursor?:string){
   const token=++generation.current;setLoading(true);
   try{
     const result=await core('listFeatureReviews',{projectId,...(cursor?{cursor}:{})});
     if(token!==generation.current||result?.result!=='OK')return;
     setItems(items=>cursor?[...items,...rows(result.data.items)]:rows(result.data.items));
     setNextCursor(typeof result.data.nextCursor==='string'?result.data.nextCursor:null);setFreshness(result.freshness);
   }finally{if(token===generation.current)setLoading(false);}
 }
 async function show(reviewId:string){
   const token=++generation.current;
   setSelected(reviewId);setDetail(null);setDiff(null);setLoading(true);
   try{
     const r=await core('getFeatureReview',{reviewId});
     if(token===generation.current&&r?.result==='OK'){setDetail(record(r.data.review));setFreshness(r.freshness);}
   }finally{if(token===generation.current)setLoading(false);}
 }
 async function part(id:string,cursor?:string){
   const token=++generation.current;setLoading(true);
   try{
     const r=await core('getReviewDiffPart',{artifactId:id,...(cursor?{cursor}:{})});
     if(token!==generation.current||r?.result!=='OK')return;
     setDiff({id,offset:Number(r.data.offset),text:new TextDecoder().decode(Uint8Array.from(atob(String(r.data.base64)),x=>x.charCodeAt(0))),
       cursor:typeof r.data.nextCursor==='string'?r.data.nextCursor:null});
   }finally{if(token===generation.current)setLoading(false);}
 }
 return <section aria-label="Revisioni delle feature">
   <div className="toolbar">
     <label>Progetto <select value={projectId} disabled={projects.length===0}
       onChange={e=>{generation.current++;setProjectId(e.target.value);}}>
       {projects.length===0&&<option value="">Nessun progetto disponibile</option>}
       {projects.map(p=><option key={String(p.projectId)} value={String(p.projectId)}>{String(p.displayName??p.projectId)}</option>)}
     </select></label>
     <button className="button subtle" disabled={!projectId||loading} onClick={()=>void list(projectId)}>Aggiorna revisioni</button>
   </div>
   {freshness==='LAST_KNOWN'&&<p className="hint">Ultimo stato registrato. Servizio offline.</p>}
   {freshness&&items.length===0&&<p>Nessuna revisione per questo progetto.</p>}
   <div className="split-layout">
     <ul className="project-list" aria-label="Revisioni">
       {items.map(item=><li key={String(item.reviewId)}><button type="button" className="project-row" aria-current={selected===item.reviewId?'true':undefined}
         onClick={()=>void show(String(item.reviewId))}>{String(item.targetRef).replace(/^refs\/heads\//,'')}
         <span className="hint"> {stateLabels[String(item.state)]??String(item.state)}</span></button></li>)}
       {nextCursor&&<li><button className="button subtle" disabled={loading} onClick={()=>void list(projectId,nextCursor)}>Altre revisioni</button></li>}
     </ul>
     {detail&&<article className="detail-panel" aria-label="Dettaglio revisione">
       <h3>{String(detail.targetRef).replace(/^refs\/heads\//,'')}</h3>
       <dl><dt>Stato</dt><dd>{stateLabels[String(detail.state)]??String(detail.state)}</dd>
         <dt>Commit sorgente</dt><dd>{String(detail.sourceOid)}</dd><dt>Commit target</dt><dd>{String(detail.targetOid)}</dd>
         <dt>File modificati</dt><dd>{String(detail.fileCount)}</dd></dl>
       <div className="row-actions">{rows(detail.parts).map((item,i)=><button type="button" className="button subtle" key={String(item.artifactId)} disabled={loading}
         onClick={()=>void part(String(item.artifactId))}>Apri diff {i+1}</button>)}</div>
       {diff&&<><p className="hint">Offset {diff.offset}</p><pre className="detail-output">{diff.text}</pre>
         {diff.cursor&&<button type="button" className="button subtle" disabled={loading} onClick={()=>void part(diff.id,diff.cursor!)}>Pagina successiva</button>}</>}
     </article>}
   </div>
 </section>;
}
