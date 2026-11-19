import { EventStreamError, requireGap, type EventCursor } from '../protocol/event-cursor.js';
import { diagnosticsData, readEventPage } from './diagnostics.js';
import { observePendingControl } from './control-observation.js';
import { foundationError } from '../domain/errors.js';
import { randomUUID } from 'node:crypto';
import { createPlatformPaths } from '../platform/macos/paths.js';
import { createLocalTransport } from '../platform/macos/transport.js';
import { createProcessIdentity } from '../platform/macos/process-identity.js';
import { openStorage } from '../storage/worker.js';
import type { PublicResult } from '../protocol/messages.js';
import type { OperationRecord } from '../ports/storage.js';
import { isEntrypoint, readBootstrap } from './entrypoint.js';
import { projectOperationStatus, projectOperationView } from './projects/dispatch.js';
import { requireUuid } from '../domain/identifiers.js';
import { readProject, readProjects, ProjectRemovedError } from './projects/read.js';

export async function inspectProjectList(directory: string, options: { readonly limit?: number; readonly cursor?: string } = {}): Promise<PublicResult> {
  const paths = await createPlatformPaths().resolveArchive(directory, 'read');
  if (!paths) throw new Error('STATE_ABSENT');
  const store = await openStorage({ path: paths.stateFile, readonly: true });
  try {
    const snapshot = await store.readSnapshot();
    if (!snapshot) throw new Error('STATE_ABSENT');
    const page = await readProjects(store, options);
    return { protocolVersion: 1, requestId: null, storeId: snapshot.store.storeId, instanceId: snapshot.instance?.instanceId ?? null,
      result: 'OK', outcome: null, freshness: 'LAST_KNOWN',
      liveness: !snapshot.instance || snapshot.instance.lifecycle === 'STOPPED' ? 'ABSENT_VERIFIED' : 'UNKNOWN',
      data: { ...page }, error: null };
  } finally { await store.close(); }
}

export async function inspectProjectGet(directory: string, projectId: string): Promise<PublicResult> {
  requireUuid(projectId);
  const paths = await createPlatformPaths().resolveArchive(directory, 'read');
  if (!paths) throw new Error('STATE_ABSENT');
  const store = await openStorage({ path: paths.stateFile, readonly: true });
  try {
    const snapshot = await store.readSnapshot();
    if (!snapshot) throw new Error('STATE_ABSENT');
    let project;
    try { project = await readProject(store, projectId); }
    catch (error) {
      if (!(error instanceof ProjectRemovedError)) throw error;
      return { protocolVersion: 1, requestId: null, storeId: snapshot.store.storeId, instanceId: snapshot.instance?.instanceId ?? null,
        result: 'ERROR', outcome: null, freshness: 'LAST_KNOWN',
        liveness: !snapshot.instance || snapshot.instance.lifecycle === 'STOPPED' ? 'ABSENT_VERIFIED' : 'UNKNOWN',
        data: { tombstone: error.tombstone }, error: foundationError('PROJECT_REMOVED') };
    }
    return { protocolVersion: 1, requestId: null, storeId: snapshot.store.storeId, instanceId: snapshot.instance?.instanceId ?? null,
      result: 'OK', outcome: null, freshness: 'LAST_KNOWN',
      liveness: !snapshot.instance || snapshot.instance.lifecycle === 'STOPPED' ? 'ABSENT_VERIFIED' : 'UNKNOWN',
      data: { project }, error: null };
  } finally { await store.close(); }
}

/** Pure archive observation: no daemon launch, IPC, Git probe, migration or writes. */
export async function inspectProjectOperation(directory: string, requestId: string): Promise<PublicResult> {
  requireUuid(requestId);
  const paths = await createPlatformPaths().resolveArchive(directory, 'read');
  if (!paths) throw new Error('STATE_ABSENT');
  const store = await openStorage({ path: paths.stateFile, readonly: true });
  try {
    const snapshot = await store.readSnapshot();
    if (!snapshot) throw new Error('STATE_ABSENT');
    const operation = await store.getProjectOperation(requestId);
    if (!operation) throw new Error('OPERATION_NOT_FOUND');
    return { protocolVersion: 1, requestId, storeId: snapshot.store.storeId, instanceId: snapshot.instance?.instanceId ?? null,
      result: projectOperationStatus(operation), outcome: operation.outcome, freshness: 'LAST_KNOWN',
      liveness: !snapshot.instance || snapshot.instance.lifecycle === 'STOPPED' ? 'ABSENT_VERIFIED' : 'UNKNOWN',
      data: { operation: projectOperationView(operation), observabilityDegraded: (await store.getEventState()).degraded },
      error: operation.result?.error ?? null };
  } finally { await store.close(); }
}

export function absentResult(): PublicResult {
  return { protocolVersion: 1, requestId: null, storeId: null, instanceId: null, result: 'OK', outcome: null,
    freshness: 'LIVE', liveness: 'ABSENT_VERIFIED', error: null,
    data: { status: 'ABSENT', ready: false, lifecycle: null, pid: null, observedAt: new Date().toISOString() } };
}

export async function readOperationFromArchive(directory: string, requestId: string): Promise<OperationRecord | null> {
  const paths = await createPlatformPaths().resolveArchive(directory, 'read');
  if (!paths) return null;
  const store = await openStorage({ path: paths.stateFile, readonly: true });
  try { return await store.getOperation(requestId); }
  finally { await store.close(); }
}

export async function inspectArchive(directory: string): Promise<PublicResult> {
  const adapter = createPlatformPaths();
  const paths = await adapter.resolveArchive(directory, 'read');
  if (!paths) return absentResult();
  // A verified live observation remains available when the daemon's storage
  // worker has failed and no safe offline WAL view can be opened.
  try {
    const key = await adapter.readCredential(paths.clientKeyFile);
    const response = await createLocalTransport().call(paths.daemonEndpoint, key, {
      protocolVersion: 1, correlationId: randomUUID(), method: 'status.get', params: {},
    }, 1_000);
    const data = response.data as Record<string, unknown> | null;
    if (response.result === 'OK' && data) {
      const storeId = requireUuid(data.storeId), instanceId = requireUuid(data.instanceId);
      return { protocolVersion: 1, requestId: null, storeId, instanceId,
        result: 'OK', outcome: null, freshness: data.freshness === 'VOLATILE' ? 'VOLATILE' : 'LIVE', liveness: 'LIVE_VERIFIED', error: null,
        data: { ...data, status: 'PRESENT', observedAt: new Date().toISOString() } };
    }
  } catch { /* Offline inspection below preserves files and never repairs sidecars. */ }
  const store = await openStorage({ path: paths.stateFile, readonly: true });
  let snapshot;
  let observability;
  let control: Awaited<ReturnType<typeof observePendingControl>> = {pendingFinalization: false, controllerLiveness: null};
  let resourceIssuesTruncated = false;
  let resourceIssues: readonly { resourceId: string; kind: string; observation: string; releaseState: string }[] = [];
  try {
    snapshot = await store.readSnapshot();
    observability = await store.getEventState();
    if (snapshot) control = await observePendingControl(snapshot, store, createProcessIdentity());
    if (snapshot?.instance) {
      const page = await store.listResourceSummaries(snapshot.instance.instanceId, { unreleasedOnly: true });
      resourceIssues = page.resources; resourceIssuesTruncated = page.truncated;
    }
  }
  finally { await store.close(); }
  if (!snapshot) return absentResult();
  const instance = snapshot.instance;
  const liveness = instance && instance.lifecycle !== 'STOPPED'
    ? await createProcessIdentity().probeAbsent(instance.pid) : 'ABSENT';
  return { protocolVersion: 1, requestId: null, storeId: snapshot.store.storeId, instanceId: instance?.instanceId ?? null,
    result: 'OK', outcome: null, freshness: 'LAST_KNOWN',
    liveness: liveness === 'ABSENT' ? 'ABSENT_VERIFIED' : 'UNKNOWN', error: null,
    data: { status: 'PRESENT', lifecycle: instance?.lifecycle ?? null, ready: false, pid: instance?.pid ?? null,
      observability, resourceIssues, resourceIssuesTruncated, revision: snapshot.store.revision, currentOperation: snapshot.pendingOperation, lastError: instance?.lastError ?? null,
      ...control, pendingFinalization: control.pendingFinalization || (liveness === 'ABSENT' && snapshot.pendingOperation !== null),
      observationError: instance && instance.lifecycle !== 'STOPPED'
        ? foundationError(liveness === 'ABSENT' ? 'DAEMON_ABSENT' : 'RESOURCE_IDENTITY_UNKNOWN', { cause: liveness === 'ABSENT' ? 'PROCESS_EXIT' : 'IDENTITY_UNVERIFIED' }) : null,
      observedAt: new Date().toISOString() } };
}

export async function inspectDetails(directory: string, method: 'diagnostics' | 'events', limit?: number, after?: EventCursor): Promise<PublicResult> {
  const state = await inspectArchive(directory);
  const adapter = createPlatformPaths(), paths = await adapter.resolveArchive(directory, 'read');
  if (!paths) {if (after) throw new Error('INVALID_REQUEST'); return state;}
  const params = {...(limit !== undefined ? {limit} : {}), ...(after ? {after} : {})};
  if (state.freshness === 'LIVE') {
    try {
      const key = await adapter.readCredential(paths.clientKeyFile);
      const response = await createLocalTransport().call(paths.daemonEndpoint, key, {protocolVersion: 1,
        correlationId: randomUUID(), method: method === 'diagnostics' ? 'diagnostics.get' : 'events.list', params}, 1_000);
      const data = response.data as Record<string, unknown> | null;
      if (response.result === 'ERROR' && typeof data?.code === 'string') throw new EventStreamError(data.code, data.code === 'CURSOR_EXPIRED' ? requireGap(data, state.storeId ?? undefined) : undefined);
      if (response.result === 'OK' && data?.storeId === state.storeId) return {...state, data: {...state.data, ...data}};
    } catch (error) {if (error instanceof EventStreamError) throw error; /* Offline inspection never repairs a journal or drains an outbox. */ }
  }
  const store = await openStorage({path: paths.stateFile, readonly: true});
  try {
    const details = method === 'diagnostics' ? await diagnosticsData(store, await store.readSnapshot())
      : {events: await readEventPage(store, state.storeId!, params)};
    return {...state, freshness: state.freshness === 'VOLATILE' ? 'VOLATILE' : 'LAST_KNOWN', data: {...state.data, ...details}};
  } finally { await store.close(); }
}

if (isEntrypoint(import.meta.url)) {
  const request = await readBootstrap();
  if (typeof request.canonicalStateDir !== 'string') throw new Error('INVALID_REQUEST');
  const result = request.requestId && typeof request.requestId === 'string'
    ? await readOperationFromArchive(request.canonicalStateDir, request.requestId)
    : await inspectArchive(request.canonicalStateDir);
  process.stdout.write(JSON.stringify(result) + '\n');
}

/** Historical Discovery queries never construct an extractor or a provider adapter. */
export async function inspectDiscovery(directory: string, method: string, params: Readonly<Record<string, unknown>>): Promise<PublicResult> {
  const { validateDiscoveryParams } = await import('../protocol/discovery.js');
  const { createDiscoveryReader } = await import('./discovery/read.js');
  let storage: Awaited<ReturnType<typeof openStorage>> | undefined;
  let snapshot: import('../ports/storage.js').StoreSnapshot | null = null;
  const base = (): PublicResult => ({ protocolVersion: 1, requestId: method === 'discovery.operation.get' && typeof params.requestId === 'string' ? params.requestId : null,
    storeId: snapshot?.store.storeId ?? null, instanceId: snapshot?.instance?.instanceId ?? null, result: 'OK', outcome: null,
    freshness: 'LAST_KNOWN', liveness: snapshot?.instance?.lifecycle === 'STOPPED' ? 'ABSENT_VERIFIED' : 'UNKNOWN', data: {}, error: null });
  try {
    validateDiscoveryParams(method, params);
    const paths = await createPlatformPaths().resolveArchive(directory, 'read'); if (!paths) throw new Error('STATE_ABSENT');
    storage = await openStorage({ path: paths.stateFile, readonly: true }); snapshot = await storage.readSnapshot(); if (!snapshot) throw new Error('STATE_ABSENT');
    if (snapshot.store.schemaVersion < 4) throw new Error('DISCOVERY_NOT_INITIALIZED');
    const data = await createDiscoveryReader({ storage, storeId: snapshot.store.storeId, offline: true })(method, params);
    const operation = data.operation as { outcome?: string; error?: PublicResult['error'] } | undefined;
    const result: PublicResult['result'] = operation?.outcome === 'IN_PROGRESS' ? 'BUSY' : operation?.outcome === 'UNKNOWN' ? 'UNKNOWN_OUTCOME' : operation?.outcome === 'BLOCKED' ? 'BLOCKED' : operation?.outcome === 'FAILED' || operation?.outcome === 'INTERRUPTED' ? 'ERROR' : 'OK';
    const outcome = operation?.outcome && operation.outcome !== 'UNKNOWN' ? operation.outcome as PublicResult['outcome'] : null;
    return { ...base(), result, outcome, data, error: operation?.error ?? null };
  } catch (error) {
    const code = (await import('./control-main.js')).classifyError(error);
    return { ...base(), result: foundationError(code).category === 'SAFETY' ? 'BLOCKED' : 'ERROR', error: foundationError(code) };
  } finally { await storage?.close(); }
}

/** Historical feature reads never migrate, spawn or infer. */
export async function inspectFeature(directory: string, method: string, params: Readonly<Record<string, unknown>>): Promise<PublicResult> {
  const { validateFeatureParams } = await import('../protocol/feature.js');
  const { createFeatureReader } = await import('./features/read.js');
  let storage: Awaited<ReturnType<typeof openStorage>> | undefined;
  let snapshot: import('../ports/storage.js').StoreSnapshot | null = null;
  const base = (): PublicResult => ({ protocolVersion: 1, requestId: method === 'feature.operation.get' && typeof params.requestId === 'string' ? params.requestId : null,
    storeId: snapshot?.store.storeId ?? null, instanceId: snapshot?.instance?.instanceId ?? null, result: 'OK', outcome: null,
    freshness: 'LAST_KNOWN', liveness: snapshot?.instance?.lifecycle === 'STOPPED' ? 'ABSENT_VERIFIED' : 'UNKNOWN', data: {}, error: null });
  try {
    validateFeatureParams(method, params);
    const paths = await createPlatformPaths().resolveArchive(directory, 'read'); if (!paths) throw new Error('STATE_ABSENT');
    storage = await openStorage({ path: paths.stateFile, readonly: true }); snapshot = await storage.readSnapshot(); if (!snapshot) throw new Error('STATE_ABSENT');
    if (snapshot.store.schemaVersion < 5) throw new Error('FEATURE_NOT_INITIALIZED');
    const data = await createFeatureReader({ storage, storeId: snapshot.store.storeId, offline: true })(method, params);
    const operation = data.operation as { outcome?: string; error?: PublicResult['error'] } | undefined;
    const result: PublicResult['result'] = operation?.outcome === 'IN_PROGRESS' ? 'BUSY' : operation?.outcome === 'UNKNOWN' ? 'UNKNOWN_OUTCOME' : operation?.outcome === 'BLOCKED' ? 'BLOCKED' : operation?.outcome === 'FAILED' || operation?.outcome === 'INTERRUPTED' ? 'ERROR' : 'OK';
    const outcome = operation?.outcome && operation.outcome !== 'UNKNOWN' ? operation.outcome as PublicResult['outcome'] : null;
    return { ...base(), result, outcome, data, error: operation?.error ?? null };
  } catch (error) {
    const code = (await import('./control-main.js')).classifyError(error);
    return { ...base(), result: foundationError(code).category === 'SAFETY' ? 'BLOCKED' : 'ERROR', error: foundationError(code) };
  } finally { await storage?.close(); }
}

export async function inspectWorkspace(directory:string,method:string,params:Readonly<Record<string,unknown>>):Promise<PublicResult>{
 const {validateWorkspaceParams,WORKSPACE_READ_METHODS,decodeWorkspaceOperation}=await import('../protocol/workspace.js');
 const {createWorkspaceReader}=await import('./workspaces/read.js');
 const {workspaceResult}=await import('./workspaces/dispatch.js');
 const {classifyError}=await import('./control-main.js');
 let store:Awaited<ReturnType<typeof openStorage>>|undefined;
 let snapshot:import('../ports/storage.js').StoreSnapshot|null=null;
 const requestId=method==='workspace.operation.get'&&typeof params.requestId==='string'?params.requestId:null;
 const base=():PublicResult=>({...absentResult(),requestId,storeId:snapshot?.store.storeId??null,instanceId:snapshot?.instance?.instanceId??null,
   freshness:'LAST_KNOWN',liveness:snapshot?.instance?.lifecycle==='STOPPED'?'ABSENT_VERIFIED':'UNKNOWN'});
 try{
   validateWorkspaceParams(method,params);
   if(!(WORKSPACE_READ_METHODS as readonly string[]).includes(method))throw new Error('DAEMON_UNAVAILABLE');
   const paths=await createPlatformPaths().resolveArchive(directory,'read');
   if(!paths)throw new Error('STATE_ABSENT');
   store=await openStorage({path:paths.stateFile,readonly:true});
   snapshot=await store.readSnapshot();
   if(!snapshot)throw new Error('STATE_ABSENT');
   if(snapshot.store.schemaVersion<6)throw new Error('WORKSPACE_NOT_INITIALIZED');
   const data=await createWorkspaceReader({storage:store,storeId:snapshot.store.storeId,offline:true})(method,params);
   const operation=data.operation?decodeWorkspaceOperation(data.operation):null;
   return{...base(),data,result:workspaceResult(data),outcome:operation?.outcome==='UNKNOWN'?null:operation?.outcome??null,error:operation?.error??null};
 }catch(error){
   const safe=foundationError(classifyError(error));
   return{...base(),result:safe.category==='SAFETY'?'BLOCKED':'ERROR',error:safe};
 }finally{await store?.close();}
}
