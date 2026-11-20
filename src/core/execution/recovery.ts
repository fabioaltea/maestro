import {requireExecutionIdentity} from '../../domain/execution/model.js';
import type {ExecutionRun} from '../../ports/execution.js';
import type {ExecutionContext} from './runtime.js';

export function createExecutionRecovery(options:ExecutionContext){
 const {storage,instanceId,lease,dependencies}=options;
 const query=storage.readExecutionState!;
 const commit=storage.commitExecutionState!;
 async function release(run:ExecutionRun){
   const {session}=await query({kind:'session',id:run.sessionId});
   if(!session||!lease)return;
   const current=(await storage.readWorkspaceState!({kind:'active-lease',id:session.workspaceId})).lease;
   if(!current||current.holderType!=='RUN'||current.holderId!==run.runId||current.generation!==run.generation||
      run.phase!=='FINALIZED'||run.instanceId!==current.instanceId)return;
   await lease.release(current,{...current,kind:'EXIT',hostExited:true,descendantsExited:true});
 }
 async function reconcile(run:ExecutionRun){
   if(run.phase==='FINALIZED'){await release(run);return;}
   const {session}=await query({kind:'session',id:run.sessionId});
   if(!session)throw new Error('STATE_CORRUPT');
   const held=(await storage.readWorkspaceState!({kind:'active-lease',id:session.workspaceId})).lease;
   const noLaunch=run.phase==='PREPARED'&&(!held||held.holderId!==run.runId);
   const proof=run.identity&&dependencies?.host?await (async()=>{
     try{
       const proof=await dependencies.host!.observe(run.identity!);
       if(!proof||proof.verified!==true)return null;
       requireExecutionIdentity(run.identity!,proof.identity);
       return proof;
     }catch{return null;}
   })():null;
   const beforeGo=run.phase==='PREPARED'||run.phase==='HOST_READY';
   const result=await commit({kind:'end',runId:run.runId,instanceId,generation:run.generation,proof:beforeGo?null:proof,
     noLaunch:noLaunch||beforeGo&&proof!==null,recovering:true,error:'INTERRUPTED'});
   if(result.run?.phase==='FINALIZED')await release(result.run);
 }
 return{release,reconcile,async recover(){
   const {runs}=await query({kind:'retained-leases'});
   for(const run of runs??[])await release(run);
   const {run}=await query({kind:'active'});
   if(run)await reconcile(run);
 }};
}
