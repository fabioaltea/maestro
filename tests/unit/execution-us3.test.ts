import assert from 'node:assert/strict';
import test from 'node:test';
import {requireCheckpointTree,validateCheckpointPatch} from '../../src/domain/execution/checkpoint.js';

test('portable checkpoints require the canonical tree digest and cap the sealed patch',()=>{
 const digest='c'.repeat(64);
 assert.equal(requireCheckpointTree(digest),digest);
 assert.throws(()=>requireCheckpointTree(digest.toUpperCase()),/CHECKPOINT_STALE/);
 assert.throws(()=>validateCheckpointPatch(new Uint8Array()),/CONTEXT_LIMIT/);
 validateCheckpointPatch(new Uint8Array(262144));
 assert.throws(()=>validateCheckpointPatch(new Uint8Array(262145)),/CONTEXT_LIMIT/);
});
