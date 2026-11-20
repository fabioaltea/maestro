import {featureObject,featureText} from '../../domain/features/bundle.js';
import {EXECUTION_LIMITS} from '../../domain/execution/model.js';
import {executionJsonLines} from '../../domain/execution/stream.js';

export const createClaudeExecutionDecoder=()=>executionJsonLines(raw=>{
 const value=featureObject(raw);
 switch(value.type){
   case 'system':return null;
   case 'result':return value.subtype==='success'&&value.is_error===false?{kind:'COMPLETED'}:{kind:'FAILED'};
   case 'stream_event':{
     const event=featureObject(value.event);
     if(event.type!=='content_block_delta')return null;
     const delta=featureObject(event.delta);
     if(delta.type==='text_delta')return{kind:'TEXT',text:featureText(delta.text,EXECUTION_LIMITS.outputChunkBytes,true)};
     if(delta.type==='input_json_delta')throw new Error('TOOL_PERMISSION_REQUIRED');
     return null;
   }
   default:throw new Error('PROVIDER_PROTOCOL_ERROR');
 }
});
