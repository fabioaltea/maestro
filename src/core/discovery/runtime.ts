import { createCodexAdapter } from '../../providers/codex/adapter.js';
import { codexAuthHome, createCodexInspection } from '../../platform/macos/discovery/provider-inspection.js';
import { createMacOSDiscoveryContext } from '../../platform/macos/discovery/context-reader.js';
import { createAgentRuntime } from '../../platform/macos/discovery/agent-runtime.js';
import { createDiscoveryRunFiles } from '../../platform/macos/discovery/runtime-files.js';
import { createDiscoveryLauncher } from './launch.js';
import { createDiscoveryOperations } from './operations.js';
import { createDiscoveryDispatch, DISCOVERY_LIVE_METHODS } from './dispatch.js';
import { createDiscoveryOutput } from './output.js';
import type { ArchivePaths } from '../../ports/platform.js';
import type { StoragePort } from '../../ports/storage.js';
import type { DiscoveryArtifactPort } from '../../ports/discovery.js';
import type { AgentProcessIdentity, AgentExitProof } from '../../ports/agent-runtime.js';
import type { Deadline } from '../../ports/clock.js';
import type { CoreDependencies } from '../runtime.js';
import { createDiscoveryLifecycle } from './lifecycle.js';

/** Composition only: test substitutions never come from a public command. */
export function createDiscoveryRuntime(storage: StoragePort, paths: ArchivePaths, instanceId: string, dependencies: CoreDependencies['discovery'] = {}) {
  let accepting = false, safe = false;
  const artifacts: DiscoveryArtifactPort = {
    reserve: (kind, maximum) => storage.reserveDiscoveryArtifact!(kind, maximum), publish: (id, bytes) => storage.publishDiscoveryArtifact!(id, bytes),
    read: (id, offset, maximum) => storage.readDiscoveryArtifact!(id, offset, maximum), reconcile: () => storage.reconcileDiscoveryArtifacts!(),
  };
  const inspection = dependencies.inspection ?? createCodexInspection({ authHome: codexAuthHome(),
    runtimeRoot: paths.runtimeDirectory, instanceId, onResource: resource => storage.saveResource(resource) });
  const provider = dependencies.provider ?? createCodexAdapter({ inspection }), context = dependencies.context ?? createMacOSDiscoveryContext();
  let launcher: ReturnType<typeof createDiscoveryLauncher>;
  const output = createDiscoveryOutput({ storage, artifacts });
  const callbacks = { onStdout: (identity: AgentProcessIdentity, bytes: Uint8Array) => launcher.output(identity, bytes), onExit: (identity: AgentProcessIdentity, proof: AgentExitProof) => launcher.exited(identity, proof) };
  const agent = dependencies.agent ?? dependencies.createAgent?.(callbacks) ?? createAgentRuntime({ storage, paths, instanceId, ...callbacks });
  launcher = createDiscoveryLauncher({ storage, paths, instanceId, provider, runtime: agent, files: dependencies.files ?? createDiscoveryRunFiles(paths),
    onEvent: (identity, event) => output.publish(identity, event),
    onResult: dependencies.onResult ?? (async (identity, result) => {
      if (result.kind === 'QUESTIONS') await operations.publishQuestions(identity, result);
      else await operations.publishDocument(identity, result);
    }) });
  const lifecycle = createDiscoveryLifecycle({ storage, agent, settle: (identity, proof) => launcher.exited(identity, proof) });
  const operations = createDiscoveryOperations({ storage, paths, instanceId, ownerUid: paths.ownerUid, provider, inspection, context, artifacts, launch: input => launcher.launch(input), cancel: (discoveryId, requestId) => lifecycle.cancel(discoveryId, requestId) });
  async function bounded(work: Promise<unknown>, deadline: Deadline) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { await Promise.race([work, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('DEADLINE_EXCEEDED')), Math.max(1, deadline.remainingMs())); })]); }
    finally { clearTimeout(timer); }
  }
  return { methods: DISCOVERY_LIVE_METHODS, operations, dispatch: createDiscoveryDispatch({ storage, operations, accepting: () => accepting && safe, canCancel: () => accepting }),
    fence() { accepting = false; },
    async recover() {
      safe = false;
      try {
        const result = await artifacts.reconcile(); if (!result.ok) throw new Error(result.code);
        safe = await lifecycle.recover();
      } catch { safe = false; }
      accepting = true;
    },
    async stop(deadline: Deadline) {
      accepting = false; await bounded(operations.idle(), deadline);
      // A historical store has no Agent Runtime records and must retain its
      // existing Foundation lifecycle without initializing Discovery on read.
      if (((await storage.readSnapshot())?.store.schemaVersion ?? 0) < 4) return;
      await lifecycle.stop(deadline);
    },
  };
}
