import type {Params} from './bridge-contract.ts';

export function record(value: unknown): Params {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error('INVALID_INPUT');
  return value as Params;
}
export function keys(value: Params, allowed: readonly string[]) {
  if (Object.keys(value).some(k => !allowed.includes(k))) throw new Error('INVALID_INPUT');
}
export function text(value: unknown, max = 1024): string {
  if (typeof value !== 'string' || !value.length || value.length > max || value.includes('\0')) throw new Error('INVALID_INPUT');
  return value;
}
export function uuid(value: unknown): string {
  const v = text(value, 36); if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) throw new Error('INVALID_INPUT'); return v;
}
export function revision(value: unknown): string {
  const v = text(value, 20); if (!/^[1-9][0-9]*$/.test(v)) throw new Error('INVALID_INPUT'); return v;
}
