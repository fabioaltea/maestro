import { readFile } from 'node:fs/promises';
import { createLocalTransport } from '../../src/platform/macos/transport.js';
import type { LocalServer } from '../../src/ports/platform.js';
import type { InspectionResult, ProbeOwnership } from '../../src/ports/repository.js';

let server: LocalServer | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let finished = false;
let ownership: ProbeOwnership | undefined;
async function finish(code: 'INTERRUPTED' | 'DEADLINE_EXCEEDED') {
  if (finished) return;
  finished = true;
  clearTimeout(timer);
  const result: InspectionResult = { ok: false, error: { code, retryable: true, nextAction: 'retry-inspection' } };
  if (process.connected) await new Promise<void>(resolve => {
    process.send?.({ kind: 'probe.result', ownership, result }, () => resolve());
  });
  await server?.close();
  process.exit(0);
}
process.once('disconnect', () => { void finish('INTERRUPTED'); });
process.once('message', async (message: {
  kind: string; ownership: ProbeOwnership; endpoint: string; credentialFile: string; timeoutMs: number;
}) => {
  if (message.kind !== 'probe.start' || finished) { process.exitCode = 1; return; }
  ownership = message.ownership;
  timer = setTimeout(() => { void finish('DEADLINE_EXCEEDED'); }, message.timeoutMs);
  const key = (await readFile(message.credentialFile, 'utf8')).trim();
  server = await createLocalTransport().listen(message.endpoint, ownership.resourceId,
    new Map([[key, 'controller']]), async request => {
      const base = { protocolVersion: 1 as const, correlationId: request.correlationId };
      if (request.method === 'internal.readiness') return { ...base, result: 'OK', data: {
        identity: ownership!.resourceId, generation: ownership!.generation, ready: true,
      } };
      if (request.method === 'internal.prepareStop' && request.params.targetInstanceId === ownership!.resourceId
        && request.params.generation === ownership!.generation) {
        setTimeout(() => { void finish('INTERRUPTED'); }, 10);
        return { ...base, result: 'OK', data: { preparingStop: true } };
      }
      return { ...base, result: 'BLOCKED', data: {} };
    });
  if (finished) { await server.close(); return; }
  process.send?.({ kind: 'probe.ready', ownership });
});
