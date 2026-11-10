import { createPlatformPaths } from './platform/macos/paths.js';
import { createLocalTransport } from './platform/macos/transport.js';
import { randomUUID } from 'node:crypto';
import { createDaemonLauncher } from './platform/macos/launcher.js';
import { defaultArchiveDirectory } from './platform/macos/paths.js';
import { inspectArchive, inspectDetails, inspectProjectOperation, readOperationFromArchive, absentResult } from './core/inspect-main.js';
import { classifyError } from './core/control-main.js';
import { foundationError, type ErrorCode } from './domain/errors.js';
import type { ClientBackend } from './ports/platform.js';
import type { PublicResult } from './protocol/messages.js';
import { decodeProjectOperationView, requireProjectCapability, validateProjectParams } from './protocol/validation.js';
import { requireUuid } from './domain/identifiers.js';

export function failureResult(code: ErrorCode, requestId: string | null): PublicResult {
  return { ...absentResult(), requestId, result: code === 'BUSY' ? 'BUSY' : ['BLOCKED', 'EVENT_BACKPRESSURE', 'RESOURCE_IDENTITY_UNKNOWN', 'ENDPOINT_COLLISION'].includes(code) ? 'BLOCKED'
    : ['UNKNOWN_OUTCOME', 'DEADLINE_EXCEEDED', 'CONTROL_INTERRUPTED', 'SERVICE_UNREACHABLE', 'SLOW_CONSUMER'].includes(code) ? 'UNKNOWN_OUTCOME' : 'ERROR', freshness: 'LAST_KNOWN', liveness: 'UNKNOWN',
    data: {}, error: foundationError(code, requestId ? { operationId: requestId } : {}) };
}

export function createClientBackend(launcher = createDaemonLauncher()): ClientBackend {
  return {
    defaultDirectory: defaultArchiveDirectory(),
    async project(directory, method, params, timeoutMs) {
      validateProjectParams(method, params);
      const reading = ['projects.list', 'projects.get', 'projects.operation.get'].includes(method);
      const requestId = typeof params.requestId === 'string' ? requireUuid(params.requestId) : null;
      const expires = performance.now() + timeoutMs;
      let sent = false;
      try {
        const adapter = createPlatformPaths();
        const paths = await adapter.resolveArchive(directory, 'read');
        if (!paths) return failureResult(reading ? 'STATE_ABSENT' : 'DAEMON_UNAVAILABLE', requestId);
        const key = await adapter.readCredential(paths.clientKeyFile);
        const transport = createLocalTransport();
        let status;
        try { status = await transport.call(paths.daemonEndpoint, key, {
          protocolVersion: 1, correlationId: randomUUID(), method: 'status.get', params: {},
        }, Math.max(1, Math.min(500, expires - performance.now()))); }
        catch (error) {
          if (classifyError(error) === 'UNAUTHORIZED') throw error;
          if (reading && method === 'projects.operation.get') return await inspectProjectOperation(directory, requestId!);
          throw new Error('DAEMON_UNAVAILABLE');
        }
        const state = status.data as Record<string, unknown>;
        if (status.result !== 'OK' || !state) throw new Error('DAEMON_UNAVAILABLE');
        requireProjectCapability(state.capabilities);
        const methods = (state.capabilities as { projectRegistryMethods?: unknown }).projectRegistryMethods;
        if (!Array.isArray(methods) || !methods.includes(method)) throw new Error('UNSUPPORTED_VERSION');
        if (!reading && (state.lifecycle !== 'RUNNING' || state.ready !== true || state.freshness === 'VOLATILE')) throw new Error('BLOCKED');
        if (performance.now() >= expires) throw new Error('DEADLINE_EXCEEDED');
        sent = true;
        const response = await transport.call(paths.daemonEndpoint, key, { protocolVersion: 1, correlationId: randomUUID(), method, params },
          Math.max(1, Math.min(1_000, expires - performance.now())));
        const data = response.data as Record<string, unknown>;
        if (!data || typeof data !== 'object') throw new Error('INVALID_REQUEST');
        const operation = data.operation === undefined ? null : decodeProjectOperationView(data.operation);
        if (!operation && typeof data.code === 'string') {
          const failure = failureResult(foundationError(data.code as ErrorCode).code, requestId);
          return { ...failure, data: data.accepted === false ? { requestId, accepted: false, outcome: null } : {} };
        }
        if (data.storeId !== state.storeId) throw new Error('WRONG_STORE');
        return { protocolVersion: 1, requestId, storeId: requireUuid(state.storeId), instanceId: requireUuid(state.instanceId),
          result: response.result, outcome: operation?.outcome ?? (data.outcome === 'IN_PROGRESS' ? 'IN_PROGRESS' : null),
          freshness: state.freshness === 'VOLATILE' ? 'VOLATILE' : 'LIVE', liveness: 'LIVE_VERIFIED', data,
          error: operation?.result?.error ?? null };
      } catch (error) {
        const code = classifyError(error);
        if (reading && method === 'projects.operation.get'
          && (code === 'DEADLINE_EXCEEDED' || (error instanceof Error && 'code' in error
            && ['ENOENT', 'ECONNREFUSED', 'ECONNRESET'].includes(String(error.code))))) {
          try { return await inspectProjectOperation(directory, requestId!); }
          catch (offline) { return failureResult(classifyError(offline), requestId); }
        }
        return failureResult(sent && !reading && code !== 'UNAUTHORIZED' ? 'UNKNOWN_OUTCOME' : code, requestId);
      }
    },
    inspect: inspectArchive,
    async follow(directory, consume, signal, timeoutMs, after) {
      const adapter = createPlatformPaths(), paths = await adapter.resolveArchive(directory, 'read');
      if (!paths) throw new Error('SERVICE_UNREACHABLE');
      try {
        const key = await adapter.readCredential(paths.clientKeyFile);
        return await createLocalTransport().subscribe(paths.daemonEndpoint, key, {protocolVersion: 1, correlationId: randomUUID(), method: 'events.subscribe', params: after ? {after} : {}}, consume,
          {timeoutMs: timeoutMs ?? 1_000, ...(signal ? {signal} : {})});
      } catch (error) {
        if (error instanceof Error && 'code' in error && ['ENOENT', 'ECONNREFUSED'].includes(String(error.code))) throw new Error('SERVICE_UNREACHABLE');
        throw error;
      }
    },
    diagnostics: directory => inspectDetails(directory, 'diagnostics'),
    events: (directory, limit, after) => inspectDetails(directory, 'events', limit, after),
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
