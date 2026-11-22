import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {chooseSchedulerJob} from '../../src/domain/scheduler/queue.js';
import type {SchedulerJob} from '../../src/ports/scheduler.js';

const when='2026-01-01T00:00:00.000Z';
const job=(projectId:string,priority:number,notBefore:string|null=null):SchedulerJob=>({
 jobId:randomUUID(),intentId:randomUUID(),projectId,workspaceId:randomUUID(),sessionId:null,type:'EXECUTION',priority,
 queuedAt:when,notBefore,state:'QUEUED',stateRevision:'1',reason:null,attempts:0,
});

test('round robin skips unavailable projects and gives lower priority a turn after four dispatches',()=>{
 const [a,b,c]=[randomUUID(),randomUUID(),randomUUID()].sort() as [string,string,string];
 const first=job(a,0),low=job(a,2),middle=job(b,1),last=job(c,0);
 const queued=[first,low,middle,last];
 assert.equal(chooseSchedulerJob(queued,{lastProject:a,streaks:new Map()},Date.parse(when),()=>true),middle);
 assert.equal(chooseSchedulerJob(queued,{lastProject:b,streaks:new Map()},Date.parse(when),j=>j!==last),first);
 assert.equal(chooseSchedulerJob(queued,{lastProject:c,streaks:new Map([[a,{priority:0,count:4}]])},Date.parse(when),()=>true),low);
 assert.equal(chooseSchedulerJob([job(a,0,'2027-01-01T00:00:00.000Z')],{lastProject:null,streaks:new Map()},Date.parse(when),()=>true),null);
});
