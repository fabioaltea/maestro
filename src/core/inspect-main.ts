import { randomUUID } from 'node:crypto';
import { createPlatformPaths } from '../platform/macos/paths.js';
import { createLocalTransport } from '../platform/macos/transport.js';
import { createProcessIdentity } from '../platform/macos/process-identity.js';
import { openStorage } from '../storage/worker.js';
import type { PublicResult } from '../protocol/messages.js';
import type { OperationRecord } from '../ports/storage.js';
import { isEntrypoint, readBootstrap } from './entrypoint.js';

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
  const store = await openStorage({ path: paths.stateFile, readonly: true });
  let snapshot;
  let resourceIssues: readonly { resourceId: string; kind: string; observation: string; releaseState: string }[] = [];
  try {
    snapshot = await store.readSnapshot();
    if (snapshot?.instance?.lifecycle === 'BLOCKED') resourceIssues = (await store.listResources(snapshot.instance.instanceId))
      .filter(resource => resource.releaseState !== 'RELEASED').map(resource => ({ resourceId: resource.resourceId,
        kind: resource.kind, observation: resource.observation, releaseState: resource.releaseState }));
  }
  finally { await store.close(); }
  if (!snapshot) return absentResult();
  const instance = snapshot.instance;
  if (instance) {
    try {
      const key = await adapter.readCredential(paths.clientKeyFile);
      const response = await createLocalTransport().call(paths.daemonEndpoint, key, {
        protocolVersion: 1, correlationId: randomUUID(), method: 'status.get', params: {},
      }, 1_000);
      const data = response.data as Record<string, unknown> | null;
      if (response.result === 'OK' && data?.storeId === snapshot.store.storeId && data.instanceId === instance.instanceId) {
        return { protocolVersion: 1, requestId: null, storeId: snapshot.store.storeId, instanceId: instance.instanceId,
          result: 'OK', outcome: null, freshness: data.freshness === 'VOLATILE' ? 'VOLATILE' : 'LIVE', liveness: 'LIVE_VERIFIED', error: null,
          data: { ...data, status: 'PRESENT', observedAt: new Date().toISOString() } };
      }
    } catch { /* A failed live observation must not rewrite the saved state. */ }
  }
  const liveness = instance && instance.lifecycle !== 'STOPPED'
    ? await createProcessIdentity().probeAbsent(instance.pid) : 'ABSENT';
  return { protocolVersion: 1, requestId: null, storeId: snapshot.store.storeId, instanceId: instance?.instanceId ?? null,
    result: 'OK', outcome: null, freshness: 'LAST_KNOWN',
    liveness: liveness === 'ABSENT' ? 'ABSENT_VERIFIED' : 'UNKNOWN', error: null,
    data: { status: 'PRESENT', lifecycle: instance?.lifecycle ?? null, ready: false, pid: instance?.pid ?? null,
      resourceIssues, revision: snapshot.store.revision, currentOperation: snapshot.pendingOperation, lastError: instance?.lastError ?? null,
      pendingFinalization: liveness === 'ABSENT' && snapshot.pendingOperation !== null,
      observedAt: new Date().toISOString() } };
}

if (isEntrypoint(import.meta.url)) {
  const request = await readBootstrap();
  if (typeof request.canonicalStateDir !== 'string') throw new Error('INVALID_REQUEST');
  const result = request.requestId && typeof request.requestId === 'string'
    ? await readOperationFromArchive(request.canonicalStateDir, request.requestId)
    : await inspectArchive(request.canonicalStateDir);
  process.stdout.write(JSON.stringify(result) + '\n');
}
