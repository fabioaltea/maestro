import { requireDecimal, requireUuid } from '../domain/identifiers.js';
export interface EventCursor {readonly storeId: string; readonly seq: string}
export interface EventGap {readonly storeId: string; readonly firstAvailable: string; readonly highWater: string; readonly nextAction: 'reread-status'}
export function requireCursor(value: unknown, storeId?: string): EventCursor {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 2 || !('storeId' in value) || !('seq' in value)) throw new Error('INVALID_REQUEST');
    const cursor = {storeId: requireUuid(value.storeId), seq: requireDecimal(value.seq)};
    if (storeId && cursor.storeId !== storeId) throw new Error('WRONG_STORE');
    return cursor;
  } catch (error) {if (error instanceof Error && error.message === 'WRONG_STORE') throw error; throw new Error('INVALID_REQUEST');}
}
export function eventGap(storeId: string, state: {firstAvailable: string; highWater: string}): EventGap {
  return {storeId, firstAvailable: requireDecimal(state.firstAvailable), highWater: requireDecimal(state.highWater), nextAction: 'reread-status'};
}
