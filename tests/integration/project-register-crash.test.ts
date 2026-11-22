import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import Database from 'better-sqlite3';
import { createProjectHarness } from '../fixtures/project-client.js';
import { createProcessSandbox } from '../fixtures/process-sandbox.js';
import { createPlatformPaths } from '../../src/platform/macos/paths.js';
import { createProcessIdentity } from '../../src/platform/macos/process-identity.js';
import { createOperations } from '../../src/core/operations.js';
import { openStorage } from '../../src/storage/worker.js';
import { decodeProjectOperationView } from '../../src/protocol/validation.js';

const cases = [
  { point: 'project.beforeAccept', variant: 'clean', committed: false, accepted: false },
  { point: 'project.accepted', variant: 'clean', committed: false, accepted: true },
  { point: 'project.accepted', variant: 'dirty', committed: false, accepted: true },
  { point: 'project.probing', variant: 'clean', committed: false, accepted: true },
  { point: 'project.probing', variant: 'blocked-git', committed: false, accepted: true },
  { point: 'project.beforeCommit', variant: 'clean', committed: false, accepted: true },
  { point: 'project.beforeCommit', variant: 'dirty', committed: false, accepted: true },
  { point: 'project.committed', variant: 'clean', committed: true, accepted: true },
  { point: 'project.beforeAck', variant: 'client-deadline', committed: true, accepted: true },
  { point: 'project.beforeDrain', variant: 'clean', committed: true, accepted: true },
] as const;
const samples: Record<string, unknown>[] = [];
after(async () => {
  if (samples.length) await writeFile(resolve('specs/002-project-registry/reports/register-crash-samples.json'),
    JSON.stringify({ measuredAt: new Date().toISOString(), required: cases.length, completed: samples.length, samples }, null, 2) + '\n');
});

for (const scenario of cases) {
  test(`REGISTER actual SIGKILL at ${scenario.point}/${scenario.variant} preserves intent/result/project/event atomically`, async t => {
    const h = await createProjectHarness(t);
    const status = JSON.parse((await h.h.call('status')).stdout);
    assert.ok(status.data.capabilities.projectRegistryMethods.includes('projects.register'), 'registration must be implemented before the actual crash campaign');
    assert.equal((await h.h.call('stop')).code, 0);
    const repo = await h.f.createRepository('crash-source');
    if (scenario.variant === 'dirty') await h.f.makeDirty(repo);
    if (scenario.variant === 'blocked-git') {
      await rename(join(repo, '.git/index'), join(repo, '.git/index.original'));
      await promisify(execFile)('/usr/bin/mkfifo', [join(repo, '.git/index')]);
    }
    const before = await h.f.snapshotTree(repo);
    const paths = (await createPlatformPaths().resolveArchive(h.h.archive, 'read'))!;
    const seed = await openStorage({ path: paths.stateFile });
    const lifecycleId = randomUUID();
    let intent;
    try {
      const snapshot = (await seed.readSnapshot())!;
      const operations = createOperations(seed, paths.ownerUid);
      await operations.accept({ requestId: lifecycleId, action: 'start', canonicalStateDir: paths.directory,
        targetInstanceId: snapshot.instance?.instanceId ?? null });
      const ticket = await operations.issueLaunch(lifecycleId, randomUUID());
      intent = { ticketId: ticket.ticketId, instanceId: ticket.instanceId, generation: ticket.generation, canonicalStateDir: paths.directory };
    } finally { await seed.close(); }
    const sandbox = await createProcessSandbox(t);
    const file = join(h.h.directory, 'project-daemon-intent.json');
    await writeFile(file, JSON.stringify({ intent, point: scenario.point }), { mode: 0o600 });
    const actor = sandbox.spawnFixture('project-daemon-actor.js', [file]);
    const exit = new Promise<string | null>(resolve => actor.once('exit', (_code, signal) => resolve(signal)));
    const identity = createProcessIdentity(), probePids = new Set<number>();
    const cleanup = h.f.context.cleanup.bind(h.f.context);
    h.f.context.cleanup = async () => {
      for (const pid of probePids) {
        if (await identity.probeAbsent(pid) !== 'ABSENT') throw new Error('Uncertain owned probe exit; retaining fixture');
      }
      await cleanup();
    };
    let submitted: ReturnType<typeof h.client.runProject> | undefined;
    try {
      await sandbox.waitForMessage(actor, 'running', 5_000);
      const finalizeBootstrap = await openStorage({ path: paths.stateFile });
      try { await finalizeBootstrap.completeOperation(lifecycleId, 'SUCCEEDED', new Date().toISOString(), null); }
      finally { await finalizeBootstrap.close(); }
      const paused = sandbox.waitForMessage(actor, 'paused', 5_000);
      const requestId = randomUUID();
      submitted = h.client.runProject('register', { path: repo, name: 'Crash project' }, {
        stateDirectory: h.h.archive, requestId, timeoutMs: scenario.variant === 'client-deadline' ? 50 : 250,
      });
      await paused;
      const capture = await openStorage({ path: paths.stateFile, readonly: true });
      try {
        for (const resource of await capture.listResources(intent.instanceId)) {
          if (resource.releaseState !== 'RELEASED' && resource.pid !== null) probePids.add(resource.pid);
        }
        const operation = await capture.getProjectOperation(requestId);
        assert.equal(Boolean(operation), scenario.accepted);
        if (scenario.committed) assert.equal(operation?.outcome, 'SUCCEEDED');
        else if (scenario.accepted) assert.equal(operation?.outcome, 'IN_PROGRESS');
      } finally { await capture.close(); }
      actor.kill('SIGKILL'); assert.equal(await exit, 'SIGKILL');
      const deadline = performance.now() + 2_000;
      for (const pid of probePids) while (await identity.probeAbsent(pid) !== 'ABSENT') {
        assert.ok(performance.now() < deadline, 'owned probe must exit after main IPC EOF');
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      const observation = await submitted;
      assert.equal(observation.requestId, requestId);
      if (scenario.variant === 'client-deadline') assert.equal(observation.result, 'UNKNOWN_OUTCOME');
      const restarted = await h.h.call('start'); assert.equal(restarted.code, 0, restarted.stdout);
      const stored = await openStorage({ path: paths.stateFile, readonly: true });
      let original;
      let revision;
      try {
        original = await stored.getProjectOperation(requestId);
        revision = (await stored.readSnapshot())!.store.revision;
        assert.equal(original?.outcome ?? null, !scenario.accepted ? null : scenario.committed ? 'SUCCEEDED' : 'INTERRUPTED');
      } finally { await stored.close(); }
      const retry = await h.client.runProject('register', { path: repo, name: 'Crash project' }, { stateDirectory: h.h.archive, requestId });
      if (scenario.accepted) {
        const retained = decodeProjectOperationView(retry.data.operation);
        assert.deepEqual(retained.result, original!.result);
        const afterRetry = await openStorage({ path: paths.stateFile, readonly: true });
        try { assert.equal((await afterRetry.readSnapshot())!.store.revision, revision); }
        finally { await afterRetry.close(); }
      } else assert.equal(retry.outcome, 'SUCCEEDED');
      const direct = new Database(paths.stateFile, { readonly: true });
      let projects: number;
      try {
        projects = (direct.prepare('SELECT count(*) AS count FROM projects WHERE removed_at IS NULL').get() as { count: number }).count;
        assert.equal(projects, scenario.committed || !scenario.accepted ? 1 : 0);
      } finally { direct.close(); }
      assert.deepEqual(await h.f.snapshotTree(repo), before);
      samples.push({ point: scenario.point, variant: scenario.variant, requestId, faultReported: true, mainExitSignal: 'SIGKILL',
        accepted: scenario.accepted, originalOutcome: original?.outcome ?? null, originalResult: original?.result ?? null,
        retryOutcome: retry.outcome, confirmedProjects: projects, repositoryUnchanged: true, ownedProbeAbsenceVerified: true });
    } finally {
      if (actor.exitCode === null && actor.signalCode === null) actor.kill('SIGKILL');
      await exit;
      if (submitted) await submitted;
    }
  });
}
