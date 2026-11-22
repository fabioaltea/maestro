import { foundationError } from '../../domain/errors.js';
import type { RegistryOperationsPort } from '../../ports/registry.js';

/** Called only after Foundation resource reconciliation, before RUNNING. Never executes an intent. */
export async function interruptProjectOperations(storage: RegistryOperationsPort, completedAt: string): Promise<void> {
  for (const operation of await storage.listPendingProjectOperations()) {
    await storage.completeProjectOperation(operation.requestId, {
      action: operation.action, requestId: operation.requestId, projectId: operation.projectId,
      outcome: 'INTERRUPTED', effect: 'NONE', configRevision: null, observationRevision: null, completedAt,
      error: foundationError('INTERRUPTED', { persisted: true, operationId: operation.requestId }),
    });
  }
}
