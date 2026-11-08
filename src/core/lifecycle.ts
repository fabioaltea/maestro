import { randomUUID } from 'node:crypto';
import type { OwnershipLease, ProcessIdentity, LocalTransport } from '../ports/platform.js';
export interface StopPorts { leases: OwnershipLease; identity: ProcessIdentity; transport: LocalTransport }
import type { ControlContext } from './control-main.js';

export async function executeStop(context: ControlContext, ports: StopPorts): Promise<void> {
  const { paths, store, operation, controlKey } = context;
  const current = (await store.readSnapshot())?.instance;
  const { leases, identity, transport } = ports;
  if (!current || current.lifecycle === 'STOPPED') {
    const lease = leases.tryAcquire(paths.daemonLeaseFile, 'daemon');
    if (lease.status !== 'HELD') throw new Error('BLOCKED');
    try {
      if (current && (await store.listResources(current.instanceId)).some(resource => resource.releaseState !== 'RELEASED')) {
        throw new Error('BLOCKED');
      }
      return;
    } finally { lease.handle.release(); }
  }
  if (operation.targetInstanceId !== current.instanceId) throw new Error('STALE_TARGET');

  const verified = await identity.challenge(paths.daemonEndpoint, {
    identity: current.instanceId, generation: current.generation, key: controlKey,
  }, 1_000);
  if (verified !== 'VERIFIED') throw new Error('RESOURCE_IDENTITY_UNKNOWN');
  await store.setOperationPhase(operation.requestId, 'STOP_REQUESTED');
  try {
    const response = await transport.call(paths.daemonEndpoint, controlKey, {
      protocolVersion: 1, correlationId: randomUUID(), method: 'internal.prepareStop',
      params: { requestId: operation.requestId, targetInstanceId: current.instanceId, generation: current.generation },
    }, 1_000);
    if (response.result !== 'OK') throw new Error('BLOCKED');
  } catch (error) {
    if (error instanceof Error && ['UNAUTHORIZED', 'INVALID_REQUEST', 'BLOCKED'].includes(error.message)) throw error;
    // The acknowledgment can disappear with the connection; verify the actual process.
  }
  await store.setOperationPhase(operation.requestId, 'DRAINING');
  await store.setOperationPhase(operation.requestId, 'WAIT_EXIT');
  const deadline = performance.now() + 8_000;
  while (performance.now() < deadline) {
    const observation = (await store.readSnapshot())?.instance;
    if (observation?.instanceId !== current.instanceId) throw new Error('STALE_TARGET');
    if (observation.lifecycle === 'BLOCKED') throw new Error('BLOCKED');
    if (await identity.probeAbsent(current.pid) === 'ABSENT') {
      const acquired = leases.tryAcquire(paths.daemonLeaseFile, 'daemon');
      if (acquired.status === 'HELD') {
        try {
          const latest = (await store.readSnapshot())?.instance;
          if (!latest || latest.instanceId !== current.instanceId || latest.lifecycle !== 'STOPPING') throw new Error('BLOCKED');
          if ((await store.listResources(current.instanceId)).some(resource => resource.releaseState !== 'RELEASED')) throw new Error('BLOCKED');
          await store.transitionInstance(current.instanceId, 'STOPPED');
          return;
        } finally { acquired.handle.release(); }
      }
    }
    await new Promise<void>(resolve => setTimeout(resolve, 25));
  }
  throw new Error('BLOCKED');
}
