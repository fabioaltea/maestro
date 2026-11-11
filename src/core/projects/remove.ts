import { normalizeProjectCommand } from '../../domain/projects/intent.js';
import type { StoragePort } from '../../ports/storage.js';
import type { ProjectExecution } from './operations.js';

/** Registration removal has no repository/filesystem/process resource authority. */
export async function removeProject(context: ProjectExecution, storage: Pick<StoragePort, 'getProject' | 'commitProjectRemoval'>) {
  if (context.operation.action !== 'REMOVE') throw new Error('INVALID_REQUEST');
  const command = normalizeProjectCommand('REMOVE', (JSON.parse(context.operation.canonicalIntent) as { params: unknown }).params);
  if (command.action !== 'REMOVE') throw new Error('INVALID_REQUEST');
  const { projectId, expectedRevision } = command.params;
  const state = await storage.getProject(projectId);
  if (!state) throw new Error('PROJECT_NOT_FOUND');
  if (state.project.removedAt !== null) throw new Error('PROJECT_REMOVED');
  if (state.project.configRevision !== expectedRevision) throw new Error('REVISION_CONFLICT');
  await context.checkpoint('project.remove.prepared');
  if (context.signal.aborted) throw new Error('INTERRUPTED');
  if (context.deadline.expired()) throw new Error('DEADLINE_EXCEEDED');
  // The writer's CAS/tombstone also fences all in-flight observations/updates.
  const result = await storage.commitProjectRemoval({ requestId: context.operation.requestId, instanceId: context.operation.owningInstanceId,
    projectId, expectedConfigRevision: expectedRevision, completedAt: new Date().toISOString() });
  await context.checkpoint('project.beforeAck');
  return result;
}
