import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, rm } from 'node:fs/promises';
import type { ChildProcess } from 'node:child_process';
import type { TestContext } from 'node:test';
import type { AgentRuntimePort, AgentProcessIdentity } from '../../src/ports/agent-runtime.js';
import type { ArchivePaths, ProcessIdentity } from '../../src/ports/platform.js';
import { createPlatformPaths } from '../../src/platform/macos/paths.js';
import { createProcessIdentity } from '../../src/platform/macos/process-identity.js';
import { makeDeadline, systemClock } from '../../src/ports/clock.js';
import { createDiscoveryMetadataFixture } from './discovery-metadata.js';
import { loadContract } from './load-contract.js';
import { value } from './discovery-artifacts.js';
export interface AgentRuntimeOptions {
  readonly paths: ArchivePaths; readonly instanceId: string; readonly storage: object; readonly providerModuleUrl?: string;
  readonly observeHost?: (child: ChildProcess) => void; readonly processIdentity?: Pick<ProcessIdentity, 'probeAbsent'>;
  readonly onStdout?: (identity: AgentProcessIdentity, bytes: Uint8Array) => Promise<void>;
}
export const loadRuntime = () => loadContract<{ createAgentRuntime(options: AgentRuntimeOptions): AgentRuntimePort }>('platform/macos/discovery/agent-runtime.js', ['createAgentRuntime']);
export const agentDeadline = (ms = 4000) => makeDeadline(systemClock, ms);
export async function waitFor(check: () => Promise<boolean> | boolean, ms = 2000) {
  const until = performance.now() + ms; while (!await check()) { if (performance.now() >= until) assert.fail('OWNED_FIXTURE_WAIT_EXPIRED'); await new Promise(resolve => setTimeout(resolve, 10)); }
}
export async function agentFixture(t: TestContext, options: { mode?: string; lifetime?: number; allowUnknown?: boolean } = {}) {
  const { createAgentRuntime } = await loadRuntime();
  let runtime: AgentRuntimePort | undefined, paths: ArchivePaths | undefined, safeToClean = false;
  const hosts: ChildProcess[] = [], providers = new Set<number>();
  // Node after-hooks run FIFO: terminate this fixture's processes before archive cleanup.
  t.after(async () => {
    if (!runtime) { safeToClean = hosts.length === 0; return; }
    const stopped = await runtime.stopWithin(agentDeadline());
    if (!options.allowUnknown) assert.equal(stopped.ok, true, 'UNVERIFIED_RUNTIME_STOP_PRESERVE_FIXTURE');
    for (const host of hosts) { if (host.connected) host.disconnect(); await waitFor(() => host.exitCode !== null || host.signalCode !== null, 4500); }
    for (const pid of providers) await waitFor(async () => await createProcessIdentity().probeAbsent(pid) === 'ABSENT', 6000);
    if (paths) { const marker = JSON.parse(await readFile(join(paths.runtimeDirectory, 'archive.json'), 'utf8')); assert.equal(marker.directory, paths.directory); await rm(paths.runtimeDirectory, { recursive: true }); }
    safeToClean = true;
  });
  const stdin = JSON.stringify({ fixture: 'authorized synthetic input' });
  const f = await createDiscoveryMetadataFixture(t, { inputDigest: createHash('sha256').update(stdin).digest('hex') });
  const cleanup = f.context.cleanup.bind(f.context);
  f.context.cleanup = async () => { if (!safeToClean) throw new Error('PRESERVE_UNVERIFIED_AGENT_FIXTURE'); await cleanup(); };
  paths = (await createPlatformPaths().resolveArchive(f.directory, 'write'))!;
  const providerRuntime = join(paths.runtimeDirectory, `p-${f.run.runId}`); await mkdir(providerRuntime, { mode: 0o700 });
  const marker = join(providerRuntime, 'provider-count.txt');
  const identity: AgentProcessIdentity = { runId: f.run.runId, generation: f.run.generation, owningInstanceId: f.instanceId, hostPid: null, providerPid: null,
    hostEndpoint: join(paths.runtimeDirectory, `a-${f.run.runId}.sock`), credentialRef: join(paths.credentialsDirectory, `agent-${f.run.runId}.key`), observation: 'UNKNOWN', releaseState: 'OWNED', policy: 'cancel-on-owner-loss-v1' };
  const invocation = { executable: process.execPath, args: [fileURLToPath(new URL('./discovery-agent-provider.js', import.meta.url)), options.mode ?? 'wait', marker, String(options.lifetime ?? 10000)], cwd: providerRuntime, env: { HOME: providerRuntime, PATH: '/usr/bin:/bin' } };
  const stdout: string[] = [];
  const runtimeOptions: AgentRuntimeOptions = { paths, instanceId: f.instanceId, storage: f.store, providerModuleUrl: new URL('./discovery-agent-launcher.js', import.meta.url).href,
    observeHost: child => { hosts.push(child); child.on('message', (message: unknown) => { if (message && typeof message === 'object' && 'kind' in message && message.kind === 'agent.provider.started' && 'providerPid' in message && typeof message.providerPid === 'number') providers.add(message.providerPid); }); },
    onStdout: async (_identity, bytes) => { stdout.push(Buffer.from(bytes).toString()); } };
  runtime = createAgentRuntime(runtimeOptions);
  const launch = () => runtime!.launch({ identity, invocation, stdin, deadline: agentDeadline() });
  async function authorize(ready: AgentProcessIdentity) {
    const result = f.store.readDiscoveryMetadata({ kind: 'run', id: f.run.runId }), run = value(result).data; assert.ok(run);
    f.commit({ kind: 'run', value: { ...run, phase: 'SPAWN_AUTHORIZED' }, expectedPhase: 'HOST_READY', exitVerified: false });
    value(await runtime!.authorizeStart(ready));
    await waitFor(async () => { const observed = await runtime!.observe(ready); return observed.ok && observed.value.providerPid !== null; });
  }
  return { ...f, paths, identity, invocation, stdin, marker, hosts, stdout, runtime, runtimeOptions, launch, authorize, proofFile: identity.credentialRef + '.proof' };
}
