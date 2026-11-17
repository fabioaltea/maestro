import type { StoragePort } from '../../ports/storage.js';
import type { DiscoveryArtifactPort, DiscoveryMetadataData, DiscoveryMetadataQuery, DiscoveryMetadataChange } from '../../ports/discovery.js';
import type { AgentProcessIdentity } from '../../ports/agent-runtime.js';
import type { ProviderEvent } from '../../ports/provider.js';
import { DISCOVERY_LIMITS as limits } from '../../domain/discovery/model.js';
import { validateDiscoveryText } from '../../domain/discovery/intent.js';

/** The only bodies published here are normalized events, never provider stderr.
 * Bodies precede the authoritative metadata/watermark/outbox transaction. */
export function createDiscoveryOutput(options: { storage: Pick<StoragePort, 'readDiscoveryMetadata' | 'commitDiscoveryMetadata'>; artifacts: DiscoveryArtifactPort }) {
  let tail: Promise<unknown> = Promise.resolve(), pending = 0;
  async function meta<Q extends DiscoveryMetadataQuery>(query: Q): Promise<DiscoveryMetadataData<Q>> {
    const r = await options.storage.readDiscoveryMetadata!(query); if (!r.ok) throw new Error(r.code); return r.value.data;
  }
  async function commit(change: DiscoveryMetadataChange) { const r = await options.storage.commitDiscoveryMetadata!(change); if (!r.ok) throw new Error(r.code); }
  async function write(identity: AgentProcessIdentity, event: ProviderEvent) {
    if (event.kind !== 'PROGRESS' && event.kind !== 'AGENT_TEXT') return;
    validateDiscoveryText(event.text, limits.runOutputBytes);
    const run = await meta({ kind: 'run', id: identity.runId }), discovery = run ? await meta({ kind: 'discovery', id: run.discoveryId }) : null;
    if (!run || !discovery || run.generation !== identity.generation || run.phase !== 'PROVIDER_RUNNING' || run.outcome !== 'RUNNING' || discovery.currentRunId !== run.runId) throw new Error('STALE_TARGET');
    const status = await meta({ kind: 'outputStatus', id: run.runId }); if (!status) throw new Error('STALE_TARGET');
    let watermark = status.watermark, stored = status.bytes; const raw = Buffer.from(event.text);
    const truncate = async () => { if (watermark !== '0') await commit({ kind: 'output-truncated', runId: run.runId, generation: run.generation, expectedWatermark: watermark }); };
    for (let offset = 0; offset < raw.length;) {
      let end = Math.min(raw.length, offset + limits.chunkBytes, offset + limits.storedOutputBytes - stored);
      while (end < raw.length && end > offset && (raw[end]! & 0xc0) === 0x80) end--;
      if (end <= offset) { await truncate(); throw new Error('PROVIDER_OUTPUT_LIMIT'); }
      const bytes = raw.subarray(offset, end), reservation = await options.artifacts.reserve('OUTPUT', bytes.length);
      if (!reservation.ok) { await truncate(); throw new Error(reservation.code); }
      const body = await options.artifacts.publish(reservation.value.artifactId, bytes); if (!body.ok) { await truncate(); throw new Error(body.code); }
      const seq = String(BigInt(watermark) + 1n);
      await commit({ kind: 'output', generation: run.generation, expectedWatermark: watermark,
        value: { runId: run.runId, seq, artifactId: body.value.artifactId, sha256: body.value.sha256!, bytes: bytes.length, kind: event.kind, createdAt: new Date().toISOString(), truncated: false } });
      stored += bytes.length; watermark = seq; offset = end;
    }
  }
  return { async publish(identity: AgentProcessIdentity, event: ProviderEvent) {
    if (pending >= 8) throw new Error('DISCOVERY_BUSY'); pending++;
    const result = tail.then(() => write(identity, event)); tail = result.catch(() => {});
    try { await result; } finally { pending--; }
  } };
}
