import { createDaemonLauncher } from './platform/macos/launcher.js';
import { defaultArchiveDirectory } from './platform/macos/paths.js';
import { inspectArchive, inspectDetails, readOperationFromArchive, absentResult } from './core/inspect-main.js';
import { classifyError } from './core/control-main.js';
import { foundationError, type ErrorCode } from './domain/errors.js';
import type { ClientBackend } from './ports/platform.js';
import type { PublicResult } from './protocol/messages.js';

export function failureResult(code: ErrorCode, requestId: string | null): PublicResult {
  return { ...absentResult(), requestId, result: code === 'BUSY' ? 'BUSY' : ['BLOCKED', 'EVENT_BACKPRESSURE', 'RESOURCE_IDENTITY_UNKNOWN', 'ENDPOINT_COLLISION'].includes(code) ? 'BLOCKED'
    : ['DEADLINE_EXCEEDED', 'CONTROL_INTERRUPTED'].includes(code) ? 'UNKNOWN_OUTCOME' : 'ERROR', freshness: 'LAST_KNOWN', liveness: 'UNKNOWN',
    data: {}, error: foundationError(code, requestId ? { operationId: requestId } : {}) };
}

export function createClientBackend(launcher = createDaemonLauncher()): ClientBackend {
  return {
    defaultDirectory: defaultArchiveDirectory(),
    inspect: inspectArchive,
    diagnostics: directory => inspectDetails(directory, 'diagnostics'),
    events: (directory, limit) => inspectDetails(directory, 'events', limit),
    async operation(directory, requestId) {
      const operation = await readOperationFromArchive(directory, requestId);
      if (!operation) return failureResult('INVALID_REQUEST', requestId);
      const state = await inspectArchive(directory);
      return { ...state, requestId, freshness: 'LAST_KNOWN', outcome: operation.outcome,
        result: operation.outcome === 'SUCCEEDED' ? 'OK' : operation.outcome === 'IN_PROGRESS' ? 'BUSY'
          : operation.outcome === 'BLOCKED' ? 'BLOCKED' : 'ERROR',
        error: operation.error, data: { ...state.data, operation } };
    },
    async control(intent, timeoutMs) {
      const deadline = performance.now() + timeoutMs;
      const process = await launcher.spawnController(intent);
      let bootstrap: { accepted: boolean; errorCode?: string } | null = null;
      let exited = false;
      void process.bootstrap?.then(value => { bootstrap = value; });
      void process.exit.then(() => { exited = true; });
      while (performance.now() < deadline) {
        let operation;
        try { operation = await readOperationFromArchive(intent.canonicalStateDir, intent.requestId); }
        catch { /* Initialization may not yet have committed its schema. */ }
        if (bootstrap !== null && !(bootstrap as {accepted: boolean}).accepted) {
          return failureResult(classifyError(new Error((bootstrap as {errorCode?: string}).errorCode ?? 'INTERNAL_ERROR')), intent.requestId);
        }
        // Exit can arrive while the previous read still held an older SQLite snapshot.
        if (exited && operation?.outcome === 'IN_PROGRESS') {
          try { operation = await readOperationFromArchive(intent.canonicalStateDir, intent.requestId); }
          catch { return failureResult('CONTROL_INTERRUPTED', intent.requestId); }
        }
        if (operation && operation.action !== intent.action) return failureResult('IDEMPOTENCY_CONFLICT', intent.requestId);
        if (operation && operation.outcome !== 'IN_PROGRESS' && (bootstrap as {accepted: boolean} | null)?.accepted) {
          let state;
          try { state = await inspectArchive(intent.canonicalStateDir); }
          catch { state = absentResult(); }
          return { ...state, requestId: intent.requestId, outcome: operation.outcome,
            result: operation.outcome === 'SUCCEEDED' ? 'OK' : operation.outcome === 'BLOCKED' ? 'BLOCKED' : 'ERROR',
            error: operation.error, data: { ...state.data, operation } };
        }
        if (exited && operation?.outcome === 'IN_PROGRESS') return failureResult('CONTROL_INTERRUPTED', intent.requestId);
        if (exited && !operation && bootstrap === null) return failureResult('CORE_EXITED_BEFORE_ACCEPTANCE', intent.requestId);
        await new Promise<void>(resolve => setTimeout(resolve, Math.min(25, Math.max(0, deadline - performance.now()))));
      }
      return failureResult('DEADLINE_EXCEEDED', intent.requestId);
    },
  };
}
