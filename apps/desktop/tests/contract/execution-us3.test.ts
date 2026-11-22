import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ReceiptStore} from '../../src/main/receipt-store.ts';
import {OperationRecovery} from '../../src/main/operation-recovery.ts';
import {settleReceipt} from '../../src/main/action-handlers.ts';
import {unknownResult} from '../../src/main/core-cli.ts';
import type {CliCommand} from '../../src/main/ports.ts';
import type {PublicResult} from '../../src/shared/bridge-contract.ts';

test('an uncertain resume is queried by its original request across main restarts',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'maestro-execution-receipts-'));
 t.after(()=>rm(directory,{recursive:true}));
 const requestId=randomUUID(),storeId=randomUUID(),target=randomUUID(),archive=join(directory,'archive');
 const receipts=new ReceiptStore(join(directory,'receipts'));
 const original=await receipts.create({requestId,namespace:'execution',action:'resume',archivePath:archive,storeId,
   executionTarget:target,projectId:randomUUID(),expectedRevision:'6',intentHash:'d'.repeat(64)});
 const uncertain=await settleReceipt(receipts,original,unknownResult(requestId));
 assert.equal(uncertain.phase,'UNKNOWN');
 const at=new Date().toISOString(),result:PublicResult={protocolVersion:1,requestId,storeId,instanceId:randomUUID(),result:'OK',outcome:'SUCCEEDED',
   liveness:'ABSENT_VERIFIED',freshness:'LAST_KNOWN',error:null,data:{operation:{namespace:'EXECUTION',action:'resume',phase:'FINALIZED',
     outcome:'SUCCEEDED',requestId,targetId:target,acceptedAt:at,completedAt:at,result:{sessionId:target,runId:requestId,generation:randomUUID()},error:null}}};
 const calls:CliCommand[]=[];
 const recovery=new OperationRecovery(new ReceiptStore(receipts.directory),{async call(command){
   calls.push(command);return command.action==='status'?{...result,requestId:null,data:{}}:result;
 },close(){}});
 const recovered=await recovery.reconcile(requestId);
 assert.equal(recovered.receipt.phase,'TERMINAL');
 assert.equal(recovered.receipt.outcome,'SUCCEEDED');
 assert.deepEqual(calls.map(c=>[c.namespace,c.action,c.params?.requestId]),[['daemon','status',undefined],['execution','operation',requestId]]);
});
