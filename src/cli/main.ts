#!/usr/bin/env node
import { encodeCursor, EventStreamError } from '../protocol/event-cursor.js';
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
  return ['INVALID_REQUEST', 'IDEMPOTENCY_CONFLICT', 'UNSUPPORTED_VERSION', 'UNSUPPORTED_PLATFORM', 'WRONG_STORE', 'CURSOR_EXPIRED'].includes(result.error?.code ?? '') ? 2 : 7;
}
async function write(text: string): Promise<void> {
  await new Promise<void>((resolve, reject) => process.stdout.write(text, error => error ? reject(error) : resolve()));
}

async function follow(client: LocalClient, json: boolean, options: import('../client/local-client.js').CommandOptions): Promise<number> {
  const abort = new AbortController();
  const interrupted = () => abort.abort();
  let brokenOutput = false;
  const outputError = () => { brokenOutput = true; abort.abort(); };
  process.on('SIGINT', interrupted); process.on('SIGTERM', interrupted); process.stdout.on('error', outputError);
  let subscription: import('../ports/platform.js').EventSubscription | undefined;
  let started!: () => void;
  const start = new Promise<void>(resolve => { started = resolve; });
  try {
    subscription = await client.followEvents(async frame => {
      await start;
      if (!abort.signal.aborted) await write(json ? JSON.stringify({...frame, cursor: encodeCursor({storeId: frame.event.storeId, seq: frame.event.seq})}) + '\n' : `${frame.event.seq} ${frame.event.type} ${JSON.stringify(frame.event.payload)} cursor=${encodeCursor({storeId: frame.event.storeId, seq: frame.event.seq})}\n`);
    }, {...options, signal: abort.signal});
    await write(json ? JSON.stringify({protocolVersion: 1, kind: 'subscription.started', correlationId: subscription.response.correlationId,
      subscriptionId: subscription.subscriptionId, storeId: subscription.storeId, instanceId: subscription.instanceId, highWater: subscription.highWater}) + '\n'
      : `Eventi live da ${subscription.highWater} (${subscription.instanceId})\n`);
    started();
    const result = await subscription.done;
    if (abort.signal.aborted || brokenOutput || result.reason === null) return 0;
    const {classifyError} = await import('../core/control-main.js');
    const error = foundationError(classifyError(new Error(result.reason)));
    await write(json ? JSON.stringify({protocolVersion: 1, kind: 'subscription.closed', subscriptionId: subscription.subscriptionId, lastReceived: result.lastReceived, cursor: result.lastReceived === null ? null : encodeCursor({storeId: subscription.storeId, seq: result.lastReceived}), ...(result.gap ?? {}), error}) + '\n'
      : `${error.code}: ${error.message}\n${result.gap ? JSON.stringify(result.gap) + "\n" : ""}${error.nextAction}\n`);
    const {failureResult} = await import('../bootstrap.js');
    return exitCode(failureResult(error.code, null));
  } catch (error) { if (abort.signal.aborted || brokenOutput) return 0; throw error; }
  finally {
    started(); await subscription?.close(); process.off('SIGINT', interrupted); process.off('SIGTERM', interrupted); process.stdout.off('error', outputError);
  }
}

export async function runCli(args: readonly string[]): Promise<number> {
  if (args[0] === 'feature') return (await import('./feature.js')).runFeatureCli(args.slice(1));
  if (args[0] === 'discovery') return (await import('./discovery.js')).runDiscoveryCli(args.slice(1));
  if (args[0] === 'project') return (await import('./projects.js')).runProjectCli(args.slice(1));
  let json = args.includes('--json');
  let result: PublicResult;
  try {
    const { values, positionals } = parseArgs({ args: [...args], allowPositionals: true, strict: true, options: {
      help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' }, json: { type: 'boolean' },
      'state-dir': { type: 'string' }, 'request-id': { type: 'string' }, 'timeout-ms': { type: 'string' }, limit: { type: 'string' }, follow: {type: 'boolean'}, after: {type: 'string'},
    } });
    json = values.json ?? false;
    if (values.help) {
      await write('maestro daemon start|status|stop|restart|diagnostics [--state-dir ABSOLUTE_PATH] [--json]\nmaestro daemon operation REQUEST_ID [--state-dir ABSOLUTE_PATH] [--json]\nmaestro daemon events [--limit 1..1000 | --follow] [--after CURSOR] [--state-dir ABSOLUTE_PATH] [--json]\n--request-id UUID --timeout-ms MILLISECONDS\nmaestro project add|list|show|verify|update|remove|operation (maestro project --help)\nmaestro feature --help\n');
      return 0;
    }
    if (values.version) { await write(VERSION + '\n'); return 0; }
    const command = positionals[1];
    if (positionals[0] !== 'daemon' || !command || !['start', 'status', 'stop', 'restart', 'operation', 'diagnostics', 'events'].includes(command)
      || positionals.length !== (command === 'operation' ? 3 : 2)) throw new Error('INVALID_REQUEST');
    if (['status', 'operation', 'diagnostics', 'events'].includes(command) && values['request-id']) throw new Error('INVALID_REQUEST');
    if (values.follow && (command !== 'events' || values.limit)) throw new Error('INVALID_REQUEST');
    if (values.after !== undefined && command !== 'events') throw new Error('INVALID_REQUEST');
    if (values.limit && command !== 'events') throw new Error('INVALID_REQUEST');
    const { createClientBackend, failureResult } = await import('../bootstrap.js');
    try {
      const client = new LocalClient(createClientBackend());
      if (values.follow) return await follow(client, json, {
        ...(values.after !== undefined ? {after: values.after} : {}),
        ...(values['state-dir'] ? {stateDirectory: values['state-dir']} : {}),
        ...(values['timeout-ms'] ? {timeoutMs: Number(values['timeout-ms'])} : {}),
      });
      result = await client.run(command as 'start' | 'status' | 'stop' | 'restart' | 'operation' | 'diagnostics' | 'events', {
        ...(values.after !== undefined ? {after: values.after} : {}),
        ...(values['state-dir'] ? { stateDirectory: values['state-dir'] } : {}),
        ...(command === 'operation' ? { requestId: positionals[2]! } : values['request-id'] ? { requestId: values['request-id'] } : {}),
        ...(values.limit ? {limit: Number(values.limit)} : {}),
        ...(values['timeout-ms'] ? { timeoutMs: Number(values['timeout-ms']) } : {}),
      });
    } catch (error) {
      const { classifyError } = await import('../core/control-main.js');
      const code = error instanceof Error && error.message === 'INVALID_IDENTIFIER' ? 'INVALID_REQUEST' : classifyError(error);
      result = {...failureResult(code, null), ...(error instanceof EventStreamError && error.gap ? {storeId: error.gap.storeId, data: {...error.gap}} : {})};
    }
  } catch {
    result = { protocolVersion: 1, requestId: null, storeId: null, instanceId: null, result: 'ERROR',
      outcome: null, freshness: 'LAST_KNOWN', liveness: 'UNKNOWN', data: {}, error: foundationError('INVALID_REQUEST') };
  }
  const page = result.data.events as {nextCursor?: import('../protocol/event-cursor.js').EventCursor} | undefined;
  if (page?.nextCursor) result = {...result, data: {...result.data, events: {...page, cursor: encodeCursor(page.nextCursor)}}};
  const humanEvents = result.data.events as {records?: readonly unknown[]; truncated?: boolean; highWater?: string; nextCursor?: import('../protocol/event-cursor.js').EventCursor} | undefined;
  await write(json ? JSON.stringify(result) + '\n' : result.error
    ? `${result.error.code}: ${result.error.message}\n${result.data.nextAction === "reread-status" ? JSON.stringify(result.data) + "\n" : ""}${result.error.nextAction}\n`
    : humanEvents ? `${JSON.stringify(humanEvents.records ?? [])}\nEventi fino a ${humanEvents.highWater}; troncato=${humanEvents.truncated}${humanEvents.nextCursor ? " cursor=" + encodeCursor(humanEvents.nextCursor) : ""}\n`
    : `${result.outcome ?? result.data.lifecycle ?? result.data.status ?? result.result}${result.data.lifecycle ? ` [${result.freshness}, ${result.liveness}, ready=${result.data.ready === true}]` : ''}${result.instanceId ? ` (${result.instanceId})` : ''}\n`);
  return exitCode(result);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exit(await runCli(process.argv.slice(2)));
}
