import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, readFile, readdir, realpath, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createCodexInspection } from '../../src/platform/macos/discovery/provider-inspection.js';
import { CODEX_DISCOVERY_PIN } from '../../src/providers/codex/argv.js';
import { CODEX_DISCOVERY_QUALIFICATION } from '../../src/providers/codex/capabilities.js';
import { createTestContext } from '../fixtures/test-context.js';
import { PINNED_CODEX } from '../fixtures/discovery-boundary.js';
import type { ManagedResource } from '../../src/ports/storage.js';

test('explicit configuration provisions only a private non-secret installation UUID, idempotently', async t => {
  const f = await createTestContext(t), directory = await realpath(f.directory), authHome = join(directory, 'auth');
  const service = createCodexInspection({ authHome, runtimeRoot: directory, instanceId: randomUUID() });
  const first = await service.prepareAuthHome(); assert.ok(first.ok);
  assert.deepEqual(await readdir(authHome), ['installation_id']); const uuid = await readFile(join(authHome, 'installation_id'), 'utf8');
  assert.match(uuid, /^[a-f0-9-]{36}$/); assert.equal((await lstat(authHome)).mode & 0o077, 0); assert.equal((await lstat(join(authHome, 'installation_id'))).mode & 0o077, 0);
  assert.ok((await service.prepareAuthHome()).ok); assert.equal(await readFile(join(authHome, 'installation_id'), 'utf8'), uuid);
});
test('file credentials, symlink homes and shared permissions block without reading or replacing credentials', async t => {
  const f = await createTestContext(t), directory = await realpath(f.directory), authHome = join(directory, 'auth'); await mkdir(authHome, { mode: 0o700 });
  const service = createCodexInspection({ authHome, runtimeRoot: directory, instanceId: randomUUID() });
  await writeFile(join(authHome, 'auth.json'), 'SYNTHETIC_DO_NOT_READ', { mode: 0 });
  assert.deepEqual(await service.prepareAuthHome(), { ok: false, code: 'PROVIDER_UNSAFE' });
  assert.deepEqual(await readdir(authHome), ['auth.json']); assert.equal((await lstat(join(authHome, 'auth.json'))).mode & 0o777, 0);
  const linked = join(f.directory, 'linked'); await symlink(authHome, linked);
  assert.equal((await createCodexInspection({ authHome: linked, runtimeRoot: directory, instanceId: randomUUID() }).prepareAuthHome()).ok, false);
  const shared = join(f.directory, 'shared'); await mkdir(shared, { mode: 0o700 }); await chmod(shared, 0o755);
  assert.equal((await createCodexInspection({ authHome: shared, runtimeRoot: directory, instanceId: randomUUID() }).prepareAuthHome()).ok, false);
});
test('native login status is confined and normalized on a new synthetic auth identity, without inference',
  { skip: process.env.MAESTRO_DISCOVERY_G0 !== '1' || process.platform !== 'darwin' }, async t => {
    const f = await createTestContext(t), directory = await realpath(f.directory), authHome = join(directory, 'auth');
    await chmod(f.directory, 0o700);
    const resources: ManagedResource[] = [];
    const service = createCodexInspection({ authHome, runtimeRoot: directory, instanceId: randomUUID(), onResource: async r => { resources.push(r); } });
    assert.ok((await service.prepareAuthHome()).ok);
    const inspected = await service.inspectBinary(PINNED_CODEX); assert.ok(inspected.ok);
    const result = await service.checkLogin({ providerId: 'codex', revision: '1', binaryRealpath: PINNED_CODEX, binarySha256: CODEX_DISCOVERY_PIN.sha256,
      binaryVersion: CODEX_DISCOVERY_PIN.version, modelId: 'not-invoked', authProfileRef: authHome, policyVersion: CODEX_DISCOVERY_PIN.policyVersion,
      qualificationDigest: CODEX_DISCOVERY_QUALIFICATION.digest, configuredAt: new Date().toISOString() });
    assert.ok(result === 'AUTH_REQUIRED' || result === 'UNSAFE', 'missing credentials or inaccessible Keychain must block; neither is an available account');
    assert.deepEqual(await readdir(authHome), ['installation_id']);
    assert.equal(resources[0]?.policyScope, 'foundation'); assert.equal(resources.at(-1)?.releaseState, 'RELEASED');
    assert.equal(resources.at(-1)?.observation, 'ABSENT'); assert.equal(resources[0]?.pid, null);
  });
