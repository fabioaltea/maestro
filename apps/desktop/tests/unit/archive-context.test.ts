import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { ArchiveContext } from '../../src/main/archive-context.ts';
import { safeError } from '../../src/shared/validation.ts';
import { createScratch } from '../fixtures/desktop.ts';
test('a Git checkout picked as archive is explained before selection changes or filesystem writes',async()=>{
 const f=await createScratch();try{
  const context=new ArchiveContext();await context.select(f.archive);const previous=context.capture();
  const repo=await f.repository(),before=await f.snapshot(repo.path);
  await assert.rejects(context.select(repo.path),/ARCHIVE_IS_REPOSITORY/);
  assert.deepEqual(context.capture(),previous);assert.deepEqual(await f.snapshot(repo.path),before);
  assert.equal(safeError('ARCHIVE_IS_REPOSITORY').code,'ARCHIVE_IS_REPOSITORY');
  await context.select(join(repo.path,'maestro-state'));await assert.rejects(access(join(repo.path,'maestro-state')));
  assert.deepEqual(await f.snapshot(repo.path),before);
 }finally{await f.cleanup();}
});
test('a .git file is also a repository marker; existing archive storage remains readable by core validation',async()=>{
 const f=await createScratch();try{
  const context=new ArchiveContext(),repo=join(f.directory,'git-file-checkout');await mkdir(repo);await writeFile(join(repo,'.git'),'gitdir: /unused');
  await assert.rejects(context.select(repo),/ARCHIVE_IS_REPOSITORY/);assert.equal(context.current,null);
  // A pre-existing archive must remain reachable; only core decides whether its store is valid.
  await writeFile(join(repo,'state.sqlite'),'invalid fixture store');assert.equal((await context.select(repo)).path,repo);
 }finally{await f.cleanup();}
});
