import type { ProjectDetail, RegistryRegistrationPort, RegistryReadPort } from '../../ports/registry.js';

export { projectDetail } from '../../domain/projects/projection.js';
import { projectDetail } from '../../domain/projects/projection.js';
export async function readProject(storage: Pick<RegistryRegistrationPort, 'getProject'>, projectId: string): Promise<ProjectDetail> {
  const state = await storage.getProject(projectId);
  if (!state) throw new Error('PROJECT_NOT_FOUND');
  if (state.project.removedAt !== null) throw new Error('PROJECT_REMOVED');
  return projectDetail(state);
}

export async function readProjects(storage: Pick<RegistryReadPort, 'listProjects'>, options: { readonly limit?: number; readonly cursor?: string } = {}) {
  return storage.listProjects(options);
}
