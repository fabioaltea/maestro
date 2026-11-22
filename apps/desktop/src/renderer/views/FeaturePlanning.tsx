import type {WorkspaceSource} from './Workspaces.tsx';
import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {ArrowLeftIcon,ArrowUpIcon,ChevronRightIcon,PlusIcon} from '@radix-ui/react-icons';
import type {Desktop} from '../state/desktop.ts';
import type {Project} from '../state/project-view.ts';
import type {Params,PublicResult} from '../../shared/bridge-contract.ts';
import {record} from '../../shared/validation.ts';
import {ConfirmationDialog,type PreparedAction} from '../components/ConfirmationDialog.tsx';
const template={version:1,title:'Nuova feature',request:'Descrivi la richiesta',specification:{scope:'Definisci l’ambito',users:['Utente'],stories:[{storyId:'US1',text:'Come utente voglio…'}],exclusions:[]},implementationPlan:{approach:'Descrivi il piano',dependencies:[],risks:[]},acceptanceCriteria:[{criterionId:'AC1',storyId:'US1',text:'Risultato osservabile',verification:'Verifica da eseguire',required:true}],provenance:[{kind:'HYPOTHESIS',text:'Da confermare con l’utente',sourceId:null,answerId:null}],unknowns:[]};
const featureStates = new Map([
 ['DRAFT','Bozza'], ['PLANNING','In pianificazione'], ['WAITING_USER','In attesa di risposta'],
 ['READY_FOR_APPROVAL','Da approvare'], ['APPROVED','Approvata'], ['NEEDS_REVIEW','Da rivedere'],
 ['ARCHIVED','Archiviata'], ['INTERRUPTED','Interrotta'], ['RECONCILING','In verifica'],
]);
export interface InterviewExchange { turnId: string; question: string; answer: string }
function ChatMessage({speaker,children}:{speaker:'Maestro'|'Agente di pianificazione'|'Tu';children:string}){
 return <li className="feature-chat-message" data-own={speaker==='Tu'}>
   <strong>{speaker}</strong><p>{children}</p>
 </li>;
}
export function FeaturePlanning({desktop,project,live,canCreate,creationHint,initialFeatureId,conversation,interviews,onExchange,onConversation,onWorkspace}:{
 desktop:Desktop;project:Project;live:boolean;canCreate:boolean;creationHint:string;initialFeatureId:string|null;conversation:boolean;
 interviews:Record<string,InterviewExchange[]>;onExchange(id:string,exchange:InterviewExchange):void;
 onConversation(id:string):void;onWorkspace(source:WorkspaceSource):void;
}){
 const[items,setItems]=useState<Params[]>([]),[cursor,setCursor]=useState<string|null>(null),[selected,setSelected]=useState<Params|null>(null),[revisions,setRevisions]=useState<Params[]>([]),[revisionCursor,setRevisionCursor]=useState<string|null>(null),[bundle,setBundle]=useState(JSON.stringify(template,null,2)),[file,setFile]=useState<{bundleHandle:string;displayName:string}|null>(null),[prepared,setPrepared]=useState<PreparedAction|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[message,setMessage]=useState<string|null>(null),[request,setRequest]=useState<string|null>(null);
 const active=useRef(false),working=useRef(false),version=useRef(0),trigger=useRef<HTMLElement|null>(null),selectedRef=useRef<string|null>(null);
 const [documentInfo,setDocumentInfo]=useState<{revisionId:string;contextSnapshotId:string|null;text:string;request:string;unknowns:Params[]}|null>(null);
 const [acceptedUnknownIds,setAcceptedUnknownIds]=useState<string[]>([]);
 const [approval,setApproval]=useState<Params|null>(null);
 const [eligibility,setEligibility]=useState<Params|null>(null);
 const [envelope,setEnvelope]=useState<Params|null>(null);
 const [qualified,setQualified]=useState(false);
 const [turn,setTurn]=useState<Params|null>(null);
 const [questions,setQuestions]=useState<Params[]>([]);
 const [questionCursor,setQuestionCursor]=useState<string|null>(null);
 const [questionId,setQuestionId]=useState('');
 const [answerText,setAnswerText]=useState('');
 const [mode,setMode]=useState<'list'|'manual'|'chat'>(conversation?'chat':'list');
 const [intakeText,setIntakeText]=useState('');
 const [listState,setListState]=useState<'loading'|'ready'|'error'>('loading');
 const [restoring,setRestoring]=useState(Boolean(initialFeatureId));
 const chatScroll=useRef<HTMLDivElement>(null);
 const{core,invoke}=desktop;
 useEffect(()=>{
   active.current=true;
   let disposed=false;
   async function load(){
     await refresh();
     if(disposed||!initialFeatureId)return;
     const result=await core('getFeature',{featureId:initialFeatureId});
     if(disposed)return;
     if(result?.result==='OK'&&record(result.data.feature).projectId===project.projectId)await open(record(result.data.feature));
     else {setMode('list');setError('Feature non disponibile in questo repository.');}
     if(!disposed)setRestoring(false);
   }
   void load();
   return()=>{disposed=true;active.current=false;version.current++;};
 },[project.projectId,project.configRevision,desktop.context?.selectionEpoch,initialFeatureId]);
 async function refresh(next?:string){const token=++version.current;const r=await core('listFeatures',{projectId:project.projectId,...(next?{cursor:next}:{})});if(!active.current||token!==version.current)return;if(r?.result==='OK'){setItems(next?old=>[...old,...r.data.items as Params[]]:r.data.items as Params[]);setCursor(r.data.nextCursor as string|null);setListState('ready');}else setListState('error');}
 async function history(feature:Params,next?:string){const token=version.current,r=await core('getFeatureRevisions',{featureId:feature.featureId,...(next?{cursor:next}:{})});if(!active.current||token!==version.current||selectedRef.current!==feature.featureId)return;if(r?.result==='OK'){setRevisions(next?old=>[...old,...r.data.items as Params[]]:r.data.items as Params[]);setRevisionCursor(r.data.nextCursor as string|null);}}
 async function document(revisionId:string){
   const token=++version.current;
   setDocumentInfo(null);setAcceptedUnknownIds([]);setApproval(null);setEligibility(null);setEnvelope(null);
   const detail=await core('getFeatureRevision',{revisionId});
   if(!active.current||token!==version.current||detail?.result!=='OK')return;
   const rev=record(detail.data.revision);
   let next:string|null=null,total=0;
   const chunks:Uint8Array[]=[];
   do{
     const r=await core('getFeatureArtifact',{artifactId:rev.artifactId,...(next?{cursor:next}:{})});
     if(!active.current||token!==version.current||r?.result!=='OK')return;
     const b=Uint8Array.from(atob(String(r.data.base64)),c=>c.charCodeAt(0));
     if(r.data.offset!==total||r.data.sha256!==rev.bundleDigest||b.length>8192||total+b.length>262144)throw new Error('Documento non valido');
     chunks.push(b);total+=b.length;next=r.data.nextCursor as string|null;
     if(!next&&r.data.totalBytes!==total)throw new Error('Documento incompleto');
   }while(next);
   const bytes=new Uint8Array(total);
   let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
   const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
   if(!active.current||token!==version.current)return;
   if(hash!==rev.bundleDigest)throw new Error('Digest documento non valido');
   const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
   const parsed=record(JSON.parse(text));
   if(!Array.isArray(parsed.unknowns)||typeof parsed.request!=='string')throw new Error('Documento non valido');
   setBundle(text);setFile(null);setDocumentInfo({revisionId,contextSnapshotId:typeof detail.data.contextSnapshotId==='string'?detail.data.contextSnapshotId:null,text,request:parsed.request,unknowns:parsed.unknowns.map(record)});
   const historical=await invoke('getFeatureApproval',{revisionId}) as PublicResult|null;
   if(active.current&&token===version.current&&historical?.result==='OK')setApproval(record(historical.data.approval));
 }
 function resetTurn(){
   setTurn(null);setQuestions([]);setQuestionCursor(null);setQuestionId('');setAnswerText('');
 }
 async function readPlanning(f:Params,next?:string){
   const token=version.current;
   const current=()=>active.current&&version.current===token&&selectedRef.current===f.featureId;
   const page=await invoke('getFeatureQuestions',{featureId:f.featureId,...(next?{cursor:next}:{})}) as PublicResult|null;
   if(!current()||page?.result!=='OK')return;
   const items=(page.data.items as Params[]).map(record),turnId=page.data.turnId;
   const result=await core('getFeaturePlanningTurn',{turnId});
   if(!current()||result?.result!=='OK')return;
   const detail=record(result.data.turn);
   if(detail.featureId!==f.featureId)return;
   setTurn(detail);
   setQuestions(previous=>next?[...previous,...items]:items);setQuestionCursor(page.data.nextCursor as string|null);
   if(!next)setQuestionId(items.length?String(items[0]!.questionId):'');
 }
 async function open(f:Params){
   if(working.current)return;
   setItems(previous=>previous.map(item=>item.featureId===f.featureId?f:item));
   working.current=true;setBusy(true);version.current++;selectedRef.current=String(f.featureId);setSelected(f);setRevisions([]);setError(null);resetTurn();
   try{
     await history(f);
     if(!active.current||selectedRef.current!==f.featureId)return;
     await document(String(f.currentRevisionId));
     if(live&&active.current&&selectedRef.current===f.featureId){
       const token=version.current,result=await core('getFeatureProvider');
       if(!active.current||token!==version.current||selectedRef.current!==f.featureId)return;
       const capabilities=result?.result==='OK'?record(result.data.capabilities):null;
       setQualified(capabilities?.qualified===true&&capabilities.readonlyPlanning===true);
     }
     if(active.current&&selectedRef.current===f.featureId)await readPlanning(f);
   }catch(e){if(active.current)setError(e instanceof Error?e.message:'Documento non disponibile');}
   finally{working.current=false;if(active.current)setBusy(false);}
 }
 async function refreshSelected(background=false){
   if(!selected||working.current)return;
   const featureId=selected.featureId,token=version.current;
   const result=await core('getFeature',{featureId});
   if(!active.current||token!==version.current||selectedRef.current!==featureId)return;
   if(result?.result!=='OK'){setError(result?.error?.message??'Impossibile aggiornare il turno.');return;}
   const latest=record(result.data.feature);
   if(!background||latest.state!==selected.state||latest.stateRevision!==selected.stateRevision)await open(latest);
 }
 const inProgress=selected?.state==='PLANNING'||selected?.state==='RECONCILING';
 useEffect(()=>{
   if(!live||!inProgress||busy||prepared)return;
   let disposed=false;
   let timer:ReturnType<typeof setTimeout>;
   async function poll(){
     if(window.document.visibilityState==='visible')await refreshSelected(true);
     if(!disposed)timer=setTimeout(()=>void poll(),2000);
   }
   timer=setTimeout(()=>void poll(),1000);
   return()=>{disposed=true;clearTimeout(timer);};
 },[live,inProgress,busy,prepared,selected]);
 async function checkEligibility(){
   if(working.current||!selected)return;
   const featureId=selected.featureId,token=version.current;
   working.current=true;setBusy(true);setEligibility(null);
   try{
     let response=await core('getFeatureEligibility',{featureId});
     if(!active.current||token!==version.current||response?.result!=='OK')return;
     const checkId=response.data.checkId;
     for(let retry=0;retry<12&&response.data.reason==='CHECKING'&&typeof checkId==='string';retry++){
       await new Promise(resolve=>setTimeout(resolve,250));
       if(!active.current||token!==version.current)return;
       response=await core('getFeatureEligibility',{featureId,checkId});
       if(!active.current||token!==version.current||response?.result!=='OK')return;
     }
     setEligibility(response.data);
   }finally{working.current=false;if(active.current)setBusy(false);}
 }
 async function choose(){const r=await invoke('chooseFeatureBundle');if(active.current&&r)setFile(record(r).bundle as typeof file);}
 async function prepare(action:string,intakeBundle?:string){if(working.current)return;working.current=true;setBusy(true);setError(null);trigger.current=window.document.activeElement as HTMLElement|null;const token=version.current;try{
 await invoke('releaseViewReads');if(!active.current||token!==version.current)return;
 let artifactId:string|undefined,answerArtifactId:string|undefined;
 if(['create','revise'].includes(action)){const source=intakeBundle??bundle,uploaded=intakeBundle===undefined?file:null;if(!uploaded&&new TextEncoder().encode(source).length>24000)throw new Error('Per documenti oltre 24KiB scegli il file JSON (massimo 256KiB).');if(!uploaded)JSON.parse(source);const value=await invoke('importFeatureBundle',uploaded?{bundleHandle:uploaded.bundleHandle}:{bundle:source});if(!active.current||token!==version.current||!value)return;const r=record(value).result as PublicResult;const op=r.data.operation?record(r.data.operation):null;if(r.result!=='OK'||op?.outcome!=='SUCCEEDED'){setRequest(r.requestId);throw new Error('Importazione incerta. Consulta la richiesta originale in Operazioni.');}artifactId=String(record(op.result).artifactId);}
 if(action==='answer'){
   const value=await invoke('importFeatureAnswer',{featureId:selected?.featureId,answerText});
   if(!active.current||token!==version.current||!value)return;
   const r=record(value).result as PublicResult,op=r.data.operation?record(r.data.operation):null;
   if(r.result!=='OK'||op?.outcome!=='SUCCEEDED'){setRequest(r.requestId);throw new Error('Risposta da verificare. Consulta la richiesta originale in Operazioni.');}
   answerArtifactId=String(record(op.result).artifactId);
 }
 const params=action==='create'
   ?{action,projectId:project.projectId,expectedConfigRevision:project.configRevision,bundleArtifactId:artifactId}
   :{action,featureId:selected?.featureId,expectedStateRevision:selected?.stateRevision,
     ...(artifactId?{bundleArtifactId:artifactId}:{}),
     ...(['approve','handoff'].includes(action)?{revisionId:documentInfo?.revisionId}:{}),
     ...(action==='approve'?{acceptedUnknownIds}:{}),
     ...(action==='generate'?{contextSnapshotId:documentInfo?.contextSnapshotId}:{}),
     ...(action==='answer'?{turnId:turn?.turnId,questionId,answerArtifactId}:{})};
 const r=await invoke('prepareFeatureAction',{params});if(active.current&&token===version.current&&r)setPrepared(r as PreparedAction);
 }catch(e){if(active.current)setError(e instanceof Error?e.message:'Preparazione fallita');}finally{working.current=false;if(active.current)setBusy(false);}}
 async function confirm(){if(!prepared||working.current)return;working.current=true;setBusy(true);const p=prepared,token=version.current;try{const value=await invoke('confirmFeatureAction',{confirmationId:p.confirmationId});if(!active.current||token!==version.current)return;setPrepared(null);setRequest(p.requestId);if(!value)return;const r=record(value).result as PublicResult;if(r.error||r.result==='UNKNOWN_OUTCOME'){setError(r.error?.message??'Esito incerto. Consulta Operazioni.');return;}let operation=r.data.operation?record(r.data.operation):null;for(let n=0;n<10&&operation?.phase!=='FINALIZED';n++){await new Promise(resolve=>setTimeout(resolve,250));if(!active.current||token!==version.current)return;const read=await core('getFeatureOperation',{requestId:p.requestId});if(!active.current||token!==version.current)return;if(!read?.data.operation)break;operation=record(read.data.operation);if(operation.outcome==='UNKNOWN')break;}
 await invoke('reconcileOperation',{receiptId:p.requestId});if(!active.current||token!==version.current)return;
 if(selected&&['feature.generate','feature.answer','feature.cancel'].includes(p.action)){
   const question=questions.find(item=>item.questionId===questionId);
   if(p.action==='feature.answer'&&operation?.outcome==='SUCCEEDED'&&typeof turn?.turnId==='string'&&typeof question?.text==='string'){
     onExchange(String(selected.featureId),{turnId:turn.turnId,question:question.text,answer:answerText});
   }
   const detail=await core('getFeature',{featureId:selected.featureId});
   if(!active.current||token!==version.current)return;
   if(detail?.result==='OK'){
     const latest=record(detail.data.feature);
     setSelected(latest);resetTurn();
     await history(latest);
     if(!active.current||token!==version.current)return;
     if(latest.currentRevisionId!==selected.currentRevisionId)await document(String(latest.currentRevisionId));
     if(!active.current||selectedRef.current!==latest.featureId)return;
     await readPlanning(latest);
     if(!active.current||selectedRef.current!==latest.featureId)return;
   }
   if(operation?.outcome==='SUCCEEDED')setMessage('Operazione completata.');
   else if(operation?.phase==='FINALIZED')setError(String(operation.error?record(operation.error).message:'Turno interrotto.'));
   else setMessage('Turno da verificare. Puoi aggiornare lo stato o consultare la richiesta originale.');
   await refresh();
   return;
 }
 if(operation?.outcome!=='SUCCEEDED'){
   setEligibility(null);
   const failure=operation?.error?record(operation.error):null;
   setError(typeof failure?.message==='string'?failure.message:'Operazione ancora da verificare. Consulta Operazioni con la richiesta originale.');
   return;
 }
 setMessage('Operazione completata.');
 const result=record(operation.result);
 if(p.action==='feature.create'&&mode==='chat'){
   if(typeof result.featureId==='string'){onConversation(result.featureId);return;}
   setError('Bozza salvata, ma il dettaglio non è disponibile. Aprila dall’elenco delle feature.');
 }
 if(selected&&['approve','handoff'].includes(String(operation.action))){
   const detail=await core('getFeature',{featureId:selected.featureId});
   if(!active.current||token!==version.current)return;
   if(detail?.result==='OK')setSelected(record(detail.data.feature));
   if(operation.action==='approve'){
     const historical=await core('getFeatureApproval',{revisionId:result.revisionId});
     if(!active.current||token!==version.current)return;
     if(historical?.result==='OK')setApproval(record(historical.data.approval));
     setEligibility(null);
   }else{
     const generated=await core('getFeatureEnvelope',{envelopeId:result.envelopeId});
     if(!active.current||token!==version.current)return;
     if(generated?.result==='OK')setEnvelope(record(generated.data.envelope));
   }
 }else{
   setSelected(null);selectedRef.current=null;setRevisions([]);setDocumentInfo(null);
   setApproval(null);setEnvelope(null);setEligibility(null);resetTurn();setMode('list');
 }
 await refresh();
 }finally{working.current=false;if(active.current)setBusy(false);}}
 async function cancel(){if(!prepared||working.current)return;const id=prepared.confirmationId;setPrepared(null);await invoke('cancelFeatureAction',{confirmationId:id});}
 const mutable=live&&!busy&&(selected!==null||canCreate)&&selected?.state!=='ARCHIVED'&&!['PLANNING','RECONCILING','WAITING_USER'].includes(String(selected?.state));
 const savedRevision=!!documentInfo&&documentInfo.revisionId===selected?.currentRevisionId&&documentInfo.text===bundle&&!file;
 const approvalPending=savedRevision&&['DRAFT','READY_FOR_APPROVAL','NEEDS_REVIEW'].includes(String(selected?.state));
 const unknowns=documentInfo?.unknowns??[];
 const nonBlockingUnknowns=unknowns.filter(u=>u.impact==='NON_BLOCKING');
 const canApprove=approvalPending&&!unknowns.some(u=>u.impact==='BLOCKING')&&acceptedUnknownIds.length===nonBlockingUnknowns.length;
 const canOfferGenerate=qualified&&live&&savedRevision&&Boolean(documentInfo?.contextSnapshotId)&&['DRAFT','READY_FOR_APPROVAL','NEEDS_REVIEW','INTERRUPTED'].includes(String(selected?.state));
 const canGenerate=canOfferGenerate&&!busy;
 const DocumentContainer=mode==='chat'?'details':'div';
 const intakeRequest=intakeText.trim();
 const intakeTitle=[...intakeRequest.replace(/\p{Cc}/gu,' ').split(/\s+/u).join(' ')].slice(0,120).join('').trim();
 const currentQuestion=questions.find(question=>question.questionId===questionId);
 const exchanges=selected ? interviews[String(selected.featureId)]??[] : [];
 const canAnswer=live&&qualified&&!busy&&selected?.state==='WAITING_USER'&&Boolean(currentQuestion&&answerText.trim())&&new TextEncoder().encode(answerText).length<=4096;
 useLayoutEffect(()=>{
   const thread=chatScroll.current;
   if(thread)thread.scrollTop=thread.scrollHeight;
 },[mode,restoring,documentInfo?.request,turn?.turnId,turn?.phase,exchanges.length]);
 function startMode(next:'list'|'manual'|'chat'){
   version.current++;selectedRef.current=null;setSelected(null);setMode(next);setRevisions([]);setBundle(JSON.stringify(template,null,2));setFile(null);
   setDocumentInfo(null);setAcceptedUnknownIds([]);setApproval(null);setEligibility(null);setEnvelope(null);setError(null);setMessage(null);resetTurn();
 }
 const intakeComposer=<form className="feature-chat-composer" onSubmit={event=>{event.preventDefault();if(!canCreate||!intakeTitle||busy)return;void prepare('create',JSON.stringify({
     version:1,title:intakeTitle,request:intakeRequest,specification:{scope:'',users:[],stories:[],exclusions:[]},
     implementationPlan:{approach:'',dependencies:[],risks:[]},acceptanceCriteria:[],provenance:[],unknowns:[]
   }));}}>
     <label className="visually-hidden" htmlFor="feature-intake-text">Cosa vuoi ottenere?</label><textarea id="feature-intake-text" autoFocus rows={3} maxLength={4096} required placeholder="Descrivi la feature…" value={intakeText} readOnly={busy} onChange={event=>setIntakeText(event.target.value)} />
     <button className="feature-chat-send" aria-label="Salva richiesta" title="Salva richiesta" disabled={!canCreate||!intakeTitle||busy}><ArrowUpIcon aria-hidden="true" /></button>
   </form>;
 const documentPanel=(selected||mode==='manual')&&<DocumentContainer className={mode==='chat'?'feature-document-secondary':undefined}>
 {mode==='chat'&&<summary>Specifica, piano e approvazione</summary>}
 {selected&&<><h4>{String(selected.title)} · {String(selected.state)}</h4><p className="mono">Feature: {String(selected.featureId)} · Stato {String(selected.stateRevision)}</p><ul>{revisions.map(r=><li key={String(r.revisionId)}><button className="text-button" disabled={busy} onClick={()=>{setBusy(true);void document(String(r.revisionId)).catch(()=>setError('Documento non verificabile')).finally(()=>{if(active.current)setBusy(false);});}}>Revisione {String(r.revisionNumber)}</button></li>)}</ul>{revisionCursor&&<button disabled={busy} onClick={()=>void history(selected,revisionCursor)}>Altre revisioni</button>}</>}
 {mode==='manual'&&!selected&&!canCreate&&<p id="feature-next-step" className="hint">{creationHint}</p>}
 <label htmlFor="feature-document">Specifica e piano JSON</label><textarea id="feature-document" rows={18} value={bundle} readOnly={!mutable} disabled={busy} onChange={e=>{setBundle(e.target.value);setFile(null);}} aria-describedby="feature-document-help"/><p id="feature-document-help" className="hint">Modifica richiesta, ambito, utenti, storie, esclusioni, piano, criteri e provenienza. Le ipotesi restano visibili. Per documenti oltre 24KiB usa un file JSON, massimo 256KiB.</p>
 <button className="button subtle" disabled={!mutable} onClick={()=>void choose()}>Scegli documento JSON</button>{file&&<p>{file.displayName}</p>}
 <div className="row-actions"><button className="button primary" disabled={!mutable} aria-describedby={!selected&&!canCreate?'feature-next-step':undefined} onClick={()=>void prepare(selected?'revise':'create')}>{selected?'Prepara nuova revisione':'Prepara creazione'}</button>{selected&&<button className="button subtle" disabled={!mutable} onClick={()=>void prepare('archive')}>Archivia feature</button>}</div>
 {selected&&documentInfo&&<section aria-label="Approvazione e handoff">
   {approval&&<p>Approvazione storica: <time dateTime={String(approval.approvedAt)}>{String(approval.approvedAt)}</time> · <span className="mono">{String(approval.approvalId)}</span></p>}
   {approvalPending&&unknowns.length>0&&<fieldset disabled={!mutable}>
     <legend>Incognite della revisione</legend>
     {unknowns.filter(u=>u.impact==='BLOCKING').map(u=><p key={String(u.unknownId)}>Da risolvere: {String(u.text)}</p>)}
     {nonBlockingUnknowns.map(u=>{
       const id=String(u.unknownId);
       return <label key={id}><input type="checkbox" checked={acceptedUnknownIds.includes(id)} onChange={e=>setAcceptedUnknownIds(e.target.checked?[...acceptedUnknownIds,id]:acceptedUnknownIds.filter(x=>x!==id))}/> Accetto: {String(u.text)}</label>;
     })}
   </fieldset>}
   <div className="row-actions">
     <button className="button subtle" disabled={!mutable||!canApprove} onClick={()=>void prepare('approve')}>Prepara approvazione</button>
     <button className="button subtle" disabled={!mutable||!savedRevision||selected.state!=='APPROVED'} onClick={()=>void checkEligibility()}>Verifica idoneità</button>
     <button className="button subtle" disabled={!mutable||!savedRevision||selected.state!=='APPROVED'} onClick={()=>void prepare('handoff')}>Prepara handoff</button>
   </div>
   {live&&eligibility&&<p role="status">{eligibility.eligible?'Handoff idoneo al momento della verifica.':eligibility.reason==='CHECKING'?'Verifica in corso.':`Handoff non idoneo: ${String(eligibility.reason)}`}</p>}
   {envelope&&selected.state==='APPROVED'&&<button className="button subtle" onClick={()=>onWorkspace({projectId:project.projectId,featureId:String(selected.featureId),envelopeId:String(envelope.envelopeId)})}>Apri workspace dell’handoff</button>}
   {envelope&&<p>Handoff <span className="mono">{String(envelope.envelopeId)}</span> · Digest <span className="mono">{String(envelope.digest)}</span></p>}
 </section>}
 </DocumentContainer>;
 const feedback=<>
   {error&&<p role="alert">{error}</p>}{message&&mode!=='chat'&&<p role="status">{message}</p>}
   {request&&(mode!=='chat'||error)&&<p className="mono">Richiesta originale: {request}. Consulta Operazioni per riconciliare l’esito.</p>}
 </>;
 const confirmation=prepared&&<ConfirmationDialog prepared={prepared} busy={busy} onConfirm={()=>void confirm()} onCancel={()=>void cancel()} returnFocus={()=>trigger.current}/>;
 if(mode==='chat')return <section className="feature-planning feature-chat" aria-labelledby="feature-chat-title">
   <header className="feature-chat-header">
     <button className="feature-chat-back" aria-label="Torna alle feature" title="Torna alle feature" disabled={busy||restoring} onClick={()=>startMode('list')}><ArrowLeftIcon aria-hidden="true" /></button>
     <div><h3 id="feature-chat-title">{selected?String(selected.title):'Nuova feature'}</h3><p>{project.displayName} · Intervista con l’agente</p></div>
     {(inProgress||selected?.state==='WAITING_USER')&&<button className="text-button feature-chat-stop" disabled={!live||!qualified||busy} onClick={()=>void prepare('cancel')}>Interrompi turno</button>}
   </header>
   <div className="feature-chat-scroll" ref={chatScroll} tabIndex={0} aria-label="Conversazione">
   <div className={`feature-chat-content${!selected&&!restoring?' feature-chat-welcome':''}`}>
   {restoring?<p role="status" className="hint">Apertura della conversazione…</p>:!selected?<div>
     <h4>Che cosa vuoi costruire?</h4>
     <p>Descrivi il risultato che vuoi ottenere. Poi potrai approfondire la richiesta con l’agente.</p>
   </div>:<>
   <ol className="feature-chat-thread" aria-label="Messaggi" aria-live="polite">
     {documentInfo&&<ChatMessage speaker="Tu">{documentInfo.request}</ChatMessage>}
     {exchanges.flatMap(exchange=>[
       <ChatMessage key={`${exchange.turnId}:question`} speaker="Agente di pianificazione">{exchange.question}</ChatMessage>,
       <ChatMessage key={`${exchange.turnId}:answer`} speaker="Tu">{exchange.answer}</ChatMessage>
     ])}
     {typeof currentQuestion?.text==='string'&&!exchanges.some(exchange=>exchange.turnId===turn?.turnId)&&<ChatMessage speaker="Agente di pianificazione">{currentQuestion.text}</ChatMessage>}
   </ol>
   {inProgress&&<p role="status" className="hint">L’agente sta elaborando la richiesta…</p>}
   {turn?.phase==='SUCCEEDED'&&<p role="status" className="hint">L’agente ha preparato una bozza. La trovi in «Specifica, piano e approvazione».</p>}
   {turn&&['FAILED','INTERRUPTED','CANCELLED'].includes(String(turn.phase))&&<p role="status" className="hint">Il turno si è concluso senza una nuova bozza.</p>}
   {!qualified&&live&&!busy&&<p role="status" className="hint">Nessun agente di pianificazione qualificato. La richiesta resta salvata.</p>}
   {!live&&<p role="status" className="hint">Ultimo stato noto. Avvia il servizio per proseguire.</p>}
   {documentPanel}
   </>}
   {feedback}
   </div>
   </div>
   {!restoring&&<div className="feature-chat-dock"><div className="feature-chat-content">
   {!selected&&<>
     {!canCreate&&<p className="hint" role="status">{creationHint}</p>}
     {intakeComposer}
   </>}
   {canOfferGenerate&&<button className="button primary" disabled={!canGenerate} onClick={()=>void prepare('generate')}>{turn?'Avvia un nuovo turno':'Avvia intervista'}</button>}
   {selected?.state==='WAITING_USER'&&currentQuestion&&<>
     {(questions.length>1||questionCursor)&&<div className="feature-chat-questions">
       <label htmlFor="feature-current-question">Domanda a cui rispondere</label>
       <select id="feature-current-question" disabled={busy} value={questionId} onChange={event=>{setQuestionId(event.target.value);setAnswerText('');}}>
         {questions.map(item=><option key={String(item.questionId)} value={String(item.questionId)}>{String(item.text)}</option>)}
       </select>
       {questionCursor&&<button className="text-button" disabled={busy} onClick={()=>void readPlanning(selected,questionCursor)}>Altre domande</button>}
     </div>}
     <form className="feature-chat-composer" onSubmit={event=>{event.preventDefault();if(canAnswer)void prepare('answer');}}>
       <label className="visually-hidden" htmlFor="feature-chat-answer">Rispondi all’agente</label>
       <textarea id="feature-chat-answer" rows={3} maxLength={4096} readOnly={busy||!live||!qualified} placeholder="Scrivi una risposta…" value={answerText} onChange={event=>setAnswerText(event.target.value)} />
       <button className="feature-chat-send" aria-label="Invia risposta" title="Invia risposta" disabled={!canAnswer}><ArrowUpIcon aria-hidden="true" /></button>
     </form>
   </>}
   </div></div>}
   {confirmation}
 </section>;
 return <section aria-labelledby="feature-planning-title" className="feature-planning feature-catalog">
 <header className="feature-catalog-header">
   <h3 id="feature-planning-title">Feature del progetto</h3>
   <button type="button" className="feature-catalog-add" aria-label="Nuova feature" title="Nuova feature" disabled={!live||busy||restoring} onClick={()=>startMode('chat')}>
     <PlusIcon aria-hidden="true" />
   </button>
 </header>
 {!live&&<p role="status">Ultimo stato noto. Avvia il servizio per modificare le feature.</p>}
 {listState==='loading'&&<p className="hint" role="status">Lettura delle feature…</p>}
 {listState==='error'&&<p role="alert">Impossibile leggere l’elenco delle feature.</p>}
 {listState==='ready'&&!items.length&&mode==='list'&&!selected&&<div className="feature-catalog-empty">
   <p>Nessuna feature per questo repository.</p>
   {live&&<p className="hint">Usa il pulsante + per iniziare una conversazione.</p>}
 </div>}
 {!!items.length&&<ul className="feature-catalog-list" aria-label="Feature salvate">
   {items.map(feature=>{
     const id=String(feature.featureId), state=String(feature.state), title=String(feature.title);
     return <li key={id}>
       <button type="button" className="feature-catalog-row" aria-label={title} aria-describedby={`feature-state-${id}`}
         aria-current={selected?.featureId===feature.featureId?'true':undefined}
         disabled={busy||restoring} onClick={()=>{setMode(['PLANNING','WAITING_USER','RECONCILING'].includes(state)?'chat':'list');void open(feature);}}>
         <span className="feature-catalog-title">{title}</span>
         <span className="feature-catalog-status" id={`feature-state-${id}`} data-state={state}>{featureStates.get(state)??'Stato non disponibile'}</span>
         <ChevronRightIcon aria-hidden="true" />
       </button>
     </li>;
   })}
 </ul>}
 <div className="feature-catalog-tools">
   {cursor&&<button className="text-button" disabled={busy||restoring} onClick={()=>void refresh(cursor)}>Altre feature</button>}
   <button className="text-button" disabled={busy||restoring} onClick={()=>void refresh()}>Aggiorna feature</button>
   {mode==='list'&&<button className="text-button" disabled={busy||restoring||!canCreate} onClick={()=>startMode('manual')}>Creazione manuale</button>}
 </div>
 {restoring?<p role="status" className="hint">Apertura della feature…</p>:<>
 {mode==='list'&&!selected&&!canCreate&&<p className="hint">{creationHint}</p>}
 {documentPanel}
 {selected&&selected.state!=='ARCHIVED'&&<section className="feature-conversation feature-turn" aria-label="Pianificazione assistita">
   {!qualified&&live&&<p className="hint">Generazione assistita indisponibile. Puoi modificare il documento manualmente.</p>}
   <div className="row-actions">
     <button className="button subtle" disabled={!canGenerate} onClick={()=>void prepare('generate')}>Prepara bozza assistita</button>
     {turn&&<button className="text-button" disabled={busy} onClick={()=>void refreshSelected()}>Aggiorna turno</button>}
     {['PLANNING','WAITING_USER','RECONCILING'].includes(String(selected.state))&&<button className="button subtle" disabled={!live||!qualified||busy} onClick={()=>void prepare('cancel')}>Interrompi turno</button>}
   </div>
   {turn&&<p role="status">Turno {String(turn.turnIndex)} · {String(turn.phase)}</p>}
   {!!questions.length&&<fieldset disabled={busy||!live||!qualified}>
     <legend>Domande del turno</legend>
     {questions.map(question=><div key={String(question.questionId)}>
       <label><input type="radio" name="feature-question" value={String(question.questionId)} checked={questionId===question.questionId} onChange={()=>setQuestionId(String(question.questionId))}/> {String(question.text)}</label>
       <p className="hint">{String(question.reason)}</p>
     </div>)}
     <label htmlFor="feature-answer">Risposta al turno</label><textarea id="feature-answer" rows={3} maxLength={4096} value={answerText} onChange={e=>setAnswerText(e.target.value)}/>
     <button className="button subtle" disabled={!questionId||!answerText.trim()||new TextEncoder().encode(answerText).length>4096} onClick={()=>void prepare('answer')}>Prepara risposta</button>
   </fieldset>}
   {questionCursor&&<button disabled={busy} onClick={()=>void readPlanning(selected,questionCursor)}>Altre domande</button>}
 </section>}
 </>}
 {feedback}
 {confirmation}
 </section>;
}
