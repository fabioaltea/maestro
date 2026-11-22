import { Socket } from 'node:net';
import { createDirectContextExtractor } from './context-sources.js';
import { readContextFrames, writeContextFrames } from './context-framing.js';
import { makeDeadline, systemClock } from '../../../ports/clock.js';
import type { ContextRequest } from '../../../ports/discovery-context.js';
import type { RepositoryInventory } from '../../../ports/repository.js';

// One bounded, owned extraction invocation. No project modules/config are imported.
const lifeline = new Socket({ fd: 3, readable: true, writable: false });
lifeline.once('end', () => process.exit(1)); lifeline.once('error', () => process.exit(1)); lifeline.resume(); lifeline.unref();
const timer = setTimeout(() => process.exit(1), 30_000);
try {
  const input = await readContextFrames(process.stdin) as { request: ContextRequest; inventory: RepositoryInventory; timeoutMs: number };
  if (Object.keys(input).sort().join(',') !== 'inventory,request,timeoutMs' || !Number.isFinite(input.timeoutMs) || input.timeoutMs < 1 || input.timeoutMs > 30_000) throw new Error('INVALID_REQUEST');
  const result = await createDirectContextExtractor().extract(input.request, input.inventory, { deadline: makeDeadline(systemClock, input.timeoutMs) });
  await writeContextFrames(process.stdout, result.ok ? { ok: true, value: { ...result.value, corpus: Buffer.from(result.value.corpus).toString('base64') } } : result);
} catch { process.exitCode = 1; } finally { clearTimeout(timer); lifeline.destroy(); }
