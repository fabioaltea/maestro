import { requireCursor, eventGap, EventStreamError } from '../protocol/event-cursor.js';
import type { ProjectRegistryDiagnostics } from '../ports/registry.js';
import { VERSION } from '../version.js';
import { SCHEMA_VERSION } from '../storage/schema.js';
import type { StoragePort, StoreSnapshot } from '../ports/storage.js';

export async function diagnosticsData(store: StoragePort, snapshot: StoreSnapshot | null, projectRegistry?: ProjectRegistryDiagnostics) {
  const observability = await store.getEventState(true);
  const resources = snapshot?.instance ? await store.listResources(snapshot.instance.instanceId) : [];
  return { ...(projectRegistry ? { projectRegistry } : {}), versions: {package: VERSION, node: process.versions.node, protocol: 1, schema: SCHEMA_VERSION},
    platform: {os: process.platform, arch: process.arch}, observability,
    health: {observability: observability.degraded ? 'DEGRADED' : 'HEALTHY'},
    resources: resources.slice(0, 20).map(r => ({resourceId: r.resourceId, kind: r.kind, observation: r.observation, releaseState: r.releaseState})),
    resourcesTruncated: resources.length > 20};
}
export function eventQuery(params: Readonly<Record<string, unknown>>, storeId: string) {
  if (Object.keys(params).some(key => !['after', 'limit', 'maxBytes'].includes(key))) throw new Error('INVALID_REQUEST');
  const after = params.after === undefined ? undefined : requireCursor(params.after, storeId).seq;
  if (params.limit !== undefined && (typeof params.limit !== 'number' || !Number.isInteger(params.limit) || params.limit < 1 || params.limit > 1000)) throw new Error('INVALID_REQUEST');
  if (params.maxBytes !== undefined && (typeof params.maxBytes !== 'number' || !Number.isInteger(params.maxBytes) || params.maxBytes < 16_384 || params.maxBytes > 65_536)) throw new Error('INVALID_REQUEST');
  return {...(after !== undefined ? {after} : {}), ...(typeof params.limit === 'number' ? {limit: params.limit} : {}),
    ...(typeof params.maxBytes === 'number' ? {maxBytes: params.maxBytes} : {})};
}

export async function readEventPage(store: StoragePort, storeId: string, params: Readonly<Record<string, unknown>>) {
  const query = eventQuery(params, storeId);
  try {
    const page = await store.listEvents(query);
    return {...page, nextCursor: {storeId, seq: page.nextAfter}};
  } catch (error) {
    if (error instanceof Error && error.message === 'CURSOR_EXPIRED') {
      const state = await store.getEventState(true);
      if (state.errorCode) throw new Error(state.errorCode);
      throw new EventStreamError('CURSOR_EXPIRED', eventGap(storeId, state));
    }
    throw error;
  }
}
