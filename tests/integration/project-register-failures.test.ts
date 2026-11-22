import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import { createRegistryStore } from '../fixtures/registry-store.js';
import { canonicalRepositoryIdentity } from '../../src/domain/projects/repository-evidence.js';
import { classifyStorageFailure } from '../../src/storage/worker.js';
import type { RegisterProjectCommit } from '../../src/ports/registry.js';

function prepare(state: Awaited<ReturnType<typeof createRegistryStore>>, large = false): RegisterProjectCommit {
  // Verified-port evidence fixture for the SQL boundary, not an assertion that
  // this long path exists on the OS. It forces real SQLite overflow-page allocation.
  const root = '/verified-fixture/' + (large ? 'a'.repeat(6_000) : 'project');
  const anchor = (path: string, inode: string) => ({ version: 1 as const, canonicalPath: path, kind: 'directory' as const,
    device: '100', inode, birthtimeNs: '1000' });
  const identity = { version: 1 as const, commonDirectory: anchor(root + '/.git', '1') };
  const intent = state.intent('REGISTER', { path: root });
  state.store.acceptProjectOperation(intent); state.store.setProjectOperationPhase(intent.requestId, 'PROBING');
  return { requestId: intent.requestId, instanceId: state.instanceId, displayName: 'Fault fixture', baseBranch: 'fixture-base',
    repositoryKey: createHash('sha256').update(canonicalRepositoryIdentity(identity)).digest('hex'), repositoryIdentity: identity,
    referenceCheckout: { version: 1, root: anchor(root, '2'), adminDirectory: identity.commonDirectory },
    completedAt: '2026-11-10T12:00:01.000Z', observation: {
      startedAt: '2026-11-10T12:00:00.000Z', completedAt: '2026-11-10T12:00:00.200Z', referencePath: root,
      checkoutAvailability: 'VERIFIED', repositoryIdentityStatus: 'VERIFIED', hasCommits: true, headKind: 'BRANCH', currentBranch: 'fixture-base',
      headOid: 'a'.repeat(40), objectFormat: 'sha1', baseState: 'VALID', baseOid: 'a'.repeat(40), trackedChanges: false,
      untrackedChanges: false, conflicts: false, fileStatusScope: 'REFERENCE_CHECKOUT_DIRECT_ENTRIES', limitations: [], error: null,
    } };
}
function unchanged(state: Awaited<ReturnType<typeof createRegistryStore>>, input: RegisterProjectCommit, revision: string) {
  const database = (state.store as unknown as { database: Database.Database }).database;
  assert.equal((database.prepare('SELECT count(*) AS count FROM projects').get() as { count: bigint }).count, 0n);
  assert.equal((database.prepare('SELECT count(*) AS count FROM project_observations').get() as { count: bigint }).count, 0n);
  assert.equal((database.prepare('SELECT registry_revision FROM registry_metadata').get() as { registry_revision: bigint }).registry_revision, 0n);
  assert.equal(state.store.getProjectOperation(input.requestId)?.outcome, 'IN_PROGRESS');
  assert.equal(state.store.getProjectOperation(input.requestId)?.result, null);
  assert.equal(state.store.readSnapshot()!.store.revision, revision);
}

test('real SQLITE_FULL during project allocation rolls back project, observation, terminal outcome and event', async t => {
  const state = await createRegistryStore(t), input = prepare(state, true);
  const database = (state.store as unknown as { database: Database.Database }).database;
  const previousMaximum = String(database.pragma('max_page_count', { simple: true }));
  const pages = String(database.pragma('page_count', { simple: true }));
  const revision = state.store.readSnapshot()!.store.revision, events = state.store.listEvents({ limit: 100 });
  database.pragma(`max_page_count=${pages}`);
  try {
    assert.throws(() => state.store.commitProjectRegistration(input), error => {
      assert.equal((error as { code: string }).code, 'SQLITE_FULL');
      assert.equal(classifyStorageFailure(error).cause, 'DISK_FULL'); return true;
    });
    unchanged(state, input, revision); assert.deepEqual(state.store.listEvents({ limit: 100 }), events);
  } finally { database.pragma(`max_page_count=${previousMaximum}`); }
});

test('injected IO failure immediately before registration commit rolls back every effect and never leaks the driver message', async t => {
  let armed = false;
  const state = await createRegistryStore(t, point => {
    if (armed && point === 'project.beforeCommit') throw Object.assign(new Error('owned sentinel-secret /private/raw-driver-detail'), { code: 'SQLITE_IOERR_FSYNC' });
  });
  const input = prepare(state), revision = state.store.readSnapshot()!.store.revision, events = state.store.listEvents({ limit: 100 });
  armed = true;
  assert.throws(() => state.store.commitProjectRegistration(input), error => {
    const safe = classifyStorageFailure(error);
    assert.equal(safe.code, 'PERSISTENCE_UNAVAILABLE'); assert.equal(safe.cause, 'IO_ERROR');
    assert.doesNotMatch(JSON.stringify(safe), /sentinel-secret|raw-driver-detail/); return true;
  });
  unchanged(state, input, revision); assert.deepEqual(state.store.listEvents({ limit: 100 }), events);
});
