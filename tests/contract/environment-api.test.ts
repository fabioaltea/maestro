import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

const protocolModule='../../src/protocol/environment.js';
test('Environment uses strict observation and confirmation inputs with no executable or credential DTO',async()=>{
 const {validateEnvironmentParams,requireEnvironmentEnvelope,environmentMutation}=await import(protocolModule);
 const workspaceId=randomUUID(),requestId=randomUUID(),jobId=randomUUID(),planId=randomUUID();
 const planning={workspaceId,requestId,expectedStateRevision:'1'};
 validateEnvironmentParams('environment.plan',planning);
 const approval={action:'prepare',intent:{planId,planDigest:'a'.repeat(64)},expectedRevisions:{stateRevision:'1'}};
 const mutation={grantId:randomUUID(),requestId};
 validateEnvironmentParams('environment.prepare',approval);
 validateEnvironmentParams('environment.prepare',mutation);
 assert.equal(environmentMutation('environment.prepare',approval),false);
 assert.equal(environmentMutation('environment.prepare',mutation),true);
 validateEnvironmentParams('environment.output.list',{jobId,limit:20});
 validateEnvironmentParams('environment.artifact.get',{artifactId:randomUUID()});
 for(const [route,body] of [
   ['environment.plan',{...planning,registry:'https://example.invalid'}],
   ['environment.plan',{...planning,workspaceId:'/root'}],
   ['environment.prepare',{...approval,intent:{...approval.intent,argv:['npm','i']}}],
   ['environment.prepare',{...approval,...mutation}],
   ['environment.output.list',{jobId,limit:21}],
   ['environment.output.list',{jobId,cursor:'x'.repeat(4097)}],
   ['environment.exec',{argv:['npm','i']}],
 ] as const)assert.throws(()=>validateEnvironmentParams(route,body));
 requireEnvironmentEnvelope({value:'v'.repeat(25000)});
 assert.throws(()=>requireEnvironmentEnvelope({value:'v'.repeat(32769)}),/CONTEXT_LIMIT/);
});
