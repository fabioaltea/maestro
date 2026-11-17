import { randomUUID, createHash } from 'node:crypto';
import { join } from 'node:path';
import { repositoryRoot } from './desktop.ts';
import type { createScratch } from './desktop.ts';
/** Privileged fixture seed while the production writer/daemon is stopped.
 * No provider process or real login ever runs; the configured binary is absent. */
export async function seedWaitingDiscovery(f: Awaited<ReturnType<typeof createScratch>>) {
  await f.cli(['daemon', 'start']); const repo = await f.repository();
  const projectId = (await f.cli(['project', 'add', repo.path, '--name=Intervista UI'])).result.data.projectId as string;
  await f.cli(['daemon', 'stop']);
  const { openStorage } = await import(join(repositoryRoot, 'dist/storage/worker.js'));
  const { createPlatformPaths } = await import(join(repositoryRoot, 'dist/platform/macos/paths.js'));
  const { createMacOSDiscoveryContext } = await import(join(repositoryRoot, 'dist/platform/macos/discovery/context-reader.js'));
  const { sealDiscoveryContext } = await import(join(repositoryRoot, 'dist/core/discovery/context.js'));
  const { makeDeadline, systemClock } = await import(join(repositoryRoot, 'dist/ports/clock.js'));
  const { canonicalDiscoveryIntent } = await import(join(repositoryRoot, 'dist/domain/discovery/intent.js'));
  const { CODEX_DISCOVERY_PIN } = await import(join(repositoryRoot, 'dist/providers/codex/argv.js'));
  const { CODEX_DISCOVERY_QUALIFICATION } = await import(join(repositoryRoot, 'dist/providers/codex/capabilities.js'));
  const store = await openStorage({ path: join(f.archive, 'state.sqlite') });
  const ok = (r: any) => { if (!r.ok) throw new Error(String(r.code)); return r.value; };
  let discoveryId: string, runId: string, questionId: string;
  try {
    const state = await store.readSnapshot(), paths = await createPlatformPaths().resolveArchive(f.archive, 'read'), at = new Date().toISOString();
    const artifacts = { reserve: (...args: any[]) => store.reserveDiscoveryArtifact(...args), publish: (...args: any[]) => store.publishDiscoveryArtifact(...args), read: (...args: any[]) => store.readDiscoveryArtifact(...args), reconcile: () => store.reconcileDiscoveryArtifacts() };
    ok(await store.commitDiscoveryMetadata({ kind: 'provider', expectedRevision: null, configuration: { providerId: 'codex', revision: '1', binaryRealpath: '/synthetic/absent/codex', binarySha256: CODEX_DISCOVERY_PIN.sha256,
      binaryVersion: CODEX_DISCOVERY_PIN.version, modelId: 'fixture-model', authProfileRef: join(f.directory, 'synthetic-auth'), policyVersion: CODEX_DISCOVERY_PIN.policyVersion, qualificationDigest: CODEX_DISCOVERY_QUALIFICATION.digest, configuredAt: at } }));
    const snapshot = ok(await sealDiscoveryContext({ storeId: state.store.storeId, projectId, configRevision: '1', checkoutPath: repo.path, selectors: ['file.txt'], excludedRoots: [f.archive, paths.runtimeDirectory] },
      { context: createMacOSDiscoveryContext(), artifacts, saveSnapshot: (value: any) => store.commitDiscoveryMetadata({ kind: 'snapshot', value }) }, { deadline: makeDeadline(systemClock, 30000) }));
    discoveryId = randomUUID(); runId = randomUUID(); questionId = randomUUID(); const requestId = randomUUID(), grantId = randomUUID(), generation = randomUUID();
    const intent = canonicalDiscoveryIntent({ ownerUid: process.getuid!(), storeId: state.store.storeId, action: 'start', targetId: projectId, configRevision: '1', stateRevision: null, snapshotId: snapshot.snapshotId, contextDigest: snapshot.contextDigest, providerRevision: '1', providerProfileDigest: CODEX_DISCOVERY_QUALIFICATION.digest, modelId: 'fixture-model', payload: { snapshotId: snapshot.snapshotId } });
    ok(await store.saveDiscoveryGrant({ grantId, canonicalIntent: intent, expiresAtMs: Date.now() + 300000, consumedByRequestId: null }));
    const d = { storeId: state.store.storeId, projectId, discoveryId, sessionId: randomUUID(), state: 'RUNNING', stateRevision: '1', snapshotId: snapshot.snapshotId, configRevision: '1', providerRevision: '1', currentRunId: runId, latestDocumentRevisionId: null, createdAt: at, updatedAt: at, error: null };
    let run = { runId, discoveryId, generation, turnIndex: 1, grantId, requestId, contextDigest: snapshot.contextDigest, inputDigest: createHash('sha256').update('synthetic-fixture').digest('hex'), providerId: 'codex', providerRevision: '1', profileDigest: CODEX_DISCOVERY_QUALIFICATION.digest, modelId: 'fixture-model', phase: 'SPAWN_INTENT', outcome: 'RUNNING', startedAt: null, endedAt: null, outputWatermark: '0', error: null };
    ok(await store.admitDiscoveryOperation({ requestId, action: 'start', payloadHash: createHash('sha256').update(intent).digest('hex'), canonicalIntent: intent, grantId, ownerUid: process.getuid!(), instanceId: state.instance.instanceId, acceptedAt: at, nowMs: Date.now(), discovery: d, run, expectedStateRevision: null, acquireSlot: true }));
    for (const phase of ['HOST_READY', 'SPAWN_AUTHORIZED', 'PROVIDER_RUNNING']) { const next = { ...run, phase }; ok(await store.commitDiscoveryMetadata({ kind: 'run', value: next, expectedPhase: run.phase, exitVerified: false })); run = next; }
    const text = Buffer.from('<img src=x onerror=alert(1)>\nAnalisi sintetica conservata.');
    const body = ok(await store.reserveDiscoveryArtifact('OUTPUT', text.length)), published = ok(await store.publishDiscoveryArtifact(body.artifactId, text));
    ok(await store.commitDiscoveryMetadata({ kind: 'output', generation, expectedWatermark: '0', value: { runId, seq: '1', artifactId: published.artifactId, sha256: published.sha256, bytes: text.length, kind: 'AGENT_TEXT', createdAt: at, truncated: false } }));
    ok(await store.commitDiscoveryMetadata({ kind: 'run', value: { ...run, phase: 'EXIT_OBSERVED', outcome: 'SUCCEEDED', endedAt: at }, expectedPhase: 'PROVIDER_RUNNING', exitVerified: true }));
    ok(await store.commitDiscoveryMetadata({ kind: 'questions', discoveryId, runId, generation, expectedRevision: '1', values: [{ questionId, discoveryId, runId, revision: '1', text: 'Quale distribuzione è prevista?', reason: 'Informazione assente nelle fonti fixture.', section: 'conventions-and-operations', status: 'OPEN' }] }));
    ok(await store.commitDiscoveryMetadata({ kind: 'operation', requestId, outcome: 'SUCCEEDED', completedAt: at, result: { discoveryId, runId, sessionId: d.sessionId }, error: null }));
  } finally { await store.close(); }
  await f.cli(['daemon', 'start']); return { repo, projectId, discoveryId, runId, questionId };
}
