import { randomUUID } from 'node:crypto';
import type { DiscoveryContextPort, ContextRequest } from '../../src/ports/discovery-context.js';
import { makeDeadline, systemClock } from '../../src/ports/clock.js';
import { loadContract } from './load-contract.js';

export type ContextCheckpoint = (point: string, relativePath?: string) => Promise<void>;
export async function contextAdapter(options: { checkpoint?: ContextCheckpoint; direct?: boolean } = {}): Promise<DiscoveryContextPort> {
  const module = await loadContract<{ createMacOSDiscoveryContext(options?: { checkpoint?: ContextCheckpoint; extractor?: unknown }): DiscoveryContextPort; createDirectContextExtractor(options?: { checkpoint?: ContextCheckpoint }): unknown }>('platform/macos/discovery/context-reader.js', ['createMacOSDiscoveryContext', 'createDirectContextExtractor']);
  return module.createMacOSDiscoveryContext({ ...(options.checkpoint ? { checkpoint: options.checkpoint } : {}), ...(options.direct ? { extractor: module.createDirectContextExtractor({ ...(options.checkpoint ? { checkpoint: options.checkpoint } : {}) }) } : {}) });
}
export const contextOptions = () => ({ deadline: makeDeadline(systemClock, 30_000) });
export const contextRequest = (checkoutPath: string, selectors: readonly string[] = ['.'], excludedRoots: readonly string[] = []): ContextRequest => ({ storeId: randomUUID(), projectId: randomUUID(), configRevision: '1', checkoutPath, selectors, excludedRoots });
