import {useEffect,useRef,useState} from 'react';
import {record} from '../../shared/input.ts';
import type {Params} from '../../shared/bridge-contract.ts';
import {ConfirmationDialog,type PreparedAction} from '../components/ConfirmationDialog.tsx';
import type {Desktop} from '../state/desktop.ts';

type Kind='PROFILE'|'SKILL'|'TOOL';
const categories:Record<Kind,string>={PROFILE:'Profili',SKILL:'Skill',TOOL:'Tool'};
const initialDraft={alias:'',title:'',role:'',instructions:''};
export function AgentProfiles({desktop,onOperations}:{desktop:Desktop;onOperations():void}){
 const {core,invoke}=desktop;
 const [kind,setKind]=useState<Kind>('PROFILE'),[items,setItems]=useState<Params[]>([]),[listCursor,setListCursor]=useState<string|null>(null);
 const [details,setDetails]=useState<Params|null>(null),[projects,setProjects]=useState<Params[]>([]),[project,setProject]=useState('');
 const [methods,setMethods]=useState<string[]>([]),[live,setLive]=useState(false),[capability,setCapability]=useState<string|null>(null);
 const [draft,setDraft]=useState(initialDraft),[mode,setMode]=useState<'create'|'revise'|null>(null);
 const [prepared,setPrepared]=useState<PreparedAction|null>(null),[receipt,setReceipt]=useState<Params|null>(null),[resolved,setResolved]=useState<Params|null>(null);
 const [busy,setBusy]=useState(false),[skillPreview,setSkillPreview]=useState<Params|null>(null),[owner,setOwner]=useState('');
 const [editorSkills,setEditorSkills]=useState<Params[]|null>(null),[binding,setBinding]=useState<Record<string,string>>({});
 const [toolManifest,setToolManifest]=useState(''),[suggestions,setSuggestions]=useState<Params[]|null>(null);
 const [profileChoices,setProfileChoices]=useState<Params[]>([]);
 const generation=useRef(0),current=useRef(true),trigger=useRef<HTMLButtonElement|null>(null);
 useEffect(()=>{current.current=true;return()=>{current.current=false;generation.current++;};},[]);
 useEffect(()=>{
   const token=++generation.current;
   setDetails(null);setResolved(null);setMode(null);setItems([]);setListCursor(null);
   setSkillPreview(null);setEditorSkills(null);setOwner('');setToolManifest('');setSuggestions(null);
   void (async()=>{
     const status=await core('status');
     if(!active(token))return;
     const available=status?.liveness==='LIVE_VERIFIED',caps=status?.data.capabilities as Params|undefined;
     setLive(available);setMethods(available&&Array.isArray(caps?.profileMethods)?caps.profileMethods as string[]:[]);
     if(available&&Array.isArray(caps?.profileMethods)&&caps.profileMethods.includes('profile.capabilities')){
       const result=await core('getProfileCapabilities');
       if(!active(token))return;
       setCapability(result?.result==='OK'?String(record(result.data.capability).digest):null);
     }else setCapability(null);
     const listed=await core('listProjects');
     if(!active(token))return;
     setProjects(listed?.result==='OK'&&Array.isArray(listed.data.projects)?listed.data.projects as Params[]:[]);
     if(kind==='SKILL'){
       const catalog=await core('listProfiles',{kind:'PROFILE',...(project?{projectId:project}:{})});
       if(!active(token))return;
       setProfileChoices(catalog?.result==='OK'&&Array.isArray(catalog.data.items)?catalog.data.items as Params[]:[]);
     }
     await load(token);
   })();
 },[kind,project,core]);
 function active(token:number){return current.current&&generation.current===token;}
 const available=(action:string)=>methods.includes(`profile.${action}`);
 async function load(token=generation.current,cursor?:string){
   const data=await core('listProfiles',{kind,...(project?{projectId:project}:{}),...(cursor?{cursor}:{})});
   if(!active(token)||data?.result!=='OK')return;
   const values=Array.isArray(data.data.items)?data.data.items as Params[]:[];
   setItems(before=>cursor?[...before,...values].slice(0,200):values);
   setListCursor(typeof data.data.nextCursor==='string'?data.data.nextCursor:null);
 }
 async function show(id:unknown,token=generation.current){
   const reply=await core('getProfile',{entityId:id});
   if(active(token)&&reply?.result==='OK'){setDetails(reply.data);setMode(null);setResolved(null);setEditorSkills(null);setSuggestions(null);}
 }
 async function prepare(params:Params,button:HTMLButtonElement){
   const token=generation.current;setBusy(true);trigger.current=button;
   try{
     const reply=await invoke('prepareProfileAction',{params}) as PreparedAction|null;
     if(!reply)return;
     if(active(token))setPrepared(reply);
     else await invoke('cancelProfileAction',{confirmationId:reply.confirmationId});
   }finally{if(active(token))setBusy(false);}
 }
 async function finish(confirm:boolean){
   if(!prepared)return;
   const token=generation.current;setBusy(true);
   try{
     const response=await invoke(confirm?'confirmProfileAction':'cancelProfileAction',{confirmationId:prepared.confirmationId});
     if(!active(token))return;
     setPrepared(null);
     if(confirm&&response){
       const value=record(response),received=record(value.receipt),reply=record(value.result);
       setReceipt(received);
       if(received.outcome==='SUCCEEDED'){
         const result=record(record(record(reply.data).operation).result);
         if(result.resolutionId){
           const snapshot=await core('getProfileResolution',{resolutionId:result.resolutionId});
           if(active(token)&&snapshot?.result==='OK')setResolved(snapshot.data);
         }else if(result.entityId)await show(result.entityId,token);
         setSkillPreview(null);
         await load(token);
       }
     }
   }finally{if(active(token))setBusy(false);}
 }
 const selection=details?record(details.record):null;
 const document=details?.revision?record(record(details.revision).document):null;
 const disabled=busy||!!prepared;
 async function chooseSkill(){
   const token=generation.current;setBusy(true);
   try{
     const reply=await invoke('chooseProfileSkill',owner?{scope:'PROFILE',ownerProfileId:owner,...(project?{projectId:project}:{})}:
       project?{scope:'PROJECT',projectId:project}:{scope:'GLOBAL'});
     if(active(token)&&reply&&record(reply).preview)setSkillPreview(record(record(reply).preview));
   }finally{if(active(token))setBusy(false);}
 }
 async function showSkillEditor(){
   if(!selection||!document)return;
   const token=generation.current;
   const page=await core('listProfiles',{kind:'SKILL',...(project?{projectId:project}:{})});
   if(!active(token)||page?.result!=='OK')return;
   const entries=Array.isArray(page.data.items)?page.data.items as Params[]:[];
   const visible=entries.filter(item=>item.state!=='DISABLED'&&(!item.ownerProfileId||item.ownerProfileId===selection.entityId));
   const existing:Record<string,string>={};
   for(const key of ['requiredRefs','recommendedRefs'])if(Array.isArray(document[key])){
     for(const item of document[key] as Params[])existing[String(item.entityId)]=key;
   }
   setBinding(existing);setEditorSkills(visible);
 }
 function saveSkills(button:HTMLButtonElement){
   if(!selection||!editorSkills||!document)return;
   const preserved=(key:string)=>Array.isArray(document[key])?(document[key] as Params[]).filter(ref=>!editorSkills.some(item=>item.entityId===ref.entityId)):[];
   const refs=(key:string)=>[...preserved(key),...editorSkills.filter(item=>binding[String(item.entityId)]===key).map(({entityId,revisionId})=>({entityId,revisionId}))];
   void prepare({action:'skill.bind',entityId:selection.entityId,stateRevision:selection.stateRevision,revisionId:selection.revisionId,
     requiredRefs:refs('requiredRefs'),recommendedRefs:refs('recommendedRefs')},button);
 }
 function edit(){
   if(!selection||!document)return;
   setDraft({alias:String(selection.alias),title:String(document.title),role:String(document.role),instructions:''});setMode('revise');
 }
 return <section aria-label="Catalogo profili agente">
   <div className="row-actions" aria-label="Tipo di risorsa">
     {(Object.keys(categories) as Kind[]).map(value=><button className="button subtle" key={value} aria-pressed={kind===value}
       disabled={disabled} onClick={()=>setKind(value)}>{categories[value]}</button>)}
     <label>Progetto <select value={project} disabled={disabled} onChange={event=>setProject(event.target.value)}>
       <option value="">Catalogo globale</option>
       {projects.map(item=><option key={String(item.projectId)} value={String(item.projectId)}>{String(item.displayName)}</option>)}
     </select></label>
     <button className="button subtle" disabled={disabled} onClick={()=>void load()}>Aggiorna catalogo</button>
   </div>
   {!live&&<p role="status">Ultimo stato noto. Avvia il servizio per modificare il catalogo.</p>}
   <ul className="registry-list">{items.map(item=><li key={String(item.entityId)}><button className="button subtle" disabled={disabled}
     aria-pressed={item.entityId===selection?.entityId} onClick={()=>void show(item.entityId,++generation.current)}>{String(item.alias)}</button>
     {' '}<span>{String(item.state)}</span></li>)}</ul>
   {listCursor&&<button className="button subtle" disabled={disabled} onClick={()=>void load(generation.current,listCursor)}>Carica altri</button>}
   {kind==='PROFILE'&&<button className="button primary" disabled={!available('create')||disabled} onClick={()=>{setDraft(initialDraft);setMode('create');}}>Nuovo profilo</button>}
   {kind==='SKILL'&&<div className="row-actions">
     <label>Profilo proprietario <select value={owner} disabled={disabled} onChange={event=>setOwner(event.target.value)}>
       <option value="">Usa lo scope del catalogo</option>
       {profileChoices.filter(item=>item.state==='ENABLED').map(item=><option key={String(item.entityId)} value={String(item.entityId)}>{String(item.alias)}</option>)}
     </select></label>
     <button className="button primary" disabled={disabled||!available('skill.preview')} onClick={()=>void chooseSkill()}>Scegli cartella skill</button>
   </div>}
   {skillPreview&&<section aria-label="Anteprima skill">
     <h3>{String(skillPreview.alias)}</h3>
     <p>{String(skillPreview.scope)} · {String(skillPreview.provenance)}</p>
     <p className="mono">{String(skillPreview.sourceDigest)}</p>
     {Array.isArray(skillPreview.files)&&<ul>{(skillPreview.files as Params[]).map(file=><li key={String(file.path)}>{String(file.path)} · {String(file.bytes)} byte</li>)}</ul>}
     <button className="button primary" disabled={disabled||!available('skill.import')}
       onClick={event=>void prepare({action:'skill.import',previewId:skillPreview.previewId,sourceDigest:skillPreview.sourceDigest},event.currentTarget)}>Prepara import skill</button>
   </section>}
   {kind==='TOOL'&&available('tool.import')&&<section aria-label="Manifest tool">
     <label>Manifest JSON <textarea value={toolManifest} disabled={disabled} maxLength={16384} onChange={event=>setToolManifest(event.target.value)}/></label>
     <button className="button primary" disabled={disabled||!toolManifest.trim()} onClick={event=>{
       try{void prepare({action:'tool.import',manifest:record(JSON.parse(toolManifest))},event.currentTarget);}
       catch{desktop.setNotice('Il manifest deve essere un oggetto JSON valido.');}
     }}>Prepara import tool</button>
   </section>}
   {selection&&<section aria-label="Dettaglio profilo">
     <h3>{String(document?.title??selection.alias)}</h3>
     <dl><div><dt>Stato</dt><dd>{String(selection.state)}</dd></div><div><dt>Revisione</dt><dd>{String(selection.stateRevision)}</dd></div></dl>
     {kind==='TOOL'&&document&&<dl><div><dt>Tipo</dt><dd>{String(document.kind)}</dd></div>
       <div><dt>Permessi richiesti</dt><dd>{Array.isArray(document.requiredPermissions)?document.requiredPermissions.join(', '):''}</dd></div>
       {document.kind==='MCP'&&<div><dt>Capability</dt><dd>Non disponibile</dd></div>}
     </dl>}
     <div className="row-actions">
       {kind==='TOOL'&&selection.state==='REVIEWED'&&document?.kind==='LOCAL_COMMAND'&&<button className="button subtle"
         disabled={disabled||!available('tool.enable')} onClick={event=>void prepare({action:'tool.enable',entityId:selection.entityId,
           revisionId:selection.revisionId,stateRevision:selection.stateRevision,permissions:document.requiredPermissions},event.currentTarget)}>Prepara abilitazione tool</button>}
       {kind==='PROFILE'&&project&&<button className="button subtle" disabled={disabled||!available('suggest')} onClick={()=>void (async()=>{
         const token=generation.current,r=await core('suggestProfileExtensions',{profileId:selection.entityId,projectId:project});
         if(active(token)&&r?.result==='OK')setSuggestions(Array.isArray(r.data.suggestions)?r.data.suggestions as Params[]:[]);
       })()}>Suggerisci estensioni</button>}
       {kind==='PROFILE'&&<button className="button subtle" disabled={disabled||!available('revise')||selection.state!=='ENABLED'} onClick={edit}>Nuova revisione</button>}
       {kind==='PROFILE'&&<button className="button subtle" disabled={disabled||!available('skill.bind')||selection.state!=='ENABLED'}
         onClick={()=>void showSkillEditor()}>Associa skill</button>}
       <button className="button subtle" disabled={disabled||!available('disable')||selection.state==='DISABLED'}
         onClick={event=>void prepare({action:'disable',entityId:selection.entityId,stateRevision:selection.stateRevision},event.currentTarget)}>Prepara disabilitazione</button>
       {kind==='PROFILE'&&<button className="button subtle" disabled={disabled||!available('resolve')||!project||!capability||selection.state!=='ENABLED'}
         onClick={event=>void prepare({action:'resolve',entityId:selection.entityId,stateRevision:selection.stateRevision,revisionId:selection.revisionId,
           projectId:project,providerCapabilityDigest:capability},event.currentTarget)}>Prepara risoluzione</button>}
     </div>
   </section>}
   {editorSkills&&<section aria-label="Associazioni skill">
     {editorSkills.map(item=><label key={String(item.entityId)}>{String(item.alias)} · {String(item.scope)} <select disabled={disabled}
       value={binding[String(item.entityId)]??''} onChange={event=>setBinding({...binding,[String(item.entityId)]:event.target.value})}>
       <option value="">Nessuna</option><option value="requiredRefs">Obbligatoria</option><option value="recommendedRefs">Consigliata</option>
     </select></label>)}
     <button className="button primary" disabled={disabled} onClick={event=>saveSkills(event.currentTarget)}>Prepara associazioni</button>
   </section>}
   {mode&&<section aria-label="Definizione del profilo">
     {(['alias','title','role'] as const).map((key,index)=><label key={key}>{['Alias','Nome','Ruolo'][index]} <input value={draft[key]}
       disabled={disabled||key==='alias'&&mode==='revise'} maxLength={key==='title'?100:64} onChange={event=>setDraft({...draft,[key]:event.target.value})}/></label>)}
     <label>Istruzioni <textarea value={draft.instructions} disabled={disabled} maxLength={16384} onChange={event=>setDraft({...draft,instructions:event.target.value})}/></label>
     <button className="button primary" disabled={disabled||Object.values(draft).some(value=>!value.trim())}
       onClick={event=>void prepare(mode==='create'?{action:'create',scope:project?'PROJECT':'GLOBAL',...(project?{projectId:project}:{}),bundle:draft}:
         {action:'revise',entityId:selection?.entityId,stateRevision:selection?.stateRevision,bundle:{...document,...draft}},event.currentTarget)}>Prepara salvataggio</button>
     <button className="button subtle" disabled={disabled} onClick={()=>setMode(null)}>Chiudi modifica</button>
   </section>}
   {suggestions&&<section aria-label="Estensioni compatibili">{suggestions.length?
     <ul>{suggestions.map(value=><li key={String(value.entityId)}>{String(value.alias)} · permessi compatibili</li>)}</ul>:<p>Nessuna estensione compatibile.</p>}</section>}
   {resolved&&<p role="status">Permessi effettivi {String(record(record(resolved.resolution).snapshot).effectivePermissions||'')||'nessuno'}</p>}
   {receipt&&<p role="status">Operazione <span className="mono">{String(receipt.requestId)}</span> · {String(receipt.phase)}
     {' '}<button className="text-button" onClick={onOperations}>Consulta operazioni</button></p>}
   {prepared&&<ConfirmationDialog prepared={prepared} busy={busy} onConfirm={()=>void finish(true)} onCancel={()=>void finish(false)} returnFocus={()=>trigger.current}/>}
 </section>;
}
