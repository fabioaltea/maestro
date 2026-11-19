import {validateWorkspaceParams,requireWorkspaceEnvelope} from './workspace.js';
import {validateFeatureParams,requireFeatureEnvelope} from './feature.js';
import { validateDiscoveryParams, requireDiscoveryEnvelope } from './discovery.js';
import { MAX_FRAME_BYTES, METHODS } from './messages.js';
import type { RpcRequest } from '../ports/platform.js';
import { requireUuid } from '../domain/identifiers.js';
import { normalizeProjectCommand, projectObject, requireProjectFields } from '../domain/projects/intent.js';
import type { ProjectAction } from '../domain/projects/model.js';
import { PROJECT_ACTIONS, requireProjectRevision, isTerminalProjectOutcome, validateProjectOperationResult } from '../domain/projects/model.js';
import type { ProjectOperationView, ProjectTombstone } from '../ports/registry.js';
import { foundationError, type SafeError } from '../domain/errors.js';

export function decodeObject(frame: string | Uint8Array): Record<string, unknown> {
  const bytes = typeof frame === 'string' ? Buffer.from(frame, 'utf8') : frame;
  if (!bytes.length || bytes.byteLength > MAX_FRAME_BYTES) throw new Error('INVALID_REQUEST');
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new Error('INVALID_REQUEST'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('INVALID_REQUEST');
  return parsed as Record<string, unknown>;
}

export function encodeFrame(value: unknown): Buffer {
  const encoded = Buffer.from(JSON.stringify(value) + '\n', 'utf8');
  if (encoded.byteLength - 1 > MAX_FRAME_BYTES) throw new Error('INVALID_REQUEST');
  return encoded;
}

export function decodeRequest(frame: string | Uint8Array): RpcRequest {
  const parsed = decodeObject(frame);
  requireProjectFields(parsed, ['protocolVersion', 'correlationId', 'method', 'params']);
  if (parsed.protocolVersion !== 1) throw new Error(typeof parsed.protocolVersion === 'number' ? 'UNSUPPORTED_VERSION' : 'INVALID_REQUEST');
  if (typeof parsed.method !== 'string' || !METHODS.includes(parsed.method as typeof METHODS[number])
    || !parsed.params || typeof parsed.params !== 'object' || Array.isArray(parsed.params)) throw new Error('INVALID_REQUEST');
  try { requireUuid(parsed.correlationId); }
  catch { throw new Error('INVALID_REQUEST'); }
  if (parsed.method.startsWith('workspace.')) { requireWorkspaceEnvelope(parsed); validateWorkspaceParams(parsed.method, parsed.params); }
  if (parsed.method.startsWith('feature.')) { requireFeatureEnvelope(parsed); validateFeatureParams(parsed.method, parsed.params); }
  if (parsed.method.startsWith('discovery.')) { requireDiscoveryEnvelope(parsed); validateDiscoveryParams(parsed.method, parsed.params); }
  if (parsed.method.startsWith('projects.')) validateProjectParams(parsed.method, parsed.params);
  return { protocolVersion: 1, correlationId: parsed.correlationId as string,
    method: parsed.method, params: parsed.params as Readonly<Record<string, unknown>> };
}

export function requireProjectClient(role: string): void {
  if (role !== 'client') throw new Error('UNAUTHORIZED');
}
export function requireProjectCapability(capabilities: unknown): void {
  if (!capabilities || typeof capabilities !== 'object'
    || (capabilities as Record<string, unknown>).projectRegistryVersion !== 1) throw new Error('UNSUPPORTED_VERSION');
}
function projectUuid(value: unknown): void {
  try { requireUuid(value); } catch { throw new Error('INVALID_REQUEST'); }
}
export function validateProjectParams(method: string, input: unknown): void {
  const params = projectObject(input);
  if (method === 'projects.list') {
    requireProjectFields(params, [], ['limit', 'cursor']);
    if (Object.hasOwn(params, 'limit') && (typeof params.limit !== 'number' || !Number.isInteger(params.limit) || params.limit < 1 || params.limit > 100)) throw new Error('INVALID_REQUEST');
    if (Object.hasOwn(params, 'cursor') && (typeof params.cursor !== 'string' || !params.cursor.isWellFormed()
      || !params.cursor || Buffer.byteLength(params.cursor) > 4096)) throw new Error('INVALID_REQUEST');
    return;
  }
  if (method === 'projects.get' || method === 'projects.operation.get') {
    const key = method === 'projects.get' ? 'projectId' : 'requestId';
    requireProjectFields(params, [key]); projectUuid(params[key]); return;
  }
  const actions: Readonly<Record<string, ProjectAction>> = {
    'projects.register': 'REGISTER', 'projects.verify': 'VERIFY', 'projects.update': 'UPDATE', 'projects.remove': 'REMOVE',
  };
  const action = actions[method];
  if (!action || !Object.hasOwn(params, 'requestId')) throw new Error('INVALID_REQUEST');
  projectUuid(params.requestId);
  const { requestId: _requestId, ...original } = params;
  normalizeProjectCommand(action, original);
}
export function validateProjectAdmission(input: unknown): void {
  const data = projectObject(input);
  if (data.accepted === true) {
    requireProjectFields(data, ['requestId', 'accepted', 'outcome', 'pollMethod']);
    if (data.outcome !== 'IN_PROGRESS' || data.pollMethod !== 'projects.operation.get') throw new Error('INVALID_REQUEST');
  } else if (data.accepted === false) {
    requireProjectFields(data, ['requestId', 'accepted', 'outcome']);
    if (data.outcome !== null) throw new Error('INVALID_REQUEST');
  } else throw new Error('INVALID_REQUEST');
  projectUuid(data.requestId);
}

export function decodeProjectOperationView(input: unknown): ProjectOperationView {
  const value = projectObject(input);
  requireProjectFields(value, ['requestId', 'action', 'projectId', 'phase', 'outcome', 'acceptedAt', 'deadlineAt', 'completedAt', 'result']);
  try {
    requireUuid(value.requestId);
    if (value.projectId !== null) requireUuid(value.projectId);
    if (!PROJECT_ACTIONS.includes(value.action as ProjectAction)
      || !['ACCEPTED', 'PROBING', 'FINALIZED'].includes(value.phase as string)) throw new Error('INVALID_REQUEST');
    for (const field of ['acceptedAt', 'deadlineAt']) {
      if (typeof value[field] !== 'string' || !Number.isFinite(Date.parse(value[field]))) throw new Error('INVALID_REQUEST');
    }
    const terminal = isTerminalProjectOutcome(value.outcome);
    if (!terminal) {
      if (value.phase === 'FINALIZED' || value.result !== null || value.completedAt !== null) throw new Error('INVALID_REQUEST');
    } else {
      const result = projectObject(value.result);
      requireProjectFields(result, ['action', 'requestId', 'projectId', 'outcome', 'effect', 'configRevision', 'observationRevision', 'completedAt', 'error']);
      validateProjectOperationResult(result as unknown as ProjectOperationView['result'] & {});
      if (value.phase !== 'FINALIZED' || result.requestId !== value.requestId || result.action !== value.action
        || result.outcome !== value.outcome || result.projectId !== value.projectId || result.completedAt !== value.completedAt) throw new Error('INVALID_REQUEST');
      if (result.error !== null) {
        const error = projectObject(result.error);
        const safe = foundationError(error.code as SafeError['code'], { persisted: error.persisted as boolean, cause: error.cause as SafeError['cause'],
          ...(error.operationId ? { operationId: error.operationId as string } : {}) });
        requireProjectFields(error, Object.keys(safe));
        if (Object.keys(safe).some(key => error[key] !== safe[key as keyof SafeError])) throw new Error('INVALID_REQUEST');
      }
    }
    return value as unknown as ProjectOperationView;
  } catch { throw new Error('INVALID_REQUEST'); }
}

export function decodeProjectTombstone(input: unknown): ProjectTombstone {
  try {
    const value = projectObject(input);
    requireProjectFields(value, ['projectId', 'configRevision', 'removedAt']);
    const projectId = requireUuid(value.projectId), configRevision = requireProjectRevision(value.configRevision);
    if (typeof value.removedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.removedAt)
      || !Number.isFinite(Date.parse(value.removedAt))) throw new Error('INVALID_REQUEST');
    return { projectId, configRevision, removedAt: value.removedAt };
  } catch { throw new Error('INVALID_REQUEST'); }
}

export { validateDiscoveryParams, requireDiscoveryCapability, validateDiscoveryAdmission, decodeDiscoveryOperationView } from './discovery.js';
