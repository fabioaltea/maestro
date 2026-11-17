import type { AuthenticatedPeer, RpcRequest, RpcResponse } from '../../ports/platform.js';
import type { StoragePort, StoreSnapshot } from '../../ports/storage.js';
import { foundationError } from '../../domain/errors.js';
import { classifyError } from '../control-main.js';
import { createDiscoveryReader } from './read.js';
import { DISCOVERY_READ_METHODS, requireDiscoveryEnvelope, validateDiscoveryParams } from '../../protocol/discovery.js';
export const DISCOVERY_METHODS: readonly string[] = DISCOVERY_READ_METHODS;
/** Only implemented reads are registered in this Foundation increment. */
export function createDiscoveryDispatch(options: { storage: Pick<StoragePort, 'readDiscoveryMetadata' | 'getDiscoveryOperation' | 'readDiscoveryArtifact' | 'readDiscoveryManifestPage' | 'getProject'> }) {
  return async (request: RpcRequest, peer: AuthenticatedPeer, snapshot: StoreSnapshot): Promise<RpcResponse> => {
    const base = { protocolVersion: 1 as const, correlationId: request.correlationId };
    try {
      if (peer.role !== 'client') throw new Error('UNAUTHORIZED');
      if (snapshot.store.schemaVersion !== 4) throw new Error('DISCOVERY_NOT_INITIALIZED');
      if (!DISCOVERY_METHODS.includes(request.method)) throw new Error('UNSUPPORTED_VERSION');
      validateDiscoveryParams(request.method, request.params);
      const data = await createDiscoveryReader({ storage: options.storage, storeId: snapshot.store.storeId, offline: false })(request.method, request.params);
      const operation = data.operation as { outcome: string } | undefined;
      const result: RpcResponse['result'] = operation?.outcome === 'IN_PROGRESS' ? 'BUSY' : operation?.outcome === 'BLOCKED' ? 'BLOCKED' : operation && operation.outcome !== 'SUCCEEDED' ? 'ERROR' : 'OK';
      const response = { ...base, result, data: { storeId: snapshot.store.storeId, ...data } }; requireDiscoveryEnvelope(response); return response;
    } catch (error) {
      const code = classifyError(error); return { ...base, result: foundationError(code).category === 'SAFETY' ? 'BLOCKED' : 'ERROR', data: { storeId: snapshot.store.storeId, code, error: foundationError(code) } };
    }
  };
}
