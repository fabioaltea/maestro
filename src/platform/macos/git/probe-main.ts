import { readFile } from 'node:fs/promises';
import type { InspectionResult, RepositoryInspector } from '../../../ports/repository.js';
import type { LocalServer } from '../../../ports/platform.js';
import { makeDeadline, systemClock } from '../../../ports/clock.js';
import { createLocalTransport } from '../transport.js';
import type { ProbeBootstrap } from './probe-supervisor.js';
import { inspectionFailure } from './runner.js';
import { initializeRepository } from './initialize.js';

let bootstrap: ProbeBootstrap | undefined;
let server: LocalServer | undefined;
let inspection: Promise<InspectionResult> | undefined;
let finishing: Promise<void> | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let executing = false;
let acknowledge: (() => void) | undefined;
const abort = new AbortController();
const admissionTimer = setTimeout(() => { process.exit(1); }, 1_500);

async function finish(result: InspectionResult): Promise<void> {
  if (finishing) return finishing;
  finishing = (async () => {
    clearTimeout(timer); clearTimeout(admissionTimer);
    abort.abort();
    // The runner resolves only after observing its own Git process close. Do not
    // exit and abandon a child whose termination has not been observed.
    if (inspection) await inspection.catch(() => {});
    if (process.connected && bootstrap) await new Promise<void>(resolve => {
      const timer = setTimeout(resolve, 300);
      acknowledge = () => { clearTimeout(timer); resolve(); };
      process.send?.({ kind: 'probe.result', ownership: bootstrap!.ownership, result }, error => {
        if (error) acknowledge?.();
      });
    });
    await server?.close();
    process.exit(0);
  })();
  return finishing;
}
process.once('disconnect', () => { acknowledge?.(); void finish({ ok: false, error: inspectionFailure('INTERRUPTED') }); });
process.once('SIGTERM', () => { void finish({ ok: false, error: inspectionFailure('INTERRUPTED') }); });
process.on('message', (value: unknown) => { void receive(value).catch(() => {
  void finish({ ok: false, error: inspectionFailure('INSPECTION_UNAVAILABLE') });
}); });

async function receive(value: unknown): Promise<void> {
  if (!value || typeof value !== 'object') return;
  const message = value as Record<string, unknown>;
  if (message.kind === 'probe.resultAccepted' && bootstrap) {
    const own = message.ownership as Record<string, unknown> | undefined;
    if (own?.resourceId === bootstrap.ownership.resourceId && own.generation === bootstrap.ownership.generation) acknowledge?.();
    return;
  }
  if (message.kind === 'probe.start' && !bootstrap) {
    bootstrap = message as unknown as ProbeBootstrap;
    clearTimeout(admissionTimer);
    if (!Number.isFinite(bootstrap.timeoutMs) || bootstrap.timeoutMs <= 0 || bootstrap.timeoutMs > 28_000) {
      await finish({ ok: false, error: inspectionFailure('INVALID_REQUEST') }); return;
    }
    timer = setTimeout(() => { void finish({ ok: false, error: inspectionFailure('DEADLINE_EXCEEDED') }); }, bootstrap.timeoutMs);
    const key = (await readFile(bootstrap.credentialFile, 'utf8')).trim();
    const own = bootstrap.ownership;
    server = await createLocalTransport().listen(bootstrap.endpoint, own.resourceId,
      new Map([[key, 'controller']]), async request => {
        const base = { protocolVersion: 1 as const, correlationId: request.correlationId };
        if (request.method === 'internal.readiness') return { ...base, result: 'OK', data: {
          identity: own.resourceId, generation: own.generation, ready: !finishing,
        } };
        if (request.method === 'internal.prepareStop' && request.params.targetInstanceId === own.resourceId
          && request.params.generation === own.generation) {
          setTimeout(() => { void finish({ ok: false, error: inspectionFailure('INTERRUPTED') }); }, 5);
          return { ...base, result: 'OK', data: { preparingStop: true } };
        }
        return { ...base, result: 'BLOCKED', data: {} };
      });
    if (finishing) { await server.close(); return; }
    process.send?.({ kind: 'probe.ready', ownership: own });
  } else if (message.kind === 'probe.execute' && bootstrap && !executing && !finishing) {
    const own = message.ownership as Record<string, unknown> | undefined;
    if (own?.resourceId !== bootstrap.ownership.resourceId || own.generation !== bootstrap.ownership.generation) return;
    executing = true;
    // Loaded only after the parent has authenticated this owned supervisor.
    const module = await import(new URL('./repository-inspector.js', import.meta.url).href) as {
      createDirectRepositoryInspector(): RepositoryInspector;
    };
    if (finishing) return;
    const inspector = module.createDirectRepositoryInspector();
    const options = { deadline: makeDeadline(systemClock, bootstrap.timeoutMs), signal: abort.signal };
    const request = bootstrap.request;
    inspection = request.kind === 'REGISTERED'
      ? inspector.inspectRegistered(request.identity, request.reference, request.configuredBase, options)
      : request.kind === 'INITIALIZE'
        ? initializeRepository(request.path, inspector, options)
        : inspector.inspectCandidate(request.path, request.requestedBase, options);
    const result = await inspection;
    if (Buffer.byteLength(JSON.stringify(result)) > 64 * 1024) await finish({ ok: false, error: inspectionFailure('OUTPUT_LIMIT') });
    else await finish(result);
  }
}
