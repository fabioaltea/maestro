import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { createScratch, controlledClock } from './desktop.ts';
import { ArchiveContext } from '../../src/main/archive-context.ts';
import type { Params, PublicResult } from '../../src/shared/bridge-contract.ts';
import type { CliCommand } from '../../src/main/ports.ts';
import { canonical } from '../../src/main/confirmations.ts';

export interface DiscoveryResolved { command: CliCommand; summary: string[] }
export interface DiscoveryActionsContract {
  chooseProviderBinary(): Promise<{ providerBinaryHandle: string; displayName: string } | null>;
  resolve(action: string, params: Params): Promise<DiscoveryResolved>;
  read(method: string, params: Params): Promise<PublicResult>;
}
interface Command { namespace: string; action: string; archive: string; requestId?: string; params?: Params }
export async function discoveryDesktopFixture() {
  const moduleUrl = new URL('../../src/main/discovery.ts', import.meta.url).href;
  const { DiscoveryActions } = await import(moduleUrl) as { DiscoveryActions: new (options: object) => DiscoveryActionsContract };
  const f = await createScratch(), context = new ArchiveContext(); await context.select(f.archive);
  const clock = controlledClock(), projectId = randomUUID(), snapshotId = randomUUID(), storeId = randomUUID();
  const binary = join(f.directory, 'codex-synthetic'); await writeFile(binary, 'NOT_AN_EXECUTABLE_PROVIDER', { mode: 0o600 });
  const owner = { owner: 7, frame: 4 }, calls: Command[] = [];
  const controls: { live: boolean; loseReply: boolean; storeId: string; beforeEffect?: (command: Command) => Promise<void> } = { live: true, loseReply: false, storeId };
  const base = (): PublicResult => ({ protocolVersion: 1, storeId: controls.storeId, instanceId: randomUUID(), requestId: null, result: 'OK', outcome: null,
    freshness: controls.live ? 'LIVE' : 'LAST_KNOWN', liveness: controls.live ? 'LIVE_VERIFIED' : 'ABSENT_VERIFIED', data: {}, error: null });
  const core = { async call(command: Command): Promise<PublicResult> {
    calls.push(structuredClone(command)); const result = base();
    if (command.namespace === 'daemon' && command.action === 'status') return { ...result, data: { lifecycle: 'RUNNING', capabilities: { discoveryVersion: 1, projectRegistryVersion: 1,
      discoveryMethods: ['discovery.prepare', 'discovery.provider.get', 'discovery.provider.configure', 'discovery.provider.check', 'discovery.preview', 'discovery.preview.get', 'discovery.preview.discard', 'discovery.start', 'discovery.operation.get'] } } };
    if (command.namespace === 'project' && command.action === 'get') return { ...result, data: { project: { projectId, displayName: 'Synthetic project', configRevision: '1' } } };
    if (command.namespace !== 'discovery') throw new Error('UNEXPECTED_NAMESPACE');
    if (command.action === 'provider.get') return { ...result, data: { configuration: { providerId: 'codex', revision: '1', modelId: 'fixture-model', binaryVersion: 'fixture-v1',
      binarySha256: 'a'.repeat(64), policyVersion: 'fixture-policy', qualificationDigest: 'b'.repeat(64) }, check: null,
      requirements: { providerId: 'codex', binaryVersion: 'fixture-v1', binarySha256: 'a'.repeat(64), policyVersion: 'fixture-policy', qualificationDigest: 'b'.repeat(64) } } };
    if (command.action === 'preview.get') return { ...result, data: { snapshot: { snapshotId, projectId, configRevision: '1', state: 'SEALED', contextDigest: 'c'.repeat(64),
      selectors: ['README.md'], fileCount: 1, byteCount: 64, omissions: [], createdAt: new Date().toISOString(), expiresAtMs: Date.now() + 900000, pinned: false } } };
    if (command.action === 'prepare') {
      const intent = command.params?.intent as Params;
      return { ...result, data: { grantId: randomUUID(), canonicalIntent: canonical(intent), expiresAtMs: Date.now() + 300000,
        summary: { action: intent.action, projectId, snapshotId, selectors: ['README.md'], fileCount: 1, byteCount: 64, contextDigest: 'c'.repeat(64),
          providerId: 'codex', modelId: intent.modelId, sendsProjectData: intent.action === 'start' } } };
    }
    if (command.action === 'operation') return { ...result, requestId: command.params?.requestId as string, outcome: 'SUCCEEDED', data: { operation: {
      requestId: command.params?.requestId, action: 'start', phase: 'FINALIZED', outcome: 'SUCCEEDED', acceptedAt: new Date().toISOString(), completedAt: new Date().toISOString(),
      result: { discoveryId: randomUUID(), sessionId: randomUUID(), runId: randomUUID() }, error: null } } };
    await controls.beforeEffect?.(command);
    if (controls.loseReply) throw new Error('LOST_REPLY_AFTER_SEND');
    return { ...result, requestId: command.requestId!, data: { accepted: true, requestId: command.requestId } };
  }, close() {} };
  const actions = new DiscoveryActions({ context, core, dialogs: { async chooseDirectory() { return null; }, async chooseFile() { return binary; } }, owner: () => ({ ...owner }), clock });
  return { ...f, context, clock, projectId, snapshotId, storeId, binary, owner, calls, controls, core, actions,
    start: () => ({ projectId, snapshotId, expectedConfigRevision: '1', expectedProviderRevision: '1', contextDigest: 'c'.repeat(64) }) };
}
