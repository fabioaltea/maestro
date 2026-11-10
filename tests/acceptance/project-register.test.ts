import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFile, readdir } from 'node:fs/promises';
import { createCliHarness, invokeCli } from '../fixtures/cli-harness.js';
import { createProjectRepositories } from '../fixtures/project-repositories.js';
import { createProcessIdentity } from '../../src/platform/macos/process-identity.js';
import { openStorage } from '../../src/storage/worker.js';

test('independent CLI clients register all supported fixture kinds, retain IDs across restart and read offline without writes', async t => {
  const h = await createCliHarness(t), f = await createProjectRepositories(t);
  const normal = await f.createRepository('normal 🎼');
  const empty = await f.createRepository('empty', { commit: false });
  const detached = await f.createRepository('detached'); await f.git(detached, ['checkout', '--detach']);
  const dirty = await f.createRepository('dirty'); await f.makeDirty(dirty);
  const conflicted = await f.createRepository('conflicted'); await f.makeConflicted(conflicted);
  const main = await f.createRepository('main'); const linked = await f.addWorktree(main, 'linked');
  const bare = await f.createRepository('bare', { bare: true }); await f.git(bare, ['fetch', normal, 'fixture-base:fixture-base']);
  const bareLinked = await f.addWorktree(bare, 'bare-linked', 'bare-branch');
  const nested = await f.createRepository('nested', { parent: normal });
  const subSource = await f.createRepository('sub-source');
  await f.git(normal, ['-c', 'protocol.file.allow=always', 'submodule', 'add', '--', subSource, 'module']);
  await f.git(normal, ['commit', '-am', 'fixture submodule']); const submodule = join(normal, 'module');
  const sha256 = await f.createRepository('sha256', { objectFormat: 'sha256' });
  const unsafe = await f.createRepository('unsafe-status'); const sentinel = await f.createSentinel('cli-no-helper');
  await f.git(unsafe, ['config', 'filter.sentinel.process', sentinel.command]);
  const roots = [normal, empty, detached, dirty, conflicted, main, linked, bare, bareLinked, subSource, sha256, unsafe];
  const snapshots = await Promise.all(roots.map(root => f.snapshotTree(root)));
  const checkouts = [normal, empty, detached, dirty, conflicted, linked, main, bareLinked, nested, submodule, sha256, unsafe];
  assert.equal((await h.call('start')).code, 0);
  const details = new Map<string, unknown>();
  let linkedId: string | undefined, unsafeId: string | undefined;
  for (const [index, checkout] of checkouts.entries()) {
    const added = await invokeCli(['project', 'add', checkout, '--name', `CLI fixture ${index}`, '--state-dir', h.archive, '--json']);
    assert.equal(added.code, 0, added.stdout || added.stderr);
    const result = JSON.parse(added.stdout) as { requestId: string; outcome: string; data: { projectId: string; effect: string; accepted: boolean } };
    assert.equal(result.outcome, 'SUCCEEDED'); assert.equal(result.data.accepted, true);
    if (checkout === linked) linkedId = result.data.projectId;
    if (checkout === main) { assert.equal(result.data.effect, 'EXISTING'); assert.equal(result.data.projectId, linkedId); }
    else assert.equal(result.data.effect, 'CREATED');
    if (checkout === unsafe) unsafeId = result.data.projectId;
    const shown = await invokeCli(['project', 'show', result.data.projectId, '--state-dir', h.archive, '--json']);
    assert.equal(shown.code, 0, shown.stdout);
    const project = JSON.parse(shown.stdout).data.project as { referenceCheckout: string; observation: { freshness: string; hasCommits: boolean; objectFormat: string; conflicts: boolean; error: { code: string } | null } };
    assert.equal(project.referenceCheckout, checkout === main ? linked : checkout);
    assert.equal(project.observation.freshness, 'LAST_KNOWN');
    if (checkout === empty) assert.equal(project.observation.hasCommits, false);
    if (checkout === conflicted) assert.equal(project.observation.conflicts, true);
    if (checkout === sha256) assert.equal(project.observation.objectFormat, 'sha256');
    if (checkout === unsafe) assert.equal(project.observation.error?.code, 'INSPECTION_UNSAFE');
    details.set(result.data.projectId, project);
  }
  assert.equal(details.size, checkouts.length - 1);
  assert.equal((await h.call('restart')).code, 0);
  for (const [id, original] of details) {
    const shown = await invokeCli(['project', 'show', id, '--state-dir', h.archive, '--json']);
    assert.equal(shown.code, 0, shown.stdout); assert.deepEqual(JSON.parse(shown.stdout).data.project, original);
  }
  const human = await invokeCli(['project', 'show', unsafeId!, '--state-dir', h.archive]);
  assert.equal(human.code, 0, human.stdout); assert.match(human.stdout, /revisione: 1/);
  assert.match(human.stdout, /osservazione: .*LAST_KNOWN/); assert.match(human.stdout, /non verificato/); assert.match(human.stdout, /INSPECTION_UNSAFE/);
  const stopped = await h.call('stop'); assert.equal(stopped.code, 0, stopped.stdout);
  const observer = await openStorage({ path: join(h.archive, 'state.sqlite'), readonly: true });
  const attempt = await observer.getControllerAttempt(JSON.parse(stopped.stdout).requestId); await observer.close();
  if (attempt) {
    const identity = createProcessIdentity(), until = performance.now() + 2_000;
    while (await identity.probeAbsent(attempt.pid) !== 'ABSENT') { assert.ok(performance.now() < until); await new Promise(resolve => setTimeout(resolve, 10)); }
  }
  const names = await readdir(h.archive), database = await readFile(join(h.archive, 'state.sqlite'));
  for (const [id, original] of details) {
    const shown = await invokeCli(['project', 'show', id, '--state-dir', h.archive, '--json']);
    assert.equal(shown.code, 0, shown.stdout);
    const result = JSON.parse(shown.stdout);
    assert.equal(result.freshness, 'LAST_KNOWN'); assert.equal(result.liveness, 'ABSENT_VERIFIED'); assert.deepEqual(result.data.project, original);
  }
  assert.deepEqual(await readdir(h.archive), names); assert.deepEqual(await readFile(join(h.archive, 'state.sqlite')), database);
  await assert.rejects(readFile(sentinel.marker), { code: 'ENOENT' });
  for (let index = 0; index < roots.length; index++) assert.deepEqual(await f.snapshotTree(roots[index]!), snapshots[index]);
});
