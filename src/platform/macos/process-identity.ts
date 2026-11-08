import { randomUUID } from 'node:crypto';
import type { LocalTransport, ProcessIdentity } from '../../ports/platform.js';
import { createLocalTransport } from './transport.js';

interface Options {
  readonly probe?: (pid: number) => void;
  readonly transport?: Pick<LocalTransport, 'call'>;
}

export function createProcessIdentity(options: Options = {}): ProcessIdentity {
  const probe = options.probe ?? ((pid: number) => { process.kill(pid, 0); });
  const transport = options.transport ?? createLocalTransport();
  return {
    async probeAbsent(pid) {
      if (!Number.isSafeInteger(pid) || pid <= 0 || pid > 2_147_483_647) return 'UNKNOWN';
      try { probe(pid); return 'UNKNOWN'; }
      catch (error) {
        return error instanceof Error && 'code' in error && error.code === 'ESRCH' ? 'ABSENT' : 'UNKNOWN';
      }
    },
    async observeExit(process) {
      try {
        const result = await process.exit;
        return result.code !== null || result.signal !== null ? 'ABSENT' : 'UNKNOWN';
      } catch { return 'UNKNOWN'; }
    },
    async challenge(endpoint, expected, timeoutMs) {
      try {
        const response = await transport.call(endpoint, expected.key, {
          protocolVersion: 1, correlationId: randomUUID(), method: 'internal.readiness',
          params: { expectedInstanceId: expected.identity, launchGeneration: expected.generation },
        }, timeoutMs);
        if (response.result !== 'OK' || !response.data || typeof response.data !== 'object') return 'UNKNOWN';
        const data = response.data as Record<string, unknown>;
        return data.identity === expected.identity && data.generation === expected.generation ? 'VERIFIED' : 'UNKNOWN';
      } catch { return 'UNKNOWN'; }
    },
  };
}
