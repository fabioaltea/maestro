import test from 'node:test';
import assert from 'node:assert/strict';
import { observationStore } from '../fixtures/project-observation.js';
import { projectDetail } from '../../src/core/projects/read.js';
import type { RepositoryInspection } from '../../src/ports/repository.js';
import type { ProjectOperationResult } from '../../src/domain/projects/model.js';
import type { ProjectPatch } from '../../src/domain/projects/intent.js';

interface Commit { requestId: string; instanceId: string; projectId: string; expectedConfigRevision: string; completedAt: string; baseEvidence?: RepositoryInspection }
interface UpdateStore { commitProjectUpdate(input: Commit): ProjectOperationResult }
async function fixture(t: Parameters<typeof observationStore>[0]) {
  const f = await observationStore(t), store = f.store as typeof f.store & UpdateStore;
  assert.equal(typeof store.commitProjectUpdate, 'function', 'atomic update CAS is missing');
  const prepare = (revision: string, patch: ProjectPatch, baseEvidence?: RepositoryInspection): Commit => {
    const intent = { ...f.intent('UPDATE', { projectId: f.projectId, expectedRevision: revision, patch }), projectId: f.projectId };
    f.store.acceptProjectOperation(intent);
    return { requestId: intent.requestId, instanceId: f.instanceId, projectId: f.projectId, expectedConfigRevision: revision,
      completedAt: '2026-11-11T12:00:00.000Z', ...(baseEvidence ? { baseEvidence } : {}) };
  };
  return { ...f, store, prepare };
}

test('rename changes only confirmed config; no-op preserves revisions and dates; historical observations are not invented', async t => {
  const f = await fixture(t), old = f.store.getProject(f.projectId)!;
  const renamed = f.store.commitProjectUpdate(f.prepare('1', { name: 'Renamed' }));
  assert.equal(renamed.effect, 'UPDATED'); assert.equal(renamed.configRevision, '2'); assert.equal(renamed.observationRevision, '1');
  const after = f.store.getProject(f.projectId)!;
  assert.deepEqual(after.observation, old.observation); assert.equal(after.project.baseBranch, old.project.baseBranch);
  assert.deepEqual(after.project.repositoryIdentity, old.project.repositoryIdentity); assert.deepEqual(after.project.referenceCheckout, old.project.referenceCheckout);
  assert.equal(projectDetail(after).baseState, 'UNVERIFIED'); assert.equal(projectDetail(after).observation!.observedConfigRevision, '1');
  const revision = f.store.listProjects().registryRevision;
  const noop = f.store.commitProjectUpdate(f.prepare('2', { name: 'Renamed' }));
  assert.equal(noop.effect, 'NONE'); assert.equal(noop.configRevision, '2');
  assert.deepEqual(f.store.getProject(f.projectId), after); assert.equal(f.store.listProjects().registryRevision, revision);
  f.store.commitProjectUpdate(f.prepare('2', { baseBranch: null }));
  const cleared = f.store.getProject(f.projectId)!;
  assert.equal(projectDetail(cleared).baseState, 'UNCONFIGURED'); assert.deepEqual(cleared.observation, old.observation);
});

test('stale revisions and invalid explicit base reject the whole patch with no partial rename or success event', async t => {
  const f = await fixture(t), old = f.store.getProject(f.projectId)!;
  assert.throws(() => f.store.commitProjectUpdate(f.prepare('9', { name: 'Stale' })), /REVISION_CONFLICT/);
  for (const evidence of [undefined, { ...f.evidence, observation: { ...f.evidence.observation, baseState: 'INVALID' as const, baseOid: null } },
    { ...f.evidence, identity: { ...f.evidence.identity, commonDirectory: { ...f.evidence.identity.commonDirectory, inode: '999' } } }]) {
    const input = f.prepare('1', { name: 'Must not apply', baseBranch: 'fixture-base' }, evidence);
    assert.throws(() => f.store.commitProjectUpdate(input), /INVALID_BASE_BRANCH|REPOSITORY_CHANGED/);
    assert.equal(f.store.getProjectOperation(input.requestId)!.outcome, 'IN_PROGRESS');
    assert.deepEqual(f.store.getProject(f.projectId), old);
  }
  const valid = f.store.commitProjectUpdate(f.prepare('1', { name: 'Confirmed', baseBranch: 'fixture-base' }, f.evidence));
  assert.equal(valid.effect, 'UPDATED'); assert.equal(valid.configRevision, '2');
  assert.deepEqual(f.store.getProject(f.projectId)!.observation, old.observation);
});
