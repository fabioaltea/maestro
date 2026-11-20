import type {BridgeRouter} from './bridge.ts';
import type {ArchiveContext} from './archive-context.ts';
import {ArchiveReader} from './read-handlers.ts';
import {REVIEW_QUERIES,reviewBridgeAction} from '../shared/review-contract.ts';
import {record,revision,text,uuid} from '../shared/input.ts';
import type {ActionService} from './action-handlers.ts';
import {publicReceipt} from './lifecycle.ts';
import type {CliCommand} from './ports.ts';

export function installReview(router:BridgeRouter,context:ArchiveContext,actions:ActionService|null){
 const core=router.services.core;
 if(!core)return;
 const reader=new ArchiveReader(context,core);
 const sync=async<T>(work:()=>Promise<T>)=>{try{return await work();}finally{router.setContext(context.current?.view??null);}};
 if(actions)actions.resolveReview=async(route,params)=>{
   const {action,input}=reviewBridgeAction({...params,action:route.slice('review.'.length)}),c=context.capture();
   const reply=await core.call({namespace:'review',action:'prepare',archive:c.path,params:{action,...input}});
   context.apply(c,reply);
   if(reply.result!=='OK'||reply.liveness!=='LIVE_VERIFIED')throw new Error(reply.error?.code??'DAEMON_UNAVAILABLE');
   const summary=record(reply.data.summary),target=uuid(action==='integrate'?input.candidateId:input.reviewId??input.featureId),projectId=uuid(input.projectId);
   if(summary.action!==action)throw new Error('CLIENT_PROTOCOL_ERROR');
   let preview:string[],stateRevision:string;
   if(action==='candidate.prepare'||action==='approve'||action==='integrate'){
     if(summary.targetId!==target||summary.projectId!==projectId||summary.stateRevision!==input.stateRevision)
       throw new Error('CLIENT_PROTOCOL_ERROR');
     stateRevision=revision(summary.stateRevision);
     const targetRef=text(summary.targetRef,266),targetOid=text(summary.targetOid,64);
     if(action==='candidate.prepare'){
       if(!['FAST_FORWARD','MERGE_COMMIT'].includes(String(summary.strategy)))throw new Error('CLIENT_PROTOCOL_ERROR');
       preview=['Prepara il candidate',`Target ${targetRef} · ${targetOid}`,`Sorgente ${text(summary.sourceOid,64)}`,
         summary.strategy==='FAST_FORWARD'?'Strategia fast-forward':`Merge commit · ${text(summary.author,120)}`];
     }else{
       if(summary.reviewId!==input.reviewId||action==='approve'&&summary.evidenceDigest!==input.evidenceDigest||
          action==='integrate'&&targetOid!==input.expectedTargetOid)throw new Error('CLIENT_PROTOCOL_ERROR');
       preview=[action==='approve'?'Approva il candidate':'Integra localmente il candidate',`Target ${targetRef} · ${targetOid}`,
         `Candidate ${text(summary.candidateOid,64)}`,`Tree ${text(summary.treeOid,64)}`,`Prove ${text(summary.evidenceDigest,64)}`];
     }
   }else if(action==='validate'){
     const expected=input.commandSpecIds as string[],checks=Array.isArray(summary.checks)?summary.checks.map(record):[];
     if(summary.reviewId!==target||summary.stateRevision!==input.stateRevision||checks.length!==expected.length||
       checks.some((check,index)=>check.commandSpecId!==expected[index]||!/^[0-9a-f]{64}$/.test(text(check.commandDigest,64))))
       throw new Error('CLIENT_PROTOCOL_ERROR');
     stateRevision=revision(summary.stateRevision);
     preview=['Esegui i controlli approvati',`Revisione ${target}`,`Tree ${text(summary.treeOid,64)}`,`Piano ${uuid(summary.planId)}`,
       ...checks.map(check=>`Comando ${check.commandSpecId} · SHA-256 ${check.commandDigest}`)];
   }else{
     const payload=record(summary.payload);
     if(summary.targetId!==target||summary.projectId!==projectId)throw new Error('CLIENT_PROTOCOL_ERROR');
     stateRevision=revision(summary.expectedRevision);
     if(action==='create'){
       if(payload.checkpointId!==input.checkpointId||payload.targetRef!==input.targetRef||payload.targetOid!==input.targetOid)
         throw new Error('CLIENT_PROTOCOL_ERROR');
       preview=['Crea snapshot di revisione',`Feature ${target}`,`Checkpoint ${payload.checkpointId}`,
         `Sorgente ${text(payload.sourceOid,64)}`,`Target ${payload.targetRef} · ${payload.targetOid}`];
     }else{
       if(stateRevision!==input.stateRevision||payload.feedbackArtifactId!==input.feedbackArtifactId)throw new Error('CLIENT_PROTOCOL_ERROR');
       preview=['Richiedi modifiche',`Revisione ${target}`,`Feedback ${payload.feedbackArtifactId}`,`Snapshot ${text(payload.digest,64)}`];
     }
   }
   const command:CliCommand={namespace:'review',action,archive:c.path,reviewTarget:target,projectId,expectedStateRevision:stateRevision,
     ...(input.reviewId?{reviewId:uuid(input.reviewId)}:{}),params:{grantId:uuid(reply.data.grantId)}};
   return{command,summary:[...preview,`Versione ${stateRevision}`]};
 };
 for(const method of REVIEW_QUERIES)router.register(method,async request=>{
   const {bridgeVersion:_version,callId:_call,selectionEpoch:_epoch,...params}=request;
   try{return await reader.read(method,params);}
   finally{router.setContext(context.current?.view??null);}
 });
 router.register('prepareReviewAction',request=>sync(()=>{
   if(!actions)throw new Error('RUNTIME_UNAVAILABLE');
   const {action,input}=reviewBridgeAction(request.params);
   return actions.prepare(`review.${action}`,input);
 }));
 router.register('confirmReviewAction',request=>sync(async()=>{
   if(!actions)throw new Error('RUNTIME_UNAVAILABLE');
   const result=await actions.confirm(uuid(request.confirmationId),['review']);
   return{...result,receipt:publicReceipt(result.receipt,context)};
 }));
 router.register('cancelReviewAction',request=>{
   actions?.confirmations.cancel(uuid(request.confirmationId),['review']);
   return{cancelled:true};
 });
}
