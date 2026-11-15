import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { record, uuid, text, keys } from '../shared/validation.ts';
import { CORE_ERRORS } from '../shared/core-errors.ts';
import { decodeUiEvent, decodeActivityCursor, encodeActivityCursor, sequence } from '../shared/activity-contract.ts';
import type { UiEvent } from '../shared/activity-contract.ts';
import type { ActivityMessage } from '../shared/bridge-contract.ts';
import { buildCliArgs } from './core-cli.ts';
import type { Runtime } from './runtime.ts';
export class JsonLines {
  private pending=Buffer.alloc(0); private consume:(value:unknown)=>void;
  constructor(consume:(value:unknown)=>void){this.consume=consume;}
  get bufferedBytes(){return this.pending.length;}
  feed(chunk:Buffer){
    this.pending=Buffer.concat([this.pending,chunk]);
    for(;;){const newline=this.pending.indexOf(10);if(newline<0)break;if(newline>65536)throw new Error('CLIENT_OUTPUT_LIMIT');
      const line=this.pending.subarray(0,newline);this.pending=this.pending.subarray(newline+1);
      this.consume(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(line)));
    }
    if(this.pending.length>65536)throw new Error('CLIENT_OUTPUT_LIMIT');
  }
  end(){if(this.pending.length)throw new Error('CLIENT_PROTOCOL_ERROR');}
}
export interface Started {kind:'started';subscriptionId:string;storeId:string;instanceId:string;correlationId:string;highWater:string}
type Frame=Started|{kind:'event';event:UiEvent;cursor:string}|{kind:'closed';code:string;firstAvailable?:string;highWater?:string};
export class StreamFrames {
  private expectedStore:string; private after:string|null; private started:Started|null=null;private received:string|null=null;private closed=false;
  constructor(storeId:string,after?:string){this.expectedStore=uuid(storeId);this.after=after??null;if(after){const c=decodeActivityCursor(after);if(c.storeId!==storeId)throw new Error('STREAM_GAP');this.received=c.seq;}}
  decode(value:unknown):Frame{
    const p=record(value);if(p.protocolVersion!==1||this.closed)throw new Error('CLIENT_PROTOCOL_ERROR');
    if(p.kind==='subscription.started'){
      keys(p,['protocolVersion','kind','subscriptionId','storeId','instanceId','correlationId','highWater']);
      if(this.started||uuid(p.storeId)!==this.expectedStore)throw new Error('CLIENT_PROTOCOL_ERROR');
      this.started={kind:'started',subscriptionId:uuid(p.subscriptionId),storeId:uuid(p.storeId),instanceId:uuid(p.instanceId),correlationId:uuid(p.correlationId),highWater:sequence(p.highWater)};
      if(this.received!==null&&BigInt(this.received)>BigInt(this.started.highWater))throw new Error('STREAM_GAP');
      this.received??=this.started.highWater;return this.started;
    }
    if(p.kind==='event'){
      keys(p,['protocolVersion','kind','correlationId','subscriptionId','instanceId','event','cursor']);
      if(!this.started||p.subscriptionId!==this.started.subscriptionId||p.correlationId!==this.started.correlationId||p.instanceId!==this.started.instanceId)throw new Error('CLIENT_PROTOCOL_ERROR');
      const event=decodeUiEvent(p.event,this.expectedStore),cursor=text(p.cursor,256),decoded=decodeActivityCursor(cursor);
      if(decoded.storeId!==this.expectedStore||decoded.seq!==event.seq||this.received===null||BigInt(event.seq)!==BigInt(this.received)+1n)throw new Error('STREAM_GAP');
      this.received=event.seq;return{kind:'event',event,cursor};
    }
    if(p.kind==='subscription.closed'||p.result!==undefined){
      if(p.kind==='subscription.closed'&&(!this.started||p.subscriptionId!==this.started.subscriptionId))throw new Error('CLIENT_PROTOCOL_ERROR');
      const code=String(record(p.error).code);if(!Object.hasOwn(CORE_ERRORS,code))throw new Error('CLIENT_PROTOCOL_ERROR');
      const gap=p.kind==='subscription.closed'?p:record(p.data??{});this.closed=true;
      if(gap.firstAvailable!==undefined||gap.highWater!==undefined){if(gap.storeId!==this.expectedStore)throw new Error('STREAM_GAP');return{kind:'closed',code,firstAvailable:sequence(gap.firstAvailable),highWater:sequence(gap.highWater)};}
      return{kind:'closed',code};
    }
    throw new Error('CLIENT_PROTOCOL_ERROR');
  }
}
interface StreamOptions {runtime:Runtime;archive:string;storeId:string;epoch:number;after:string;onMessage(message:ActivityMessage):void}
interface Batch {id:string;seq:string;cursor:string;bytes:number}
export class ActivityStream {
  readonly options:StreamOptions;
  private child:ChildProcessWithoutNullStreams|null=null;private frames:StreamFrames;private lines:JsonLines;
  private started:Started|null=null;private pending:UiEvent[]=[];private pendingBytes=0;private batch:Batch|null=null;
  private lastAck:string|null=null;private cursor:string;private closed=false;private ackTimer:ReturnType<typeof setTimeout>|undefined;
  private resolveStart:((s:Started)=>void)|null=null;private rejectStart:((e:Error)=>void)|null=null;
  private startup:ReturnType<typeof setTimeout>|undefined;private stderr=0;private closing:Promise<void>|null=null;
  constructor(options:StreamOptions){this.options=options;this.cursor=options.after;this.frames=new StreamFrames(options.storeId,options.after);this.lines=new JsonLines(value=>this.frame(this.frames.decode(value)));}
  get subscriptionId(){return this.started?.subscriptionId??null;}
  get lastAppliedCursor(){return this.cursor;}
  get backlogBytes(){return this.pendingBytes+(this.batch?.bytes??0)+this.lines.bufferedBytes;}
  start():Promise<Started>{
    if(this.child||this.closed)return Promise.reject(new Error('LOCAL_BUSY'));
    const ready=new Promise<Started>((resolve,reject)=>{this.resolveStart=resolve;this.rejectStart=reject;});
    const args=buildCliArgs({namespace:'daemon',action:'events',archive:this.options.archive,params:{follow:true,after:this.options.after}});
    this.child=spawn(this.options.runtime.node,[this.options.runtime.cli,...args],{env:this.options.runtime.env,shell:false,stdio:['pipe','pipe','pipe']});
    this.startup=setTimeout(()=>this.fail('SERVICE_UNREACHABLE'),3000);
    this.child.stdout.on('data',(chunk:Buffer)=>{if(this.closed)return;try{this.lines.feed(chunk);if(this.backlogBytes>262144)this.fail('STREAM_SATURATED');}catch(error){this.fail(error instanceof Error?error.message:'CLIENT_PROTOCOL_ERROR');}});
    this.child.stderr.on('data',(chunk:Buffer)=>{this.stderr+=chunk.length;if(this.stderr>16384)this.fail('CLIENT_OUTPUT_LIMIT');});
    this.child.once('error',()=>this.fail('CLIENT_PROTOCOL_ERROR'));
    this.child.once('close',()=>{if(!this.closed){try{this.lines.end();this.fail('SERVICE_UNREACHABLE');}catch{this.fail('CLIENT_PROTOCOL_ERROR');}}});
    return ready;
  }
  private frame(frame:Frame){
    if(this.closed)return;
    if(frame.kind==='started'){
      this.started=frame;clearTimeout(this.startup);this.resolveStart?.(frame);this.resolveStart=null;this.rejectStart=null;
      this.state('LIVE',null);return;
    }
    if(frame.kind==='closed'){this.fail(frame.code,frame);return;}
    const bytes=Buffer.byteLength(JSON.stringify(frame.event));this.pending.push(frame.event);this.pendingBytes+=bytes;
    if(this.backlogBytes>262144){this.fail('STREAM_SATURATED');return;}this.pump();
  }
  private state(state:string,code:string|null,bounds?:{firstAvailable?:string;highWater?:string}){
    this.options.onMessage({kind:'activity.state',subscriptionId:this.subscriptionId,selectionEpoch:this.options.epoch,storeId:this.options.storeId,state,code,lastAppliedCursor:this.cursor,...(bounds?.firstAvailable?{firstAvailable:bounds.firstAvailable}:{}),...(bounds?.highWater?{highWater:bounds.highWater}:{})});
  }
  private pump(){
    if(this.closed||this.batch||!this.pending.length||!this.started)return;
    const events:UiEvent[]=[];let bytes=1024;
    while(this.pending.length&&events.length<32){const event=this.pending[0]!,size=Buffer.byteLength(JSON.stringify(event));if(bytes+size>65536)break;events.push(this.pending.shift()!);bytes+=size;this.pendingBytes-=size;}
    if(!events.length){this.fail('STREAM_SATURATED');return;}
    const seq=events.at(-1)!.seq,cursor=encodeActivityCursor(this.options.storeId,seq),id=randomUUID();this.batch={id,seq,cursor,bytes};
    this.child?.stdout.pause();this.ackTimer=setTimeout(()=>this.fail('STREAM_SATURATED'),2000);
    this.options.onMessage({kind:'activity.batch',subscriptionId:this.started.subscriptionId,batchId:id,selectionEpoch:this.options.epoch,storeId:this.options.storeId,events,cursor});
  }
  ack(batchId:string,lastAppliedSeq:string){
    if(this.closed)throw new Error('STALE_CONTEXT');
    if(!this.batch){if(batchId===this.lastAck&&decodeActivityCursor(this.cursor).seq===lastAppliedSeq)return{cursor:this.cursor};throw new Error('INVALID_INPUT');}
    if(this.batch.id!==batchId||this.batch.seq!==lastAppliedSeq)throw new Error('INVALID_INPUT');
    this.cursor=this.batch.cursor;this.lastAck=batchId;this.batch=null;clearTimeout(this.ackTimer);this.pump();if(!this.batch)this.child?.stdout.resume();return{cursor:this.cursor};
  }
  private fail(code:string,bounds?:{firstAvailable?:string;highWater?:string}){
    if(this.closed)return;
    const safe=Object.hasOwn(CORE_ERRORS,code)||['STREAM_GAP','STREAM_SATURATED','CLIENT_OUTPUT_LIMIT','CLIENT_PROTOCOL_ERROR'].includes(code)?code:'CLIENT_PROTOCOL_ERROR';
    this.rejectStart?.(new Error(safe));this.rejectStart=null;this.resolveStart=null;
    this.state(['CURSOR_EXPIRED','WRONG_STORE','STREAM_GAP'].includes(safe)?'GAP':['STREAM_SATURATED','SLOW_CONSUMER'].includes(safe)?'SATURATED':'DISCONNECTED',safe,bounds);
    void this.close(false).catch(()=>undefined);
  }
  close(announce=true):Promise<void>{
    if(this.closing)return this.closing;
    this.closed=true;clearTimeout(this.startup);clearTimeout(this.ackTimer);this.pending=[];this.pendingBytes=0;this.batch=null;
    this.rejectStart?.(new Error('SERVICE_UNREACHABLE'));this.rejectStart=null;
    if(announce)this.state('DISCONNECTED',null);
    this.closing=(async()=>{
      const child=this.child;if(!child||child.exitCode!==null||child.signalCode!==null)return;
      const exited=once(child,'close',{signal:AbortSignal.timeout(2000)}).catch(()=>{throw new Error('LOCAL_BUSY');});
      child.kill('SIGTERM');const timer=setTimeout(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');},250);
      try{await exited;}finally{clearTimeout(timer);}
    })();return this.closing;
  }
}
