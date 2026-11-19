import {inspectWorkspace} from './core/inspect-main.js';
import {WORKSPACE_MUTATION_METHODS,WORKSPACE_PREPARE_METHODS,validateWorkspaceParams,workspaceCapabilities,decodeWorkspaceOperation} from './protocol/workspace.js';
import { inspectFeature } from './core/inspect-main.js';
import { FEATURE_ADMISSION_METHODS,validateFeatureParams,requireFeatureCapability,decodeFeatureOperationView,requireFeatureEnvelope } from './protocol/feature.js';
import { inspectDiscovery } from './core/inspect-main.js';
import { DISCOVERY_ADMISSION_METHODS, validateDiscoveryParams, requireDiscoveryCapability, decodeDiscoveryOperationView, requireDiscoveryEnvelope } from './protocol/discovery.js';
import { createPlatformPaths } from './platform/macos/paths.js';
import { createLocalTransport } from './platform/macos/transport.js';
import { randomUUID } from 'node:crypto';
import { createDaemonLauncher } from './platform/macos/launcher.js';
import { defaultArchiveDirectory } from './platform/macos/paths.js';
import { inspectArchive, inspectDetails, inspectProjectOperation, inspectProjectGet, inspectProjectList, readOperationFromArchive, absentResult } from './core/inspect-main.js';
import { classifyError } from './core/control-main.js';
import { foundationError, type ErrorCode } from './domain/errors.js';
import type { ClientBackend } from './ports/platform.js';
import type { PublicResult } from './protocol/messages.js';
import { decodeProjectOperationView, decodeProjectTombstone, requireProjectCapability, validateProjectParams } from './protocol/validation.js';
import { requireUuid } from './domain/identifiers.js';

export function failureResult(code: ErrorCode, requestId: string | null): PublicResult {
  return { ...absentResult(), requestId, result: code === 'BUSY' ? 'BUSY' : ['BLOCKED', 'EVENT_BACKPRESSURE', 'RESOURCE_IDENTITY_UNKNOWN', 'ENDPOINT_COLLISION'].includes(code) ? 'BLOCKED'
    : ['UNKNOWN_OUTCOME', 'DEADLINE_EXCEEDED', 'CONTROL_INTERRUPTED', 'SERVICE_UNREACHABLE', 'SLOW_CONSUMER'].includes(code) ? 'UNKNOWN_OUTCOME' : 'ERROR', freshness: 'LAST_KNOWN', liveness: 'UNKNOWN',
    data: {}, error: foundationError(code, requestId ? { operationId: requestId } : {}) };
}

function workflowBackend(scope:'feature'|'workspace'):NonNullable<ClientBackend['feature']>{
  return async(directory, method, params, timeoutMs)=>{
      const feature=scope==='feature';
      (feature?validateFeatureParams:validateWorkspaceParams)(method,params);
      const mutation = ((feature?FEATURE_ADMISSION_METHODS:WORKSPACE_MUTATION_METHODS) as readonly string[]).includes(method);
      const requestId = mutation || method === `${scope}.operation.get` ? requireUuid(params.requestId) : null;
      const preparation=feature?method==='feature.prepare':(WORKSPACE_PREPARE_METHODS as readonly string[]).includes(method);
      const offline=()=>mutation||preparation?Promise.resolve(failureResult('DAEMON_UNAVAILABLE',requestId))
        :(feature?inspectFeature:inspectWorkspace)(directory,method,params);
      const expires = performance.now() + timeoutMs;
      let possiblySent = false;
      try {
        const adapter = createPlatformPaths(), paths = await adapter.resolveArchive(directory, 'read');
        if (!paths) return failureResult('STATE_ABSENT', requestId);
        let key: string;
        try { key = await adapter.readCredential(paths.clientKeyFile); }
        catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return await offline(); throw error; }
        const transport = createLocalTransport(); let status;
        try { status = await transport.call(paths.daemonEndpoint, key, { protocolVersion: 1, correlationId: randomUUID(), method: 'status.get', params: {} }, Math.max(1, Math.min(500, expires - performance.now()))); }
        catch (error) { if (classifyError(error) === 'UNAUTHORIZED') throw error; return await offline(); }
        const state = status.data as Record<string, unknown>; if (status.result !== 'OK' || !state) throw new Error('DAEMON_UNAVAILABLE');
        if(feature){
          requireFeatureCapability(state.capabilities);
          const methods=(state.capabilities as {featureMethods?:unknown}).featureMethods;
          if(!Array.isArray(methods)||!methods.includes(method))throw new Error('UNSUPPORTED_VERSION');
        }else workspaceCapabilities(state.capabilities,method);
        if (performance.now() >= expires) throw new Error('DEADLINE_EXCEEDED');
        possiblySent = true;
        const response = await transport.call(paths.daemonEndpoint, key, { protocolVersion: 1, correlationId: randomUUID(), method, params }, Math.max(1, Math.min(2000, expires - performance.now())));
        requireFeatureEnvelope(response); const data = response.data as Record<string, unknown>;
        if (!data || typeof data !== 'object' || data.storeId !== state.storeId) throw new Error('WRONG_STORE');
        const operation = data.operation === undefined ? null : (feature?decodeFeatureOperationView:decodeWorkspaceOperation)(data.operation);
        const code = typeof data.code === 'string' ? foundationError(data.code as ErrorCode).code : null;
        return { protocolVersion: 1, requestId, storeId: requireUuid(state.storeId), instanceId: requireUuid(state.instanceId), result: operation?.outcome === 'UNKNOWN' ? 'UNKNOWN_OUTCOME' : response.result,
          outcome: operation?.outcome && operation.outcome !== 'UNKNOWN' ? operation.outcome as PublicResult['outcome'] : null,
          freshness: state.freshness === 'VOLATILE' ? 'VOLATILE' : 'LIVE', liveness: 'LIVE_VERIFIED', data,
          error: code ? foundationError(code) : operation?.error as PublicResult['error'] ?? null };
      } catch (error) { return possiblySent && mutation ? { ...failureResult('UNKNOWN_OUTCOME', requestId), result: 'UNKNOWN_OUTCOME' } : failureResult(classifyError(error), requestId); }
    };
}

export function createClientBackend(launcher = createDaemonLauncher()): ClientBackend {
  return {
    defaultDirectory: defaultArchiveDirectory(),
    async project(directory, method, params, timeoutMs) {
      validateProjectParams(method, params);
      const reading = ['projects.list', 'projects.get', 'projects.operation.get'].includes(method);
      const requestId = typeof params.requestId === 'string' ? requireUuid(params.requestId) : null;
      const offline = () => method === 'projects.operation.get' ? inspectProjectOperation(directory, requestId!)
        : method === 'projects.list' ? inspectProjectList(directory, params) : method === 'projects.get' ? inspectProjectGet(directory, params.projectId as string) : Promise.reject(new Error('UNSUPPORTED_VERSION'));
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
          if (reading && ['projects.operation.get', 'projects.get', 'projects.list'].includes(method)) return await offline();
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
          if (method === 'projects.get' && data.code === 'PROJECT_REMOVED') {
            const tombstone = decodeProjectTombstone(data.tombstone);
            if (tombstone.projectId !== params.projectId) throw new Error('INVALID_REQUEST');
            if (data.storeId !== state.storeId) throw new Error('WRONG_STORE');
            return { ...failure, storeId: requireUuid(state.storeId), instanceId: requireUuid(state.instanceId),
              freshness: state.freshness === 'VOLATILE' ? 'VOLATILE' : 'LIVE', liveness: 'LIVE_VERIFIED', data: { tombstone } };
          }
          return { ...failure, data: data.accepted === false ? { requestId, accepted: false, outcome: null } : {} };
        }
        if (data.storeId !== state.storeId) throw new Error('WRONG_STORE');
        return { protocolVersion: 1, requestId, storeId: requireUuid(state.storeId), instanceId: requireUuid(state.instanceId),
          result: response.result, outcome: operation?.outcome ?? (data.outcome === 'IN_PROGRESS' ? 'IN_PROGRESS' : null),
          freshness: state.freshness === 'VOLATILE' ? 'VOLATILE' : 'LIVE', liveness: 'LIVE_VERIFIED', data,
          error: operation?.result?.error ?? null };
      } catch (error) {
        const code = classifyError(error);
        if (reading && ['projects.operation.get', 'projects.get', 'projects.list'].includes(method)
          && (code === 'DEADLINE_EXCEEDED' || (error instanceof Error && 'code' in error
            && ['ENOENT', 'ECONNREFUSED', 'ECONNRESET'].includes(String(error.code))))) {
          try { return await offline(); }
          catch (offline) { return failureResult(classifyError(offline), requestId); }
        }
        return failureResult(sent && !reading && code !== 'UNAUTHORIZED' ? 'UNKNOWN_OUTCOME' : code, requestId);
      }
    },
    feature: workflowBackend('feature'),
    workspace: workflowBackend('workspace'),
    async discovery(directory, method, params, timeoutMs) {
      validateDiscoveryParams(method, params);
      const mutation = (DISCOVERY_ADMISSION_METHODS as readonly string[]).includes(method);
      const requestId = mutation || method === 'discovery.operation.get' ? requireUuid(params.requestId) : null;
      const offline = () => mutation || method === 'discovery.prepare' ? Promise.resolve(failureResult('DAEMON_UNAVAILABLE', requestId)) : inspectDiscovery(directory, method, params);
      const expires = performance.now() + timeoutMs;
      let possiblySent = false;
      try {
        const adapter = createPlatformPaths(), paths = await adapter.resolveArchive(directory, 'read');
        if (!paths) return failureResult('STATE_ABSENT', requestId);
        let key: string;
        try { key = await adapter.readCredential(paths.clientKeyFile); }
        catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return await offline(); throw error; }
        const transport = createLocalTransport(); let status;
        try { status = await transport.call(paths.daemonEndpoint, key, { protocolVersion: 1, correlationId: randomUUID(), method: 'status.get', params: {} }, Math.max(1, Math.min(500, expires - performance.now()))); }
        catch (error) { if (classifyError(error) === 'UNAUTHORIZED') throw error; return await offline(); }
        const state = status.data as Record<string, unknown>; if (status.result !== 'OK' || !state) throw new Error('DAEMON_UNAVAILABLE');
        requireDiscoveryCapability(state.capabilities);
        const methods = (state.capabilities as { discoveryMethods?: unknown }).discoveryMethods;
        if (!Array.isArray(methods) || !methods.includes(method)) throw new Error('UNSUPPORTED_VERSION');
        if (performance.now() >= expires) throw new Error('DEADLINE_EXCEEDED');
        possiblySent = true;
        const response = await transport.call(paths.daemonEndpoint, key, { protocolVersion: 1, correlationId: randomUUID(), method, params }, Math.max(1, Math.min(2000, expires - performance.now())));
        requireDiscoveryEnvelope(response); const data = response.data as Record<string, unknown>;
        if (!data || typeof data !== 'object' || data.storeId !== state.storeId) throw new Error('WRONG_STORE');
        const operation = data.operation === undefined ? null : decodeDiscoveryOperationView(data.operation);
        const code = typeof data.code === 'string' ? foundationError(data.code as ErrorCode).code : null;
        return { protocolVersion: 1, requestId, storeId: requireUuid(state.storeId), instanceId: requireUuid(state.instanceId), result: operation?.outcome === 'UNKNOWN' ? 'UNKNOWN_OUTCOME' : response.result,
          outcome: operation?.outcome && operation.outcome !== 'UNKNOWN' ? operation.outcome as PublicResult['outcome'] : null,
          freshness: state.freshness === 'VOLATILE' ? 'VOLATILE' : 'LIVE', liveness: 'LIVE_VERIFIED', data,
          error: code ? foundationError(code) : operation?.error as PublicResult['error'] ?? null };
      } catch (error) { return possiblySent && mutation ? { ...failureResult('UNKNOWN_OUTCOME', requestId), result: 'UNKNOWN_OUTCOME' } : failureResult(classifyError(error), requestId); }
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
        // Give the controller its ownership/admission turn before an offline
        // snapshot briefly reserves the same leases. Bootstrap acknowledgment is
        // emitted only after the intent is durable; this never replays effects.
        if (process.bootstrap && bootstrap === null && !exited) {
          await new Promise<void>(resolve => setTimeout(resolve, Math.min(25, Math.max(1, deadline - performance.now()))));
          continue;
        }
        if (bootstrap !== null && !(bootstrap as {accepted: boolean}).accepted) {
          return failureResult(classifyError(new Error((bootstrap as {errorCode?: string}).errorCode ?? 'INTERNAL_ERROR')), intent.requestId);
        }
        let operation;
        try { operation = await readOperationFromArchive(intent.canonicalStateDir, intent.requestId); }
        catch { /* Initialization may not yet have committed its schema. */ }
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
