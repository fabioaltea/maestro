import {useEffect,useRef,useState} from 'react';
import type {Params} from '../../shared/bridge-contract.ts';
import {record} from '../../shared/input.ts';
import {ConfirmationDialog,type PreparedAction} from '../components/ConfirmationDialog.tsx';
import type {Desktop} from '../state/desktop.ts';

export function Environments({desktop,workspaceId,onWorkspaces,onOperations}:{desktop:Desktop;workspaceId:string|null;onWorkspaces():void;onOperations():void}){
 const {core,invoke}=desktop;
 const [view,setView]=useState<Params|null>(null),[workspace,setWorkspace]=useState<Params|null>(null);
 const [methods,setMethods]=useState<string[]>([]),[prepared,setPrepared]=useState<PreparedAction|null>(null);
 const [busy,setBusy]=useState(false),[receipt,setReceipt]=useState<Params|null>(null);
 const [manual,setManual]=useState(''),[managerVersion,setManagerVersion]=useState('');
 const active=useRef(false),generation=useRef(0),trigger=useRef<HTMLButtonElement|null>(null),lastReceipt=useRef<Params|null>(null);
 useEffect(()=>{
   active.current=true;void load();
   return()=>{active.current=false;generation.current++;};
 },[workspaceId,core]);
 async function load(){
   if(!workspaceId)return;
   const token=++generation.current;
   const prior=lastReceipt.current;
   if(prior&&prior.phase!=='TERMINAL'){
     const result=await invoke('reconcileOperation',{receiptId:prior.requestId});
     if(!active.current||token!==generation.current)return;
     if(result){lastReceipt.current=record(record(result).receipt);setReceipt(lastReceipt.current);}
   }
   const status=await core('status');
   if(!active.current||token!==generation.current)return;
   const cap=status?.data.capabilities as Params|undefined;
   setMethods(status?.liveness==='LIVE_VERIFIED'&&cap?.environmentVersion===1&&Array.isArray(cap.environmentMethods)?cap.environmentMethods as string[]:[]);
   const item=await core('getWorkspace',{workspaceId});
   if(!active.current||token!==generation.current)return;
   if(item?.result==='OK')setWorkspace(record(item.data.workspace));
   const environment=await core('getEnvironment',{workspaceId});
   if(!active.current||token!==generation.current)return;
   if(environment?.result==='OK')setView(environment.data);
 }
 async function prepare(params:Params,button:HTMLButtonElement){
   trigger.current=button;
   const token=generation.current;
   setBusy(true);
   try{
     const reply=await invoke('prepareEnvironmentAction',{params});
     if(!reply)return;
     const next=reply as PreparedAction;
     if(active.current&&token===generation.current)setPrepared(next);
     else await invoke('cancelEnvironmentAction',{confirmationId:next.confirmationId});
   }finally{if(active.current&&token===generation.current)setBusy(false);}
 }
 async function finish(confirm:boolean){
   if(!prepared)return;
   const token=generation.current;
   setBusy(true);
   try{
     const result=await invoke(confirm?'confirmEnvironmentAction':'cancelEnvironmentAction',{confirmationId:prepared.confirmationId});
     if(!active.current||token!==generation.current)return;
     setPrepared(null);setBusy(false);
     if(confirm&&result){
       lastReceipt.current=record(record(result).receipt);setReceipt(lastReceipt.current);
       await load();
     }
   }finally{if(active.current&&token===generation.current)setBusy(false);}
 }
 if(!workspaceId)return <section aria-label="Ambiente del workspace"><p>Scegli un worktree per consultarne l’ambiente.</p>
   <button className="button subtle" onClick={onWorkspaces}>Vai ai workspace</button></section>;
 const environment=view?.environment as Params|undefined,plan=view?.plan as Params|null|undefined;
 const available=(method:string)=>methods.includes(`environment.${method}`);
 return <section aria-label="Ambiente del workspace">
   <div className="row-actions">
     <button className="button subtle" onClick={onWorkspaces}>Torna ai workspace</button>
     <button className="button subtle" disabled={busy||!!prepared} onClick={()=>void load()}>Aggiorna ambiente</button>
   </div>
   <p className="mono">{workspaceId}</p>
   {view?.freshness==='LAST_KNOWN'&&<p role="status">Ultimo stato noto. Per aggiornare l’ambiente avvia il servizio.</p>}
   {environment&&<dl>
     <div><dt>Stato</dt><dd>{String(environment.state)}</dd></div>
     {typeof environment.checkedAt==='string'&&<div><dt>Ultima verifica</dt><dd><time dateTime={environment.checkedAt}>{environment.checkedAt}</time></dd></div>}
     {plan&&<>
       <div><dt>Package manager</dt><dd>{String(plan.manager)} {plan.managerVersion===null?'':String(plan.managerVersion)}</dd></div>
       <div><dt>Digest degli input</dt><dd className="mono">{String(plan.inputDigest)}</dd></div>
       <div><dt>Rete</dt><dd>{plan.networkScope==='LOOPBACK'?'Registry locale':'Offline'}</dd></div>
       <div><dt>File del piano</dt><dd>{String(plan.inputFiles)}</dd></div>
       {Array.isArray(plan.scriptNames)&&plan.scriptNames.length>0&&<div><dt>Script dichiarati</dt><dd>{plan.scriptNames.join(', ')}</dd></div>}
       {plan.reason!==null&&<div><dt>Motivo</dt><dd>{String(plan.reason)}</dd></div>}
     </>}
   </dl>}
   <div className="row-actions">
     <label>Versione pnpm se assente dal manifest <input maxLength={14} value={managerVersion} onChange={event=>setManagerVersion(event.target.value)}/></label>
     <button className="button primary" disabled={!available('plan')||!workspace||workspace.state!=='READY'||busy||!!prepared}
       onClick={event=>void prepare({action:'plan',workspaceId,expectedStateRevision:workspace?.stateRevision,...(managerVersion?{managerVersion}:{})},event.currentTarget)}>
       Prepara piano d’ambiente
     </button>
   </div>
   {environment?.state==='MANUAL_REQUIRED'&&plan&&<div className="row-actions">
     <label>Limitazioni verificate <textarea maxLength={256} value={manual} onChange={event=>setManual(event.target.value)}/></label>
     <button className="button subtle" disabled={!available('attest')||!manual.trim()||busy||!!prepared}
       onClick={event=>void prepare({action:'attest',workspaceId,stateRevision:environment.stateRevision,inputDigest:plan.inputDigest,limitations:[manual]},event.currentTarget)}>
       Prepara attestazione manuale
     </button>
   </div>}
   {receipt&&<p role="status">Operazione <span className="mono">{String(receipt.requestId)}</span> · {String(receipt.phase)}
     {' '}<button className="text-button" onClick={onOperations}>Consulta operazioni</button></p>}
   {prepared&&<ConfirmationDialog prepared={prepared} busy={busy} onConfirm={()=>void finish(true)} onCancel={()=>void finish(false)} returnFocus={()=>trigger.current}/>}
 </section>;
}
