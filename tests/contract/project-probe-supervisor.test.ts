import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { PassThrough } from 'node:stream';
import { performance } from 'node:perf_hooks';
import type { ProbeOwnership, ProbeSupervisor } from '../../src/ports/repository.js';
import type { ManagedResource } from '../../src/ports/storage.js';
import type { ArchivePaths, ProcessIdentity } from '../../src/ports/platform.js';
import { createPlatformPaths } from '../../src/platform/macos/paths.js';
import { makeDeadline, systemClock } from '../../src/ports/clock.js';
import { createTestContext } from '../fixtures/test-context.js';

interface SupervisorModule {
  createProbeSupervisor(options: { paths: ArchivePaths; workerUrl?: URL; lifeline?: PassThrough;
    identity?: ProcessIdentity; onResource?: (resource: ManagedResource) => Promise<void> }): ProbeSupervisor;
}
async function loadSupervisor(): Promise<SupervisorModule> {
  const url = new URL('../../src/platform/macos/git/probe-supervisor.js', import.meta.url);
  assert.ok(existsSync(url), 'required owned probe supervisor has not been implemented');
  return await import(url.href) as SupervisorModule;
}
const ownership = (): ProbeOwnership => ({ resourceId: randomUUID(), generation: randomUUID(),
  owningInstanceId: randomUUID(), policyScope: 'foundation' });

test('probe cancellation verifies ownership and awaits cooperative process exit within its budget', async t => {
  const context = await createTestContext(t);
  const paths = (await createPlatformPaths().resolveArchive(context.directory + '/state', 'write'))!;
  const resources: ManagedResource[] = [];
  const supervisor = (await loadSupervisor()).createProbeSupervisor({ paths,
    workerUrl: new URL('../fixtures/project-probe-worker.js', import.meta.url),
    onResource: async resource => { resources.push(resource); } });
  const own = ownership();
  const probe = await supervisor.start({ kind: 'CANDIDATE', path: context.directory }, own,
    { deadline: makeDeadline(systemClock, 3_000) });
  try {
    assert.deepEqual(probe.ownership, own);
    assert.equal(resources[0]?.owningInstanceId, own.owningInstanceId);
    assert.equal(resources[0]?.generation, own.generation);
    assert.equal(resources[0]?.policyScope, 'foundation');
    assert.equal(resources[0]?.pid, null, 'persist resource intent before launching');
    assert.ok(resources.some(resource => resource.pid !== null));
    const started = performance.now();
    assert.equal(await probe.cancel(), 'ABSENT');
    assert.ok(performance.now() - started <= 1_500);
    assert.equal((await probe.result).ok, false);
    assert.equal(resources.at(-1)?.releaseState, 'RELEASED');
    assert.equal(await probe.cancel(), 'ABSENT');
  } finally { await probe.cancel(); }
});

test('lifeline EOF interrupts the owned probe without sending commands to unrelated processes', async t => {
  const context = await createTestContext(t);
  const paths = (await createPlatformPaths().resolveArchive(context.directory + '/state', 'write'))!;
  const lifeline = new PassThrough();
  const supervisor = (await loadSupervisor()).createProbeSupervisor({ paths, lifeline,
    workerUrl: new URL('../fixtures/project-probe-worker.js', import.meta.url) });
  const probe = await supervisor.start({ kind: 'CANDIDATE', path: context.directory }, ownership(),
    { deadline: makeDeadline(systemClock, 3_000) });
  lifeline.end();
  const result = await probe.result;
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, 'INTERRUPTED');
  assert.equal(await probe.cancel(), 'ABSENT');
});

test('an independently expiring probe returns an explicit deadline result and does not remain owned', async t => {
  const context = await createTestContext(t);
  const paths = (await createPlatformPaths().resolveArchive(context.directory + '/state', 'write'))!;
  const supervisor = (await loadSupervisor()).createProbeSupervisor({ paths,
    workerUrl: new URL('../fixtures/project-probe-worker.js', import.meta.url) });
  const probe = await supervisor.start({ kind: 'CANDIDATE', path: context.directory }, ownership(),
    { deadline: makeDeadline(systemClock, 800) });
  const result = await probe.result;
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, 'DEADLINE_EXCEEDED');
  assert.equal(await probe.cancel(), 'ABSENT');
});

test('uncertain identity is BLOCKED rather than authorization to terminate a saved or reused PID', async t => {
  const context = await createTestContext(t);
  const paths = (await createPlatformPaths().resolveArchive(context.directory + '/state', 'write'))!;
  const identity: ProcessIdentity = { probeAbsent: async () => 'UNKNOWN',
    observeExit: async () => 'UNKNOWN', challenge: async () => 'UNKNOWN' };
  const resources: ManagedResource[] = [];
  const supervisor = (await loadSupervisor()).createProbeSupervisor({ paths, identity,
    workerUrl: new URL('../fixtures/project-probe-worker.js', import.meta.url),
    onResource: async resource => { resources.push(resource); } });
  await assert.rejects(supervisor.start({ kind: 'CANDIDATE', path: context.directory }, ownership(),
    { deadline: makeDeadline(systemClock, 800) }), /RESOURCE_IDENTITY_UNKNOWN/);
  assert.ok(resources.some(resource => resource.releaseState === 'BLOCKED'));
  // The fixture's own deadline is independent of the failed parent challenge.
  await new Promise(resolve => setTimeout(resolve, 900));
});

test('invalid policy scope and expired intentions are rejected before probe creation', async t => {
  const context = await createTestContext(t);
  const paths = (await createPlatformPaths().resolveArchive(context.directory + '/state', 'write'))!;
  const resources: ManagedResource[] = [];
  const supervisor = (await loadSupervisor()).createProbeSupervisor({ paths,
    onResource: async resource => { resources.push(resource); } });
  await assert.rejects(supervisor.start({ kind: 'CANDIDATE', path: context.directory },
    { ...ownership(), policyScope: 'agent' } as unknown as ProbeOwnership,
    { deadline: makeDeadline(systemClock, 1_000) }), /INVALID_REQUEST/);
  await assert.rejects(supervisor.start({ kind: 'CANDIDATE', path: context.directory }, ownership(),
    { deadline: makeDeadline(systemClock, 0) }), /DEADLINE_EXCEEDED/);
  assert.equal(resources.length, 0);
});
