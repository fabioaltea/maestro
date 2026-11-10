import { foundationError } from '../../domain/errors.js';
import type { ProjectOperation } from '../../domain/projects/model.js';
import type { ProjectOperationView } from '../../ports/registry.js';
import type { AuthenticatedPeer, RpcRequest, RpcResponse } from '../../ports/platform.js';
import type { StoragePort, StoreSnapshot } from '../../ports/storage.js';
import { requireProjectClient, validateProjectParams } from '../../protocol/validation.js';
import { classifyError } from '../control-main.js';
import type { createProjectOperations } from './operations.js';
import { readProject } from './read.js';

/** Add methods here only as their story implementation becomes available. */
export const PROJECT_METHODS: readonly string[] = ['projects.operation.get', 'projects.register', 'projects.get'];
export function projectOperationView(operation: ProjectOperation): ProjectOperationView {
  return { requestId: operation.requestId, action: operation.action, projectId: operation.projectId,
    phase: operation.phase, outcome: operation.outcome, acceptedAt: operation.acceptedAt,
    deadlineAt: operation.deadlineAt, completedAt: operation.completedAt, result: operation.result };
}
export function projectOperationStatus(operation: Pick<ProjectOperation, 'outcome'>): RpcResponse['result'] {
  return operation.outcome === 'IN_PROGRESS' ? 'BUSY' : operation.outcome === 'SUCCEEDED' ? 'OK'
    : operation.outcome === 'BLOCKED' ? 'BLOCKED' : 'ERROR';
}
export function createProjectDispatch(options: {
  readonly operations: Pick<ReturnType<typeof createProjectOperations>, 'get' | 'admit'>;
  readonly storage: Pick<StoragePort, 'getEventState' | 'getProject'>;
}) {
  return async (request: RpcRequest, peer: AuthenticatedPeer, snapshot: StoreSnapshot): Promise<RpcResponse> => {
    const base = { protocolVersion: 1 as const, correlationId: request.correlationId };
    try {
      requireProjectClient(peer.role);
      validateProjectParams(request.method, request.params);
      if (!PROJECT_METHODS.includes(request.method)) throw new Error('UNSUPPORTED_VERSION');
      if (request.method === 'projects.get') {
        return { ...base, result: 'OK', data: { storeId: snapshot.store.storeId,
          project: await readProject(options.storage, request.params.projectId as string) } };
      }
      if (request.method === 'projects.register') {
        if (snapshot.instance?.lifecycle !== 'RUNNING') throw new Error('BLOCKED');
        const { requestId, ...params } = request.params;
        const admission = await options.operations.admit(peer, 'REGISTER', requestId as string, params);
        if (!admission.accepted) return { ...base, result: admission.error.code === 'BUSY' ? 'BUSY' : 'BLOCKED',
          data: { storeId: snapshot.store.storeId, requestId, accepted: false, outcome: null, code: admission.error.code, error: admission.error } };
        if (admission.operation.outcome === 'IN_PROGRESS') return { ...base, result: 'BUSY', data: {
          storeId: snapshot.store.storeId, requestId, accepted: true, outcome: 'IN_PROGRESS', pollMethod: 'projects.operation.get',
          observabilityDegraded: (await options.storage.getEventState()).degraded,
        } };
        return { ...base, result: projectOperationStatus(admission.operation), data: { storeId: snapshot.store.storeId,
          operation: projectOperationView(admission.operation), observabilityDegraded: (await options.storage.getEventState()).degraded } };
      }
      if (request.method === 'projects.operation.get') {
        const operation = await options.operations.get(peer, request.params.requestId as string);
        if (!operation) throw new Error('OPERATION_NOT_FOUND');
        return { ...base, result: projectOperationStatus(operation), data: { storeId: snapshot.store.storeId,
          operation: projectOperationView(operation), observabilityDegraded: (await options.storage.getEventState()).degraded } };
      }
      throw new Error('INVALID_REQUEST');
    } catch (error) {
      const code = classifyError(error);
      return { ...base, result: ['SAFETY', 'OBSERVABILITY'].includes(foundationError(code).category) ? 'BLOCKED' : 'ERROR',
        data: { code, error: foundationError(code), ...(['projects.register', 'projects.verify', 'projects.update', 'projects.remove'].includes(request.method)
          ? { requestId: request.params.requestId, accepted: false, outcome: null } : {}) } };
    }
  };
}
