#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VERSION } from '../version.js';
import { LocalClient } from '../client/local-client.js';
import { foundationError } from '../domain/errors.js';
import type { PublicResult } from '../protocol/messages.js';

function exitCode(result: PublicResult): number {
  if (result.result === 'OK') return 0;
  if (result.result === 'BUSY') return 3;
  if (result.result === 'BLOCKED') return 4;
  if (result.result === 'UNKNOWN_OUTCOME') return 5;
  if (result.error?.code === 'UNAUTHORIZED') return 6;
  return ['INVALID_REQUEST', 'IDEMPOTENCY_CONFLICT', 'UNSUPPORTED_VERSION', 'UNSUPPORTED_PLATFORM'].includes(result.error?.code ?? '') ? 2 : 7;
}
async function write(text: string): Promise<void> {
  await new Promise<void>((resolve, reject) => process.stdout.write(text, error => error ? reject(error) : resolve()));
}

export async function runCli(args: readonly string[]): Promise<number> {
  let json = args.includes('--json');
  let result: PublicResult;
  try {
    const { values, positionals } = parseArgs({ args: [...args], allowPositionals: true, strict: true, options: {
      help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' }, json: { type: 'boolean' },
      'state-dir': { type: 'string' }, 'request-id': { type: 'string' }, 'timeout-ms': { type: 'string' },
    } });
    json = values.json ?? false;
    if (values.help) {
      await write('maestro daemon start|status|stop [--state-dir ABSOLUTE_PATH] [--json]\n--request-id UUID --timeout-ms MILLISECONDS\n');
      return 0;
    }
    if (values.version) { await write(VERSION + '\n'); return 0; }
    if (positionals[0] !== 'daemon' || positionals.length !== 2 || !['start', 'status', 'stop'].includes(positionals[1]!)) {
      throw new Error('INVALID_REQUEST');
    }
    if (positionals[1] === 'status' && values['request-id']) throw new Error('INVALID_REQUEST');
    const { createClientBackend, failureResult } = await import('../bootstrap.js');
    try {
      result = await new LocalClient(createClientBackend()).run(positionals[1] as 'start' | 'status' | 'stop', {
        ...(values['state-dir'] ? { stateDirectory: values['state-dir'] } : {}),
        ...(values['request-id'] ? { requestId: values['request-id'] } : {}),
        ...(values['timeout-ms'] ? { timeoutMs: Number(values['timeout-ms']) } : {}),
      });
    } catch (error) {
      const { classifyError } = await import('../core/control-main.js');
      const code = error instanceof Error && error.message === 'INVALID_IDENTIFIER' ? 'INVALID_REQUEST' : classifyError(error);
      result = failureResult(code, null);
    }
  } catch {
    result = { protocolVersion: 1, requestId: null, storeId: null, instanceId: null, result: 'ERROR',
      outcome: null, freshness: 'LAST_KNOWN', liveness: 'UNKNOWN', data: {}, error: foundationError('INVALID_REQUEST') };
  }
  await write(json ? JSON.stringify(result) + '\n' : result.error
    ? `${result.error.code}: ${result.error.message}\n${result.error.nextAction}\n`
    : `${result.data.lifecycle ?? result.data.status ?? result.result}${result.instanceId ? ` (${result.instanceId})` : ''}\n`);
  return exitCode(result);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exit(await runCli(process.argv.slice(2)));
}
