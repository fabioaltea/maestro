import { requireUuid, requireDecimal } from '../domain/identifiers.js';
import { foundationError } from '../domain/errors.js';
import { EVENT_TYPES, type EventDraft } from './messages.js';

/** Structured allowlist: arbitrary text, credentials, paths and raw exceptions never enter persistence. */
export function redactEventDraft(draft: EventDraft): EventDraft {
  if (!EVENT_TYPES.includes(draft.type)) throw new Error('INVALID_REQUEST');
  if (draft.instanceId != null) requireUuid(draft.instanceId);
  if (draft.operationId != null) requireUuid(draft.operationId);
  const payload: Record<string, unknown> = {}; let redacted = 0;
  const enums: Record<string, readonly string[]> = {
    action: ['start', 'stop', 'restart'], outcome: ['IN_PROGRESS', 'SUCCEEDED', 'FAILED', 'BLOCKED', 'INTERRUPTED'],
    from: ['STARTING', 'RUNNING', 'RECOVERING', 'STOPPING', 'STOPPED', 'BLOCKED'],
    to: ['STARTING', 'RUNNING', 'RECOVERING', 'STOPPING', 'STOPPED', 'BLOCKED'],
    phase: ['ACCEPTED', 'PRECHECK', 'SPAWN_INTENT', 'WAIT_READY', 'STOP_REQUESTED', 'DRAINING', 'WAIT_EXIT', 'FINALIZED'],
  };
  for (const [key, value] of Object.entries(draft.payload)) {
    let allowed = false;
    try {
      if (key === 'code' && typeof value === 'string') { foundationError(value as Parameters<typeof foundationError>[0]); allowed = true; }
      if (['resourceId', 'correlationId'].includes(key) && typeof value === 'string') { requireUuid(value); allowed = true; }
      if (key === 'generation' && typeof value === 'string') { requireDecimal(value); allowed = true; }
      if (enums[key] && typeof value === 'string' && enums[key]!.includes(value)) allowed = true;
      if (['pid', 'count'].includes(key) && typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 2_147_483_647) allowed = true;
    } catch { allowed = false; }
    if (allowed) payload[key] = value; else redacted++;
  }
  if (redacted) { payload.truncated = true; payload.redactedFields = Math.min(redacted, 65535); }
  return {...draft, payload};
}
