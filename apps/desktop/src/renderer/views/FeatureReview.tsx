import {useEffect,useRef,useState} from 'react';
import type {FormEvent} from 'react';
import type {Params} from '../../shared/bridge-contract.ts';
import {record} from '../../shared/input.ts';
import type {Desktop} from '../state/desktop.ts';
import {ConfirmationDialog,type PreparedAction} from '../components/ConfirmationDialog.tsx';

const stateLabels:Record<string,string>={
 DRAFT:'Bozza',CHECKING:'Controlli in corso',CHANGES_REQUESTED:'Modifiche richieste',
 READY_FOR_APPROVAL:'Attende approvazione',BLOCKED:'Bloccata',STALE:'Superata',APPROVED:'Approvata',
};
const rows=(v:unknown)=>Array.isArray(v)?v.map(record):[];
const checkLabels:Record<string,string>={NOT_RUN:'Non verificato',PASS:'Superato',FAIL:'Fallito',BLOCKED:'Bloccato'};

export function FeatureReview({desktop,onEnvironment}:{desktop:Desktop;onEnvironment(workspaceId:string):void}){
 const {core,invoke}=desktop;
 const [projects,setProjects]=useState<Params[]>([]),[projectId,setProjectId]=useState('');
 const [items,setItems]=useState<Params[]>([]),[selected,setSelected]=useState('');
 const [nextCursor,setNextCursor]=useState<string|null>(null),[detail,setDetail]=useState<Params|null>(null);
 const [criteria,setCriteria]=useState<Params[]>([]),[criteriaCursor,setCriteriaCursor]=useState<string|null>(null);
 const [freshness,setFreshness]=useState<string|null>(null),[loading,setLoading]=useState(false);
 const [diff,setDiff]=useState<{id:string;offset:number;text:string;cursor:string|null}|null>(null);
 const [candidateDetail,setCandidateDetail]=useState<{candidate:Params;decisionId:string|null;integration:Params|null;evidenceDigest:string}|null>(null);
 const [methods,setMethods]=useState<string[]>([]),[creating,setCreating]=useState(false);
 const [commands,setCommands]=useState<Params[]>([]),[checked,setChecked]=useState<string[]>([]);
 const [prepared,setPrepared]=useState<PreparedAction|null>(null),[receipt,setReceipt]=useState<Params|null>(null),[busy,setBusy]=useState(false);
 const trigger=useRef<HTMLElement|null>(null);
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
   setDetail(null);setDiff(null);setItems([]);setSelected('');setFreshness(null);setNextCursor(null);setCriteria([]);setCriteriaCursor(null);
   setCreating(false);setReceipt(null);setCandidateDetail(null);
   if(projectId)void list(projectId);
 },[projectId]);
 async function list(projectId:string,cursor?:string){
   const token=++generation.current;setLoading(true);
   try{
     const result=await core('listFeatureReviews',{projectId,...(cursor?{cursor}:{})});
     if(token!==generation.current||result?.result!=='OK')return;
     if(!cursor){
       const status=await core('status'),cap=status?.data.capabilities as Params|undefined;
       if(token!==generation.current)return;
       setMethods(status?.liveness==='LIVE_VERIFIED'&&cap?.reviewVersion===1&&Array.isArray(cap.reviewMethods)?cap.reviewMethods as string[]:[]);
     }
     setItems(items=>cursor?[...items,...rows(result.data.items)]:rows(result.data.items));
     setNextCursor(typeof result.data.nextCursor==='string'?result.data.nextCursor:null);setFreshness(result.freshness);
   }finally{if(token===generation.current)setLoading(false);}
 }
 async function show(reviewId:string,cursor?:string){
   const token=++generation.current;
   if(!cursor){setSelected(reviewId);setDetail(null);setDiff(null);setCriteria([]);setCriteriaCursor(null);setCommands([]);setChecked([]);setCandidateDetail(null);}
   setLoading(true);
   try{
     const r=await core('getFeatureReview',{reviewId,...(cursor?{cursor}:{})});
     if(token===generation.current&&r?.result==='OK'){
       setDetail(record(r.data.review));setFreshness(r.freshness);
       const candidate=r.data.candidate?record(r.data.candidate):null;
       setCandidateDetail(candidate?{candidate,decisionId:typeof r.data.decisionId==='string'?r.data.decisionId:null,
         integration:r.data.integration?record(r.data.integration):null,evidenceDigest:String(r.data.evidenceDigest)}:null);
       setCriteria(previous=>cursor?[...previous,...rows(r.data.criteria)]:rows(r.data.criteria));
       setCriteriaCursor(typeof r.data.nextCursor==='string'?r.data.nextCursor:null);
       if(!cursor&&r.freshness==='LIVE'&&methods.includes('review.validate')){
         const environment=await core('getEnvironment',{workspaceId:candidate?.stagingId??record(r.data.review).workspaceId});
         const plan=environment?.result==='OK'&&environment.data.plan?record(environment.data.plan):null;
         if(token===generation.current)setCommands(plan?rows(plan.commands):[]);
       }
     }
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
 const can=(action:string)=>freshness==='LIVE'&&methods.includes(`review.${action}`);
 async function prepare(params:Params,button:HTMLElement|null,feedback?:string){
   const token=generation.current;
   trigger.current=button;setBusy(true);setReceipt(null);
   try{
     if(feedback&&detail){
       const imported=await invoke('importFeatureAnswer',{featureId:detail.featureId,answerText:feedback});
       if(token!==generation.current||!imported)return;
       const result=record(record(imported).result),data=record(result.data),operation=data.operation?record(data.operation):null;
       const artifactId=operation?.result?record(operation.result).artifactId:null;
       if(typeof artifactId!=='string'){desktop.setNotice('Il feedback non è stato sigillato. Consulta le operazioni.');return;}
       params={...params,feedbackArtifactId:artifactId};
     }
     const action=await invoke('prepareReviewAction',{params}) as PreparedAction|null;
     if(!action)return;
     if(token===generation.current)setPrepared(action);
     else await invoke('cancelReviewAction',{confirmationId:action.confirmationId});
   }finally{setBusy(false);}
 }
 async function finish(confirm:boolean){
   if(!prepared)return;
   const token=generation.current;setBusy(true);
   try{
     const result=await invoke(confirm?'confirmReviewAction':'cancelReviewAction',{confirmationId:prepared.confirmationId});
     if(token!==generation.current)return;
     setPrepared(null);
     if(confirm&&result){
       setReceipt(record(record(result).receipt));
       const operation=record(record(result).result);
       if(prepared.action==='review.create'&&operation.outcome==='SUCCEEDED'){
         setCreating(false);await list(projectId);
       }else if(selected)await show(selected);
     }
   }finally{setBusy(false);}
 }
 function create(event:FormEvent<HTMLFormElement>){
   event.preventDefault();
   const values=new FormData(event.currentTarget),submitter=(event.nativeEvent as SubmitEvent).submitter;
   void prepare({action:'create',projectId,featureId:values.get('featureId'),checkpointId:values.get('checkpointId'),
     targetRef:values.get('targetRef'),targetOid:values.get('targetOid')},submitter);
 }
 return <section aria-label="Revisioni delle feature">
   <div className="toolbar">
     <label>Progetto <select value={projectId} disabled={projects.length===0||busy}
       onChange={e=>{generation.current++;setProjectId(e.target.value);}}>
       {projects.length===0&&<option value="">Nessun progetto disponibile</option>}
       {projects.map(p=><option key={String(p.projectId)} value={String(p.projectId)}>{String(p.displayName??p.projectId)}</option>)}
     </select></label>
     <button className="button subtle" disabled={!projectId||loading||busy} onClick={()=>void list(projectId)}>Aggiorna revisioni</button>
     <button className="button subtle" disabled={!projectId||loading||busy||!can('create')} onClick={()=>setCreating(value=>!value)}>Nuova revisione</button>
   </div>
   {freshness==='LAST_KNOWN'&&<p className="hint">Ultimo stato registrato. Servizio offline.</p>}
   {receipt&&<p role="status">Operazione {String(receipt.requestId)} · {String(receipt.outcome??receipt.phase)}</p>}
   {creating&&can('create')&&<form className="detail-panel" aria-label="Crea revisione" onSubmit={create}>
     <label>Feature <input name="featureId" required maxLength={36}/></label>
     <label>Checkpoint <input name="checkpointId" required maxLength={36}/></label>
     <label>Ref target <input name="targetRef" required maxLength={266} placeholder="refs/heads/main"/></label>
     <label>Commit target <input name="targetOid" required maxLength={64}/></label>
     <button className="button primary" disabled={busy}>Prepara snapshot</button>
   </form>}
   {freshness&&items.length===0&&<p>Nessuna revisione per questo progetto.</p>}
   <div className="split-layout">
     <ul className="project-list" aria-label="Revisioni">
       {items.map(item=><li key={String(item.reviewId)}><button type="button" className="project-row" aria-current={selected===item.reviewId?'true':undefined} disabled={busy||loading}
         onClick={()=>void show(String(item.reviewId))}>{String(item.targetRef).replace(/^refs\/heads\//,'')}
         <span className="hint"> {stateLabels[String(item.state)]??String(item.state)}</span></button></li>)}
       {nextCursor&&<li><button className="button subtle" disabled={loading} onClick={()=>void list(projectId,nextCursor)}>Altre revisioni</button></li>}
     </ul>
     {detail&&<article className="detail-panel" aria-label="Dettaglio revisione">
       <h3>{String(detail.targetRef).replace(/^refs\/heads\//,'')}</h3>
       <button className="button subtle" disabled={loading||busy} onClick={()=>void show(String(detail.reviewId))}>Aggiorna dettaglio</button>
       <dl><dt>Stato</dt><dd>{stateLabels[String(detail.state)]??String(detail.state)}</dd>
         <dt>Commit sorgente</dt><dd>{String(detail.sourceOid)}</dd><dt>Commit target</dt><dd>{String(detail.targetOid)}</dd>
         <dt>File modificati</dt><dd>{String(detail.fileCount)}</dd></dl>
       {candidateDetail&&<>
         <dl><dt>Commit candidate</dt><dd>{String(candidateDetail.candidate.candidateOid)}</dd>
           <dt>Tree</dt><dd>{String(candidateDetail.candidate.treeOid)}</dd>
           {candidateDetail.integration&&<><dt>Integrazione locale</dt><dd>{String(candidateDetail.integration.phase)}</dd></>}
         </dl>
         <div className="row-actions">
           <button className="button subtle" disabled={busy||loading} onClick={()=>onEnvironment(String(candidateDetail.candidate.stagingId))}>Apri ambiente candidate</button>
           {can('approve')&&<button className="button subtle" disabled={busy||loading||detail.state!=='READY_FOR_APPROVAL'}
             onClick={e=>void prepare({action:'approve',projectId,reviewId:detail.reviewId,candidateId:candidateDetail.candidate.candidateId,
               evidenceDigest:candidateDetail.evidenceDigest,stateRevision:detail.stateRevision},e.currentTarget)}>Prepara approvazione candidate</button>}
           {can('integrate')&&<button className="button primary" disabled={busy||loading||!candidateDetail.decisionId||!!candidateDetail.integration}
             onClick={e=>void prepare({action:'integrate',projectId,reviewId:detail.reviewId,candidateId:candidateDetail.candidate.candidateId,
               decisionId:candidateDetail.decisionId,expectedTargetOid:detail.targetOid,stateRevision:detail.stateRevision},e.currentTarget)}>Prepara integrazione locale</button>}
         </div>
       </>}
       {!candidateDetail&&can('candidate.prepare')&&<button className="button subtle" disabled={busy||loading||!['DRAFT','READY_FOR_APPROVAL','BLOCKED','CHANGES_REQUESTED'].includes(String(detail.state))}
         onClick={e=>void prepare({action:'candidate.prepare',projectId,reviewId:detail.reviewId,stateRevision:detail.stateRevision},e.currentTarget)}>Prepara candidate</button>}
       {criteria.length>0&&<>
         <h4>Criteri di accettazione</h4>
         <ul>{criteria.map(item=><li key={String(item.criterionId)}>
           <strong>{String(item.text??item.criterionId)}</strong> · {checkLabels[String(item.status)]}
           {item.required===true&&<span className="hint"> · Obbligatorio</span>}
           {typeof item.verification==='string'&&<p>{item.verification}</p>}
           {item.evidence&&record(item.evidence).outputId?<button className="button subtle" disabled={loading||busy}
             onClick={()=>void part(String(record(item.evidence).outputId))}>Apri prova</button>:null}
         </li>)}</ul>
         {criteriaCursor&&<button className="button subtle" disabled={loading}
           onClick={()=>void show(String(detail.reviewId),criteriaCursor)}>Altri criteri</button>}
       </>}
       <div className="row-actions">{rows(detail.parts).map((item,i)=><button type="button" className="button subtle" key={String(item.artifactId)} disabled={loading}
         onClick={()=>void part(String(item.artifactId))}>Apri diff {i+1}</button>)}</div>
       {diff&&<><p className="hint">Offset {diff.offset}</p><pre className="detail-output">{diff.text}</pre>
         {diff.cursor&&<button type="button" className="button subtle" disabled={loading} onClick={()=>void part(diff.id,diff.cursor!)}>Pagina successiva</button>}</>}
       {can('validate')&&commands.length>0&&<fieldset disabled={loading||busy||!['DRAFT','READY_FOR_APPROVAL','BLOCKED'].includes(String(detail.state))}>
         <legend>Controlli dal piano ambiente</legend>
         {commands.map(command=>{
           const id=String(command.id);
           return <label key={id}><input type="checkbox" checked={checked.includes(id)}
             onChange={e=>{const enabled=e.target.checked;setChecked(values=>enabled?[...values,id]:values.filter(value=>value!==id));}}/> {String(command.entry)}</label>;
         })}
         <button className="button subtle" disabled={!checked.length} onClick={e=>void prepare({action:'validate',projectId,reviewId:detail.reviewId,
           stateRevision:detail.stateRevision,commandSpecIds:checked},e.currentTarget)}>Prepara controlli</button>
       </fieldset>}
       {can('request-changes')&&<form aria-label="Feedback" onSubmit={event=>{
         event.preventDefault();
         const value=String(new FormData(event.currentTarget).get('feedback')??'').trim();
         if(value&&new TextEncoder().encode(value).length<=4096)void prepare({action:'request-changes',projectId,reviewId:detail.reviewId,
           stateRevision:detail.stateRevision},(event.nativeEvent as SubmitEvent).submitter,value);
       }}><fieldset disabled={loading||busy||['CHECKING','STALE','APPROVED'].includes(String(detail.state))}>
         <label>Feedback <textarea name="feedback" required maxLength={4096}/></label>
         <button className="button subtle">Prepara richiesta di modifiche</button>
       </fieldset></form>}
     </article>}
   </div>
   {prepared&&<ConfirmationDialog prepared={prepared} busy={busy} onConfirm={()=>void finish(true)} onCancel={()=>void finish(false)} returnFocus={()=>trigger.current}/>}
 </section>;
}
