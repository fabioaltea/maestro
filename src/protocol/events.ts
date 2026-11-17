import { DISCOVERY_STATES } from '../domain/discovery/state.js';
import { requireUuid, requireDecimal } from '../domain/identifiers.js';
import { foundationError } from '../domain/errors.js';
import { EVENT_TYPES, type EventDraft } from './messages.js';

/** Structured allowlist: arbitrary text, credentials, paths and raw exceptions never enter persistence. */
export function redactEventDraft(draft: EventDraft): EventDraft {
  if (!EVENT_TYPES.includes(draft.type)) throw new Error('INVALID_REQUEST');
  if (draft.instanceId != null) requireUuid(draft.instanceId);
  if (draft.operationId != null) requireUuid(draft.operationId);
  const project = draft.payload.scope === 'project';
  const discovery = draft.payload.scope === 'discovery';
  if (draft.type.startsWith('discovery.') && !discovery) throw new Error('INVALID_REQUEST');
  if ((project || discovery) && draft.operationId == null) throw new Error('INVALID_REQUEST');
  const payload: Record<string, unknown> = {}; let redacted = 0;
  const enums: Record<string, readonly string[]> = {
    state: discovery ? DISCOVERY_STATES : [],
    action: discovery ? ['configure', 'start', 'answer', 'correct', 'approve', 'cancel', 'preview', 'check', 'discard'] : project ? ['REGISTER', 'VERIFY', 'UPDATE', 'REMOVE'] : ['start', 'stop', 'restart'], outcome: discovery ? ['IN_PROGRESS', 'SUCCEEDED', 'FAILED', 'BLOCKED', 'INTERRUPTED', 'UNKNOWN'] : ['IN_PROGRESS', 'SUCCEEDED', 'FAILED', 'BLOCKED', 'INTERRUPTED'],
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
      if (key === 'scope' && (value === 'project' || value === 'discovery')) allowed = true;
      if (draft.type.startsWith('discovery.') && !discovery) throw new Error('INVALID_REQUEST');
  if ((project || discovery) && key === 'projectId' && typeof value === 'string') { requireUuid(value); allowed = true; }
      if (discovery && ['discoveryId', 'sessionId', 'runId', 'revisionId'].includes(key) && typeof value === 'string') { requireUuid(value); allowed = true; }
      if (discovery && ['watermark', 'stateRevision'].includes(key) && typeof value === 'string') { requireDecimal(value); allowed = true; }
      if (project && ['configRevision', 'observationRevision'].includes(key) && typeof value === 'string') {
        requireDecimal(value); allowed = value !== '0';
      }
      if (project && key === 'effect' && typeof value === 'string'
        && ['CREATED', 'EXISTING', 'UPDATED', 'OBSERVED', 'REMOVED', 'NONE'].includes(value)) allowed = true;
      if (enums[key] && typeof value === 'string' && enums[key]!.includes(value)) allowed = true;
      if (['pid', 'count'].includes(key) && typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 2_147_483_647) allowed = true;
      if (discovery && key === 'truncated' && typeof value === 'boolean') allowed = true;
    } catch { allowed = false; }
    if (allowed) payload[key] = value; else redacted++;
  }
  const required: Readonly<Record<string, readonly string[]>> = {
    'discovery.output.available': ['discoveryId', 'runId', 'watermark'], 'discovery.question.available': ['discoveryId', 'runId'],
    'discovery.document.changed': ['discoveryId', 'revisionId'], 'discovery.approval.changed': ['discoveryId', 'revisionId'],
  };
  if (required[draft.type]?.some(key => !Object.hasOwn(payload, key))) throw new Error('INVALID_REQUEST');
  if (redacted) { payload.truncated = true; payload.redactedFields = Math.min(redacted, 65535); }
  return {...draft, payload};
}
