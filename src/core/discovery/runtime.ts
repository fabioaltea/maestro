import { homedir } from 'node:os';
import { join } from 'node:path';
import { createCodexAdapter } from '../../providers/codex/adapter.js';
import { createCodexInspection } from '../../platform/macos/discovery/provider-inspection.js';
import { createMacOSDiscoveryContext } from '../../platform/macos/discovery/context-reader.js';
import { createAgentRuntime } from '../../platform/macos/discovery/agent-runtime.js';
import { createDiscoveryRunFiles } from '../../platform/macos/discovery/runtime-files.js';
import { createDiscoveryLauncher } from './launch.js';
import { createDiscoveryOperations } from './operations.js';
import { createDiscoveryDispatch, DISCOVERY_LIVE_METHODS } from './dispatch.js';
import type { ArchivePaths } from '../../ports/platform.js';
import type { StoragePort } from '../../ports/storage.js';
import type { DiscoveryArtifactPort } from '../../ports/discovery.js';
import type { AgentProcessIdentity, AgentExitProof } from '../../ports/agent-runtime.js';
import type { Deadline } from '../../ports/clock.js';
import type { CoreDependencies } from '../runtime.js';
import type { DiscoveryMetadataData, DiscoveryMetadataQuery, DiscoveryMetadataChange } from '../../ports/discovery.js';

/** Composition only: test substitutions never come from a public command. */
export function createDiscoveryRuntime(storage: StoragePort, paths: ArchivePaths, instanceId: string, dependencies: CoreDependencies['discovery'] = {}) {
  let accepting = false, safe = false;
  const artifacts: DiscoveryArtifactPort = {
    reserve: (kind, maximum) => storage.reserveDiscoveryArtifact!(kind, maximum), publish: (id, bytes) => storage.publishDiscoveryArtifact!(id, bytes),
    read: (id, offset, maximum) => storage.readDiscoveryArtifact!(id, offset, maximum), reconcile: () => storage.reconcileDiscoveryArtifacts!(),
  };
  const inspection = dependencies.inspection ?? createCodexInspection({ authHome: join(homedir(), 'Library/Application Support/Maestro/providers/codex-discovery'),
    runtimeRoot: paths.runtimeDirectory, instanceId, onResource: resource => storage.saveResource(resource) });
  const provider = dependencies.provider ?? createCodexAdapter({ inspection }), context = dependencies.context ?? createMacOSDiscoveryContext();
  let launcher: ReturnType<typeof createDiscoveryLauncher>;
  const callbacks = { onStdout: (identity: AgentProcessIdentity, bytes: Uint8Array) => launcher.output(identity, bytes), onExit: (identity: AgentProcessIdentity, proof: AgentExitProof) => launcher.exited(identity, proof) };
  const agent = dependencies.agent ?? dependencies.createAgent?.(callbacks) ?? createAgentRuntime({ storage, paths, instanceId, ...callbacks });
  launcher = createDiscoveryLauncher({ storage, paths, instanceId, provider, runtime: agent, files: dependencies.files ?? createDiscoveryRunFiles(paths),
    onResult: dependencies.onResult ?? (async (identity, result) => {
      if (result.kind !== 'QUESTIONS') throw new Error('PROVIDER_UNSUPPORTED');
      await operations.publishQuestions(identity, result);
    }) });
  const operations = createDiscoveryOperations({ storage, paths, instanceId, ownerUid: paths.ownerUid, provider, inspection, context, artifacts, launch: input => launcher.launch(input) });
  async function meta<Q extends DiscoveryMetadataQuery>(query: Q): Promise<DiscoveryMetadataData<Q>> {
    const r = await storage.readDiscoveryMetadata!(query); if (!r.ok) throw new Error(r.code); return r.value.data;
  }
  async function commit(change: DiscoveryMetadataChange) { const r = await storage.commitDiscoveryMetadata!(change); if (!r.ok) throw new Error(r.code); }
  async function processes() {
    const all: AgentProcessIdentity[] = []; let offset = 0;
    for (;;) {
      const page = await meta({ kind: 'processes', offset, limit: 20 }); all.push(...page.items);
      if (page.nextOffset === null) return all;
      if (page.nextOffset <= offset || all.length > 2000) throw new Error('DISCOVERY_LIMIT'); offset = page.nextOffset;
    }
  }
  async function interrupted(identity: AgentProcessIdentity, proof: AgentExitProof | null) {
    const run = await meta({ kind: 'run', id: identity.runId }); if (!run || run.generation !== identity.generation) throw new Error('STALE_TARGET');
    const discovery = await meta({ kind: 'discovery', id: run.discoveryId }); if (!discovery || discovery.currentRunId !== run.runId) throw new Error('STALE_TARGET');
    if (!proof || !proof.hostExited || !proof.providerExited || proof.runId !== run.runId || proof.generation !== run.generation) {
      if (['RUNNING', 'UPDATING', 'CANCELLING'].includes(discovery.state)) await commit({ kind: 'state', discoveryId: discovery.discoveryId, expectedRevision: discovery.stateRevision, next: 'RECONCILING', exitVerified: false });
      return false;
    }
    await commit({ kind: 'process', value: { ...identity, observation: 'ABSENT', releaseState: 'RELEASED' } });
    if (!['FINALIZED', 'EXIT_OBSERVED'].includes(run.phase)) await commit({ kind: 'run', expectedPhase: run.phase, exitVerified: true, value: { ...run, phase: 'EXIT_OBSERVED', outcome: 'INTERRUPTED', endedAt: new Date().toISOString(), error: null } });
    if (['RUNNING', 'UPDATING', 'CANCELLING', 'RECONCILING'].includes(discovery.state)) await commit({ kind: 'state', discoveryId: discovery.discoveryId, expectedRevision: discovery.stateRevision, next: 'INTERRUPTED', exitVerified: true });
    return true;
  }
  async function bounded(work: Promise<unknown>, deadline: Deadline) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { await Promise.race([work, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('DEADLINE_EXCEEDED')), Math.max(1, deadline.remainingMs())); })]); }
    finally { clearTimeout(timer); }
  }
  return { methods: DISCOVERY_LIVE_METHODS, operations, dispatch: createDiscoveryDispatch({ storage, operations, accepting: () => accepting && safe }),
    fence() { accepting = false; },
    async recover() {
      safe = false;
      try {
        const result = await artifacts.reconcile(); if (!result.ok) throw new Error(result.code);
        let complete = true;
        for (const identity of await processes()) if (identity.releaseState !== 'RELEASED') {
          const r = await agent.reconcile(identity); complete = await interrupted(identity, r.ok ? r.value : null) && complete;
        }
        safe = complete;
      } catch { safe = false; }
      accepting = true;
    },
    async stop(deadline: Deadline) {
      accepting = false; await bounded(operations.idle(), deadline);
      // A historical store has no Agent Runtime records and must retain its
      // existing Foundation lifecycle without initializing Discovery on read.
      if ((await storage.readSnapshot())?.store.schemaVersion !== 4) return;
      const stopped = await agent.stopWithin(deadline); if (!stopped.ok) throw new Error(stopped.code);
      for (const identity of await processes()) if (identity.releaseState !== 'RELEASED') {
        const result = await agent.cancel(identity, deadline);
        if (!await interrupted(identity, result.ok ? result.value : null)) throw new Error('RESOURCE_IDENTITY_UNKNOWN');
      }
    },
  };
}
