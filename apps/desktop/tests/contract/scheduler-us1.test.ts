import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {validateRequest} from '../../src/shared/validation.ts';
import {buildCliArgs} from '../../src/main/core-cli.ts';
import {validateSchedulerQueue} from '../../src/shared/scheduler-contract.ts';

test('Desktop queue requests are closed and preserve offline dispatch boundaries',()=>{
 const id=randomUUID(),b={bridgeVersion:1,selectionEpoch:2,callId:id};
 validateRequest('listScheduledJobs',{...b,projectId:id});
 assert.throws(()=>validateRequest('listScheduledJobs',{...b,localPath:'/tmp/worktree'}));
 assert.deepEqual(buildCliArgs({namespace:'scheduler',action:'queue.list',archive:'/tmp/state',params:{projectId:id}}),
   ['scheduler','queue.list','--state-dir=/tmp/state','--json','--',id]);
 assert.throws(()=>validateSchedulerQueue({freshness:'LAST_KNOWN',dispatchAvailable:true,systemLoad:'UNKNOWN'},undefined));
});
