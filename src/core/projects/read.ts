import type { ProjectDetail, RegistryRegistrationPort } from '../../ports/registry.js';

export { projectDetail } from '../../domain/projects/projection.js';
import { projectDetail } from '../../domain/projects/projection.js';
export async function readProject(storage: Pick<RegistryRegistrationPort, 'getProject'>, projectId: string): Promise<ProjectDetail> {
  const state = await storage.getProject(projectId);
  if (!state) throw new Error('PROJECT_NOT_FOUND');
  if (state.project.removedAt !== null) throw new Error('PROJECT_REMOVED');
  return projectDetail(state);
}
