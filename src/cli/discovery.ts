import { parseArgs } from 'node:util';
import { isAbsolute } from 'node:path';
import { LocalClient } from '../client/local-client.js';
import { createClientBackend, failureResult } from '../bootstrap.js';
import { classifyError } from '../core/control-main.js';
import { projectExitCode } from './projects.js';
import type { PublicResult } from '../protocol/messages.js';
export async function runDiscoveryCli(args: readonly string[]): Promise<number> {
  let json = args.includes('--json'); let result: PublicResult;
  try {
    const { values, positionals } = parseArgs({ args: [...args], strict: true, allowPositionals: true, options: { json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' }, 'state-dir': { type: 'string' }, 'timeout-ms': { type: 'string' }, limit: { type: 'string' }, cursor: { type: 'string' }, after: { type: 'string' }, sources: { type: 'boolean' }, metadata: { type: 'boolean' }, 'check-id': { type: 'string' } } });
    json = values.json ?? false;
    if (values.help) { process.stdout.write('maestro discovery provider get\nmaestro discovery preview show SNAPSHOT [--sources --limit N --cursor C]\nmaestro discovery list PROJECT [--limit N --cursor C]\nmaestro discovery show DISCOVERY\nmaestro discovery questions DISCOVERY [--limit N --cursor C]\nmaestro discovery output RUN [--limit N --after C]\nmaestro discovery document REVISION [--metadata | --after C]\nmaestro discovery operation REQUEST\n--state-dir ABS --json --timeout-ms MS\n'); return 0; }
    if (values['state-dir'] !== undefined && !isAbsolute(values['state-dir'])) throw new Error('INVALID_REQUEST');
    if (values.cursor !== undefined && values.after !== undefined) throw new Error('INVALID_REQUEST');
    for (const option of ['limit', 'timeout-ms'] as const) if (values[option] !== undefined && !/^[1-9][0-9]*$/.test(values[option])) throw new Error('INVALID_REQUEST');
    const command = positionals[0]; let method: string, params: Record<string, unknown>;
    if (command === 'provider' && positionals[1] === 'get' && positionals.length === 2) { method = 'discovery.provider.get'; params = {}; }
    else if (command === 'preview' && positionals[1] === 'show' && positionals.length === 3) { method = 'discovery.preview.get'; params = { snapshotId: positionals[2], ...(values.sources ? { sources: true } : {}) }; }
    else {
      if (positionals.length !== 2) throw new Error('INVALID_REQUEST');
      const methods: Record<string, [string, string]> = { list: ['discovery.list', 'projectId'], show: ['discovery.get', 'discoveryId'], questions: ['discovery.questions.list', 'discoveryId'], output: ['discovery.output.list', 'runId'], document: ['discovery.document.get', 'revisionId'], operation: ['discovery.operation.get', 'requestId'], eligibility: ['discovery.eligibility.get', 'projectId'] };
      if (!command || !Object.hasOwn(methods, command)) throw new Error('INVALID_REQUEST');
      const [name, key] = methods[command]!; method = name; params = { [key]: positionals[1] };
      if (command === 'document' && !values.metadata) params.content = true;
    }
    if (values.sources && command !== 'preview' || values.metadata && command !== 'document' || values['check-id'] !== undefined && command !== 'eligibility') throw new Error('INVALID_REQUEST');
    if (values.limit !== undefined) params.limit = Number(values.limit);
    if (values.cursor !== undefined || values.after !== undefined) params.cursor = values.cursor ?? values.after;
    if (values['check-id'] !== undefined) params.checkId = values['check-id'];
    result = await new LocalClient(createClientBackend()).runDiscovery(method, params, { ...(values['state-dir'] ? { stateDirectory: values['state-dir'] } : {}), ...(values['timeout-ms'] ? { timeoutMs: Number(values['timeout-ms']) } : {}) });
  } catch (error) { result = failureResult(classifyError(error), null); }
  await new Promise<void>((resolve, reject) => process.stdout.write((json ? JSON.stringify(result) : result.error ? `${result.error.code}: ${result.error.message}\n${result.error.nextAction}` : JSON.stringify(result.data, null, 2)) + '\n', error => error ? reject(error) : resolve()));
  return projectExitCode(result);
}
