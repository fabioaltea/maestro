import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';
import { createTestContext } from '../fixtures/test-context.js';

test('storage worker does not inherit eval-only flags from an SDK host', async (t) => {
  const context = await createTestContext(t);
  const module = pathToFileURL(resolve('dist/storage/worker.js')).href;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import {openStorage} from ${JSON.stringify(module)};
    const store=await openStorage({path:process.argv[1],readonly:true});
    console.log(JSON.stringify(await store.readSnapshot()));
    await store.close();
  `, join(context.directory, 'absent.sqlite')], { encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout.trim(), 'null');
});
