import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {TestContext} from 'node:test';
import {featureAuthoringFixture} from './feature-authoring.js';
import {createProfileRuntime,type ProfileRuntimeContext} from '../../src/core/profiles/runtime.js';
import {publishPlanningArtifact} from '../../src/core/features/artifacts.js';
import type {StoragePort} from '../../src/ports/storage.js';
import type {ProfileAction} from '../../src/core/profiles/dispatch.js';

export async function profileRuntimeFixture(t:TestContext,compose?:(context:ProfileRuntimeContext)=>Readonly<Record<string,ProfileAction>>){
 const f=await featureAuthoringFixture(t);
 const {composeProfileServices}=await import(new URL('../../src/core/profiles/registry.js',import.meta.url).href);
 const storage=new Proxy(f.store,{get(target,key){const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}}) as unknown as StoragePort;
 const runtime=createProfileRuntime({storage,paths:f.paths,instanceId:f.instanceId,compose:compose??composeProfileServices});
 runtime.start();
 async function call(method:string,params:Record<string,unknown>={}){
   return runtime.dispatch({protocolVersion:1,correlationId:randomUUID(),method:`profile.${method}`,params},f.peer,f.store.readSnapshot()!);
 }
 async function ok(method:string,params:Record<string,unknown>={}){
   const reply=await call(method,params);assert.equal(reply.result,'OK',JSON.stringify(reply));return reply.data as Record<string,unknown>;
 }
 async function upload(value:unknown){
   return publishPlanningArtifact({storage,storeId:f.store.readSnapshot()!.store.storeId,ownerUid:f.paths.ownerUid,instanceId:f.instanceId,
     targetId:randomUUID()},'BUNDLE',value);
 }
 async function prepare(action:string,intent:Record<string,unknown>,stateRevision?:string){
   return ok('prepare',{action,intent,expectedRevisions:stateRevision?{stateRevision}:{}});
 }
 async function mutate(action:string,grantId:unknown,requestId=randomUUID()){
   return (await ok(action,{grantId,requestId})).operation as {result:Record<string,string>};
 }
 return{...f,storage,call,ok,prepare,mutate,upload};
}
