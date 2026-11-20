import {featureObject,featureText} from '../../domain/features/bundle.js';
import {executionInteractionText} from '../../domain/execution/interaction.js';
import {executionJsonLines} from '../../domain/execution/stream.js';
import {EXECUTION_LIMITS} from '../../domain/execution/model.js';
import type {ExecutionOutputEvent} from '../../ports/execution-output.js';

export function codexExecutionEvent(value:unknown):ExecutionOutputEvent|null{
 const frame=featureObject(value);
 if(typeof frame.method!=='string'){
   if((typeof frame.id==='number'||typeof frame.id==='string')&&(Object.hasOwn(frame,'result')||Object.hasOwn(frame,'error')))return null;
   throw new Error('PROVIDER_PROTOCOL_ERROR');
 }
 const p=featureObject(frame.params);
 switch(frame.method){
   case 'item/agentMessage/delta':
     return{kind:'TEXT',text:featureText(p.delta,EXECUTION_LIMITS.outputChunkBytes,true)};
   case 'item/tool/call':
     return{kind:'TOOL_REQUEST',correlation:requestId(frame.id),name:featureText(p.tool,64,true),input:featureObject(p.arguments)};
   case 'item/tool/requestUserInput':{
     const q=p.questions;
     if(!Array.isArray(q)||q.length<1||q.length>EXECUTION_LIMITS.interactions)throw new Error('PROVIDER_PROTOCOL_ERROR');
     return{kind:'QUESTION',correlation:requestId(frame.id),questions:q.map(value=>{
       const question=featureObject(value);
       return{id:featureText(question.id,128,true),text:executionInteractionText(question.question)};
     })};
   }
   case 'turn/completed':
     return featureObject(p.turn).status==='completed'?{kind:'COMPLETED'}:{kind:'FAILED'};
   case 'error':return{kind:'FAILED'};
   case 'thread/started':case 'turn/started':case 'item/started':case 'item/completed':case 'thread/tokenUsage/updated':return null;
   default:
     if(frame.id!==undefined)throw new Error('TOOL_PERMISSION_REQUIRED');
     return null;
 }
}
function requestId(value:unknown){
 if(typeof value==='number'&&Number.isSafeInteger(value)&&value>=0)return String(value);
 return featureText(value,128,true);
}
export const createCodexExecutionDecoder=()=>executionJsonLines(codexExecutionEvent);
