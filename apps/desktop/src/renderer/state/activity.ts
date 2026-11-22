import type { UiEvent } from '../../shared/activity-contract.ts';
export interface ActivityState { events: UiEvent[]; bytes: number; omitted: number; storeId: string | null; appliedSeq: string | null; cursor: string | null }
export const emptyActivity: ActivityState = { events: [], bytes: 0, omitted: 0, storeId: null, appliedSeq: null, cursor: null };
export function appendActivity(state: ActivityState, incoming: readonly UiEvent[]): ActivityState {
  const events = [...state.events]; let { bytes, omitted, storeId, appliedSeq } = state;
  const size = (event: UiEvent) => new TextEncoder().encode(JSON.stringify(event)).byteLength;
  for (const event of incoming) {
    if (storeId && event.storeId !== storeId) throw new Error('STREAM_GAP');
    storeId ??= event.storeId;
    if (appliedSeq !== null && BigInt(event.seq) <= BigInt(appliedSeq)) {
      const previous = events.find(e => e.seq === event.seq); if (previous && previous.eventId !== event.eventId) throw new Error('STREAM_GAP'); continue;
    }
    if (appliedSeq !== null && BigInt(event.seq) !== BigInt(appliedSeq) + 1n) throw new Error('STREAM_GAP');
    events.push(event); bytes += size(event); appliedSeq = event.seq;
    while (events.length > 500 || bytes > 4 * 1024 * 1024) { bytes -= size(events.shift()!); omitted++; }
  }
  return { ...state, events, bytes, omitted, storeId, appliedSeq };
}
