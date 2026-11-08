import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import type { ArchivePaths, LocalTransport, PlatformPaths, ProcessIdentity } from '../ports/platform.js';
import type { StoragePort } from '../ports/storage.js';
import type { Deadline } from '../ports/clock.js';

export interface AuxiliaryDrainContext {
  readonly store: StoragePort;
  readonly instanceId: string;
  readonly paths: ArchivePaths;
  readonly identity: ProcessIdentity;
  readonly transport: LocalTransport;
  readonly platformPaths: PlatformPaths;
  readonly deadline: Deadline;
  readonly excludedPids: readonly number[];
  readonly sleep: (ms: number) => Promise<void>;
}

/** Foundation-only cooperative policy. No signals, PID termination or runtime adoption. */
export async function drainFoundationAuxiliaries(context: AuxiliaryDrainContext): Promise<void> {
  const { store, instanceId, paths, identity, transport, platformPaths, deadline } = context;
  for (const resource of await store.listResources(instanceId)) {
    if (resource.releaseState === 'RELEASED') continue;
    try {
      if (resource.policyScope !== 'foundation' || resource.kind !== 'auxiliary'
        || resource.owningInstanceId !== instanceId || resource.pid === null
        || context.excludedPids.includes(resource.pid) || !resource.endpoint || !resource.credentialRef
        || dirname(resource.endpoint) !== paths.runtimeDirectory
        || dirname(resource.credentialRef) !== paths.credentialsDirectory) throw new Error('RESOURCE_IDENTITY_UNKNOWN');
      // Absence is sufficient for release, never for sending a command to a reused PID.
      if (await identity.probeAbsent(resource.pid) !== 'ABSENT') {
        const key = await platformPaths.readCredential(resource.credentialRef);
        if (deadline.expired() || await identity.challenge(resource.endpoint, {
          identity: resource.resourceId, generation: resource.generation, key,
        }, Math.min(500, deadline.remainingMs())) !== 'VERIFIED') throw new Error('RESOURCE_IDENTITY_UNKNOWN');
        await store.saveResource({ ...resource, observation: 'VERIFIED' });
        const ack = await transport.call(resource.endpoint, key, {
          protocolVersion: 1, correlationId: randomUUID(), method: 'internal.prepareStop',
          params: { targetInstanceId: resource.resourceId, generation: resource.generation },
        }, Math.min(500, deadline.remainingMs()));
        if (ack.result !== 'OK') throw new Error('BLOCKED');
        while (await identity.probeAbsent(resource.pid) !== 'ABSENT') {
          if (deadline.expired()) throw new Error('BLOCKED');
          await context.sleep(Math.min(20, deadline.remainingMs()));
        }
      }
      await store.saveResource({ ...resource, observation: 'ABSENT', releaseState: 'RELEASED' });
    } catch (error) {
      await store.saveResource({ ...resource, observation: 'UNKNOWN', releaseState: 'BLOCKED' });
      if (error instanceof Error && ['BLOCKED', 'RESOURCE_IDENTITY_UNKNOWN'].includes(error.message)) throw error;
      throw new Error('RESOURCE_IDENTITY_UNKNOWN');
    }
  }
}
