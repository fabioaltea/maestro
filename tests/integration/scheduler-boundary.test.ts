import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {schedulerBoundaryFixture} from '../fixtures/scheduler-boundary.js';

const domain='../../src/domain/scheduler/resource-admission.js';
test('G0 shares four slots and fences class limits and workspace writers across projects',async()=>{
 const {admissionBlock,DEFAULT_SCHEDULER_LIMITS,reserveSchedulerResource}=await import(domain);
 const f=schedulerBoundaryFixture();
 const a=f.job(0,'INSTALL',0),b=f.job(1,'INSTALL',1),c=f.job(0,'VALIDATE',2),d=f.job(1,'DISCOVERY',3);
 const reservations=[a,b,c,d].map(job=>reserveSchedulerResource(job));
 assert.equal(admissionBlock(DEFAULT_SCHEDULER_LIMITS,reservations.slice(0,2),f.job(1,'INSTALL',4)),'INSTALL_LIMIT');
 assert.equal(admissionBlock(DEFAULT_SCHEDULER_LIMITS,reservations.slice(0,3),f.job(1,'EXECUTION',0)),'WORKSPACE_IN_USE');
 assert.equal(admissionBlock({...DEFAULT_SCHEDULER_LIMITS,global:5},reservations,f.job(0,'DISCOVERY',4)),'DISCOVERY_LIMIT');
 assert.equal(admissionBlock(DEFAULT_SCHEDULER_LIMITS,reservations,f.job(0,'EXECUTION',4)),'GLOBAL_LIMIT');
 await Promise.all(reservations.map(()=>f.spawnLocal()));
});

test('G0 retains after owner loss at reservation or launch and accepts only the exact exit proof',async()=>{
 const {reserveSchedulerResource,schedulerReservationTransition,admissionBlock,DEFAULT_SCHEDULER_LIMITS}=await import(domain);
 const f=schedulerBoundaryFixture(),job=f.job(0,'EXECUTION',0);
 const reservation=reserveSchedulerResource(job);
 const ownerLost=schedulerReservationTransition(reservation,{kind:'owner-lost'});
 f.move(300_000);
 assert.equal(ownerLost.state,'RECONCILING');
 assert.equal(admissionBlock(DEFAULT_SCHEDULER_LIMITS,[ownerLost],f.job(1,'VALIDATE',0)),'WORKSPACE_IN_USE');
 assert.throws(()=>schedulerReservationTransition(ownerLost,{kind:'release',proof:{...job,generation:randomUUID(),kind:'EXIT',verified:true}}),/STALE_TARGET/);
 const running=schedulerReservationTransition(reservation,{kind:'go',generation:job.generation});
 assert.throws(()=>schedulerReservationTransition(running,{kind:'release',proof:{...job,kind:'NO_SPAWN',verified:true}}),/RESERVATION_UNKNOWN/);
 await f.spawnLocal();
 const ended=schedulerReservationTransition(running,{kind:'release',proof:{...job,kind:'EXIT',verified:true}});
 assert.equal(admissionBlock(DEFAULT_SCHEDULER_LIMITS,[ended],f.job(1,'INSTALL',0)),null);
});

test('G0 preserves live debits when limits are lowered and rejects duplicate generations',async()=>{
 const {reserveSchedulerResource,admissionBlock,DEFAULT_SCHEDULER_LIMITS}=await import(domain);
 const f=schedulerBoundaryFixture();
 const job=f.job(0,'VALIDATE',0),one=reserveSchedulerResource(job),two=reserveSchedulerResource(f.job(1,'VALIDATE',1));
 assert.equal(admissionBlock({...DEFAULT_SCHEDULER_LIMITS,global:1},[one,two],f.job(1,'EXECUTION',2)),'GLOBAL_LIMIT');
 assert.equal(admissionBlock(DEFAULT_SCHEDULER_LIMITS,[one,two],f.job(1,'VALIDATE',2)),'VALIDATION_LIMIT');
 assert.equal(admissionBlock(DEFAULT_SCHEDULER_LIMITS,[one],{...f.job(1,'EXECUTION',3),generation:job.generation}),'RESERVATION_UNKNOWN');
});
