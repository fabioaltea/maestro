import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import type { TestContext } from 'node:test';
import type { AuthenticatedPeer } from '../../src/ports/platform.js';
import type { DiscoveryContextPort } from '../../src/ports/discovery-context.js';
import type { DiscoveryArtifactPort, DiscoveryOperationView } from '../../src/ports/discovery.js';
import type { ProviderAvailability, ProviderConfiguration, ProviderPort } from '../../src/ports/provider.js';
import type { DiscoveryIntent } from '../../src/domain/discovery/intent.js';
import type { DiscoveryResult } from '../../src/domain/discovery/model.js';
import { createPlatformPaths } from '../../src/platform/macos/paths.js';
import { createMacOSDiscoveryContext } from '../../src/platform/macos/discovery/context-reader.js';
import { createDirectRepositoryInspector } from '../../src/platform/macos/git/repository-inspector.js';
import { sealDiscoveryContext } from '../../src/core/discovery/context.js';
import { makeDeadline, systemClock } from '../../src/ports/clock.js';
import { createProjectRepositories } from './project-repositories.js';
import { createRegistryStore } from './registry-store.js';
import { value } from './discovery-artifacts.js';
import { loadContract } from './load-contract.js';
import type { DiscoveryLaunch } from '../../src/core/discovery/launch.js';

export interface StartInput { requestId: string; grantId: string | null; canonicalIntent: string }
export interface StartAdmission { accepted: true; requestId: string; discoveryId?: string; sessionId?: string; runId?: string }
export interface PreparedDiscovery { grantId: string; canonicalIntent: string; expiresAtMs: number; summary: Record<string, unknown> }
export interface DiscoveryOperations {
  prepare(peer: AuthenticatedPeer, intent: DiscoveryIntent): Promise<DiscoveryResult<PreparedDiscovery>>;
  start(peer: AuthenticatedPeer, input: StartInput): Promise<DiscoveryResult<StartAdmission>>;
  preview(peer: AuthenticatedPeer, input: { requestId: string; projectId: string; expectedConfigRevision: string; selectors: readonly string[] }): Promise<DiscoveryResult<StartAdmission>>;
  check(peer: AuthenticatedPeer, input: { requestId: string; expectedProviderRevision: string }): Promise<DiscoveryResult<StartAdmission>>;
  get(peer: AuthenticatedPeer, requestId: string): Promise<DiscoveryOperationView | null>;
  idle(): Promise<void>;
  startGranted(peer: AuthenticatedPeer, input: { requestId: string; grantId: string; projectId: string }): Promise<DiscoveryResult<StartAdmission>>;
  configureGranted(peer: AuthenticatedPeer, input: { requestId: string; grantId: string; binaryRealpath: string; modelId: string }): Promise<DiscoveryResult<StartAdmission>>;
  discard(peer: AuthenticatedPeer, input: { requestId: string; snapshotId: string }): Promise<DiscoveryResult<StartAdmission>>;
}
export async function launchFixture(t: TestContext, settings: { baseBranch?:string; configured?: boolean; repository?: 'clean' | 'dirty' | 'conflict' | 'unborn'; checkpoint?: (point: string) => Promise<void>; onLaunch?: (input: DiscoveryLaunch) => Promise<void>; cleanupAllowed?: () => boolean } = {}) {
  const { createDiscoveryOperations } = await loadContract<{ createDiscoveryOperations(options: object): DiscoveryOperations }>('core/discovery/operations.js', ['createDiscoveryOperations']);
  let service: DiscoveryOperations | undefined, runtimeDirectory: string | undefined;
  t.after(async () => { await service?.idle(); if (settings.cleanupAllowed && !settings.cleanupAllowed()) throw new Error('PRESERVE_UNVERIFIED_LAUNCH_FIXTURE'); if (runtimeDirectory) await rm(runtimeDirectory, { recursive: true }); });
  const repositories = await createProjectRepositories(t), repo = await repositories.createRepository('launch', { commit: settings.repository !== 'unborn' });
  if (settings.baseBranch && settings.baseBranch !== 'fixture-base') await repositories.git(repo, ['branch', settings.baseBranch]);
  if (settings.repository === 'unborn') await writeFile(join(repo, 'tracked.txt'), 'unborn project\n');
  if (settings.repository === 'dirty') await writeFile(join(repo, 'tracked.txt'), 'dirty working input\n');
  if (settings.repository === 'conflict') {
    await repositories.git(repo, ['switch', '-c', 'other']); await writeFile(join(repo, 'tracked.txt'), 'other\n'); await repositories.git(repo, ['commit', '-am', 'other']);
    await repositories.git(repo, ['switch', 'fixture-base']); await writeFile(join(repo, 'tracked.txt'), 'base changed\n'); await repositories.git(repo, ['commit', '-am', 'base']); await repositories.git(repo, ['merge', 'other'], 1);
  }
  const f = await createRegistryStore(t), paths = (await createPlatformPaths().resolveArchive(f.directory, 'write'))!; runtimeDirectory = paths.runtimeDirectory;
  if (settings.cleanupAllowed) {
    const cleanup = f.context.cleanup.bind(f.context);
    f.context.cleanup = async () => { if (!settings.cleanupAllowed!()) throw new Error('PRESERVE_UNVERIFIED_LAUNCH_FIXTURE'); await cleanup(); };
  }
  const database = new Database(f.path); database.pragma('foreign_keys=ON'); t.after(() => database.close());
  const projectId = randomUUID(), at = new Date().toISOString();
  const inspected = await createDirectRepositoryInspector().inspectCandidate(repo, undefined, { deadline: makeDeadline(systemClock, 30000) }); assert.ok(inspected.ok);
  database.prepare("INSERT INTO projects(project_id,display_name,repository_key,repository_identity,reference_checkout,base_branch,config_revision,created_at,updated_at) VALUES(?,'Launch fixture',?,?,?,?,1,?,?)").run(projectId, createHash('sha256').update(JSON.stringify(inspected.value.identity)).digest('hex'), JSON.stringify(inspected.value.identity), JSON.stringify(inspected.value.reference), settings.baseBranch??null, at, at);
  const authHome = join(f.directory, 'fixture-provider'); await mkdir(authHome, { mode: 0o700 });
  const configuration: ProviderConfiguration = { providerId: 'fixture', revision: '1', binaryRealpath: '/fixture/native', binarySha256: 'a'.repeat(64), binaryVersion: 'fixture-v1', modelId: 'fixture-model', authProfileRef: authHome, policyVersion: 'fixture-readonly-v1', qualificationDigest: 'c'.repeat(64), configuredAt: at };
  if (settings.configured !== false) value(f.store.commitDiscoveryMetadata({ kind: 'provider', expectedRevision: null, configuration }));
  const availability: { value: ProviderAvailability } = { value: { state: 'AVAILABLE', checkedAt: at, capabilities: { readOnlyAnalysis: true, portableTurns: true, nativeResume: false, localCancellation: true, verifiedRemoteCancellation: false, quotaResetInfo: false }, code: null } };
  let inspections = 0, checks = 0;
  const provider: ProviderPort = { inspectConfiguredBinary: async () => { inspections++; return { ok: true, value: { version: configuration.binaryVersion, sha256: configuration.binarySha256 } }; }, checkAvailability: async () => { checks++; return availability.value; },
    buildInvocation: async () => ({ ok: false, code: 'PROVIDER_UNSUPPORTED' }), serializeInput: input => ({ ok: true, value: JSON.stringify(input) }), decodeEvent: () => ({ ok: true, value: null }), finalResult: () => ({ ok: false, code: 'PROVIDER_PROTOCOL_ERROR' }) };
  const artifacts: DiscoveryArtifactPort = { reserve: async (kind, max) => f.store.reserveDiscoveryArtifact(kind, max), publish: async (id, bytes) => f.store.publishDiscoveryArtifact(id, bytes), read: async (id, offset, max) => f.store.readDiscoveryArtifact(id, offset, max), reconcile: async () => f.store.reconcileDiscoveryArtifacts() };
  const nativeContext = createMacOSDiscoveryContext(), context: DiscoveryContextPort = { capture: (...args) => nativeContext.capture(...args), revalidate: (...args) => nativeContext.revalidate(...args) };
  const request = { storeId: f.storeId, projectId, configRevision: '1', checkoutPath: repo, selectors: ['tracked.txt'], excludedRoots: [f.directory, paths.runtimeDirectory, authHome] };
  const snapshot = value(await sealDiscoveryContext(request, { context, artifacts, saveSnapshot: async s => f.store.commitDiscoveryMetadata({ kind: 'snapshot', value: s }) }, { deadline: makeDeadline(systemClock, 30000) }));
  const launches: { requestId: string; runId: string; discoveryId: string }[] = [];
  const launch = async (raw: unknown) => {
    const c = raw as { operation: { requestId: string }; run: { runId: string; grantId: string }; discovery: { discoveryId: string } };
    assert.equal(f.store.getDiscoveryOperation(c.operation.requestId)?.outcome, 'SUCCEEDED', 'acceptance is durable before any external spawn');
    assert.equal((database.prepare('SELECT phase FROM discovery_runs WHERE run_id=?').get(c.run.runId) as { phase: string }).phase, 'SPAWN_INTENT');
    assert.equal((database.prepare('SELECT consumed_by_request_id FROM discovery_grants WHERE grant_id=?').get(c.run.grantId) as { consumed_by_request_id: string }).consumed_by_request_id, c.operation.requestId);
    assert.equal((database.prepare('SELECT discovery_id FROM discovery_slot WHERE singleton=1').get() as { discovery_id: string }).discovery_id, c.discovery.discoveryId);
    launches.push({ requestId: c.operation.requestId, runId: c.run.runId, discoveryId: c.discovery.discoveryId });
    await settings.onLaunch?.(raw as DiscoveryLaunch);
  };
  service = createDiscoveryOperations({ storage: f.store, paths, instanceId: f.instanceId, ownerUid: process.getuid!(), provider, context, artifacts, launch, ...(settings.checkpoint ? { checkpoint: settings.checkpoint } : {}) });
  const peer: AuthenticatedPeer = { role: 'client', identity: f.instanceId, credentialId: 'owned-launch-fixture' };
  const intent = (override: Partial<DiscoveryIntent> = {}): DiscoveryIntent => ({ ownerUid: process.getuid!(), storeId: f.storeId, action: 'start', targetId: projectId, configRevision: '1', stateRevision: null, snapshotId: snapshot.snapshotId, contextDigest: snapshot.contextDigest, providerRevision: '1', providerProfileDigest: configuration.qualificationDigest, modelId: configuration.modelId, payload: { snapshotId: snapshot.snapshotId }, ...override });
  const prepare = async () => value(await service!.prepare(peer, intent()));
  const startInput = (grant: PreparedDiscovery): StartInput => ({ requestId: randomUUID(), grantId: grant.grantId, canonicalIntent: grant.canonicalIntent });
  return { ...f, paths, database, projectId, repo, repositories, configuration, availability, provider, context, artifacts, snapshot, service, peer, intent, prepare, startInput, launches,
    counts: () => ({ inspections, checks, runs: Number((database.prepare('SELECT count(*) AS n FROM discovery_runs').get() as { n: number }).n) }) };
}
