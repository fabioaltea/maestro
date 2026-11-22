import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { createCliHarness } from './cli-harness.js';
import { createProjectRepositories } from './project-repositories.js';
import { LocalClient } from '../../src/client/local-client.js';
import { createClientBackend } from '../../src/bootstrap.js';
import { decodeProjectOperationView } from '../../src/protocol/validation.js';
import type { ProjectOperationResult } from '../../src/domain/projects/model.js';
import type { ProjectObservation } from '../../src/domain/projects/model.js';

export interface ProjectDetail {
  readonly projectId: string; readonly displayName: string; readonly referenceCheckout: string; readonly baseBranch: string | null;
  readonly configRevision: string; readonly createdAt: string; readonly updatedAt: string;
  readonly observation: ProjectObservation & { readonly freshness: 'LAST_KNOWN' };
}
export async function createProjectHarness(t: TestContext) {
  const h = await createCliHarness(t), f = await createProjectRepositories(t);
  assert.equal((await h.call('start')).code, 0);
  const client = new LocalClient(createClientBackend()), other = new LocalClient(createClientBackend());
  async function register(path: string, params: { name?: string; baseBranch?: string } = {}, actor = client): Promise<ProjectOperationResult> {
    const result = await actor.runProject('register', { path, ...params }, { stateDirectory: h.archive });
    assert.equal(result.outcome, 'SUCCEEDED', JSON.stringify(result));
    const operation = decodeProjectOperationView(result.data.operation);
    assert.ok(operation.result); return operation.result;
  }
  async function get(projectId: string, actor = other): Promise<ProjectDetail> {
    const result = await actor.runProject('get', { projectId }, { stateDirectory: h.archive });
    assert.equal(result.result, 'OK', JSON.stringify(result));
    assert.ok(result.data.project); return result.data.project as unknown as ProjectDetail;
  }
  return { h, f, client, other, register, get };
}
