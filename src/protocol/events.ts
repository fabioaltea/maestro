import {REVIEW_GRANTED,REVIEW_STATES} from '../domain/review/state.js';
import {SCHEDULER_GRANTED,schedulerJobStates} from '../ports/scheduler.js';
import {EXECUTION_GRANTED,EXECUTION_OBSERVED,executionSessionStates} from '../domain/execution/model.js';
import {PROFILE_GRANTED,PROFILE_OBSERVED,PROFILE_STATES} from '../domain/profiles/model.js';
import {ENVIRONMENT_STATES,ENVIRONMENT_GRANTED_ACTIONS,ENVIRONMENT_OBSERVATION_ACTIONS} from '../domain/environments/state.js';
import {WORKSPACE_STATES} from '../domain/workspaces/model.js';
import {FEATURE_ACTIONS} from './feature.js';
import {FEATURE_STATES} from '../domain/features/model.js';
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
  const workspace=draft.payload.scope==='workspace',environment=draft.payload.scope==='environment',profile=draft.payload.scope==='profile';
  const review=draft.payload.scope==='review';
  if(draft.type.startsWith('review.')!==review)throw new Error('INVALID_REQUEST');
  const scheduler=draft.payload.scope==='scheduler';
  if(draft.type.startsWith('scheduler.')!==scheduler)throw new Error('INVALID_REQUEST');
  const execution=draft.payload.scope==='execution';
  if(draft.type.startsWith('execution.')!==execution)throw new Error('INVALID_REQUEST');
  const feature = draft.payload.scope === 'feature', artifact = draft.payload.scope === 'artifact', workflow = feature || artifact || workspace || environment || profile || execution || scheduler || review;
  if (draft.type.startsWith('profile.')&&!profile||draft.type.startsWith('environment.')&&!environment||draft.type.startsWith('workspace.')&&!workspace || draft.type.startsWith('feature.') && !feature || draft.type.startsWith('artifact.') && !artifact) throw new Error('INVALID_REQUEST');
  if (draft.type.startsWith('discovery.') && !discovery) throw new Error('INVALID_REQUEST');
  if ((project || discovery || workflow) && draft.operationId == null && draft.type!=='workspace.changed') throw new Error('INVALID_REQUEST');
  const payload: Record<string, unknown> = {}; let redacted = 0;
  const enums: Record<string, readonly string[]> = {
    state: review?REVIEW_STATES:scheduler?schedulerJobStates:execution?executionSessionStates:profile?PROFILE_STATES:environment?ENVIRONMENT_STATES:workspace ? WORKSPACE_STATES : feature ? FEATURE_STATES : artifact ? ['RESERVED','SEALED','REFERENCED','ORPHAN','CORRUPT','DISCARDED'] : discovery ? DISCOVERY_STATES : [],
    action: review?REVIEW_GRANTED:scheduler?SCHEDULER_GRANTED:execution?[...EXECUTION_GRANTED,...EXECUTION_OBSERVED]:profile?[...PROFILE_GRANTED,...PROFILE_OBSERVED]:environment?[...ENVIRONMENT_GRANTED_ACTIONS,...ENVIRONMENT_OBSERVATION_ACTIONS]:workspace ? ['create','refresh','remove'] : feature ? FEATURE_ACTIONS : artifact ? ['reserve','append','seal','discard'] : discovery ? ['configure', 'start', 'answer', 'correct', 'approve', 'cancel', 'preview', 'check', 'discard'] : project ? ['REGISTER', 'VERIFY', 'UPDATE', 'REMOVE'] : ['start', 'stop', 'restart'], outcome: workflow || discovery ? ['IN_PROGRESS', 'SUCCEEDED', 'FAILED', 'BLOCKED', 'INTERRUPTED', 'UNKNOWN'] : ['IN_PROGRESS', 'SUCCEEDED', 'FAILED', 'BLOCKED', 'INTERRUPTED'],
    from: ['STARTING', 'RUNNING', 'RECOVERING', 'STOPPING', 'STOPPED', 'BLOCKED'],
    to: ['STARTING', 'RUNNING', 'RECOVERING', 'STOPPING', 'STOPPED', 'BLOCKED'],
    phase: [...(workflow ? ['WORKING'] : []), 'ACCEPTED', 'PRECHECK', 'SPAWN_INTENT', 'WAIT_READY', 'STOP_REQUESTED', 'DRAINING', 'WAIT_EXIT', 'FINALIZED'],
  };
  for (const [key, value] of Object.entries(draft.payload)) {
    if(review&&!['scope','reviewId','featureId','projectId','state','stateRevision','action','phase','outcome','code','watermark'].includes(key)){redacted++;continue;}
    if(scheduler&&!['scope','jobId','projectId','state','stateRevision','action','phase','outcome','code'].includes(key)){redacted++;continue;}
    if(execution&&!['scope','sessionId','runId','workspaceId','state','stateRevision','action','phase','outcome','code','watermark','truncated'].includes(key)){
      redacted++;continue;
    }
    let allowed = false;
    try {
      if (key === 'code' && typeof value === 'string') { foundationError(value as Parameters<typeof foundationError>[0]); allowed = true; }
      if (['resourceId', 'correlationId'].includes(key) && typeof value === 'string') { requireUuid(value); allowed = true; }
      if (key === 'generation' && typeof value === 'string') { requireDecimal(value); allowed = true; }
      if (key === 'scope' && (value === 'project' || value === 'discovery' || value === 'feature' || value === 'artifact' || value === 'workspace' || value === 'environment' || value === 'profile' || value === 'execution' || value === 'scheduler' || value === 'review')) allowed = true;
      if (draft.type.startsWith('discovery.') && !discovery) throw new Error('INVALID_REQUEST');
  if ((project || discovery || workflow) && key === 'projectId' && typeof value === 'string') { requireUuid(value); allowed = true; }
      if (workflow && ['workspaceId','featureId','artifactId','revisionId','approvalId','envelopeId','turnId','runId'].includes(key) && typeof value === 'string') { requireUuid(value); allowed = true; }
      if(execution&&key==='sessionId'&&typeof value==='string'){requireUuid(value);allowed=true;}
      if(profile&&key==='entityId'&&typeof value==='string'){requireUuid(value);allowed=true;}
      if(review&&key==='reviewId'&&typeof value==='string'){requireUuid(value);allowed=true;}
      if(scheduler&&key==='jobId'&&typeof value==='string'){requireUuid(value);allowed=true;}
      if(environment&&['environmentId','planId','jobId'].includes(key)&&typeof value==='string'){requireUuid(value);allowed=true;}
      if (workflow && ['stateRevision','watermark'].includes(key) && typeof value === 'string') { requireDecimal(value); allowed = true; }
      if (discovery && ['discoveryId', 'sessionId', 'runId', 'revisionId'].includes(key) && typeof value === 'string') { requireUuid(value); allowed = true; }
      if (discovery && ['watermark', 'stateRevision'].includes(key) && typeof value === 'string') { requireDecimal(value); allowed = true; }
      if (project && ['configRevision', 'observationRevision'].includes(key) && typeof value === 'string') {
        requireDecimal(value); allowed = value !== '0';
      }
      if (project && key === 'effect' && typeof value === 'string'
        && ['CREATED', 'EXISTING', 'UPDATED', 'OBSERVED', 'REMOVED', 'NONE'].includes(value)) allowed = true;
      if (enums[key] && typeof value === 'string' && enums[key]!.includes(value)) allowed = true;
      if (['pid', 'count'].includes(key) && typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 2_147_483_647) allowed = true;
      if ((discovery||environment||execution) && key === 'truncated' && typeof value === 'boolean') allowed = true;
    } catch { allowed = false; }
    if (allowed) payload[key] = value; else redacted++;
  }
  const required: Readonly<Record<string, readonly string[]>> = {
    'review.changed':['reviewId','state','stateRevision'],
    'review.output.available':['reviewId','stateRevision','watermark'],
    'scheduler.changed':['action'],
    'execution.changed':['sessionId','runId','state','stateRevision'],'execution.output.available':['sessionId','runId','watermark'],
    'profile.changed':['entityId'],'workspace.changed':['workspaceId'],'environment.changed':['workspaceId'],'environment.output.available':['workspaceId','jobId','watermark'],
    'feature.changed': ['featureId'], 'feature.output.available': ['featureId','turnId','watermark'], 'feature.revision.changed': ['featureId','revisionId'], 'feature.approval.changed': ['featureId','revisionId'], 'artifact.changed': ['artifactId'],
    'discovery.output.available': ['discoveryId', 'runId', 'watermark'], 'discovery.question.available': ['discoveryId', 'runId'],
    'discovery.document.changed': ['discoveryId', 'revisionId'], 'discovery.approval.changed': ['discoveryId', 'revisionId'],
  };
  if (required[draft.type]?.some(key => !Object.hasOwn(payload, key))) throw new Error('INVALID_REQUEST');
  if (redacted) { payload.truncated = true; payload.redactedFields = Math.min(redacted, 65535); }
  return {...draft, payload};
}
