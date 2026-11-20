import {makeDeadline,systemClock,type Deadline} from '../../ports/clock.js';
import type {OwnedWorkspaceFilesPort,WorkspacePort,WorkspaceRecord} from '../../ports/workspace.js';
import {REVIEW_READ_METHODS} from '../../protocol/review.js';
import {createReviewGitReader} from '../../platform/macos/git/review-reader.js';
import {createIntegrationMutator} from '../../platform/macos/git/integration-mutator.js';
import {createReviewSnapshotServices,type ReviewServicesOptions} from './snapshot.js';
import {createReviewDispatch,type ReviewAction} from './dispatch.js';
import {createReviewValidation,type RunReviewCheck} from './validation.js';
import {createReviewIntegration,type ReviewIntegrationPorts} from './integrate.js';

export function nativeReviewGit(git:WorkspacePort,owned:(workspace:WorkspaceRecord)=>Promise<NonNullable<WorkspaceRecord['ownership']>>){
 return{git:createReviewGitReader(createIntegrationMutator()),async captureCheckpoint(workspace:WorkspaceRecord){
   if(!git.captureCheckpoint)throw new Error('CHECKPOINT_STALE');
   return git.captureCheckpoint(workspace.target,await owned(workspace),makeDeadline(systemClock,8000));
 }};
}
export type ReviewGitServices=Pick<ReviewServicesOptions,'git'|'captureCheckpoint'>;
export const nativeReviewIntegration=(files:OwnedWorkspaceFilesPort):ReviewIntegrationPorts=>({files,git:createIntegrationMutator()});
export function createReviewRuntime(options:Omit<ReviewServicesOptions,keyof ReviewGitServices|'requireAccepting'>&{
 readGit?:ReviewGitServices;
 runCheck?:RunReviewCheck;
 integration?:ReviewIntegrationPorts;
}){
 const {storage,readGit}=options;
 let accepting=false;
 const running=new Set<Promise<unknown>>();
 const admits=new Map<string,{method:string;grantId:unknown;result:Promise<Record<string,unknown>>}>();
 function requireAccepting(){if(!accepting)throw new Error('BLOCKED');}
 const services=readGit&&storage.commitReviewState&&storage.readReviewState&&storage.readFeatureState&&
   storage.commitFeatureState&&storage.readWorkflowArtifact&&storage.readWorkspaceState&&storage.readExecutionState?
   {...options,...readGit,requireAccepting}:null;
 const available=services?{...createReviewSnapshotServices(services)}:{};
 function track<T>(result:Promise<T>){
   running.add(result);
   void result.finally(()=>running.delete(result)).catch(()=>{});
   return result;
 }
 const runCheck=options.runCheck;
 const schedule=(work:()=>Promise<void>)=>{track(Promise.resolve().then(work));};
 const validation=services&&runCheck&&storage.readEnvironmentState?createReviewValidation({...services,runCheck,schedule}):null;
 if(validation){
   const prepare=available['review.prepare']!;
   available['review.prepare']=(params,peer)=>params.action==='validate'?validation.prepare(params,peer):prepare(params,peer);
   available['review.validate']=validation.submit;
 }
 const integration=services&&validation&&options.integration&&storage.settleWorkspaceClaim?
   createReviewIntegration({...services,integration:options.integration,schedule}):null;
 if(integration){
   const prepare=available['review.prepare']!;
   available['review.prepare']=(params,peer)=>['candidate.prepare','approve','integrate'].includes(String(params.action))?
     integration.prepare(params,peer):prepare(params,peer);
   Object.assign(available,integration.actions);
 }
 const actions:Record<string,ReviewAction>={};
 for(const [method,action] of Object.entries(available)){
   actions[method]=async(params,peer)=>{
     requireAccepting();
     const requestId=typeof params.requestId==='string'?params.requestId:null;
     const previous=requestId?admits.get(requestId):undefined;
     if(previous){
       if(previous.method!==method||previous.grantId!==params.grantId)throw new Error('BUSY');
       return previous.result;
     }
     if(running.size>=4)throw new Error('BUSY');
     const result=track(action(params,peer));
     if(requestId)admits.set(requestId,{method,grantId:params.grantId,result});
     try{return await result;}finally{
       if(requestId)admits.delete(requestId);
     }
   };
 }
 return{
   methods:[...REVIEW_READ_METHODS,...Object.keys(actions)],
   dispatch:createReviewDispatch(storage,actions),
   start(){accepting=true;},
   async idle(){while(running.size)await Promise.allSettled([...running]);},
   async recover(){
     if(!storage.commitReviewState||!storage.readReviewState||((await storage.readSnapshot())?.store.schemaVersion??0)<11)return;
     const {operations}=await storage.readReviewState({kind:'pending-snapshots'});
     for(const {requestId} of operations??[])await storage.commitReviewState({kind:'recover-snapshot',instanceId:options.instanceId,requestId});
     await validation?.recover();
     await integration?.recover();
   },
   fence(){accepting=false;},
   async stop(deadline:Deadline){
     accepting=false;
     if(!running.size)return;
     let timer:ReturnType<typeof setTimeout>|undefined;
     try{await Promise.race([(async()=>{while(running.size)await Promise.allSettled([...running]);})(),new Promise<never>((_,reject)=>{
       timer=setTimeout(()=>reject(new Error('DEADLINE_EXCEEDED')),Math.max(1,deadline.remainingMs()));
     })]);}finally{clearTimeout(timer);}
   },
 };
}
