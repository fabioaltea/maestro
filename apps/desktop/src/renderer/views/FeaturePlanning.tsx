import type {WorkspaceSource} from './Workspaces.tsx';
import {useEffect,useRef,useState} from 'react';
import type {Desktop} from '../state/desktop.ts';
import type {Project} from '../state/project-view.ts';
import type {Params,PublicResult} from '../../shared/bridge-contract.ts';
import {record} from '../../shared/validation.ts';
import {ConfirmationDialog,type PreparedAction} from '../components/ConfirmationDialog.tsx';
const template={version:1,title:'Nuova feature',request:'Descrivi la richiesta',specification:{scope:'Definisci l’ambito',users:['Utente'],stories:[{storyId:'US1',text:'Come utente voglio…'}],exclusions:[]},implementationPlan:{approach:'Descrivi il piano',dependencies:[],risks:[]},acceptanceCriteria:[{criterionId:'AC1',storyId:'US1',text:'Risultato osservabile',verification:'Verifica da eseguire',required:true}],provenance:[{kind:'HYPOTHESIS',text:'Da confermare con l’utente',sourceId:null,answerId:null}],unknowns:[]};
export function FeaturePlanning({desktop,project,live,canCreate,onWorkspace}:{desktop:Desktop;project:Project;live:boolean;canCreate:boolean;onWorkspace(source:WorkspaceSource):void}){
 const[items,setItems]=useState<Params[]>([]),[cursor,setCursor]=useState<string|null>(null),[selected,setSelected]=useState<Params|null>(null),[revisions,setRevisions]=useState<Params[]>([]),[revisionCursor,setRevisionCursor]=useState<string|null>(null),[bundle,setBundle]=useState(JSON.stringify(template,null,2)),[file,setFile]=useState<{bundleHandle:string;displayName:string}|null>(null),[prepared,setPrepared]=useState<PreparedAction|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[message,setMessage]=useState<string|null>(null),[request,setRequest]=useState<string|null>(null);
 const active=useRef(false),working=useRef(false),version=useRef(0),trigger=useRef<HTMLElement|null>(null),selectedRef=useRef<string|null>(null);
 const [documentInfo,setDocumentInfo]=useState<{revisionId:string;contextSnapshotId:string|null;text:string;unknowns:Params[]}|null>(null);
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
 const{core,invoke}=desktop;
 useEffect(()=>{active.current=true;void refresh();return()=>{active.current=false;version.current++;void invoke('releaseViewReads');};},[project.projectId,project.configRevision,desktop.context?.selectionEpoch]);
 async function refresh(next?:string){const token=++version.current;const r=await core('listFeatures',{projectId:project.projectId,...(next?{cursor:next}:{})});if(!active.current||token!==version.current)return;if(r?.result==='OK'){setItems(next?old=>[...old,...r.data.items as Params[]]:r.data.items as Params[]);setCursor(r.data.nextCursor as string|null);}}
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
   if(!Array.isArray(parsed.unknowns))throw new Error('Documento non valido');
   setBundle(text);setFile(null);setDocumentInfo({revisionId,contextSnapshotId:typeof detail.data.contextSnapshotId==='string'?detail.data.contextSnapshotId:null,text,unknowns:parsed.unknowns.map(record)});
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
 async function refreshSelected(){
   if(!selected||working.current)return;
   const featureId=selected.featureId,token=version.current;
   const result=await core('getFeature',{featureId});
   if(active.current&&token===version.current&&selectedRef.current===featureId&&result?.result==='OK')await open(record(result.data.feature));
 }
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
 async function prepare(action:string){if(working.current)return;working.current=true;setBusy(true);setError(null);trigger.current=window.document.activeElement as HTMLElement|null;const token=version.current;try{
 await invoke('releaseViewReads');if(!active.current||token!==version.current)return;
 let artifactId:string|undefined,answerArtifactId:string|undefined;
 if(['create','revise'].includes(action)){if(!file&&new TextEncoder().encode(bundle).length>24000)throw new Error('Per documenti oltre 24KiB scegli il file JSON (massimo 256KiB).');if(!file)JSON.parse(bundle);const value=await invoke('importFeatureBundle',file?{bundleHandle:file.bundleHandle}:{bundle});if(!active.current||token!==version.current||!value)return;const r=record(value).result as PublicResult;const op=r.data.operation?record(r.data.operation):null;if(r.result!=='OK'||op?.outcome!=='SUCCEEDED'){setRequest(r.requestId);throw new Error('Importazione incerta. Consulta la richiesta originale in Operazioni.');}artifactId=String(record(op.result).artifactId);}
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
   setApproval(null);setEnvelope(null);setEligibility(null);resetTurn();
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
 return <section aria-labelledby="feature-planning-title" className="feature-planning"><div className="section-heading"><h3 id="feature-planning-title">Feature del progetto</h3><button className="text-button" disabled={busy} onClick={()=>void refresh()}>Aggiorna feature</button></div>
 {!live&&<p role="status">Ultimo stato noto. Avvia il servizio per modificare le feature.</p>}
 <p className="hint">Specifica, piano e criteri di accettazione restano in un documento versionato. La creazione richiede una Discovery approvata e corrente.</p>
 <ul>{items.map(f=><li key={String(f.featureId)}><button className="text-button" disabled={busy} onClick={()=>void open(f)}>{String(f.title)}</button> · {String(f.state)}</li>)}</ul>{cursor&&<button disabled={busy} onClick={()=>void refresh(cursor)}>Altre feature</button>}
 {selected&&<button className="button subtle" disabled={busy||!canCreate} onClick={()=>{version.current++;selectedRef.current=null;setSelected(null);setRevisions([]);setBundle(JSON.stringify(template,null,2));setFile(null);setDocumentInfo(null);setAcceptedUnknownIds([]);setApproval(null);setEligibility(null);setEnvelope(null);resetTurn();}}>Crea un’altra feature</button>}
 {selected&&<><h4>{String(selected.title)} · {String(selected.state)}</h4><p className="mono">Feature: {String(selected.featureId)} · Stato {String(selected.stateRevision)}</p><ul>{revisions.map(r=><li key={String(r.revisionId)}><button className="text-button" disabled={busy} onClick={()=>{setBusy(true);void document(String(r.revisionId)).catch(()=>setError('Documento non verificabile')).finally(()=>{if(active.current)setBusy(false);});}}>Revisione {String(r.revisionNumber)}</button></li>)}</ul>{revisionCursor&&<button disabled={busy} onClick={()=>void history(selected,revisionCursor)}>Altre revisioni</button>}</>}
 <label htmlFor="feature-document">Specifica e piano JSON</label><textarea id="feature-document" rows={18} value={bundle} readOnly={!mutable} disabled={busy} onChange={e=>{setBundle(e.target.value);setFile(null);}} aria-describedby="feature-document-help"/><p id="feature-document-help" className="hint">Modifica richiesta, ambito, utenti, storie, esclusioni, piano, criteri e provenienza. Le ipotesi restano visibili. Per documenti oltre 24KiB usa un file JSON, massimo 256KiB.</p>
 <button className="button subtle" disabled={!mutable} onClick={()=>void choose()}>Scegli documento JSON</button>{file&&<p>{file.displayName}</p>}
 <div className="row-actions"><button className="button primary" disabled={!mutable} onClick={()=>void prepare(selected?'revise':'create')}>{selected?'Prepara nuova revisione':'Prepara creazione'}</button>{selected&&<button className="button subtle" disabled={!mutable} onClick={()=>void prepare('archive')}>Archivia feature</button>}</div>
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
 {selected&&selected.state!=='ARCHIVED'&&<section aria-label="Pianificazione assistita">
   {!qualified&&live&&<p className="hint">Generazione assistita indisponibile. Puoi modificare il documento manualmente.</p>}
   <div className="row-actions">
     <button className="button subtle" disabled={!qualified||!mutable||!savedRevision||!documentInfo?.contextSnapshotId||!['DRAFT','READY_FOR_APPROVAL','NEEDS_REVIEW','INTERRUPTED'].includes(String(selected.state))} onClick={()=>void prepare('generate')}>Prepara bozza assistita</button>
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
 {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}{request&&<p className="mono">Richiesta originale: {request}. Consulta Operazioni per riconciliare l’esito.</p>}
 {prepared&&<ConfirmationDialog prepared={prepared} busy={busy} onConfirm={()=>void confirm()} onCancel={()=>void cancel()} returnFocus={()=>trigger.current}/>}
 </section>;
}
