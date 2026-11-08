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
export function encodeCursor(value: EventCursor): string {
  return Buffer.from(JSON.stringify(requireCursor(value))).toString('base64url');
}
export function decodeCursor(value: string): EventCursor {
  try {
    if (value.length > 256 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('INVALID_REQUEST');
    const cursor = requireCursor(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')));
    if (encodeCursor(cursor) !== value) throw new Error('INVALID_REQUEST');
    return cursor;
  } catch {throw new Error('INVALID_REQUEST');}
}
export function requireGap(value: unknown, expectedStoreId?: string): EventGap {
  if (!value || typeof value !== 'object') throw new Error('INVALID_REQUEST');
  const data = value as Record<string, unknown>;
  const storeId = requireUuid(data.storeId);
  if (expectedStoreId && storeId !== expectedStoreId || data.nextAction !== 'reread-status') throw new Error('INVALID_REQUEST');
  const gap = eventGap(storeId, {firstAvailable: requireDecimal(data.firstAvailable), highWater: requireDecimal(data.highWater)});
  if (BigInt(gap.firstAvailable) < 1n || BigInt(gap.firstAvailable) > BigInt(gap.highWater) + 1n) throw new Error('INVALID_REQUEST');
  return gap;
}
export class EventStreamError extends Error {
  constructor(code: string, readonly gap?: EventGap) {super(code);}
}
