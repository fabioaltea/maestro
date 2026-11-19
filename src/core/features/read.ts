import {FEATURE_PLANNING_LIMITS,validatePlanningResult} from '../../domain/features/planning.js';
import {readSealedFeatureArtifact} from './artifacts.js';
import type {StoragePort} from '../../ports/storage.js';
import type {FeatureQuery} from '../../ports/workflow.js';
import {publicFeatureOperation,requireFeatureEnvelope,validateFeatureParams} from '../../protocol/feature.js';
import {UNAVAILABLE_FEATURE_PLANNING_CAPABILITIES as FEATURE_PLANNING_CAPABILITIES} from '../../ports/feature.js';
import {featureObject,featureFields} from '../../domain/features/bundle.js';
/** Historical reader: never constructs a provider, extractor, writer or implicit check. */
export function createFeatureReader(options:{readonly storage:Pick<StoragePort,'readFeatureState'|'readWorkflowArtifact'>;readonly storeId:string;readonly offline:boolean}){
 const {storage,storeId,offline}=options;
 async function query(q:FeatureQuery){if(!storage.readFeatureState)throw new Error('FEATURE_NOT_INITIALIZED');return storage.readFeatureState(q);}
 function cursor(target:string,revision:string,offset:number){return Buffer.from(JSON.stringify({storeId,target,revision,offset})).toString('base64url');}
 function offset(raw:unknown,target:string,revision:string){if(raw===undefined)return 0;if(typeof raw!=='string'||raw.length>4096)throw new Error('INVALID_REQUEST');let p:Record<string,unknown>;try{p=featureObject(JSON.parse(Buffer.from(raw,'base64url').toString('utf8')));}catch{throw new Error('INVALID_REQUEST');}featureFields(p,['storeId','target','revision','offset']);if(p.storeId!==storeId||p.target!==target||p.revision!==revision)throw new Error('REVISION_CONFLICT');if(typeof p.offset!=='number'||!Number.isSafeInteger(p.offset)||p.offset<0)throw new Error('INVALID_REQUEST');return p.offset;}
 return async(method:string,p:Readonly<Record<string,unknown>>):Promise<Record<string,unknown>>=>{
 validateFeatureParams(method,p);let data:Record<string,unknown>;
 if(method==='feature.provider.get')data={capabilities:FEATURE_PLANNING_CAPABILITIES,reason:'PLANNING_UNAVAILABLE'};
 else if(method==='feature.artifact.budget')data={budget:(await query({kind:'budget'})).budget};
 else if(method==='feature.operation.get'){const o=(await query({kind:'operation',id:p.requestId as string})).operation;if(!o||o.namespace==='WORKSPACE')throw new Error('OPERATION_NOT_FOUND');data={operation:publicFeatureOperation(o)};}
 else if(method==='feature.eligibility.get')data={featureId:p.featureId,eligible:false,reason:offline?'UNKNOWN':'CHECKING',freshness:offline?'LAST_KNOWN':'UNKNOWN',checkId:null,checkedAt:null};
 else if(method==='feature.artifact.get'){
 const id=p.artifactId as string,a=(await query({kind:'artifact',id})).artifact;if(!a||!['SEALED','REFERENCED'].includes(a.state))throw new Error('ARTIFACT_CORRUPT');const at=offset(p.cursor,id,a.sha256);if(!storage.readWorkflowArtifact)throw new Error('FEATURE_NOT_INITIALIZED');const r=await storage.readWorkflowArtifact(id,at,8192);data={artifactId:id,sha256:r.sha256,totalBytes:r.totalBytes,offset:at,base64:Buffer.from(r.bytes).toString('base64'),nextCursor:at+r.bytes.length<r.totalBytes?cursor(id,r.sha256,at+r.bytes.length):null};
 }else if(method==='feature.list'||method==='feature.revisions.list'){
 const kind=method==='feature.list'?'features':'revisions',id=(p.projectId??p.featureId) as string;
 const head=await query({kind,id,offset:0,limit:(p.limit as number|undefined)??20});const revision=head.pageRevision;if(!revision)throw new Error('STATE_CORRUPT');
 const at=offset(p.cursor,id,revision),page=at===0?head:await query({kind,id,offset:at,limit:(p.limit as number|undefined)??20});if(page.pageRevision!==revision)throw new Error('REVISION_CONFLICT');data={items:page.items,nextCursor:page.nextOffset===null?null:cursor(id,revision,page.nextOffset!)};
 }else if(method==='feature.planning.get'||method==='feature.questions.list'||method==='feature.output.list'){
 const turn=(await query(method==='feature.questions.list'?{kind:'latestTurn',id:p.featureId as string}:{kind:'turn',id:p.turnId as string})).turn;
 if(!turn)throw new Error('FEATURE_NOT_FOUND');
 if(method==='feature.planning.get'){
 const {turnId,featureId,revisionId,contextSnapshotId,turnIndex,phase,questionIds,resultArtifactId,createdAt,completedAt,error}=turn;
 data={turn:{turnId,featureId,revisionId,contextSnapshotId,turnIndex,phase,questionIds,resultArtifactId,createdAt,completedAt,error,...(turn.configuration?{configuration:turn.configuration}:{})}};
 }else{
 const at=offset(p.cursor,turn.turnId,turn.phase),limit=(p.limit as number|undefined)??20;
 let items:readonly unknown[]=[];
 if(method==='feature.questions.list'&&turn.phase==='WAITING_USER'&&turn.resultArtifactId){
 const {text}=await readSealedFeatureArtifact(storage,turn.resultArtifactId,'OUTPUT',FEATURE_PLANNING_LIMITS.resultBytes,turn.featureId);
 const result=validatePlanningResult(JSON.parse(text),{sourceIds:[],answerIds:[]});
 if(result.kind!=='QUESTIONS'||JSON.stringify(result.questions.map(q=>q.questionId))!==JSON.stringify(turn.questionIds))throw new Error('ARTIFACT_CORRUPT');
 items=result.questions;
 }else if(method==='feature.output.list'&&turn.resultArtifactId){
 const a=(await query({kind:'artifact',id:turn.resultArtifactId})).artifact;
 if(!a||a.state!=='REFERENCED'||a.targetId!==turn.featureId)throw new Error('ARTIFACT_CORRUPT');
 items=[{artifactId:a.artifactId,sha256:a.sha256,expectedBytes:a.expectedBytes,kind:a.kind,partial:!['SUCCEEDED','WAITING_USER'].includes(turn.phase)}];
 }
 let end=Math.min(at+limit,items.length);
 while(end>at+1&&Buffer.byteLength(JSON.stringify(items.slice(at,end)))>27000)end--;
 data={turnId:turn.turnId,items:items.slice(at,end),nextCursor:end<items.length?cursor(turn.turnId,turn.phase,end):null};
 }
 }else{
 const map:Record<string,[FeatureQuery['kind'],string,string]>={'feature.get':['feature','featureId','feature'],'feature.revision.get':['revision','revisionId','revision'],'feature.approval.get':['approval','revisionId','approval'],'feature.envelope.get':['envelope','envelopeId','envelope']};const info=map[method];if(!info)throw new Error('UNSUPPORTED_VERSION');const [kind,key,resultKey]=info;const r=await query({kind,id:p[key] as string} as FeatureQuery);const value=r[resultKey as keyof typeof r];if(!value)throw new Error('FEATURE_NOT_FOUND');data={[resultKey]:value,...(kind==='revision'?{contextSnapshotId:r.contextSnapshotId}: {})};
 }
 const result={...data,freshness:offline?'LAST_KNOWN':'CURRENT'};requireFeatureEnvelope(result);return result;
 };
}
