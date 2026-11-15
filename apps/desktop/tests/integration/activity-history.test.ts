import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { ActivityHistory } from '../../src/main/activity-history.ts';
import { ArchiveContext } from '../../src/main/archive-context.ts';
import { CoreCli } from '../../src/main/core-cli.ts';
import { validateRuntime } from '../../src/main/runtime.ts';
import { createScratch, repositoryRoot } from '../fixtures/desktop.ts';
import { record } from '../../src/shared/validation.ts';
test('real persistent history pages and diagnostics are bounded redacted and read-only offline', async () => {
  const f=await createScratch(), core=new CoreCli(await validateRuntime(process.execPath,join(repositoryRoot,'dist/cli/main.js')));
  try {
    await f.cli(['daemon','start']);const repo=await f.repository('private-project');await f.cli(['project','add',repo.path,'--name=SECRET_PROJECT_NAME']);
    const context=new ArchiveContext();await context.select(f.archive);const history=new ActivityHistory(context,core);
    const first=await history.history({limit:2}), firstPage=record(first.data.events);
    assert.equal(first.freshness,'LIVE');assert.equal((firstPage.records as unknown[]).length,2);
    const next=await history.history({after:firstPage.cursor,limit:2});assert.ok(BigInt(String(record(next.data.events).nextAfter))>BigInt(String(firstPage.nextAfter)));
    assert.doesNotMatch(JSON.stringify(first.data),/SECRET_PROJECT_NAME|private-project|credential|token/i);
    await f.cli(['daemon','stop']);const before=await f.snapshot(f.archive);
    const offline=await history.history(), diagnostics=await history.diagnostics();
    assert.equal(offline.freshness,'LAST_KNOWN');assert.equal(diagnostics.liveness,'ABSENT_VERIFIED');assert.ok((record(offline.data.events).records as unknown[]).length>0);
    assert.doesNotMatch(JSON.stringify(diagnostics.data),/SECRET_PROJECT_NAME|private-project|credential|token/i);
    assert.deepEqual(await f.snapshot(f.archive),before);
  } finally {core.close();await f.cleanup();}
});
