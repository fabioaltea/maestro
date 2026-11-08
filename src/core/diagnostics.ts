import { VERSION } from '../version.js';
import { SCHEMA_VERSION } from '../storage/schema.js';
import type { StoragePort, StoreSnapshot } from '../ports/storage.js';

export async function diagnosticsData(store: StoragePort, snapshot: StoreSnapshot | null) {
  const observability = await store.getEventState(true);
  const resources = snapshot?.instance ? await store.listResources(snapshot.instance.instanceId) : [];
  return {versions: {package: VERSION, node: process.versions.node, protocol: 1, schema: SCHEMA_VERSION},
    platform: {os: process.platform, arch: process.arch}, observability,
    health: {observability: observability.degraded ? 'DEGRADED' : 'HEALTHY'},
    resources: resources.slice(0, 20).map(r => ({resourceId: r.resourceId, kind: r.kind, observation: r.observation, releaseState: r.releaseState})),
    resourcesTruncated: resources.length > 20};
}
export function eventQuery(params: Readonly<Record<string, unknown>>) {
  if (Object.keys(params).some(key => !['after', 'limit', 'maxBytes'].includes(key))) throw new Error('INVALID_REQUEST');
  if (params.after !== undefined && (typeof params.after !== 'string' || !/^(0|[1-9][0-9]{0,18})$/.test(params.after))) throw new Error('INVALID_REQUEST');
  if (params.limit !== undefined && (typeof params.limit !== 'number' || !Number.isInteger(params.limit) || params.limit < 1 || params.limit > 1000)) throw new Error('INVALID_REQUEST');
  if (params.maxBytes !== undefined && (typeof params.maxBytes !== 'number' || !Number.isInteger(params.maxBytes) || params.maxBytes < 16_384 || params.maxBytes > 65_536)) throw new Error('INVALID_REQUEST');
  return {...(typeof params.after === 'string' ? {after: params.after} : {}), ...(typeof params.limit === 'number' ? {limit: params.limit} : {}),
    ...(typeof params.maxBytes === 'number' ? {maxBytes: params.maxBytes} : {})};
}
