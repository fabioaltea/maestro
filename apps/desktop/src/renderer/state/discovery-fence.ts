export interface DiscoveryReadIdentity { readonly epoch: number; readonly storeId: string | null; readonly projectId: string; readonly discoveryId: string; readonly runId: string | null; readonly revisionId: string | null }
/** A response may only update the view that requested it. */
export function createDiscoveryReadFence(identity: DiscoveryReadIdentity, current: () => DiscoveryReadIdentity) {
  const captured = { ...identity }; let closed = false;
  return { current: () => !closed && Object.entries(captured).every(([key, value]) => current()[key as keyof DiscoveryReadIdentity] === value), close() { closed = true; } };
}
