import {useEffect,useRef,useState} from 'react';
import type {Params} from '../../shared/bridge-contract.ts';
import {record} from '../../shared/validation.ts';
import {ConfirmationDialog,type PreparedAction} from '../components/ConfirmationDialog.tsx';
import type {Desktop} from '../state/desktop.ts';

export interface WorkspaceSource {projectId:string;featureId:string;envelopeId:string}

export function Workspaces({desktop,source,onProjects,onOperations}:{desktop:Desktop;source:WorkspaceSource|null;onProjects():void;onOperations():void}){
 const {core,invoke}=desktop;
 const [projectId,setProjectId]=useState(source?.projectId??'');
 const [projects,setProjects]=useState<Params[]>([]);
 const [items,setItems]=useState<Params[]>([]);
 const [cursor,setCursor]=useState<string|null>(null);
 const [loaded,setLoaded]=useState(false);
 const [live,setLive]=useState(false);
 const [busy,setBusy]=useState(false);
 const [prepared,setPrepared]=useState<PreparedAction|null>(null);
 const [receipt,setReceipt]=useState<Params|null>(null);
 const current=useRef(0),active=useRef(false),trigger=useRef<HTMLButtonElement>(null);
 const project=useRef(projectId);

 useEffect(()=>{
   active.current=true;
   const generation=++current.current;
   async function load(){
     const result=await core('listProjects',{limit:20});
     if(!active.current||generation!==current.current)return;
     if(result?.result==='OK')setProjects(result.data.projects as Params[]);
     if(project.current)await refresh(project.current);
   }
   void load();
   return()=>{active.current=false;current.current++;};
 },[core]);

 async function refresh(id:string,next?:string){
   const generation=++current.current;
   const status=await core('status');
   if(!active.current||generation!==current.current)return;
   const capability=status?.data.capabilities as Params|undefined;
   setLive(status?.liveness==='LIVE_VERIFIED'&&capability?.workspaceVersion===1
     &&Array.isArray(capability.workspaceMethods)&&capability.workspaceMethods.includes('workspace.create'));
   const page=await core('listWorkspaces',{projectId:id,...(next?{cursor:next}:{})});
   if(!active.current||generation!==current.current)return;
   if(page?.result==='OK'){
     setItems(old=>next?[...old,...page.data.items as Params[]]:page.data.items as Params[]);
     setCursor(page.data.nextCursor as string|null);
     setLoaded(true);
   }
 }
 function select(id:string){
   project.current=id;current.current++;
   setProjectId(id);setItems([]);setCursor(null);setLoaded(false);setReceipt(null);
   if(id)void refresh(id);
 }
 async function prepare(){
   if(!source||source.projectId!==projectId)return;
   const generation=current.current;
   setBusy(true);
   try{
     const response=await invoke('prepareWorkspaceAction',{params:{featureId:source.featureId,envelopeId:source.envelopeId}});
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
     if(value)setReceipt(record(record(value).receipt));
     setPrepared(null);setBusy(false);
     await refresh(projectId);
   }finally{if(active.current&&generation===current.current)setBusy(false);}
 }

 return <section aria-label="Worktree Git" className="workspace-panel">
   <div className="row-actions">
     <label>Progetto <select aria-label="Progetto workspace" value={projectId} disabled={busy||!!prepared} onChange={event=>select(event.target.value)}>
       <option value="">Seleziona progetto</option>
       {source&&!projects.some(item=>item.projectId===source.projectId)&&<option value={source.projectId}>{source.projectId}</option>}
       {projects.map(item=><option key={String(item.projectId)} value={String(item.projectId)}>{String(item.displayName)}</option>)}
     </select></label>
     <button className="button subtle" disabled={!projectId||busy||!!prepared} onClick={()=>void refresh(projectId)}>Aggiorna elenco</button>
   </div>
   {loaded&&!live&&<p role="status">Ultimo stato noto. La creazione richiede il servizio attivo.</p>}
   {source?.projectId===projectId?<div className="row-actions">
     <button className="button primary" ref={trigger} disabled={!live||busy||!!prepared} onClick={()=>void prepare()}>Prepara creazione workspace</button>
   </div>:<p>Apri un handoff approvato per creare un workspace. <button className="text-button" onClick={onProjects}>Vai ai progetti</button></p>}
   {receipt&&<p role="status">Operazione <span className="mono">{String(receipt.requestId)}</span> · {String(receipt.phase)}
     {' '}<button className="text-button" onClick={onOperations}>Consulta operazioni</button></p>}
   {loaded&&!items.length&&<p>Nessun workspace per questo progetto.</p>}
   {items.length>0&&<ul aria-label="Workspace del progetto">
     {items.map(item=><li key={String(item.workspaceId)}>
       <strong>{String(item.state)}</strong> · <span className="mono">{String(item.branchRef)}</span>
       <dl><div><dt>Base</dt><dd className="mono">{String(item.baseRef)} · {String(item.baseOid)}</dd></div>
         <div><dt>Aggiornato</dt><dd><time dateTime={String(item.updatedAt)}>{String(item.updatedAt)}</time></dd></div></dl>
       {item.safeError!==null&&<p>{String(item.safeError)}</p>}
     </li>)}
   </ul>}
   {cursor&&<button className="button subtle" disabled={busy||!!prepared} onClick={()=>void refresh(projectId,cursor)}>Altri workspace</button>}
   {prepared&&<ConfirmationDialog prepared={prepared} busy={busy} onConfirm={()=>void confirm()} onCancel={()=>void cancel()} returnFocus={()=>trigger.current}/>}
 </section>;
}
