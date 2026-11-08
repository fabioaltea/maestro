import { randomUUID } from 'node:crypto';
import type { AuthenticatedPeer, RpcRequest, RpcResponse, StreamChannel } from '../ports/platform.js';
import type { StoragePort } from '../ports/storage.js';
import { createEventPump, type EventPumpStats } from '../protocol/event-pump.js';
import { requireUuid } from '../domain/identifiers.js';

/** Shared polling only signals a high-water change; the journal remains the only event history. */
export function createLiveEvents(store: StoragePort, instanceId: string) {
  const active = new Map<string, {owner: StreamChannel; pump: ReturnType<typeof createEventPump>}>();
  const recent: EventPumpStats[] = [];
  let timer: ReturnType<typeof setInterval> | undefined, polling = false, highWater = '-1';
  let closedCount = 0, slowConsumers = 0, lastSlowAudit = -Infinity;
  function closeAll(reason?: string) { for (const {pump} of active.values()) pump.close(reason); if (timer) clearInterval(timer); timer = undefined; }
  function startPolling() {
    if (timer) return;
    timer = setInterval(() => {
      if (polling || !active.size) return; polling = true;
      void store.getEventState().then(state => {
        if (state.highWater === highWater) return; highWater = state.highWater;
        for (const {pump} of active.values()) pump.wake();
      }).catch(() => closeAll('PERSISTENCE_UNAVAILABLE')).finally(() => { polling = false; });
    }, 50);
  }
  return {
    closeAll,
    diagnostics() { return {active: [...active.values()].map(entry => entry.pump.stats()), recent: [...recent], closedCount, slowConsumers}; },
    async dispatch(request: RpcRequest, peer: AuthenticatedPeer, storeId: string): Promise<RpcResponse> {
      const base = {protocolVersion: 1 as const, correlationId: request.correlationId};
      const failure = (code: string): RpcResponse => ({...base, result: code === 'BUSY' ? 'BUSY' : 'ERROR', data: {code}});
      const channel = peer.channel;
      if (!channel || !['client', 'controller'].includes(peer.role)) return failure('UNAUTHORIZED');
      if (request.method === 'subscription.close') {
        if (Object.keys(request.params).length !== 1 || typeof request.params.subscriptionId !== 'string') return failure('INVALID_REQUEST');
        try { requireUuid(request.params.subscriptionId); } catch { return failure('INVALID_REQUEST'); }
        const entry = active.get(request.params.subscriptionId);
        if (!entry) return failure('INVALID_REQUEST');
        if (entry.owner !== channel) return failure('UNAUTHORIZED');
        entry.pump.close();
        return {...base, result: 'OK', data: {subscriptionId: request.params.subscriptionId, closed: true}};
      }
      if (Object.keys(request.params).length) return failure('INVALID_REQUEST'); // replay parameters belong to E3
      if (active.size >= 10 || [...active.values()].some(entry => entry.owner === channel)) return failure('BUSY');
      const state = await store.getEventState(), subscriptionId = randomUUID();
      const pump = createEventPump({subscriptionId, correlationId: request.correlationId, instanceId, storeId,
        after: state.highWater, sink: channel,
        readPage: (after, maxBytes) => store.listEvents({after, maxBytes, limit: 1000}),
      });
      active.set(subscriptionId, {owner: channel, pump});
      void pump.done.then(stats => {
        active.delete(subscriptionId); recent.push(stats); if (recent.length > 10) recent.shift(); closedCount++;
        if (stats.reason === 'SLOW_CONSUMER') {
          slowConsumers++;
          if (performance.now() - lastSlowAudit >= 1_000) {
            lastSlowAudit = performance.now();
            void store.recordEvents([{type: 'diagnostics.degraded', instanceId, payload: {code: 'SLOW_CONSUMER', count: 1}}]).catch(() => {});
          }
        }
        if (!active.size && timer) { clearInterval(timer); timer = undefined; }
      });
      channel.afterReply(() => { startPolling(); pump.start(); });
      return {...base, result: 'OK', data: {subscriptionId, storeId, instanceId, highWater: state.highWater}};
    },
  };
}
