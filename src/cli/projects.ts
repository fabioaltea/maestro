import { parseArgs } from 'node:util';
import { resolve, isAbsolute } from 'node:path';
import { LocalClient } from '../client/local-client.js';
import { createClientBackend, failureResult } from '../bootstrap.js';
import { classifyError } from '../core/control-main.js';
import { requireUuid } from '../domain/identifiers.js';
import { requireProjectRevision } from '../domain/projects/model.js';
import { randomUUID } from 'node:crypto';
import type { PublicResult } from '../protocol/messages.js';

const write = (text: string) => new Promise<void>((resolve, reject) => process.stdout.write(text, error => error ? reject(error) : resolve()));

export function projectExitCode(result: PublicResult): number {
  if (result.outcome === 'INTERRUPTED') return 4;
  if (result.result === 'OK') return 0;
  const code = result.error?.code ?? '';
  if (code === 'UNAUTHORIZED' || code === 'PATH_ACCESS_DENIED') return 6;
  if (code.startsWith('INVALID_') || code.endsWith('_CONFLICT') || ['UNSUPPORTED_VERSION', 'REGISTRY_CHANGED', 'OBSERVATION_SUPERSEDED'].includes(code)) return 2;
  if (result.result === 'UNKNOWN_OUTCOME' || ['DEADLINE_EXCEEDED', 'UNKNOWN_OUTCOME', 'DAEMON_UNAVAILABLE', 'SERVICE_UNREACHABLE'].includes(code)) return 5;
  if (result.result === 'BUSY') return 3;
  if (result.result === 'BLOCKED' || ['REPOSITORY_NOT_FOUND', 'REFERENCE_CHECKOUT_UNAVAILABLE', 'REPOSITORY_UNSUPPORTED', 'GIT_UNAVAILABLE',
    'REPOSITORY_CHANGED', 'REPOSITORY_UNSTABLE', 'INSPECTION_UNAVAILABLE', 'INSPECTION_UNSAFE', 'OUTPUT_LIMIT',
    'PROJECT_NOT_FOUND', 'PROJECT_REMOVED', 'OPERATION_NOT_FOUND', 'STATE_ABSENT', 'REGISTRY_NOT_INITIALIZED'].includes(code)) return 4;
  return 7;
}
function render(result: PublicResult, json: boolean): string {
  if (json) return JSON.stringify(result) + '\n';
  const project = result.data.project as { projectId: string; displayName: string; referenceCheckout: string; configRevision: string;
    baseBranch: string | null; baseState: string; observation: { completedAt: string; freshness: string;
      trackedChanges: boolean | null; untrackedChanges: boolean | null; conflicts: boolean | null;
      error: { code: string; nextAction: string } | null } | null } | undefined;
  const lines: string[] = [];
  if (result.requestId) lines.push(`requestId: ${result.requestId}`);
  if (project) {
    lines.push(`${project.projectId} ${project.displayName}`, `checkout: ${project.referenceCheckout}`, `revisione: ${project.configRevision}`,
      `base: ${project.baseBranch ?? 'non configurata'} (${project.baseState})`, `osservazione: ${project.observation?.completedAt ?? 'assente'} (${project.observation?.freshness ?? 'LAST_KNOWN'})`);
    if (project.observation) {
      const flag = (value: boolean | null) => value === null ? 'non verificato' : value ? 'sì' : 'no';
      lines.push(`modifiche: ${flag(project.observation.trackedChanges)}; non tracciati: ${flag(project.observation.untrackedChanges)}; conflitti: ${flag(project.observation.conflicts)}`);
      if (project.observation.error) lines.push(project.observation.error.code, project.observation.error.nextAction);
    }
  } else if (result.data.projectId) lines.push(`projectId: ${result.data.projectId}`, `esito: ${result.outcome} ${result.data.effect ?? ''}`,
    `revisione: ${result.data.configRevision ?? 'non disponibile'}`);
  else if (Array.isArray(result.data.projects)) {
    for (const p of result.data.projects as { projectId: string; displayName: string; configRevision: string }[]) lines.push(`${p.projectId} ${p.displayName} (revisione ${p.configRevision})`);
    if (result.data.nextCursor) lines.push(`nextCursor: ${result.data.nextCursor}`);
  } else lines.push(result.outcome ?? result.result);
  if (result.data.effect === 'OBSERVED') lines.push(`Osservazione salvata. Disponibilità ed errori: maestro project show ${result.data.projectId}`);
  if (result.error) lines.push(`${result.error.code}: ${result.error.message}`, result.error.nextAction);
  return lines.join('\n') + '\n';
}
export async function runProjectCli(args: readonly string[]): Promise<number> {
  const json = args.includes('--json');
  let requestId: string | null = null;
  let result: PublicResult;
  try {
    const { values, positionals } = parseArgs({ args: [...args], allowPositionals: true, strict: true, options: {
      help: { type: 'boolean', short: 'h' }, json: { type: 'boolean' }, 'state-dir': { type: 'string' },
      'request-id': { type: 'string' }, 'timeout-ms': { type: 'string' }, name: { type: 'string' }, 'base-branch': { type: 'string' }, limit: { type: 'string' }, cursor: { type: 'string' }, 'expected-revision': { type: 'string' }, 'clear-base-branch': { type: 'boolean' },
    } });
    if (values.help) {
      await write('maestro project add PATH [--name NAME] [--base-branch BRANCH]\nmaestro project list [--limit N] [--cursor CURSOR]\nmaestro project verify PROJECT_ID\nmaestro project update PROJECT_ID --expected-revision REV [--name NAME] [--base-branch BRANCH | --clear-base-branch]\nmaestro project show PROJECT_ID\nmaestro project operation REQUEST_ID\n--state-dir ABSOLUTE_PATH --json --request-id UUID --timeout-ms MILLISECONDS\n');
      return 0;
    }
    const command = positionals[0];
    if (!command || !['add', 'show', 'operation', 'list', 'verify', 'update'].includes(command) || positionals.length !== (command === 'list' ? 1 : 2)) throw new Error('INVALID_REQUEST');
    if (values['state-dir'] !== undefined && (!values['state-dir'] || !isAbsolute(values['state-dir']))) throw new Error('INVALID_REQUEST');
    if (!['add', 'update'].includes(command) && (values.name !== undefined || values['base-branch'] !== undefined)) throw new Error('INVALID_REQUEST');
    if (command !== 'list' && (values.limit !== undefined || values.cursor !== undefined)) throw new Error('INVALID_REQUEST');
    if (!['add', 'verify', 'update'].includes(command) && values['request-id'] !== undefined) throw new Error('INVALID_REQUEST');
    if (command !== 'update' && (values['expected-revision'] !== undefined || values['clear-base-branch'] !== undefined)) throw new Error('INVALID_REQUEST');
    if (command === 'update' && values['base-branch'] !== undefined && values['clear-base-branch'] === true) throw new Error('INVALID_REQUEST');
    if (values.limit !== undefined && !/^[1-9][0-9]*$/.test(values.limit)) throw new Error('INVALID_REQUEST');
    if (command === 'add' || command === 'verify' || command === 'update') requestId = values['request-id'] === undefined ? randomUUID() : requireUuid(values['request-id']);
    const timeout = values['timeout-ms'] === undefined ? undefined : Number(values['timeout-ms']);
    if (values['timeout-ms'] !== undefined && (!/^[1-9][0-9]*$/.test(values['timeout-ms']) || !Number.isSafeInteger(timeout))) throw new Error('INVALID_REQUEST');
    const params = command === 'add' ? { path: resolve(positionals[1]!),
      ...(values.name === undefined ? {} : { name: values.name }),
      ...(values['base-branch'] === undefined ? {} : { baseBranch: values['base-branch'] }) }
      : command === 'update' ? { projectId: requireUuid(positionals[1]), expectedRevision: requireProjectRevision(values['expected-revision']), patch: {
        ...(values.name === undefined ? {} : { name: values.name }),
        ...(values['clear-base-branch'] === true ? { baseBranch: null } : values['base-branch'] === undefined ? {} : { baseBranch: values['base-branch'] }),
      } }
      : command === 'list' ? { ...(values.limit === undefined ? {} : { limit: Number(values.limit) }), ...(values.cursor === undefined ? {} : { cursor: values.cursor }) }
      : command === 'show' || command === 'verify' ? { projectId: requireUuid(positionals[1]) } : { requestId: requireUuid(positionals[1]) };
    const client = new LocalClient(createClientBackend());
    result = await client.runProject(command === 'add' ? 'register' : command === 'show' ? 'get' : command === 'list' ? 'list' : command === 'verify' ? 'verify' : command === 'update' ? 'update' : 'operation', params, {
      ...(values['state-dir'] ? { stateDirectory: values['state-dir'] } : {}), ...(requestId ? { requestId } : {}),
      ...(timeout === undefined ? {} : { timeoutMs: timeout }),
    });
    const operation = result.data.operation as { result?: Record<string, unknown> | null } | undefined;
    if (operation) result = { ...result, data: { ...result.data, ...(operation.result ?? {}), accepted: true } };
    else if (command === 'add' || command === 'verify' || command === 'update') result = { ...result, data: { ...result.data, accepted: result.result === 'UNKNOWN_OUTCOME' ? null : false } };
  } catch (error) {
    const code = error instanceof Error && (error.message === 'INVALID_IDENTIFIER' || error.name === 'TypeError') ? 'INVALID_REQUEST' : classifyError(error);
    result = failureResult(code, requestId);
  }
  await write(render(result, json));
  return projectExitCode(result);
}
