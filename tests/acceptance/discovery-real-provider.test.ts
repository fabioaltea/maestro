import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
const optedIn = process.env.MAESTRO_DISCOVERY_REAL === '1' && process.env.MAESTRO_DISCOVERY_REAL_CONSENT === 'synthetic-scratch-readonly';
/** Separate opt-in only. Ordinary and acceptance invocations never authorize an
 * official login or inference merely by including this test file. */
test('SC-001 official-provider UI journey', { skip: !optedIn ? 'NOT_RUN: explicit opt-in absent' : !process.env.MAESTRO_DISCOVERY_REAL_BINARY || !process.env.MAESTRO_DISCOVERY_REAL_MODEL ? 'NOT_RUN: exact native binary/model absent' : false, timeout: 1_850_000 }, async t => {
  const result = await promisify(execFile)(process.execPath, [resolve('node_modules/@playwright/test/cli.js'), 'test', '-c', 'apps/desktop/playwright.config.ts', 'discovery-real-provider', '--reporter=json'], { timeout: 1_840_000, maxBuffer: 1024 * 1024, env: process.env }).then(value => value, (error: unknown) => { if (error && typeof error === 'object' && 'stdout' in error && typeof error.stdout === 'string') return { stdout: error.stdout }; throw new Error('BLOCKED: real-provider runner unavailable'); });
  const report = JSON.parse(result.stdout) as { stats: { expected: number; skipped: number; unexpected: number } };
  if (report.stats.skipped) { t.skip('NOT_RUN: official login/capability unavailable; inspect redacted provider status'); return; }
  assert.equal(report.stats.unexpected, 0, 'BLOCKED: real-provider qualification failed; consult redacted real-provider-status.json'); assert.equal(report.stats.expected, 1);
});
