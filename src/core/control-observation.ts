import type { StoragePort, StoreSnapshot } from '../ports/storage.js';
import type { ProcessIdentity } from '../ports/platform.js';

/** Observation is diagnostic only; it cannot authorize taking a lease or repeating an effect. */
export async function observePendingControl(snapshot: StoreSnapshot, store: StoragePort, identity: ProcessIdentity) {
  if (!snapshot.pendingOperation) return {pendingFinalization: false, controllerLiveness: null};
  const attempt = await store.getControllerAttempt(snapshot.pendingOperation.requestId);
  if (!attempt) return {pendingFinalization: true, controllerLiveness: 'UNKNOWN'};
  const absent = await identity.probeAbsent(attempt.pid) === 'ABSENT';
  return {pendingFinalization: absent || attempt.endedAt !== null, controllerLiveness: absent ? 'ABSENT_VERIFIED' : 'UNKNOWN'};
}
