import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {lstat, readFile} from 'node:fs/promises';
import {createConnection} from 'node:net';
import {createCliHarness, invokeCli} from '../fixtures/cli-harness.js';
import {createPlatformPaths} from '../../src/platform/macos/paths.js';

const execute = promisify(execFile);

test('local access: private archive, credentials and UDS; daemon has no TCP listener', async t => {
  const harness = await createCliHarness(t);
  assert.equal((await harness.call('start')).code, 0);
  const paths = (await createPlatformPaths().resolveArchive(harness.archive, 'read'))!;
  for (const path of [paths.directory, paths.runtimeDirectory]) {
    const info = await lstat(path);
    assert.equal(info.uid, process.getuid!());
    assert.equal(info.mode & 0o777, 0o700);
  }
  for (const path of [paths.clientKeyFile, paths.stateFile, paths.daemonEndpoint]) {
    const info = await lstat(path);
    assert.equal(info.uid, process.getuid!());
    assert.equal(info.mode & 0o777, 0o600);
  }
  assert.ok((await lstat(paths.daemonEndpoint)).isSocket());
  const status = JSON.parse((await harness.call('status')).stdout);
  const result = await execute('/usr/sbin/lsof', ['-nP', '-a', '-p', String(status.data.pid), '-iTCP', '-sTCP:LISTEN'])
    .then(output => ({code: 0, ...output}), error => ({code: error.code as number, stdout: error.stdout as string, stderr: error.stderr as string}));
  assert.equal(result.code, 1, JSON.stringify(result));
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
  assert.equal(JSON.parse((await harness.call('status')).stdout).instanceId, status.instanceId);
});

test('local access: real second UID cannot read capabilities, connect or inspect the owner archive', async t => {
  const archive = process.env.MAESTRO_LOCAL_ACCESS_ARCHIVE;
  const endpoint = process.env.MAESTRO_LOCAL_ACCESS_ENDPOINT;
  if (!archive || !endpoint) {
    t.skip('NOT_RUN: run under a preconfigured second UID with owner archive and endpoint');
    return;
  }
  const owner = await lstat(archive);
  assert.notEqual(owner.uid, process.getuid!(), 'this gate requires a real distinct UID');
  assert.equal(owner.mode & 0o777, 0o700);
  await assert.rejects(readFile(`${archive}/credentials/client.key`), {code: 'EACCES'});
  await assert.rejects(new Promise<void>((resolve, reject) => {
    const socket = createConnection(endpoint);
    socket.setTimeout(1_000, () => {socket.destroy(); reject(new Error('connection timeout is not proof of denied access'));});
    socket.once('connect', () => {socket.destroy(); resolve();});
    socket.once('error', reject);
  }), {code: 'EACCES'});
  for (const command of ['status', 'diagnostics', 'events']) {
    const result = await invokeCli(['daemon', command, '--state-dir', archive, '--json']);
    assert.notEqual(result.code, 0, result.stdout);
    assert.equal(JSON.parse(result.stdout).error.code, 'UNAUTHORIZED');
  }
  t.diagnostic(JSON.stringify({ownerUid: owner.uid, requesterUid: process.getuid!(), archive, endpoint, result: 'PASS'}));
});