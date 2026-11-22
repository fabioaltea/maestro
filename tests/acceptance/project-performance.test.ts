import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chmod, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createProjectHarness } from '../fixtures/project-client.js';
import { LocalClient } from '../../src/client/local-client.js';
import { createClientBackend } from '../../src/bootstrap.js';

const execute = promisify(execFile);
type Sample = { durationMs: number; ok: boolean; code: string | null; pages?: number; action?: string };
const percentile = (values: number[], fraction: number) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1] ?? 0;
function cpuMs(value: string) { return value.split(':').reduce((total, part) => total * 60 + Number(part), 0) * 1000; }

test('V1 SC-002/003: 100 projects, 1000 full paginated reads/10 clients, 30 bounded inspections including inaccessible/slow reference', { timeout: 240_000 }, async t => {
  const a = await createProjectHarness(t), repos: string[] = [], ids: string[] = [], reads: Sample[] = [], inspections: Sample[] = [];
  const resources: { elapsedMs: number; rssBytes: number; cpuMs: number }[] = [], clock = performance.now(); let sampling: ReturnType<typeof setInterval> | undefined;
  let pending = Promise.resolve();
  try {
    for (let i = 0; i < 100; i++) { const repo = await a.f.createRepository(`performance-${i}`); repos.push(repo); ids.push((await a.register(repo)).projectId!); }
    for (let i = 1; i < 100; i++) await a.f.git(repos[0]!, ['commit', '--allow-empty', '-m', `fixture ${i}`]);
    for (let i = 1; i < 10; i++) await a.f.git(repos[0]!, ['branch', `fixture-${i}`]);
    const status = JSON.parse((await a.h.call('status')).stdout), pid = status.data.pid as number;
    const sampleResources = async () => {
      const output = (await execute('/bin/ps', ['-p', String(pid), '-o', 'rss=', '-o', 'time='])).stdout.trim().split(/\s+/);
      resources.push({ elapsedMs: performance.now() - clock, rssBytes: Number(output[0]) * 1024, cpuMs: cpuMs(output[1]!) });
    };
    await sampleResources(); sampling = setInterval(() => { pending = pending.then(sampleResources); }, 1000);
    const inspect = async (action: 'register' | 'verify', index: number, label: string = action) => {
      const start = performance.now();
      try {
        const result = await a.client.runProject(action, action === 'register' ? { path: repos[index] } : { projectId: ids[index] }, { stateDirectory: a.h.archive });
        inspections.push({ action: label, durationMs: performance.now() - start, ok: result.outcome === 'SUCCEEDED', code: result.error?.code ?? null });
      } catch (error) { inspections.push({ action: label, durationMs: performance.now() - start, ok: false, code: error instanceof Error ? error.message : 'unknown' }); }
    };
    await chmod(repos[98]!, 0);
    try { await inspect('verify', 98, 'verify-inaccessible'); } finally { await chmod(repos[98]!, 0o755); }
    await rename(join(repos[99]!, '.git/index'), join(repos[99]!, '.git/index.saved')); await execute('/usr/bin/mkfifo', [join(repos[99]!, '.git/index')]);
    const slow = inspect('verify', 99, 'verify-slow-FIFO');
    try {
      const actors = Array.from({ length: 10 }, () => new LocalClient(createClientBackend()));
      await Promise.all(actors.map(async actor => {
        for (let request = 0; request < 100; request++) {
          const start = performance.now(); let pages = 0;
          try {
            const found: string[] = []; let cursor: string | null = null;
            do {
              const result = await actor.runProject('list', { limit: 100, ...(cursor ? { cursor } : {}) }, { stateDirectory: a.h.archive });
              if (result.result !== 'OK') throw new Error(result.error?.code ?? result.result);
              const page = result.data as { projects: { projectId: string }[]; nextCursor: string | null };
              found.push(...page.projects.map(project => project.projectId)); cursor = page.nextCursor; pages++;
            } while (cursor);
            if (found.length !== 100 || new Set(found).size !== 100) throw new Error('INCOMPLETE_PAGE_COLLECTION');
            reads.push({ durationMs: performance.now() - start, ok: true, code: null, pages });
          } catch (error) { reads.push({ durationMs: performance.now() - start, ok: false, code: error instanceof Error ? error.message : 'unknown', pages }); }
        }
      }));
    } finally { await slow; }
    for (let i = 0; i < 28; i++) await inspect(i % 2 ? 'verify' : 'register', 0);
    const queryStart = performance.now(); assert.equal((await a.h.call('status')).code, 0); const statusMs = performance.now() - queryStart;
    clearInterval(sampling); sampling = undefined; await pending;
    const stopStart = performance.now(); assert.equal((await a.h.call('stop')).code, 0); const stopMs = performance.now() - stopStart;
    clearInterval(sampling); sampling = undefined; await pending;
    const readP95 = percentile(reads.map(sample => sample.durationMs), .95), inspectionP95 = percentile(inspections.map(sample => sample.durationMs), .95);
    await writeFile('specs/002-project-registry/reports/project-performance-samples.json', JSON.stringify({ measuredAt: new Date().toISOString(), node: process.versions.node,
      projects: ids.length, clients: 10, fullReadCount: reads.length, readP95Ms: readP95, readMaxMs: Math.max(...reads.map(sample => sample.durationMs)),
      readErrorRate: reads.filter(sample => !sample.ok).length / reads.length, inspectionCount: inspections.length, inspectionP95Ms: inspectionP95,
      inspectionMaxMs: Math.max(...inspections.map(sample => sample.durationMs)), inspectionErrorRate: inspections.filter(sample => !sample.ok).length / inspections.length,
      richRepository: { branches: 10, commits: 100 }, statusMs, stopMs, activeResources: resources, reads, inspections,
    }, null, 2) + '\n');
    assert.equal(reads.length, 1000); assert.equal(reads.filter(sample => !sample.ok).length, 0); assert.ok(readP95 <= 500, `read p95 ${readP95}`);
    assert.ok(reads.every(sample => sample.durationMs <= 2000)); assert.equal(inspections.length, 30); assert.ok(inspectionP95 <= 5000, `inspection p95 ${inspectionP95}`);
    assert.ok(inspections.every(sample => sample.durationMs <= 30_000)); assert.ok(statusMs <= 2000); assert.ok(stopMs <= 10_000);
  } finally { clearInterval(sampling); await pending; if (!reads.length) await writeFile('specs/002-project-registry/reports/project-performance-incomplete.json', JSON.stringify({ measuredAt: new Date().toISOString(), registered: ids.length, reads, inspections, resources }, null, 2)); }
});
