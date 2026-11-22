import {EXECUTION_LIMITS} from '../../domain/execution/model.js';

export interface CodexExecutionTool {
 readonly name:string;
 readonly description:string;
 readonly inputSchema:Readonly<Record<string,unknown>>;
}
export function codexExecutionThread(input:{cwd:string;modelId:string;tools:readonly CodexExecutionTool[]}){
 if(input.tools.length>20||new Set(input.tools.map(tool=>tool.name)).size!==input.tools.length||
    input.tools.some(tool=>!/^[a-z][a-z0-9_]{0,63}$/.test(tool.name)))throw new Error('EXECUTION_UNSUPPORTED');
 return{cwd:input.cwd,model:input.modelId,approvalPolicy:'never',sandbox:'read-only',ephemeral:true,
   dynamicTools:input.tools.map(tool=>({type:'function',name:tool.name,description:tool.description,inputSchema:tool.inputSchema}))};
}
export function codexExecutionInput(input:Uint8Array){
 if(!input.byteLength||input.byteLength>EXECUTION_LIMITS.runInputBytes)throw new Error('CONTEXT_LIMIT');
 return[{type:'text',text:new TextDecoder('utf-8',{fatal:true}).decode(input),text_elements:[]}];
}
