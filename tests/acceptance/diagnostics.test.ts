import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {lstat, readFile, readdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {foundationError, type ErrorCode} from '../../src/domain/errors.js';
import {classifyStorageFailure} from '../../src/storage/worker.js';
import {createClientBackend} from '../../src/bootstrap.js';
import {createCliHarness, invokeCli} from '../fixtures/cli-harness.js';
import {createPlatformPaths} from '../../src/platform/macos/paths.js';
import {createLocalTransport} from '../../src/platform/macos/transport.js';

const codes: ErrorCode[] = ['INVALID_REQUEST', 'UNSUPPORTED_VERSION', 'UNSUPPORTED_PLATFORM', 'UNAUTHORIZED',
  'STALE_TARGET', 'IDEMPOTENCY_CONFLICT', 'BUSY', 'BLOCKED', 'EVENT_BACKPRESSURE', 'PERSISTENCE_UNAVAILABLE',
  'STATE_INCOMPATIBLE', 'STATE_CORRUPT', 'DEADLINE_EXCEEDED', 'RESOURCE_IDENTITY_UNKNOWN', 'ENDPOINT_COLLISION',
  'CURSOR_EXPIRED', 'WRONG_STORE', 'SLOW_CONSUMER', 'DAEMON_ABSENT', 'SERVICE_UNREACHABLE', 'CONTROL_INTERRUPTED',
  'CORE_EXITED_BEFORE_ACCEPTANCE', 'INTERNAL_ERROR'];

test('diagnostics: every error code has a safe actionable result; disk faults never invent persistence', () => {
  const operationId = randomUUID();
  for (const code of codes) {
    const error = foundationError(code, {operationId});
    assert.equal(error.code, code);
    assert.ok(['VALIDATION', 'AUTHORIZATION', 'CONCURRENCY', 'SAFETY', 'PERSISTENCE', 'TIMEOUT', 'OBSERVABILITY', 'RUNTIME'].includes(error.category));
    assert.equal(error.operationId, operationId);
    assert.equal(error.persisted, false);
    assert.equal(typeof error.retryable, 'boolean');
    assert.ok(error.message.length > 0 && error.nextAction.length > 0);
    assert.ok(Buffer.byteLength(JSON.stringify(error)) < 1024);
  }
  for (const [code, cause] of [['SQLITE_FULL', 'DISK_FULL'], ['ENOSPC', 'DISK_FULL'], ['SQLITE_READONLY', 'READ_ONLY'], ['SQLITE_IOERR_WRITE', 'IO_ERROR']]) {
    const error = classifyStorageFailure(Object.assign(new Error('diagnostics-sentinel-secret'), {code}));
    assert.equal(error.code, 'PERSISTENCE_UNAVAILABLE');
    assert.equal(error.category, 'PERSISTENCE');
    assert.equal(error.cause, cause);
    assert.equal(error.persisted, false);
    assert.ok(!JSON.stringify(error).includes('diagnostics-sentinel-secret'));
  }
});

test('diagnostics: core exit before acceptance is explicit, unpersisted and does not initialize state', async t => {
  const harness = await createCliHarness(t);
  const backend = createClientBackend({
    spawnController: async () => ({pid: 0, exit: Promise.resolve({code: 86, signal: null}), bootstrap: Promise.resolve(null)}),
    spawnDaemon: async () => {throw new Error('UNEXPECTED_SPAWN');},
  });
  const result = await backend.control({protocolVersion: 1, requestId: randomUUID(), action: 'start', canonicalStateDir: harness.archive}, 1_000);
  assert.equal(result.error?.code, 'CORE_EXITED_BEFORE_ACCEPTANCE');
  assert.equal(result.error?.persisted, false);
  assert.notEqual(result.result, 'OK');
  await assert.rejects(lstat(harness.archive), {code: 'ENOENT'});
});

test('diagnostics: denied major/internal requests, sentinel redaction and byte-identical offline reads', async t => {
  const harness = await createCliHarness(t), sentinel = `diagnostics-sentinel-${randomUUID()}`;
  const previous = process.env.MAESTRO_ACCEPTANCE_SECRET;
  process.env.MAESTRO_ACCEPTANCE_SECRET = sentinel;
  try {
    for (const command of ['status', 'diagnostics', 'events']) assert.equal((await harness.call(command)).code, 0);
    await assert.rejects(lstat(harness.archive), {code: 'ENOENT'});
    assert.equal((await harness.call('start')).code, 0);
    const paths = (await createPlatformPaths().resolveArchive(harness.archive, 'read'))!;
    const key = (await readFile(paths.clientKeyFile, 'utf8')).trim(), transport = createLocalTransport();
    const request = {protocolVersion: 1 as const, correlationId: randomUUID(), method: 'status.get', params: {}};
    await assert.rejects(transport.call(paths.daemonEndpoint, key, {...request, protocolVersion: 2} as unknown as typeof request, 1_000), /UNSUPPORTED_VERSION/);
    const denied = await transport.call(paths.daemonEndpoint, key, {...request, correlationId: randomUUID(), method: 'internal.prepareStop', params: {password: sentinel}}, 1_000);
    assert.equal(denied.result, 'ERROR');
    assert.equal((denied.data as {code: string}).code, 'UNAUTHORIZED');
    assert.equal(JSON.parse((await harness.call('status')).stdout).data.ready, true);
    assert.equal((await harness.call('stop')).code, 0);
    const bytes = await readFile(paths.stateFile);
    for (const command of ['status', 'diagnostics', 'events']) {
      const json = await harness.call(command), human = await invokeCli(['daemon', command, '--state-dir', harness.archive]);
      assert.equal(json.code, 0, json.stdout); assert.equal(human.code, json.code, human.stdout);
      assert.ok(![json.stdout, human.stdout, json.stderr, human.stderr].some(output => output.includes(sentinel) || output.includes(key)));
    }
    assert.deepEqual(await readFile(paths.stateFile), bytes);
    for (const directory of ['events', 'logs']) for (const name of await readdir(join(harness.archive, directory))) {
      const contents = await readFile(join(harness.archive, directory, name));
      assert.equal(contents.includes(Buffer.from(sentinel)), false);
      assert.equal(contents.includes(Buffer.from(key)), false);
    }
    const invalid = await harness.call('events', '--limit', '1001');
    assert.equal(invalid.code, 2); assert.equal(JSON.parse(invalid.stdout).error.code, 'INVALID_REQUEST');
    await writeFile('specs/001-core-background-daemon/reports/diagnostics-samples.json', JSON.stringify({measuredAt: new Date().toISOString(), catalogCodes: codes, diskFaults: 'controlled adapter, not a filled physical disk', bootstrapFault: 'controlled launcher, unpersisted', deniedMajor: true, deniedInternal: true, sentinelLeaks: 0, offlineBytesUnchanged: true}, null, 2) + '\n');
  } finally {
    if (previous === undefined) delete process.env.MAESTRO_ACCEPTANCE_SECRET;
    else process.env.MAESTRO_ACCEPTANCE_SECRET = previous;
  }
});