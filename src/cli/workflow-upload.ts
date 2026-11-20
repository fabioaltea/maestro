import {createHash} from 'node:crypto';
import type {LocalClient,CommandOptions} from '../client/local-client.js';
import type {PublicResult} from '../protocol/messages.js';

function uploadId(root:string,part:string){
 const h=createHash('sha256').update(`${root}:${part}`).digest('hex');
 return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;
}
/** Stable subordinate UUIDs make a whole upload retryable. */
export async function uploadWorkflowBytes(client:LocalClient,options:CommandOptions,root:string,kind:'BUNDLE'|'INPUT',bytes:Buffer,targetId?:string){
 const sha256=createHash('sha256').update(bytes).digest('hex'),artifactId=uploadId(root,'reserve');
 const good=(r:PublicResult)=>r.result==='OK'&&(r.data.operation as {outcome?:string}|undefined)?.outcome==='SUCCEEDED';
 let result=await client.runFeature('feature.artifact.reserve',{kind,expectedBytes:bytes.length,sha256,...(targetId?{targetId}:{})},{...options,requestId:artifactId});
 if(!good(result))return result;
 for(let offset=0;offset<bytes.length;offset+=8192){
   const chunk=bytes.subarray(offset,offset+8192);
   result=await client.runFeature('feature.artifact.append',{uploadId:artifactId,offset,chunkSha256:createHash('sha256').update(chunk).digest('hex'),
     base64:chunk.toString('base64')},{...options,requestId:uploadId(root,`append:${offset}`)});
   if(!good(result))return result;
 }
 return client.runFeature('feature.artifact.seal',{uploadId:artifactId,expectedBytes:bytes.length,sha256},{...options,requestId:root});
}
