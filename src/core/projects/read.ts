import type { ProjectDetail, ProjectTombstone, RegistryRegistrationPort, RegistryReadPort } from '../../ports/registry.js';

export { projectDetail } from '../../domain/projects/projection.js';
import { projectDetail } from '../../domain/projects/projection.js';
export class ProjectRemovedError extends Error {
  constructor(readonly tombstone: ProjectTombstone) { super('PROJECT_REMOVED'); }
}
export async function readProject(storage: Pick<RegistryRegistrationPort, 'getProject'>, projectId: string): Promise<ProjectDetail> {
  const state = await storage.getProject(projectId);
  if (!state) throw new Error('PROJECT_NOT_FOUND');
  if (state.project.removedAt !== null) throw new ProjectRemovedError({ projectId: state.project.projectId, configRevision: state.project.configRevision, removedAt: state.project.removedAt });
  return projectDetail(state);
}

export async function readProjects(storage: Pick<RegistryReadPort, 'listProjects'>, options: { readonly limit?: number; readonly cursor?: string } = {}) {
  return storage.listProjects(options);
}
