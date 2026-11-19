import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import type {TestContext} from 'node:test';
import {reviewFixture,reviewDraft} from './discovery-review.js';
import {value} from './discovery-artifacts.js';
import {createFeatureRuntime} from '../../src/core/features/runtime.js';
import type {StoragePort} from '../../src/ports/storage.js';
import type {AuthenticatedPeer,RpcRequest,RpcResponse} from '../../src/ports/platform.js';
import type {DiscoveryEligibility} from '../../src/domain/discovery/approval.js';
import type {FeatureBundle} from '../../src/ports/feature.js';
import type {Deadline} from '../../src/ports/clock.js';
interface Runtime {
 dispatch(r:RpcRequest,p:AuthenticatedPeer,s:NonNullable<Awaited<ReturnType<StoragePort['readSnapshot']>>>):Promise<RpcResponse>;
 idle():Promise<void>;fence():void;recover():Promise<void>;stop(d:Deadline):Promise<void>;
}
export async function featureAuthoringFixture(t:TestContext,settings:{loseCreateReply?:boolean}={}){
 const f=await reviewFixture(t);await f.service.publishDocument(await f.exit(),reviewDraft());
 const revision=value(f.store.readDiscoveryMetadata({kind:'revision',id:f.discovery().latestDocumentRevisionId!})).data!;
 const c=await f.command('approve',{revisionId:revision.revisionId,bundleDigest:revision.bundleDigest,acceptedUnknownIds:reviewDraft().sections.map(s=>`${s.id}:0`)});
 value(await f.service.approve(f.peer,c));await f.service.idle();
 const make=createFeatureRuntime as unknown as (s:StoragePort,p:typeof f.paths,id:string,dependencies:{currentEligibility(peer:AuthenticatedPeer,projectId:string):Promise<DiscoveryEligibility>})=>Runtime;
 let loseReply=settings.loseCreateReply===true;
 const storage=new Proxy(f.store,{get(target,key){const v=Reflect.get(target,key) as unknown;if(key==='commitFeatureState')return async(change:import('../../src/ports/workflow.js').WorkflowChange)=>{const result=Reflect.apply(v as (...args:unknown[])=>unknown,target,[change]);if(loseReply&&change.kind==='create'){loseReply=false;throw new Error('DEADLINE_EXCEEDED');}return result;};return typeof v==='function'?v.bind(target):v;}}) as unknown as StoragePort;
 const runtime=make(storage,f.paths,f.instanceId,{currentEligibility:(peer,projectId)=>(f.service as unknown as {currentEligibility(peer:AuthenticatedPeer,projectId:string):Promise<DiscoveryEligibility>}).currentEligibility(peer,projectId)});
 await runtime.recover();
 const send=(method:string,params:Record<string,unknown>,peer=f.peer)=>runtime.dispatch({protocolVersion:1,correlationId:randomUUID(),method,params},peer,f.store.readSnapshot()!);
 const checked=(r:RpcResponse)=>{const data=r.data as Record<string,unknown>;assert.ok(r.result==='OK'||r.result==='BUSY',JSON.stringify(r));return data;};
 async function upload(bundle:FeatureBundle){const bytes=Buffer.from(JSON.stringify(bundle)),sha256=createHash('sha256').update(bytes).digest('hex'),requestId=randomUUID();
 const a=checked(await send('feature.artifact.reserve',{requestId,kind:'BUNDLE',expectedBytes:bytes.length,sha256})).artifact as {artifactId:string};
 for(let offset=0;offset<bytes.length;offset+=8192){const b=bytes.subarray(offset,offset+8192);checked(await send('feature.artifact.append',{requestId:randomUUID(),uploadId:a.artifactId,offset,chunkSha256:createHash('sha256').update(b).digest('hex'),base64:b.toString('base64')}));}
 checked(await send('feature.artifact.seal',{requestId:randomUUID(),uploadId:a.artifactId,expectedBytes:bytes.length,sha256}));return a.artifactId;
 }
 const prepareFeature=async(action:string,params:Record<string,unknown>)=>checked(await send('feature.prepare',{action,...params}));
 const execute=async(action:string,grantId:string,requestId=randomUUID())=>{const result=await send(`feature.${action}`,{requestId,grantId});await runtime.idle();return{requestId,response:result,operation:f.store.readFeatureState({kind:'operation',id:requestId}).operation};};
 return{...f,runtime,send,checked,upload,prepareFeature,execute};
}
