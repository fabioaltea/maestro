import type { AuthenticatedPeer, RpcRequest, RpcResponse } from '../../ports/platform.js';
import type { StoragePort, StoreSnapshot } from '../../ports/storage.js';
import { foundationError } from '../../domain/errors.js';
import { classifyError } from '../control-main.js';
import { createDiscoveryReader } from './read.js';
import { DISCOVERY_READ_METHODS, DISCOVERY_ADMISSION_METHODS, requireDiscoveryEnvelope, validateDiscoveryParams } from '../../protocol/discovery.js';
import type { createDiscoveryOperations } from './operations.js';
import type { DiscoveryIntent } from '../../domain/discovery/intent.js';
import { CODEX_DISCOVERY_PIN } from '../../providers/codex/argv.js';
import { CODEX_DISCOVERY_QUALIFICATION } from '../../providers/codex/capabilities.js';
export const DISCOVERY_METHODS: readonly string[] = DISCOVERY_READ_METHODS;
export const DISCOVERY_LIVE_METHODS: readonly string[] = [...DISCOVERY_READ_METHODS, 'discovery.prepare', ...DISCOVERY_ADMISSION_METHODS];
export function createDiscoveryDispatch(options: { storage: Pick<StoragePort, 'readDiscoveryMetadata' | 'getDiscoveryOperation' | 'readDiscoveryArtifact' | 'readDiscoveryManifestPage' | 'getProject'>;
  operations?: ReturnType<typeof createDiscoveryOperations>; accepting?: () => boolean; canCancel?: () => boolean }) {
  return async (request: RpcRequest, peer: AuthenticatedPeer, snapshot: StoreSnapshot): Promise<RpcResponse> => {
    const base = { protocolVersion: 1 as const, correlationId: request.correlationId };
    try {
      if (peer.role !== 'client') throw new Error('UNAUTHORIZED');
      if (snapshot.store.schemaVersion !== 4) throw new Error('DISCOVERY_NOT_INITIALIZED');
      if (!(options.operations ? DISCOVERY_LIVE_METHODS : DISCOVERY_METHODS).includes(request.method)) throw new Error('UNSUPPORTED_VERSION');
      validateDiscoveryParams(request.method, request.params);
      let data: Record<string, unknown>;
      const p = request.params, service = options.operations;
      if (request.method === 'discovery.prepare' || (DISCOVERY_ADMISSION_METHODS as readonly string[]).includes(request.method)) {
        const cancelling = request.method === 'discovery.cancel' || request.method === 'discovery.prepare' && (p.intent as DiscoveryIntent).action === 'cancel';
        if (!service || snapshot.instance?.lifecycle !== 'RUNNING' || (cancelling ? options.canCancel?.() === false : options.accepting?.() === false)) throw new Error('BLOCKED');
        const result = request.method === 'discovery.prepare' ? await service.prepare(peer, p.intent as DiscoveryIntent)
          : request.method === 'discovery.start' ? await service.startGranted(peer, p as unknown as Parameters<typeof service.startGranted>[1])
          : request.method === 'discovery.provider.configure' ? await service.configureGranted(peer, p as unknown as Parameters<typeof service.configureGranted>[1])
          : request.method === 'discovery.provider.check' ? await service.check(peer, p as unknown as Parameters<typeof service.check>[1])
          : request.method === 'discovery.preview.discard' ? await service.discard(peer, p as unknown as Parameters<typeof service.discard>[1])
          : await service.preview(peer, p as unknown as Parameters<typeof service.preview>[1]);
        if (!result.ok) throw new Error(result.code); data = { ...result.value };
      } else {
        data = await createDiscoveryReader({ storage: options.storage, storeId: snapshot.store.storeId, offline: false })(request.method, p);
        if (request.method === 'discovery.provider.get' && service) {
          data = { ...data, check: await service.availability(peer).catch(() => null), requirements: { providerId: 'codex', binaryVersion: CODEX_DISCOVERY_PIN.version,
            binarySha256: CODEX_DISCOVERY_PIN.sha256, policyVersion: CODEX_DISCOVERY_PIN.policyVersion, qualificationDigest: CODEX_DISCOVERY_QUALIFICATION.digest } };
        }
      }
      const operation = data.operation as { outcome: string } | undefined;
      const result: RpcResponse['result'] = operation?.outcome === 'IN_PROGRESS' ? 'BUSY' : operation?.outcome === 'BLOCKED' ? 'BLOCKED' : operation && operation.outcome !== 'SUCCEEDED' ? 'ERROR' : 'OK';
      const response = { ...base, result, data: { storeId: snapshot.store.storeId, ...data } }; requireDiscoveryEnvelope(response); return response;
    } catch (error) {
      const code = classifyError(error); return { ...base, result: code === 'DISCOVERY_BUSY' ? 'BUSY' : foundationError(code).category === 'SAFETY' ? 'BLOCKED' : 'ERROR', data: { storeId: snapshot.store.storeId, code, error: foundationError(code) } };
    }
  };
}
