import {useEffect,useRef,useState} from 'react';
import type {Params} from '../../shared/bridge-contract.ts';
import {record} from '../../shared/validation.ts';
import {ConfirmationDialog,type PreparedAction} from '../components/ConfirmationDialog.tsx';
import type {Desktop} from '../state/desktop.ts';

export interface WorkspaceSource {projectId:string;featureId:string;envelopeId:string}

export function Workspaces({desktop,source,onProjects,onOperations,onEnvironment}:{desktop:Desktop;source:WorkspaceSource|null;onProjects():void;onOperations():void;onEnvironment(workspaceId:string):void}){
 const {core,invoke}=desktop;
 const projectId=desktop.context?.activeProjectId??'';
 const [items,setItems]=useState<Params[]>([]);
 const [cursor,setCursor]=useState<string|null>(null);
 const [loaded,setLoaded]=useState(false);
 const [live,setLive]=useState(false);
 const [canObserve,setCanObserve]=useState(false);
 const [canCleanup,setCanCleanup]=useState(false);
 const [cleanup,setCleanup]=useState<{workspaceId:string;targetRef:string;targetOid:string}|null>(null);
 const [busy,setBusy]=useState(false);
 const [prepared,setPrepared]=useState<PreparedAction|null>(null);
 const [receipt,setReceipt]=useState<Params|null>(null);
 const latestReceipt=useRef<Params|null>(null);
 const current=useRef(0),active=useRef(false),trigger=useRef<HTMLButtonElement|null>(null);
 useEffect(()=>{
   active.current=true;
   if(projectId)void refresh(projectId);
   return()=>{active.current=false;current.current++;};
 },[core,projectId]);

 async function refresh(id:string,next?:string){
   const generation=++current.current;
   const pending=latestReceipt.current;
   if(pending&&pending.phase!=='TERMINAL'){
     const result=await invoke('reconcileOperation',{receiptId:pending.requestId});
     if(!active.current||generation!==current.current)return;
     if(result){
       const updated=record(record(result).receipt);
       latestReceipt.current=updated;setReceipt(updated);
     }
   }
   const status=await core('status');
   if(!active.current||generation!==current.current)return;
   const capability=status?.data.capabilities as Params|undefined;
   setLive(status?.liveness==='LIVE_VERIFIED'&&capability?.workspaceVersion===1
     &&Array.isArray(capability.workspaceMethods)&&capability.workspaceMethods.includes('workspace.create'));
   setCanObserve(status?.liveness==='LIVE_VERIFIED'&&capability?.workspaceVersion===1
     &&Array.isArray(capability.workspaceMethods)&&capability.workspaceMethods.includes('workspace.refresh'));
   setCanCleanup(status?.liveness==='LIVE_VERIFIED'&&capability?.workspaceVersion===1&&Array.isArray(capability.workspaceMethods)
     &&['workspace.cleanup.prepare','workspace.remove'].every(method=>(capability.workspaceMethods as unknown[]).includes(method)));
   const page=await core('listWorkspaces',{projectId:id,...(next?{cursor:next}:{})});
   if(!active.current||generation!==current.current)return;
   if(page?.result==='OK'){
     setItems(old=>next?[...old,...page.data.items as Params[]]:page.data.items as Params[]);
     setCursor(page.data.nextCursor as string|null);
     setLoaded(true);
   }
 }
 async function prepare(params:Params,button:HTMLButtonElement){
   trigger.current=button;
   const generation=current.current;
   setBusy(true);
   try{
     const response=await invoke('prepareWorkspaceAction',{params});
     if(!response)return;
     const value=response as PreparedAction;
     if(active.current&&generation===current.current)setPrepared(value);
     else await invoke('cancelWorkspaceAction',{confirmationId:value.confirmationId});
   }finally{if(active.current&&generation===current.current)setBusy(false);}
 }
 async function cancel(){
   if(!prepared)return;
   await invoke('cancelWorkspaceAction',{confirmationId:prepared.confirmationId});
   if(active.current)setPrepared(null);
 }
 async function confirm(){
   if(!prepared)return;
   const generation=current.current;
   setBusy(true);
   try{
     const value=await invoke('confirmWorkspaceAction',{confirmationId:prepared.confirmationId});
     if(!active.current||generation!==current.current)return;
     if(value){
       const received=record(record(value).receipt);
       latestReceipt.current=received;setReceipt(received);
       if(prepared.action==='workspace.remove')setCleanup(null);
     }
     setPrepared(null);setBusy(false);
     await refresh(projectId);
   }finally{if(active.current&&generation===current.current)setBusy(false);}
 }

 return <section aria-label="Worktree Git" className="workspace-panel">
   <div className="row-actions">
     <button className="button subtle" disabled={!projectId||busy||!!prepared} onClick={()=>void refresh(projectId)}>Aggiorna elenco</button>
   </div>
   {loaded&&!live&&<p role="status">Ultimo stato noto. La creazione richiede il servizio attivo.</p>}
   {source?.projectId===projectId?<div className="row-actions">
     <button className="button primary" disabled={!live||busy||!!prepared} onClick={event=>void prepare({featureId:source.featureId,envelopeId:source.envelopeId},event.currentTarget)}>Prepara creazione workspace</button>
   </div>:<p>Apri un handoff approvato per creare un workspace. <button className="text-button" onClick={onProjects}>Vai ai progetti</button></p>}
   {receipt&&<p role="status">Operazione <span className="mono">{String(receipt.requestId)}</span> · {String(receipt.phase)}
     {' '}<button className="text-button" onClick={onOperations}>Consulta operazioni</button></p>}
   {loaded&&!items.length&&<p>Nessun workspace per questo progetto.</p>}
   {items.length>0&&<ul aria-label="Workspace del progetto">
     {items.map(item=>{
       const observation=item.observation as Params|null|undefined;
       const draft=cleanup&&cleanup.workspaceId===item.workspaceId?cleanup:null;
       return <li key={String(item.workspaceId)}>
       <strong>{String(item.state)}</strong> · <span className="mono">{String(item.branchRef)}</span>
       <dl><div><dt>Base</dt><dd className="mono">{String(item.baseRef)} · {String(item.baseOid)}</dd></div>
         <div><dt>Aggiornato</dt><dd><time dateTime={String(item.updatedAt)}>{String(item.updatedAt)}</time></dd></div></dl>
       <button className="button subtle" onClick={()=>onEnvironment(String(item.workspaceId))}>Apri ambiente</button>
       {item.safeError!==null&&<p>{String(item.safeError)}</p>}
       {observation&&<dl aria-label="Ultima osservazione Git">
         <div><dt>Osservazione</dt><dd><time dateTime={String(observation.checkedAt)}>{String(observation.checkedAt)}</time></dd></div>
         <div><dt>Proprietà</dt><dd>{String(observation.ownership)}</dd></div>
         {observation.ownership==='VERIFIED'&&<>
           <div><dt>HEAD</dt><dd className="mono">{String(observation.headOid)}</dd></div>
           <div><dt>File</dt><dd>{[
             observation.tracked&&'Modifiche tracciate',observation.untracked&&'File non tracciati',
             observation.ignored&&'File ignorati',observation.conflicts&&'Conflitti',
           ].filter(Boolean).join(' · ')||'Checkout pulito'}</dd></div>
         </>}
       </dl>}
       <button className="button subtle" disabled={!canObserve||busy||!!prepared||['CREATING','REMOVING'].includes(String(item.state))}
         onClick={event=>void prepare({action:'refresh',workspaceId:item.workspaceId,expectedStateRevision:item.stateRevision},event.currentTarget)}>
         Aggiorna osservazione
       </button>
       <button className="button subtle" disabled={!canCleanup||busy||!!prepared||item.state!=='READY'}
         aria-expanded={!!draft}
         onClick={()=>setCleanup(draft?null:{workspaceId:String(item.workspaceId),targetRef:String(item.baseRef),targetOid:String(item.baseOid)})}>
         Rimozione workspace
       </button>
       {canCleanup&&draft&&<form onSubmit={event=>{
         event.preventDefault();
         const button=event.currentTarget.querySelector('button');
         if(button)void prepare({action:'remove',...draft,expectedStateRevision:item.stateRevision},button);
       }}>
         <label>Ref locale di integrazione <input required maxLength={1035} value={draft.targetRef}
           onChange={event=>setCleanup({...draft,targetRef:event.target.value})}/></label>
         <label>OID del target <input required maxLength={64} value={draft.targetOid}
           onChange={event=>setCleanup({...draft,targetOid:event.target.value})}/></label>
         <button className="button subtle" disabled={busy||!!prepared}>Prepara rimozione</button>
       </form>}
     </li>;})}
   </ul>}
   {cursor&&<button className="button subtle" disabled={busy||!!prepared} onClick={()=>void refresh(projectId,cursor)}>Altri workspace</button>}
   {prepared&&<ConfirmationDialog prepared={prepared} busy={busy} onConfirm={()=>void confirm()} onCancel={()=>void cancel()} returnFocus={()=>trigger.current}/>}
 </section>;
}
