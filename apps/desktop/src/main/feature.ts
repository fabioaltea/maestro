import {randomUUID} from 'node:crypto';
import {basename} from 'node:path';
import {open} from 'node:fs/promises';
import {constants} from 'node:fs';
import type {CorePort,DialogPort} from './ports.ts';
import {ArchiveContext} from './archive-context.ts';
import type {ActionService} from './action-handlers.ts';
import type {BridgeRouter} from './bridge.ts';
import {FEATURE_QUERIES,FEATURE_QUERY_MAP,validateFeatureAction,validateFeatureData} from '../shared/feature-contract.ts';
import {record,uuid} from '../shared/validation.ts';
import type {Params} from '../shared/bridge-contract.ts';
import {publicReceipt} from './lifecycle.ts';
export class FeatureActions{
 private handles=new Map<string,{path:string;epoch:number;owner:string;expires:number}>();private choosing=false;
 private options:{context:ArchiveContext;core:CorePort;dialogs:DialogPort;owner():{owner:number;frame:number}};
 constructor(options:{context:ArchiveContext;core:CorePort;dialogs:DialogPort;owner():{owner:number;frame:number}}){this.options=options;options.context.onChange(()=>this.handles.clear());}
 private owner(){return JSON.stringify(this.options.owner());}
 async chooseBundle(){if(this.choosing||!this.options.dialogs.chooseFile)throw new Error('LOCAL_BUSY');this.choosing=true;const c=this.options.context.capture(),owner=this.owner();try{const path=await this.options.dialogs.chooseFile('Scegli il bundle JSON della feature');if(!path)return null;if(c.view.selectionEpoch!==this.options.context.capture().view.selectionEpoch||owner!==this.owner())throw new Error('STALE_CONTEXT');for(const[k,h]of this.handles)if(h.expires<Date.now())this.handles.delete(k);if(this.handles.size>=8)throw new Error('LOCAL_BUSY');const bundleHandle=randomUUID();this.handles.set(bundleHandle,{path,epoch:c.view.selectionEpoch,owner,expires:Date.now()+60000});return{bundleHandle,displayName:basename(path)};}finally{this.choosing=false;}}
 async read(method:string,p:Params){const q=Object.hasOwn(FEATURE_QUERY_MAP,method)?FEATURE_QUERY_MAP[method]:undefined;if(!q)throw new Error('INVALID_INPUT');const c=this.options.context.capture(),r=await this.options.core.call({namespace:'feature',action:q.action,archive:c.path,params:p,scope:'view'});this.options.context.apply(c,r);return{...r,data:validateFeatureData(q.action,r.data)};}
 async resolve(action:string,raw:Params){const p=validateFeatureAction(action,raw),c=this.options.context.capture();const command=(a:string,params:Params)=>({namespace:'feature' as const,action:a,archive:c.path,params,...(typeof p.featureId==='string'?{featureId:p.featureId,expectedStateRevision:p.expectedStateRevision as string}:{}),...(typeof p.projectId==='string'?{projectId:p.projectId}:{})});
 if(action==='feature.artifact.import'){
 let bundle=p.bundle;if(p.bundleHandle){const h=this.handles.get(uuid(p.bundleHandle));this.handles.delete(uuid(p.bundleHandle));if(!h||h.epoch!==c.view.selectionEpoch||h.owner!==this.owner()||h.expires<Date.now())throw new Error('STALE_CONTEXT');const f=await open(h.path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);try{const a=await f.stat({bigint:true});if(!a.isFile()||a.size>262144n)throw new Error('INVALID_INPUT');const b=Buffer.alloc(262145);let n=0;while(n<b.length){const r=await f.read(b,n,b.length-n,null);if(!r.bytesRead)break;n+=r.bytesRead;}const z=await f.stat({bigint:true});if(n>262144||a.dev!==z.dev||a.ino!==z.ino||a.size!==z.size||a.mtimeNs!==z.mtimeNs||a.ctimeNs!==z.ctimeNs)throw new Error('INVALID_INPUT');bundle=new TextDecoder('utf-8',{fatal:true}).decode(b.subarray(0,n));}finally{await f.close();}}
 if(typeof bundle!=='string'||!bundle.length||Buffer.byteLength(bundle)>262144)throw new Error('INVALID_INPUT');JSON.parse(bundle);return{command:command('artifact.import',{bundle}),summary:['Conserva il documento nell’archivio locale']};
 }
 if(action==='feature.artifact.import-answer')return{command:{namespace:'feature' as const,action:'artifact.import-answer',archive:c.path,params:p},summary:['Conserva la risposta nell’archivio locale']};
 const a=action.slice(8),r=await this.options.core.call(command('prepare',{action:a,...p}));this.options.context.apply(c,r);if(r.result!=='OK')throw new Error(r.error?.code??'OPERATION_UNCERTAIN');const data=validateFeatureData('prepare',r.data),intent=record(JSON.parse(String(data.canonicalIntent)));
 if(intent.action!==a||intent.storeId!==r.storeId||p.featureId!==undefined&&intent.targetId!==p.featureId||p.projectId!==undefined&&intent.projectId!==p.projectId)throw new Error('CLIENT_PROTOCOL_ERROR');const payload=record(intent.payload);if(p.bundleArtifactId!==undefined&&payload.bundleArtifactId!==p.bundleArtifactId)throw new Error('CLIENT_PROTOCOL_ERROR');
 if(p.expectedStateRevision!==undefined&&intent.expectedRevision!==p.expectedStateRevision
   ||p.revisionId!==undefined&&payload.revisionId!==p.revisionId
   ||p.contextSnapshotId!==undefined&&payload.contextSnapshotId!==p.contextSnapshotId
   ||p.turnId!==undefined&&payload.parentTurnId!==p.turnId
   ||p.questionId!==undefined&&payload.questionId!==p.questionId
   ||p.answerArtifactId!==undefined&&payload.answerArtifactId!==p.answerArtifactId
   ||Array.isArray(p.acceptedUnknownIds)&&JSON.stringify(payload.acceptedUnknownIds)!==JSON.stringify([...p.acceptedUnknownIds].sort()))throw new Error('CLIENT_PROTOCOL_ERROR');
 const label:Record<string,string>={create:'Crea feature',revise:'Salva nuova revisione',archive:'Archivia feature',approve:'Approva specifica e piano',handoff:'Genera handoff per l’implementazione',generate:'Genera bozza assistita',answer:'Invia risposta e avvia un nuovo turno',cancel:'Interrompi il turno assistito'};
 const summary=[label[a]!,`Progetto: ${intent.projectId}`,`Feature: ${intent.targetId}`];
 if(typeof payload.revisionId==='string'&&['approve','handoff'].includes(a))summary.push(`Revisione: ${payload.revisionId}`);
 if(typeof payload.bundleDigest==='string')summary.push(`Digest documento: ${payload.bundleDigest}`);
 if(a==='approve'&&Array.isArray(payload.acceptedUnknownIds)&&payload.acceptedUnknownIds.length)summary.push(`Incognite accettate: ${payload.acceptedUnknownIds.join(', ')}`);
 if(a==='handoff')summary.push('Conserva un riferimento versionato nell’archivio locale.');
 if(a==='generate'||a==='answer'){
 const configuration=record(payload.configuration);
 summary.push(`Snapshot Discovery: ${payload.contextSnapshotId}`,`Provider e modello: ${configuration.providerId} / ${configuration.modelId}`,
   'Invia al provider qualificato il contesto approvato, il documento e le risposte di questo percorso in sola lettura.');
 }
 if(a==='answer')summary.push(`Domanda: ${payload.questionId}`,`Digest risposta: ${payload.answerDigest}`);
 if(a==='cancel')summary.push(`Turno: ${payload.turnId}`);
 return{command:{...command(a,{grantId:data.grantId}),featureId:intent.targetId as string,projectId:intent.projectId as string},summary};
 }
}
export function installFeature(router:BridgeRouter,context:ArchiveContext,actions:ActionService|null){
 if(!router.services.core)return null;const feature=new FeatureActions({context,core:router.services.core,dialogs:router.services.dialogs,owner:()=>({owner:router.window.webContents.id,frame:router.window.webContents.mainFrame.routingId})});if(actions)actions.resolveFeature=(a,p)=>feature.resolve(a,p);
 const sync=async<T>(work:()=>Promise<T>)=>{try{return await work();}finally{router.setContext(context.current?.view??null);}};
 router.register('chooseFeatureBundle',()=>sync(async()=>({bundle:await feature.chooseBundle()})));
 for(const method of Object.keys(FEATURE_QUERIES))router.register(method as Parameters<typeof router.register>[0],request=>{const{bridgeVersion:_v,callId:_c,selectionEpoch:_e,...p}=request;return sync(()=>feature.read(method,p));});
 for(const [method,action] of [['importFeatureBundle','feature.artifact.import'],['importFeatureAnswer','feature.artifact.import-answer']] as const){
 router.register(method,request=>sync(async()=>{if(!actions)throw new Error('RUNTIME_UNAVAILABLE');const{bridgeVersion:_v,callId:_c,selectionEpoch:_e,...p}=request;const prepared=await actions.prepare(action,p);const r=await actions.confirm(prepared.confirmationId,['feature']);return{...r,receipt:publicReceipt(r.receipt,context)};}));
 }
 router.register('prepareFeatureAction',request=>sync(()=>{if(!actions)throw new Error('RUNTIME_UNAVAILABLE');const{action,...p}=record(request.params);return actions.prepare(`feature.${action}`,p);}));
 router.register('confirmFeatureAction',request=>sync(async()=>{if(!actions)throw new Error('RUNTIME_UNAVAILABLE');const r=await actions.confirm(uuid(request.confirmationId),['feature']);return{...r,receipt:publicReceipt(r.receipt,context)};}));
 router.register('cancelFeatureAction',request=>{actions?.confirmations.cancel(uuid(request.confirmationId),['feature']);return{cancelled:true};});return feature;
}
