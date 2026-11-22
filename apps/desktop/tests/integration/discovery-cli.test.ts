import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CoreCli, buildCliArgs } from '../../src/main/core-cli.ts';
import { sanitizedEnvironment } from '../../src/main/runtime.ts';
import { createScratch, repositoryRoot } from '../fixtures/desktop.ts';

test('the external CLI receives preview scope through a bounded pipe, outside argv', async () => {
  const f = await createScratch(), requestId = randomUUID(), projectId = randomUUID(), storeId = randomUUID();
  const script = join(f.directory, 'pipe.mjs');
  await writeFile(script, `const chunks=[];for await(const b of process.stdin)chunks.push(b);
const scope=JSON.parse(Buffer.concat(chunks).toString('utf8'));
if(JSON.stringify(scope)!==JSON.stringify(['sorgenti/è.ts'])||process.argv.some(v=>v.includes('sorgenti')))process.exit(3);
process.stdout.write(JSON.stringify({protocolVersion:1,requestId:${JSON.stringify(requestId)},storeId:${JSON.stringify(storeId)},instanceId:null,result:'OK',outcome:null,freshness:'LIVE',liveness:'LIVE_VERIFIED',data:{accepted:true,requestId:${JSON.stringify(requestId)}},error:null}));`);
  const core = new CoreCli({ node: process.execPath, cli: script, env: sanitizedEnvironment() });
  try {
    const command = { namespace: 'discovery' as const, action: 'preview', archive: f.archive, requestId, params: { projectId, expectedConfigRevision: '1', selectors: ['sorgenti/è.ts'] } };
    assert.ok(buildCliArgs(command).includes('--scope-stdin'));
    assert.equal((await core.call(command)).data.accepted, true);
    const actual = new CoreCli({ node: process.execPath, cli: join(repositoryRoot, 'dist/cli/main.js'), env: sanitizedEnvironment() });
    try { const result = await actual.call(command); assert.equal(result.error?.code, 'STATE_ABSENT'); assert.equal(result.requestId, requestId); }
    finally { actual.close(); }
  } finally { core.close(); await f.cleanup(); }
});
