import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { createProjectRepositories } from '../fixtures/project-repositories.js';
import { contextAdapter, contextOptions, contextRequest } from '../fixtures/discovery-context.js';
import { value } from '../fixtures/discovery-artifacts.js';

for (const state of ['clean', 'dirty', 'unborn', 'conflict']) {
  test(`Discovery inspects ${state} working bytes with unchanged index/objects/refs/config and checkout`, async t => {
    const f = await createProjectRepositories(t), repo = await f.createRepository('repository', { commit: state !== 'unborn' });
    if (state === 'unborn') await writeFile(join(repo, 'tracked.txt'), 'unborn source\n');
    if (state === 'dirty') await writeFile(join(repo, 'tracked.txt'), 'dirty working bytes\n');
    if (state === 'conflict') {
      await f.git(repo, ['switch', '-c', 'other']); await writeFile(join(repo, 'tracked.txt'), 'other\n'); await f.git(repo, ['commit', '-am', 'other']);
      await f.git(repo, ['switch', 'fixture-base']); await writeFile(join(repo, 'tracked.txt'), 'base changed\n'); await f.git(repo, ['commit', '-am', 'base']); await f.git(repo, ['merge', 'other'], 1);
    }
    const before = await f.snapshotTree(repo), context = await contextAdapter(); const captured = value(await context.capture(contextRequest(repo, ['tracked.txt']), contextOptions()));
    assert.equal(captured.manifest.headKind, state === 'unborn' ? 'UNBORN' : 'BRANCH'); assert.equal(captured.manifest.sources.length, 1);
    assert.deepEqual(await f.snapshotTree(repo), before);
  });
}
test('nested repositories and gitlink entries cannot broaden a directory scope', async t => {
  const f = await createProjectRepositories(t), repo = await f.createRepository('outer'); await f.createRepository('nested', { parent: repo });
  const oid = (await f.git(repo, ['rev-parse', 'HEAD'])).trim(); await mkdir(join(repo, 'vendor')); await writeFile(join(repo, 'vendor/code.ts'), 'NESTED_CANARY');
  await f.git(repo, ['update-index', '--add', '--cacheinfo', `160000,${oid},vendor`]); const before = await f.snapshotTree(repo);
  const context = await contextAdapter(), captured = value(await context.capture(contextRequest(repo), contextOptions()));
  assert.equal(captured.manifest.sources.some(source => /^(nested|vendor)\//.test(source.relativePath)), false);
  for (const path of ['nested', 'nested/tracked.txt', 'vendor', 'vendor/code.ts']) assert.deepEqual(await context.capture(contextRequest(repo, [path]), contextOptions()), { ok: false, code: 'SOURCE_EXCLUDED' });
  assert.deepEqual(await f.snapshotTree(repo), before);
});
test('hostile Git helpers and package scripts are never executed and cannot write a marker', async t => {
  const f = await createProjectRepositories(t), repo = await f.createRepository('hostile'); const marker = join(f.directory, 'must-not-exist');
  const helper = join(repo, '.git', 'helper'); await writeFile(helper, `#!/bin/sh\nprintf executed > '${marker}'\n`, { mode: 0o700 });
  await f.git(repo, ['config', 'core.fsmonitor', helper]); await f.git(repo, ['config', 'filter.evil.process', helper]); await f.git(repo, ['config', 'diff.external', helper]);
  await writeFile(join(repo, '.gitattributes'), 'tracked.txt filter=evil\n'); await writeFile(join(repo, 'package.json'), JSON.stringify({ scripts: { prepare: helper, test: helper } }));
  const before = await f.snapshotTree(repo), context = await contextAdapter(); const result = await context.capture(contextRequest(repo), contextOptions());
  assert.equal(result.ok, true); await assert.rejects(access(marker)); assert.deepEqual(await f.snapshotTree(repo), before);
});
