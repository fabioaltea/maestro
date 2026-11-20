import {useEffect,useRef,useState} from 'react';
import type {BridgeMethod,Params} from '../../shared/bridge-contract.ts';
import {record} from '../../shared/input.ts';
import {ConfirmationDialog,type PreparedAction} from '../components/ConfirmationDialog.tsx';
import type {Desktop} from '../state/desktop.ts';

const labels:Record<string,string>={CREATED:'In avvio',RUNNING:'In esecuzione',WAITING_USER:'In attesa di risposta',PAUSING:'Sospensione in corso',
 PAUSED:'In pausa',CANCELLING:'Annullamento in corso',CANCELLED:'Annullata',READY_FOR_REVIEW:'Pronta per la revisione',
 FAILED:'Fallita',INTERRUPTED:'Interrotta',RECONCILING:'Uscita da riconciliare'};
function rows(value:unknown):Params[]{return Array.isArray(value)?value.map(record):[];}
export function Sessions({desktop,onOperations}:{desktop:Desktop;onOperations():void}){
 const {core,invoke}=desktop;
 const [projects,setProjects]=useState<Params[]>([]),[projectId,setProjectId]=useState('');
 const [items,setItems]=useState<Params[]>([]),[next,setNext]=useState<string|null>(null),[sessionId,setSessionId]=useState('');
 const [detail,setDetail]=useState<Params|null>(null),[methods,setMethods]=useState<string[]>([]),[freshness,setFreshness]=useState<string|null>(null);
 const [prepared,setPrepared]=useState<PreparedAction|null>(null),[receipt,setReceipt]=useState<Params|null>(null);
 const [busy,setBusy]=useState(false),[answerArtifactId,setAnswerArtifactId]=useState('');
 const [chunkPage,setChunkPage]=useState<Params|null>(null),[text,setText]=useState<string|null>(null);
 const [starting,setStarting]=useState(false),[startInput,setStartInput]=useState({featureId:'',workspaceId:'',profileResolutionId:'',envelopeId:''});
 const [pageLoaded,setPageLoaded]=useState(false);
 const alive=useRef(false),target=useRef(0),readVersion=useRef(0),trigger=useRef<HTMLElement|null>(null);
 useEffect(()=>{
   alive.current=true;
   void (async()=>{
     const reply=await core('listProjects');
     if(!alive.current||reply?.result!=='OK')return;
     const projects=rows(reply.data.projects);
     setProjects(projects);setProjectId(String(projects[0]?.projectId??''));
   })();
   return()=>{alive.current=false;target.current++;readVersion.current++;};
 },[core]);
 useEffect(()=>{
   setItems([]);setNext(null);setSessionId('');setDetail(null);setReceipt(null);setText(null);setChunkPage(null);setPageLoaded(false);
   void refresh(projectId,'');
 },[projectId]);
 const available=(action:string)=>methods.includes(`execution.${action}`);
 const selection=()=>target.current;
 const current=(epoch:number)=>alive.current&&selection()===epoch;
 function select(id:string){
   target.current++;setSessionId(id);setDetail(null);setText(null);setChunkPage(null);setAnswerArtifactId('');
   void refresh(projectId,id);
 }
 async function refresh(project:string,id:string,cursor?:string){
   const epoch=selection(),request=++readVersion.current;
   const valid=()=>current(epoch)&&request===readVersion.current;
   const status=await core('status');
   if(!valid())return;
   const caps=status?.data.capabilities as Params|undefined;
   setMethods(status?.liveness==='LIVE_VERIFIED'&&status.freshness==='LIVE'&&caps?.executionVersion===1&&Array.isArray(caps.executionMethods)
     ?caps.executionMethods.filter((v):v is string=>typeof v==='string'):[]);
   if(!project)return;
   const list=await core('listExecutionSessions',{projectId:project,...(cursor?{cursor}:{})});
   if(!valid())return;
   if(list?.result==='OK'){
     const nextPage=rows(list.data.items);
     setItems(prior=>cursor?[...prior,...nextPage]:nextPage);
     setNext(typeof list.data.nextCursor==='string'?list.data.nextCursor:null);setPageLoaded(true);setFreshness(list.freshness);
   }
   if(id){
     const response=await core('getExecutionSession',{sessionId:id});
     if(valid()&&response?.result==='OK')setDetail(response.data);
   }
 }
 async function prepare(action:string,params:Params){
   const epoch=selection();setBusy(true);setReceipt(null);
   try{
     const result=await invoke('prepareExecutionAction',{params:{action,...params}}) as PreparedAction|null;
     if(!result)return;
     if(current(epoch))setPrepared(result);
     else if(alive.current)await invoke('cancelExecutionAction',{confirmationId:result.confirmationId});
   }finally{if(current(epoch))setBusy(false);}
 }
 async function finish(confirm:boolean){
   if(!prepared)return;
   const epoch=selection();setBusy(true);
   try{
     const result=await invoke(confirm?'confirmExecutionAction':'cancelExecutionAction',{confirmationId:prepared.confirmationId});
     if(!current(epoch))return;
     setPrepared(null);
     if(confirm&&result){
       const r=record(record(result).receipt);setReceipt(r);
       const resultData=record(record(record(result).result).data),op=resultData.operation?record(resultData.operation):null;
       const ids=op?.result?record(op.result):null;
       if(prepared.action==='execution.start'&&typeof ids?.sessionId==='string'){setStarting(false);select(ids.sessionId);}
       else await refresh(projectId,sessionId);
     }
   }finally{if(alive.current)setBusy(false);}
 }
 async function read(method:BridgeMethod,params:Params,apply:(data:Params)=>void){
   const epoch=selection(),nextRead=++readVersion.current,r=await core(method,params);
   if(current(epoch)&&nextRead===readVersion.current&&r?.result==='OK')apply(r.data);
 }
 async function preview(artifactId:unknown){
   await read('getExecutionArtifact',{artifactId},data=>{
     const bytes=Uint8Array.from(atob(String(data.base64)),value=>value.charCodeAt(0));
     setText(new TextDecoder().decode(bytes));
   });
 }
 const s=detail?.session?record(detail.session):null,r=detail?.run?record(detail.run):null;
 const q=rows(detail?.interactions).find(interaction=>interaction.status==='OPEN'&&interaction.type==='QUESTION');
 const checkpoint=detail?.checkpoint?record(detail.checkpoint):null;
 const state=String(s?.state??''),terminal=['PAUSED','INTERRUPTED','CANCELLED','READY_FOR_REVIEW'].includes(state);
 const controls={sessionId,expectedStateRevision:s?.stateRevision};
 const action=(name:string,label:string,params:Params)=><button className="button subtle" disabled={busy||!available(name)}
   onClick={event=>{trigger.current=event.currentTarget;void prepare(name,params);}}>{label}</button>;
 return <section aria-label="Sessioni agente">
   <div className="toolbar">
     <label>Progetto <select value={projectId} disabled={busy||projects.length===0}
       onChange={event=>{target.current++;setProjectId(event.target.value);}}>
       {projects.length===0&&<option value="">Nessun progetto disponibile</option>}
       {projects.map(project=><option key={String(project.projectId)} value={String(project.projectId)}>{String(project.displayName??project.projectId)}</option>)}
     </select></label>
     <button className="button subtle" disabled={busy} onClick={()=>void refresh(projectId,sessionId)}>Aggiorna</button>
     <button className="button primary" disabled={!projectId||busy||!available('start')} onClick={()=>setStarting(value=>!value)}>Nuova sessione</button>
   </div>
   {freshness==='LAST_KNOWN'?<p className="hint">Dati dell’ultimo stato registrato. Servizio offline.</p>:
     !available('start')&&<p className="hint">L’avvio richiede un provider con esecuzione qualificata.</p>}
   {receipt&&<p role="status">Operazione {String(receipt.requestId)} · {String(receipt.phase)} <button className="text-button" onClick={onOperations}>Apri operazioni</button></p>}
   {starting&&available('start')&&<form className="detail-panel" onSubmit={event=>{event.preventDefault();void prepare('start',startInput);}}>
     {([['featureId','ID feature approvata'],['workspaceId','ID workspace'],['profileResolutionId','ID risoluzione profilo'],
       ['envelopeId','ID handoff']] as const).map(([key,label])=><label key={key}>{label}
         <input required maxLength={36} value={startInput[key]} onChange={event=>setStartInput({...startInput,[key]:event.target.value})}/>
       </label>)}
     <button className="button primary" disabled={busy} onClick={event=>{trigger.current=event.currentTarget;}}>Rivedi avvio</button>
   </form>}
   {pageLoaded&&items.length===0&&<p>Nessuna sessione per questo progetto.</p>}
   <div className="split-layout">
     <ul className="project-list" aria-label="Sessioni del progetto">
       {items.map(item=><li key={String(item.sessionId)}><button className="project-row" aria-current={sessionId===item.sessionId?'true':undefined}
         disabled={busy} onClick={()=>select(String(item.sessionId))}>{labels[String(item.state)]??String(item.state)}
         <span className="hint"> {new Date(String(item.updatedAt)).toLocaleString('it-IT')}</span></button></li>)}
       {next&&<li><button className="button subtle" disabled={busy} onClick={()=>void refresh(projectId,sessionId,next)}>Altre sessioni</button></li>}
     </ul>
     {s&&r&&<div className="detail-panel">
       <h3>{labels[state]??state}</h3>
       <dl><dt>Sessione</dt><dd>{sessionId}</dd><dt>Provider</dt><dd>{String(r.providerId)}</dd><dt>Run</dt><dd>{String(r.runId)}</dd></dl>
       <div className="row-actions">
         {['CREATED','RUNNING','WAITING_USER'].includes(state)&&<>{action('pause','Metti in pausa',controls)}{action('cancel','Annulla run',controls)}</>}
         {terminal&&action('checkpoint','Salva checkpoint',controls)}
         {checkpoint&&['PAUSED','INTERRUPTED'].includes(state)&&action('resume','Riprendi',{sessionId,checkpointId:checkpoint.checkpointId,
           providerId:r.providerId,stateRevision:s.stateRevision})}
         {state==='RECONCILING'&&action('reconcile','Riconcilia', {sessionId})}
         <button className="button subtle" onClick={()=>void read('listExecutionOutput',{runId:r.runId},setChunkPage)}>Leggi output</button>
       </div>
       {q&&<section aria-label="Domanda del run"><button className="text-button" onClick={()=>void preview(q.textArtifactId)}>Leggi la domanda</button>
         <label>Artefatto risposta <input maxLength={36} disabled={!available('answer')} value={answerArtifactId}
           onChange={event=>setAnswerArtifactId(event.target.value)}/></label>
         {action('answer','Invia risposta',{interactionId:q.interactionId,expectedRevision:q.expectedRevision,answerArtifactId})}
       </section>}
       {checkpoint&&<button className="text-button" onClick={()=>void preview(checkpoint.patchArtifactId)}>Leggi checkpoint</button>}
       {chunkPage&&<div aria-label="Output del run">
         {chunkPage.truncated===true&&<p className="hint">Limite di output raggiunto.</p>}
         {rows(chunkPage.chunks).map(chunk=><button className="text-button" key={String(chunk.seq)}
           onClick={()=>void preview(chunk.artifactId)}>Blocco {String(chunk.seq)}</button>)}
         {typeof chunkPage.nextCursor==='string'&&String(rows(chunkPage.chunks).at(-1)?.seq??'0')!==chunkPage.watermark&&
           <button className="button subtle" onClick={()=>void read('listExecutionOutput',{runId:r.runId,cursor:chunkPage.nextCursor},setChunkPage)}>Altri blocchi</button>}
       </div>}
       {text!==null&&<pre className="detail-output">{text}</pre>}
     </div>}
   </div>
   {prepared&&<ConfirmationDialog prepared={prepared} busy={busy} onConfirm={()=>void finish(true)} onCancel={()=>void finish(false)} returnFocus={()=>trigger.current}/>}
 </section>;
}
