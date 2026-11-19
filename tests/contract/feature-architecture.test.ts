import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createTestContext} from '../fixtures/test-context.js';
test('workflow/feature orchestration cannot import direct OS effects outside composition',async t=>{
 const f=await createTestContext(t),root=join(f.directory,'src');await mkdir(join(root,'core','workflow'),{recursive:true});
 await writeFile(join(root,'core','workflow','unsafe.ts'),"import {readFile} from 'node:fs/promises';\n");
 await assert.rejects(()=>promisify(execFile)(process.execPath,[resolve('scripts/check-architecture.mjs'),root,join(f.directory,'no-desktop')]),e=>e instanceof Error&&'stderr'in e&&String(e.stderr).includes('forbidden dependency node:fs/promises'));
});
