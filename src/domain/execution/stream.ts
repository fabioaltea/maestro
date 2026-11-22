import type {ExecutionOutputDecoder,ExecutionOutputEvent} from '../../ports/execution-output.js';
import {EXECUTION_LIMITS} from './model.js';

export function executionJsonLines(decode:(value:unknown)=>ExecutionOutputEvent|null):ExecutionOutputDecoder{
 let pending=new Uint8Array(),bytes=0,ended=false;
 const utf8=new TextDecoder('utf-8',{fatal:true});
 const frameLimit=32768;
 function ensureOpen(){if(ended)throw new Error('PROVIDER_PROTOCOL_ERROR');}
 return{
   feed(chunk){
     ensureOpen();
     try{
       bytes+=chunk.byteLength;
       if(bytes>EXECUTION_LIMITS.outputBytes+frameLimit)throw new Error('PROVIDER_OUTPUT_LIMIT');
       const events:ExecutionOutputEvent[]=[];
       let offset=0;
       function consume(part:Uint8Array,complete:boolean){
         const length=pending.byteLength+part.byteLength;
         if(length>frameLimit)throw new Error('PROVIDER_OUTPUT_LIMIT');
         const joined=new Uint8Array(length);joined.set(pending);joined.set(part,pending.byteLength);
         if(!complete){pending=joined;return;}
         pending=new Uint8Array();
         let value:unknown;
         try{value=JSON.parse(utf8.decode(joined));}catch{throw new Error('PROVIDER_PROTOCOL_ERROR');}
         const event=decode(value);if(event)events.push(event);
       }
       for(let i=0;i<chunk.byteLength;i++)if(chunk[i]===10){consume(chunk.subarray(offset,i),true);offset=i+1;}
       if(offset<chunk.byteLength)consume(chunk.subarray(offset),false);
       return events;
     }catch(error){ended=true;pending=new Uint8Array();throw error;}
   },
   finish(){
     ensureOpen();ended=true;
     if(pending.byteLength)throw new Error('PROVIDER_PROTOCOL_ERROR');
   },
 };
}
