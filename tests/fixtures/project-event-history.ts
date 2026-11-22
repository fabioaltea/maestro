import type { TestContext } from 'node:test';
import { observationStore } from './project-observation.js';
import type { ProjectOperationResult } from '../../src/domain/projects/model.js';
import type { StoragePort } from '../../src/ports/storage.js';

/** Real SQLite/outbox/journal with typed repository evidence; no Git inspection is claimed here. */
export async function createMixedProjectHistory(t: TestContext, checkpoint?: (point: string) => void) {
  const f = await observationStore(t, checkpoint), initial = f.store.getProject(f.projectId)!;
  const results: ProjectOperationResult[] = [f.store.getProjectOperation(initial.observation!.requestId)!.result!];
  const completedAt = new Date().toISOString();
  const verify = { ...f.intent('VERIFY', { projectId: f.projectId }), projectId: f.projectId }; f.store.acceptProjectOperation(verify);
  results.push(f.store.commitProjectObservation({ requestId: verify.requestId, instanceId: f.instanceId, projectId: f.projectId,
    expectedConfigRevision: '1', expectedObservationRevision: '1', observation: f.evidence.observation, completedAt }));
  const update = { ...f.intent('UPDATE', { projectId: f.projectId, expectedRevision: '1', patch: { name: 'Private registry name' } }), projectId: f.projectId };
  f.store.acceptProjectOperation(update);
  results.push(f.store.commitProjectUpdate({ requestId: update.requestId, instanceId: f.instanceId, projectId: f.projectId, expectedConfigRevision: '1', completedAt }));
  const remove = { ...f.intent('REMOVE', { projectId: f.projectId, expectedRevision: '2' }), projectId: f.projectId }; f.store.acceptProjectOperation(remove);
  results.push(f.store.commitProjectRemoval({ requestId: remove.requestId, instanceId: f.instanceId, projectId: f.projectId, expectedConfigRevision: '2', completedAt }));
  const reader = { listEvents: async (options: Parameters<typeof f.store.listEvents>[0]) => f.store.listEvents(options),
    getEventState: async (verify?: boolean) => f.store.getEventState(verify) } as StoragePort;
  return { ...f, results, reader };
}
