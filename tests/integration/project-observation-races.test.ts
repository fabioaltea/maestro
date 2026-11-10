import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createProjectHarness } from '../fixtures/project-client.js';
import { decodeProjectOperationView } from '../../src/protocol/validation.js';
import { observationStore } from '../fixtures/project-observation.js';
import { verifyProject } from '../../src/core/projects/verify.js';
import { makeDeadline, systemClock } from '../../src/ports/clock.js';
import type { StoragePort } from '../../src/ports/storage.js';
import type { ProjectExecution } from '../../src/core/projects/operations.js';

async function verify(a: Awaited<ReturnType<typeof createProjectHarness>>, projectId: string) {
  const result = await a.client.runProject('verify', { projectId }, { stateDirectory: a.h.archive });
  assert.equal(result.outcome, 'SUCCEEDED', JSON.stringify(result));
  return decodeProjectOperationView(result.data.operation).result!;
}

test('first external commit never configures an absent base; deleted configured branch becomes INVALID', async t => {
  const a = await createProjectHarness(t), unborn = await a.f.createRepository('unborn-race', { commit: false });
  const first = await a.register(unborn), saved = await a.get(first.projectId!); assert.equal(saved.baseBranch, null);
  await writeFile(join(unborn, 'first.txt'), 'external first commit\n');
  await a.f.git(unborn, ['add', 'first.txt']); await a.f.git(unborn, ['commit', '-m', 'external first']);
  await verify(a, first.projectId!);
  const current = await a.get(first.projectId!);
  assert.equal(current.baseBranch, null); assert.equal(current.configRevision, '1');
  assert.equal(current.observation.hasCommits, true); assert.equal(current.observation.baseState, 'UNCONFIGURED');
  const repo = await a.f.createRepository('deleted-base'), registered = await a.register(repo);
  await a.f.git(repo, ['checkout', '--detach']); await a.f.git(repo, ['branch', '-D', 'fixture-base']);
  const snapshot = await a.f.snapshotTree(repo); await verify(a, registered.projectId!);
  const invalid = await a.get(registered.projectId!);
  assert.equal(invalid.baseBranch, 'fixture-base'); assert.equal(invalid.configRevision, '1'); assert.equal(invalid.observation.baseState, 'INVALID');
  assert.deepEqual(await a.f.snapshotTree(repo), snapshot);
});

test('two verifies capture one observation revision; a delayed result cannot overwrite the winner', async t => {
  const f = await observationStore(t), storage = { getProject: async (id: string) => f.store.getProject(id),
    commitProjectObservation: async (input: Parameters<typeof f.store.commitProjectObservation>[0]) => f.store.commitProjectObservation(input) } as StoragePort;
  let entered!: () => void, release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }), ready = new Promise<void>(resolve => { entered = resolve; });
  function context(delayed: boolean): ProjectExecution {
    const intent = { ...f.intent('VERIFY', { projectId: f.projectId }), projectId: f.projectId }; f.store.acceptProjectOperation(intent);
    return { operation: f.store.getProjectOperation(intent.requestId)!, deadline: makeDeadline(systemClock, 2_000), signal: new AbortController().signal,
      checkpoint: async point => { if (delayed && point === 'project.verified') { entered(); await gate; } },
      probe: async () => ({ ok: true, value: f.evidence }) };
  }
  const filesystem = { capture: async (path: string) => path === '/fixture' ? f.evidence.reference.root : f.evidence.identity.commonDirectory, compare: () => 'VERIFIED' as const };
  const slow = verifyProject(context(true), storage, filesystem); await ready;
  const winner = await verifyProject(context(false), storage, filesystem), saved = f.store.getProject(f.projectId);
  release(); await assert.rejects(slow, /OBSERVATION_SUPERSEDED/);
  assert.equal(winner.observationRevision, '2'); assert.deepEqual(f.store.getProject(f.projectId), saved);
});

test('ref or topology changed between the first probe and commit publishes uncertainty rather than stale positive evidence', async t => {
  const f = await observationStore(t);
  for (const changed of ['refs', 'topology']) {
    const intent = { ...f.intent('VERIFY', { projectId: f.projectId }), projectId: f.projectId }; f.store.acceptProjectOperation(intent);
    let probes = 0;
    const storage = { getProject: async (id: string) => f.store.getProject(id),
      commitProjectObservation: async (input: Parameters<typeof f.store.commitProjectObservation>[0]) => f.store.commitProjectObservation(input) } as StoragePort;
    const context: ProjectExecution = { operation: f.store.getProjectOperation(intent.requestId)!, deadline: makeDeadline(systemClock, 2_000),
      signal: new AbortController().signal, checkpoint: async () => {}, probe: async () => {
        probes++; return { ok: true, value: probes === 1 ? f.evidence : changed === 'refs'
          ? { ...f.evidence, observation: { ...f.evidence.observation, headOid: 'b'.repeat(40) } }
          : { ...f.evidence, identity: { ...f.evidence.identity, commonDirectory: { ...f.evidence.identity.commonDirectory, inode: '99' } } } };
      } };
    await verifyProject(context, storage, { capture: async () => { throw new Error('not reached'); }, compare: () => 'UNKNOWN' });
    const state = f.store.getProject(f.projectId)!;
    assert.equal(state.project.configRevision, '1'); assert.equal(state.observation!.headOid, null);
    assert.equal(state.observation!.error!.code, changed === 'refs' ? 'REPOSITORY_UNSTABLE' : 'REPOSITORY_CHANGED');
  }
});
