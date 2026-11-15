import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { writeFile, rename } from 'node:fs/promises';
import { ProjectActions } from '../../src/main/project-actions.ts';
import { ActionService } from '../../src/main/action-handlers.ts';
import { ArchiveContext } from '../../src/main/archive-context.ts';
import { ReceiptStore } from '../../src/main/receipt-store.ts';
import { CoreCli } from '../../src/main/core-cli.ts';
import { validateRuntime } from '../../src/main/runtime.ts';
import { record } from '../../src/shared/validation.ts';
import { createScratch, repositoryRoot } from '../fixtures/desktop.ts';
test('real project mutations preserve conflicted files, deduplicate, reject stale approval and reimport with new identity', async () => {
  const f = await createScratch(); const core = new CoreCli(await validateRuntime(process.execPath, join(repositoryRoot, 'dist/cli/main.js')));
  try {
    assert.equal((await f.cli(['daemon', 'start'])).result.outcome, 'SUCCEEDED');
    const repo = await f.repository();
    await repo.git(['checkout', '-b', 'side']); await writeFile(join(repo.path, 'file.txt'), 'side\n'); await repo.git(['commit', '-am', 'side']);
    await repo.git(['checkout', 'main']); await writeFile(join(repo.path, 'file.txt'), 'main\n'); await repo.git(['commit', '-am', 'main']);
    await assert.rejects(() => repo.git(['merge', 'side'])); const snapshot = await f.snapshot(repo.path);
    const context = new ArchiveContext(); await context.select(f.archive);
    const projects = new ProjectActions(context, { async chooseDirectory() { return repo.path; } });
    const receipts = new ReceiptStore(join(f.userData, 'receipts'));
    const actions = new ActionService({ context, receipts, core, owner: () => ({ owner: 1, frame: 2 }) }); actions.resolveProject = (action, params) => projects.resolve(action, params);
    async function apply(action: string, params: Record<string, unknown>) {
      const prepared = await actions.prepare(action, params), result = await actions.confirm(prepared.confirmationId);
      assert.equal(result.result.outcome, 'SUCCEEDED'); return record(record(result.result.data.operation).result);
    }
    const selected = await projects.chooseRepository(); assert.ok(selected);
    const added = await apply('project.register', { repositoryHandle: selected!.repositoryHandle, name: 'Progetto', baseBranch: 'main' });
    const projectId = String(added.projectId);
    assert.equal((await apply('project.register', { repositoryHandle: selected!.repositoryHandle, name: 'Non sovrascrivere' })).projectId, projectId);
    const verified = await apply('project.verify', { projectId }); assert.equal(verified.effect, 'OBSERVED');
    const original = (await f.cli(['project', 'show', projectId])).result.data.project;
    assert.equal(original.observation.conflicts, true); assert.equal(original.displayName, 'Progetto');
    const stale = await actions.prepare('project.update', { projectId, expectedRevision: original.configRevision, patch: { name: 'Obsoleto' } });
    await f.cli(['project', 'update', projectId, `--expected-revision=${original.configRevision}`, '--name=Da CLI']);
    const count = (await receipts.list()).length;
    await assert.rejects(() => actions.confirm(stale.confirmationId), { message: 'REVISION_CONFLICT' }); assert.equal((await receipts.list()).length, count);
    const current = (await f.cli(['project', 'show', projectId])).result.data.project;
    await apply('project.update', { projectId, expectedRevision: current.configRevision, patch: { name: 'Nuovo nome', baseBranch: null } });
    const updated = (await f.cli(['project', 'show', projectId])).result.data.project;
    assert.equal(updated.displayName, 'Nuovo nome'); assert.equal(updated.baseBranch, null);
    await apply('project.remove', { projectId, expectedRevision: updated.configRevision });
    const reimported = await apply('project.register', { repositoryHandle: selected!.repositoryHandle }); assert.notEqual(reimported.projectId, projectId);
    assert.deepEqual(await f.snapshot(repo.path), snapshot);
  } finally { core.close(); await f.cleanup(); }
});
test('unborn repository and unavailable verification remain dated observations without reference rebinding', async () => {
  const f = await createScratch(); const core = new CoreCli(await validateRuntime(process.execPath, join(repositoryRoot, 'dist/cli/main.js')));
  try {
    await f.cli(['daemon', 'start']); const repo = await f.repository('unborn', false);
    const context = new ArchiveContext(); await context.select(f.archive);
    const projects = new ProjectActions(context, { async chooseDirectory() { return repo.path; } });
    const actions = new ActionService({ context, core, receipts: new ReceiptStore(join(f.userData, 'receipts')), owner: () => ({ owner: 1, frame: 2 }) }); actions.resolveProject = (a, p) => projects.resolve(a, p);
    const selected = await projects.chooseRepository(), prepared = await actions.prepare('project.register', { repositoryHandle: selected!.repositoryHandle });
    const result = await actions.confirm(prepared.confirmationId), projectId = String(record(record(result.result.data.operation).result).projectId);
    await rename(repo.path, `${repo.path}-moved`);
    const verify = await actions.prepare('project.verify', { projectId });
    assert.equal((await actions.confirm(verify.confirmationId)).result.outcome, 'SUCCEEDED');
    const detail = (await f.cli(['project', 'show', projectId])).result.data.project;
    assert.equal(detail.referenceCheckout, repo.path); assert.equal(detail.observation.checkoutAvailability, 'UNAVAILABLE'); assert.equal(detail.observation.freshness, 'LAST_KNOWN');
  } finally { core.close(); await f.cleanup(); }
});
