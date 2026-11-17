import { createHash, randomUUID } from 'node:crypto';
import { canonicalDiscoveryIntent, validateDiscoveryGrant, type DiscoveryIntent } from '../../domain/discovery/intent.js';
import { DISCOVERY_LIMITS, isDiscoveryFailure, type DiscoveryFailure, type DiscoveryResult } from '../../domain/discovery/model.js';
import { requireUuid } from '../../domain/identifiers.js';
import type { StoragePort } from '../../ports/storage.js';
import type { ArchivePaths, AuthenticatedPeer } from '../../ports/platform.js';
import type { DiscoveryAdmission, DiscoveryMetadataData, DiscoveryMetadataQuery } from '../../ports/discovery.js';
import type { CodexInspectionPort, ProviderAvailability, ProviderConfiguration, ProviderPort } from '../../ports/provider.js';
import { CODEX_DISCOVERY_PIN } from '../../providers/codex/argv.js';
import { CODEX_DISCOVERY_QUALIFICATION, validCodexModel } from '../../providers/codex/capabilities.js';

interface Options {
  readonly storage: Pick<StoragePort, 'readSnapshot' | 'readDiscoveryMetadata' | 'commitDiscoveryMetadata' | 'admitDiscoveryOperation' | 'getDiscoveryOperation' | 'saveDiscoveryGrant'>;
  readonly paths: ArchivePaths; readonly instanceId: string; readonly ownerUid: number;
  readonly provider: ProviderPort; readonly inspection?: CodexInspectionPort;
  readonly checkpoint?: (point: string) => Promise<void>;
}
export interface DiscoveryCommand { readonly requestId: string; readonly grantId: string | null; readonly canonicalIntent: string }
export interface DiscoveryAccepted { readonly accepted: true; readonly requestId: string; readonly discoveryId?: string; readonly sessionId?: string; readonly runId?: string }
function fail(code: DiscoveryFailure): never { throw new Error(code); }
function failure(error: unknown): { ok: false; code: DiscoveryFailure } {
  return { ok: false, code: error instanceof Error && isDiscoveryFailure(error.message) ? error.message as DiscoveryFailure : 'INVALID_REQUEST' };
}
function exact(value: object, keys: readonly string[]) { if (!value || Object.keys(value).some(key => !keys.includes(key))) fail('INVALID_REQUEST'); }
export function createDiscoveryOperations(options: Options) {
  const { storage } = options;
  let lastCheck: { revision: string; value: ProviderAvailability } | null = null;
  const jobs = new Set<Promise<void>>();
  async function guard(peer: AuthenticatedPeer) {
    if (peer.role !== 'client') fail('UNAUTHORIZED');
    const s = await storage.readSnapshot();
    if (!s || s.store.ownerUid !== options.ownerUid || s.store.canonicalPath !== options.paths.directory
      || s.instance?.instanceId !== options.instanceId || s.instance.lifecycle !== 'RUNNING') fail('STALE_TARGET');
    return s!;
  }
  async function meta<Q extends DiscoveryMetadataQuery>(query: Q): Promise<DiscoveryMetadataData<Q>> {
    if (!storage.readDiscoveryMetadata) return fail('DISCOVERY_NOT_INITIALIZED');
    const result = await storage.readDiscoveryMetadata(query); if (!result.ok) return fail(result.code); return result.value.data;
  }
  async function commit(change: Parameters<NonNullable<StoragePort['commitDiscoveryMetadata']>>[0]) {
    if (!storage.commitDiscoveryMetadata) fail('DISCOVERY_NOT_INITIALIZED');
    const result = await storage.commitDiscoveryMetadata!(change); if (!result.ok) fail(result.code);
  }
  async function intentFor(peer: AuthenticatedPeer, raw: DiscoveryIntent | string) {
    const s = await guard(peer);
    const canonical = canonicalDiscoveryIntent(typeof raw === 'string' ? JSON.parse(raw) : raw);
    if (typeof raw === 'string' && raw !== canonical) fail('INVALID_REQUEST');
    const intent = JSON.parse(canonical) as DiscoveryIntent;
    if (intent.ownerUid !== options.ownerUid) fail('APPROVAL_REQUIRED');
    if (intent.storeId !== s.store.storeId) fail('WRONG_STORE');
    return { canonical, intent, snapshot: s };
  }
  function admission(requestId: string, canonicalIntent: string, grantId: string | null): DiscoveryAdmission {
    requireUuid(requestId); const intent = JSON.parse(canonicalIntent) as DiscoveryIntent;
    return { requestId, action: intent.action, canonicalIntent, payloadHash: createHash('sha256').update(canonicalIntent).digest('hex'), grantId,
      ownerUid: options.ownerUid, instanceId: options.instanceId, acceptedAt: new Date().toISOString(), nowMs: Date.now(),
      discovery: null, run: null, expectedStateRevision: null, acquireSlot: false };
  }
  async function original(input: DiscoveryCommand, action: DiscoveryIntent['action']) {
    requireUuid(input.requestId);
    const old = await storage.getDiscoveryOperation?.(input.requestId);
    if (old) {
      // Public operations omit the intent/hash: compare through the ledger's
      // replay path rather than accepting a UUID with another payload.
      if (old.action !== action) fail('IDEMPOTENCY_CONFLICT');
      if (!storage.admitDiscoveryOperation) fail('DISCOVERY_NOT_INITIALIZED');
      const result = await storage.admitDiscoveryOperation!(admission(input.requestId, input.canonicalIntent, input.grantId));
      if (!result.ok) fail(result.code); return true;
    }
    return false;
  }
  async function configureIntent(intent: DiscoveryIntent) {
    const c = await meta({ kind: 'provider' }), p = intent.payload;
    if (intent.action !== 'configure' || intent.targetId !== intent.storeId || intent.configRevision !== null || intent.stateRevision !== null
      || intent.snapshotId !== null || intent.contextDigest !== null || intent.providerRevision !== (c?.revision ?? null)
      || p.expectedProviderRevision !== (c?.revision ?? null)) fail('APPROVAL_STALE');
    if (!validCodexModel(p.modelId) || intent.modelId !== p.modelId || p.binarySha256 !== CODEX_DISCOVERY_PIN.sha256
      || p.binaryVersion !== CODEX_DISCOVERY_PIN.version || p.providerProfileDigest !== CODEX_DISCOVERY_QUALIFICATION.digest
      || intent.providerProfileDigest !== CODEX_DISCOVERY_QUALIFICATION.digest || typeof p.binaryRealpath !== 'string') fail('PROVIDER_UNSUPPORTED');
    if (!options.inspection) fail('PROVIDER_UNAVAILABLE');
    const inspected = await options.inspection!.inspectBinary(p.binaryRealpath as string);
    if (!inspected.ok) fail(inspected.code);
    if (inspected.value.sha256 !== p.binarySha256 || inspected.value.version !== p.binaryVersion) fail('PROVIDER_UNSUPPORTED');
    return c;
  }
  return {
    async prepare(peer: AuthenticatedPeer, raw: DiscoveryIntent) {
      try {
        const { canonical, intent } = await intentFor(peer, raw);
        await configureIntent(intent);
        const grant = { grantId: randomUUID(), canonicalIntent: canonical, expiresAtMs: Date.now() + DISCOVERY_LIMITS.grantMs, consumedByRequestId: null };
        if (!storage.saveDiscoveryGrant) fail('DISCOVERY_NOT_INITIALIZED');
        const saved = await storage.saveDiscoveryGrant!(grant); if (!saved.ok) fail(saved.code);
        return { ok: true, value: { grantId: grant.grantId, canonicalIntent: canonical, expiresAtMs: grant.expiresAtMs,
          summary: { action: intent.action, modelId: intent.modelId, sendsProjectData: false } } } as const;
      } catch (error) { return failure(error); }
    },
    async configure(peer: AuthenticatedPeer, input: DiscoveryCommand): Promise<DiscoveryResult<DiscoveryAccepted>> {
      try {
        exact(input, ['requestId', 'grantId', 'canonicalIntent']);
        const { intent } = await intentFor(peer, input.canonicalIntent);
        if (intent.action !== 'configure') fail('INVALID_REQUEST');
        if (await original(input, 'configure')) return { ok: true, value: { accepted: true, requestId: input.requestId } };
        const previous = await configureIntent(intent);
        if (!input.grantId) fail('APPROVAL_REQUIRED');
        const grant = await meta({ kind: 'grant', id: input.grantId });
        if (!grant || validateDiscoveryGrant(grant, input.canonicalIntent, input.requestId, Date.now()) !== 'CONSUME') fail('APPROVAL_REQUIRED');
        // Explicit configuration only: create the dedicated non-secret UUID,
        // never copy credentials or invoke the login command.
        const auth = await options.inspection!.prepareAuthHome(); if (!auth.ok) fail(auth.code);
        const p = intent.payload;
        const configuration: ProviderConfiguration = { providerId: 'codex', revision: String(BigInt(previous?.revision ?? '0') + 1n),
          binaryRealpath: p.binaryRealpath as string, binarySha256: p.binarySha256 as string, binaryVersion: p.binaryVersion as string,
          modelId: p.modelId as string, authProfileRef: auth.value, policyVersion: CODEX_DISCOVERY_PIN.policyVersion,
          qualificationDigest: CODEX_DISCOVERY_QUALIFICATION.digest, configuredAt: new Date().toISOString() };
        await commit({ kind: 'configure', configuration, expectedRevision: previous?.revision ?? null, admission: admission(input.requestId, input.canonicalIntent, input.grantId) });
        lastCheck = null;
        return { ok: true, value: { accepted: true, requestId: input.requestId } };
      } catch (error) { return failure(error); }
    },
    async check(peer: AuthenticatedPeer, input: { requestId: string; expectedProviderRevision: string }): Promise<DiscoveryResult<DiscoveryAccepted>> {
      try {
        exact(input, ['requestId', 'expectedProviderRevision']);
        const s = await guard(peer), c = await meta({ kind: 'provider' });
        if (!c) fail('PROVIDER_NOT_CONFIGURED');
        if (c!.revision !== input.expectedProviderRevision) fail('APPROVAL_STALE');
        const intent: DiscoveryIntent = { ownerUid: options.ownerUid, storeId: s.store.storeId, action: 'check', targetId: s.store.storeId,
          configRevision: null, stateRevision: null, snapshotId: null, contextDigest: null, providerRevision: c!.revision,
          providerProfileDigest: c!.qualificationDigest, modelId: c!.modelId, payload: {} };
        if (!storage.admitDiscoveryOperation) fail('DISCOVERY_NOT_INITIALIZED');
        const admitted = await storage.admitDiscoveryOperation!(admission(input.requestId, canonicalDiscoveryIntent(intent), null));
        if (!admitted.ok) fail(admitted.code);
        if (admitted.value.inserted) {
          const job = (async () => {
            try {
              const checked = await options.provider.checkAvailability(c!);
              const current = await meta({ kind: 'provider' });
              if (current?.revision !== c!.revision) fail('APPROVAL_STALE');
              lastCheck = { revision: c!.revision, value: checked };
              await commit({ kind: 'operation', requestId: input.requestId, outcome: checked.state === 'AVAILABLE' ? 'SUCCEEDED' : 'BLOCKED',
                completedAt: new Date().toISOString(), result: { providerRevision: c!.revision }, error: checked.code });
            } catch (error) {
              await commit({ kind: 'operation', requestId: input.requestId, outcome: 'BLOCKED', completedAt: new Date().toISOString(), result: null, error: failure(error).code });
            }
          })();
          jobs.add(job); void job.finally(() => jobs.delete(job)).catch(() => {});
        }
        return { ok: true, value: { accepted: true, requestId: input.requestId } };
      } catch (error) { return failure(error); }
    },
    async get(peer: AuthenticatedPeer, requestId: string) { await guard(peer); requireUuid(requestId); return await storage.getDiscoveryOperation?.(requestId) ?? null; },
    async availability(peer: AuthenticatedPeer) { await guard(peer); const c = await meta({ kind: 'provider' }); return lastCheck?.revision === c?.revision ? lastCheck?.value ?? null : null; },
    async idle() { while (jobs.size) await Promise.allSettled([...jobs]); },
  };
}
