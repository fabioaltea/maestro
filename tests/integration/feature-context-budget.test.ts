import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewFixture} from '../fixtures/discovery-review.js';
import {createDiscoveryReview} from '../../src/core/discovery/review.js';
import type {StoragePort} from '../../src/ports/storage.js';
import type {DiscoveryContextPort} from '../../src/ports/discovery-context.js';
test('feature-authoritative revalidation shares Discovery I/O debit until the actual work settles after timeout',async t=>{
 const f=await reviewFixture(t);let release!:(v:Awaited<ReturnType<DiscoveryContextPort['revalidate']>>)=>void;
 const pending=new Promise<Awaited<ReturnType<DiscoveryContextPort['revalidate']>>>(r=>{release=r;});t.after(()=>release({ok:false,code:'CONTEXT_UNSTABLE'}));
 const context:DiscoveryContextPort={capture:(...args)=>f.context.capture(...args),revalidate:()=>pending};
 const options={storage:f.store as unknown as StoragePort,paths:f.paths,context,artifacts:f.artifacts,provider:f.provider,contextTimeoutMs:5};const review=createDiscoveryReview(options);
 await assert.rejects(()=>review.fresh(f.discovery()),/DEADLINE_EXCEEDED/);
 await assert.rejects(()=>review.fresh(f.discovery()),/DISCOVERY_BUSY/);
 release({ok:false,code:'CONTEXT_UNSTABLE'});await new Promise<void>(r=>setImmediate(r));
 await assert.rejects(()=>review.fresh(f.discovery()),/CONTEXT_UNSTABLE/);
 assert.throws(()=>createDiscoveryReview({...options,contextTimeoutMs:30001}),/INVALID_REQUEST/);
});
