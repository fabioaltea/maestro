import type {Deadline} from '../../ports/clock.js';
import type {WorkspacePort,WorkspaceRecord} from '../../ports/workspace.js';
import {REVIEW_READ_METHODS} from '../../protocol/review.js';
import {createReviewGitReader} from '../../platform/macos/git/review-reader.js';
import {createIntegrationMutator} from '../../platform/macos/git/integration-mutator.js';
import {createExecutionCheckpointCapture} from '../../platform/macos/git/execution-commit.js';
import {createReviewSnapshotServices,type ReviewServicesOptions} from './snapshot.js';
import {createReviewDispatch,type ReviewAction} from './dispatch.js';

export function nativeReviewGit(git:WorkspacePort,owned:(workspace:WorkspaceRecord)=>Promise<NonNullable<WorkspaceRecord['ownership']>>){
 return{git:createReviewGitReader(createIntegrationMutator()),captureCheckpoint:createExecutionCheckpointCapture(git,owned)};
}
export function createReviewRuntime(options:Omit<ReviewServicesOptions,'git'|'captureCheckpoint'>&{
 readGit?:Pick<ReviewServicesOptions,'git'|'captureCheckpoint'>;
}){
 const {storage,readGit}=options;
 let accepting=false;
 const running=new Set<Promise<unknown>>();
 const available=readGit&&storage.commitReviewState&&storage.readReviewState?
   createReviewSnapshotServices({...options,...readGit}):{};
 const actions:Record<string,ReviewAction>={};
 for(const [method,action] of Object.entries(available)){
   actions[method]=async(params,peer)=>{
     if(!accepting)throw new Error('BLOCKED');
     if(running.size>=4)throw new Error('BUSY');
     const result=action(params,peer);running.add(result);
     try{return await result;}finally{running.delete(result);}
   };
 }
 return{
   methods:[...REVIEW_READ_METHODS,...Object.keys(actions)],
   dispatch:createReviewDispatch(storage,actions),
   start(){accepting=true;},
   fence(){accepting=false;},
   async stop(deadline:Deadline){
     accepting=false;
     if(!running.size)return;
     let timer:ReturnType<typeof setTimeout>|undefined;
     try{await Promise.race([Promise.allSettled([...running]),new Promise<never>((_,reject)=>{
       timer=setTimeout(()=>reject(new Error('DEADLINE_EXCEEDED')),Math.max(1,deadline.remainingMs()));
     })]);}finally{clearTimeout(timer);}
   },
 };
}
