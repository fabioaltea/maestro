import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createPlatformPaths } from '../paths.js';
import { createLocalTransport } from '../transport.js';
import type { LocalServer } from '../../../ports/platform.js';
import type { AgentProcessIdentity } from '../../../ports/agent-runtime.js';
import type { ProviderInvocation } from '../../../ports/provider.js';
import { DISCOVERY_LIMITS as limits, isDiscoveryFailure, type DiscoveryFailure, type RunOutcome } from '../../../domain/discovery/model.js';
import { requireUuid } from '../../../domain/identifiers.js';
import { signHostProof, writeHostProof } from './agent-proof.js';

export interface AgentBootstrap {
  kind: 'agent.bootstrap'; identity: AgentProcessIdentity; invocation: ProviderInvocation; stdin: string; timeoutMs: number; providerModuleUrl?: string;
}
let bootstrap: AgentBootstrap | undefined, key: string | undefined, server: LocalServer | undefined;
let provider: ChildProcessWithoutNullStreams | undefined, started = false, ownerLost = false;
let finishing: Promise<void> | undefined, providerClosed: Promise<void> = Promise.resolve(), output = Promise.resolve();
let exitCode: number | null = null, signal: string | null = null, failure: DiscoveryFailure | null = null;
let runTimer: ReturnType<typeof setTimeout> | undefined;
const admissionTimer = setTimeout(() => process.exit(1), 1500);
const send = (message: object) => new Promise<void>((resolve, reject) => {
  if (!process.connected) { reject(new Error('INTERRUPTED')); return; }
  process.send!(message, error => error ? reject(error) : resolve());
});
async function finish(outcome: RunOutcome, graceMs: number = limits.termGraceMs): Promise<void> {
  if (finishing) return finishing;
  finishing = (async () => {
    clearTimeout(admissionTimer); clearTimeout(runTimer);
    if (provider && provider.exitCode === null && provider.signalCode === null) {
      provider.kill('SIGTERM');
      const kill = setTimeout(() => { if (provider && provider.exitCode === null && provider.signalCode === null) provider.kill('SIGKILL'); }, Math.max(0, Math.min(limits.termGraceMs, graceMs)));
      await providerClosed; clearTimeout(kill);
    } else await providerClosed;
    await output.catch(() => {});
    if (bootstrap && key) {
      const proof = signHostProof({ proofVersion: 1, runId: bootstrap.identity.runId, generation: bootstrap.identity.generation, hostPid: process.pid, providerPid: provider?.pid ?? null,
        providerExited: !provider || provider.exitCode !== null || provider.signalCode !== null, outcome, exitCode, signal, error: failure }, key);
      try { await writeHostProof(bootstrap.identity.credentialRef + '.proof', proof); await send({ kind: 'agent.exit', runId: proof.runId, generation: proof.generation }).catch(() => {}); }
      catch { process.exitCode = 1; }
    }
    await server?.close(); process.disconnect?.(); process.exit(process.exitCode ?? 0);
  })(); return finishing;
}
process.once('disconnect', () => { ownerLost = true; void finish('INTERRUPTED'); });
process.once('SIGTERM', () => { ownerLost = true; void finish('INTERRUPTED'); });
async function startProvider() {
  if (started || finishing || ownerLost || !bootstrap) return;
  started = true;
  try {
    const module = await import(bootstrap.providerModuleUrl ?? new URL('./provider-launcher.js', import.meta.url).href) as { prepareProviderInvocation(invocation: ProviderInvocation): Promise<ProviderInvocation> };
    const invocation = await module.prepareProviderInvocation(bootstrap.invocation);
    if (finishing || ownerLost) return;
    provider = spawn(invocation.executable, [...invocation.args], { cwd: invocation.cwd, env: invocation.env, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    let resolveClosed!: () => void; providerClosed = new Promise<void>(resolve => { resolveClosed = resolve; });
    let total = 0, line = 0, stderr = 0;
    provider.once('error', () => { failure = 'PROVIDER_UNAVAILABLE'; });
    provider.once('close', (code, why) => { exitCode = code !== null && code >= 0 ? code : null; signal = why; resolveClosed(); if (!finishing) void finish(failure || code !== 0 ? 'FAILED' : 'SUCCEEDED'); });
    const startedNotification = provider.pid ? send({ kind: 'agent.provider.started', runId: bootstrap.identity.runId, generation: bootstrap.identity.generation, providerPid: provider.pid }) : Promise.resolve();
    provider.stdout.on('data', (chunk: Buffer) => {
      total += chunk.length; for (const byte of chunk) { line = byte === 10 ? 0 : line + 1; if (line > limits.outputLineBytes) failure = 'PROVIDER_OUTPUT_LIMIT'; }
      if (total > limits.runOutputBytes || failure) { failure ??= 'PROVIDER_OUTPUT_LIMIT'; void finish('FAILED'); return; }
      provider!.stdout.pause();
      output = output.then(async () => { for (let offset = 0; offset < chunk.length; offset += limits.chunkBytes) await send({ kind: 'agent.stdout', runId: bootstrap!.identity.runId, generation: bootstrap!.identity.generation, data: chunk.subarray(offset, offset + limits.chunkBytes).toString('base64') }); }).catch(() => { ownerLost = true; void finish('INTERRUPTED'); });
      void output.then(() => { if (!finishing) provider?.stdout.resume(); });
    });
    provider.stderr.on('data', (chunk: Buffer) => { stderr += chunk.length; if (stderr > limits.stderrBytes) { failure = 'PROVIDER_OUTPUT_LIMIT'; void finish('FAILED'); } });
    provider.stdin.on('error', () => {}); await startedNotification; if (finishing) return; provider.stdin.end(bootstrap.stdin);
    runTimer = setTimeout(() => { failure = 'DEADLINE_EXCEEDED'; void finish('TIMED_OUT'); }, Math.min(limits.runMs, bootstrap.timeoutMs));
  } catch (error) { failure = error instanceof Error && isDiscoveryFailure(error.message) ? error.message : 'PROVIDER_UNSAFE'; void finish('FAILED'); }
}
process.once('message', (raw: unknown) => { void (async () => {
  const b = raw as AgentBootstrap;
  if (!b || b.kind !== 'agent.bootstrap' || bootstrap || !process.connected) throw new Error('INVALID_REQUEST');
  requireUuid(b.identity.runId); requireUuid(b.identity.generation);
  if (b.identity.policy !== 'cancel-on-owner-loss-v1' || typeof b.stdin !== 'string' || Buffer.byteLength(b.stdin) > limits.inputBytes || !Number.isFinite(b.timeoutMs) || b.timeoutMs <= 0 || b.timeoutMs > limits.runMs) throw new Error('INVALID_REQUEST');
  bootstrap = b; key = await createPlatformPaths().readCredential(b.identity.credentialRef);
  if (ownerLost) { await finish('INTERRUPTED'); return; }
  server = await createLocalTransport().listen(b.identity.hostEndpoint, b.identity.runId, new Map([[key, 'controller']]), async (request, peer) => {
    const base = { protocolVersion: 1 as const, correlationId: request.correlationId };
    if (peer.role !== 'controller') return { ...base, result: 'ERROR', data: { code: 'UNAUTHORIZED' } };
    const p = request.params;
    if (p.expectedInstanceId !== b.identity.runId || p.launchGeneration !== b.identity.generation || Object.keys(p).some(k => !['expectedInstanceId', 'launchGeneration', 'action', 'graceMs'].includes(k))) return { ...base, result: 'ERROR', data: { code: 'STALE_TARGET' } };
    if (request.method === 'internal.prepareStop') { void finish('CANCELLED', typeof p.graceMs === 'number' && Number.isFinite(p.graceMs) ? p.graceMs : limits.termGraceMs); return { ...base, result: 'OK', data: { accepted: true } }; }
    if (request.method !== 'internal.readiness' || p.action !== undefined && !['GO', 'OBSERVE'].includes(String(p.action))) return { ...base, result: 'ERROR', data: { code: 'INVALID_REQUEST' } };
    if (p.action === 'GO' && !started && !finishing) void startProvider();
    return { ...base, result: 'OK', data: { identity: b.identity.runId, generation: b.identity.generation, hostPid: process.pid, providerPid: provider?.pid ?? null, phase: finishing ? 'EXITING' : started ? 'RUNNING' : 'WAIT_GO' } };
  });
  clearTimeout(admissionTimer); await send({ kind: 'agent.ready', runId: b.identity.runId, generation: b.identity.generation, hostPid: process.pid });
})().catch(() => { failure = 'PROVIDER_UNSAFE'; void finish('FAILED'); }); });
