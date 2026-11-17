import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { agentFixture, agentDeadline } from '../fixtures/discovery-agent-runtime.js';
import { value } from '../fixtures/discovery-artifacts.js';

test('runtime rejects stale generation, foreign owner, changed input and incompatible policy before creating a host', async t => {
  const f = await agentFixture(t);
  for (const change of [{ generation: randomUUID() }, { owningInstanceId: randomUUID() }, { policy: 'foundation-auxiliary' }]) assert.equal((await f.runtime.launch({ identity: { ...f.identity, ...change }, invocation: f.invocation, stdin: f.stdin, deadline: agentDeadline() })).ok, false);
  assert.equal((await f.runtime.launch({ identity: f.identity, invocation: f.invocation, stdin: 'unapproved bytes', deadline: agentDeadline() })).ok, false);
  assert.equal(f.hosts.length, 0);
});
test('input and deadline caps fail before external effects; runtime cannot expose its control root as provider cwd', async t => {
  const f = await agentFixture(t);
  assert.equal((await f.runtime.launch({ identity: f.identity, invocation: f.invocation, stdin: 'x'.repeat(2 * 1024 * 1024 + 1), deadline: agentDeadline() })).ok, false);
  assert.equal((await f.runtime.launch({ identity: f.identity, invocation: f.invocation, stdin: f.stdin, deadline: agentDeadline(0) })).ok, false);
  assert.equal((await f.runtime.launch({ identity: f.identity, invocation: { ...f.invocation, cwd: f.paths.directory }, stdin: f.stdin, deadline: agentDeadline() })).ok, false);
  assert.equal(f.hosts.length, 0);
});
test('HOST_READY never authorizes GO; the durable SPAWN_AUTHORIZED phase is mandatory', async t => {
  const f = await agentFixture(t), ready = value(await f.launch());
  assert.equal(value(f.store.readDiscoveryMetadata({ kind: 'run', id: f.run.runId })).data?.phase, 'HOST_READY');
  assert.equal((await f.runtime.authorizeStart(ready)).ok, false);
  assert.equal(ready.providerPid, null); assert.equal(f.stdout.length, 0);
});
