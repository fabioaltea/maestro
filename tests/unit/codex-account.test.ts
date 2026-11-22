import assert from 'node:assert/strict';
import { lstat, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createCodexAccount } from '../../src/platform/macos/discovery/codex-account.js';

test('Codex status is passive and login invokes the official command once then confirms and reuses the session',
  { skip: process.platform !== 'darwin' }, async t => {
    const home = await realpath(await mkdtemp(join(tmpdir(), 'maestro-codex-account-')));
    t.after(() => rm(home, { recursive: true, force: true }));
    const binary = join(home, 'codex');
    const authHome = join(home, 'maestro-auth');
    await writeFile(binary, '', { mode: 0o700 });
    const commands: string[][] = [];
    let loggedIn = false;
    const account = createCodexAccount({ home, authHome, candidates: [binary], verify: async () => {},
      run: async (program, args, cwd, env, status) => {
        assert.equal(program, binary);
        assert.equal(cwd, '/private/var/empty');
        assert.equal(env.CODEX_HOME, authHome);
        assert.equal(env.OPENAI_API_KEY, undefined);
        assert.equal(env.CODEX_ACCESS_TOKEN, undefined);
        assert.ok(args.includes('cli_auth_credentials_store="keyring"'));
        assert.ok(args.includes('forced_login_method="chatgpt"'));
        commands.push(args.slice(0, status ? 3 : 2));
        if (!status) {
          loggedIn = true;
          return { code: 0, output: Buffer.from('Raw output never crosses the adapter') };
        }
        return loggedIn ? { code: 0, output: Buffer.from('Logged in using ChatGPT\n') }
          : { code: 1, output: Buffer.from('Not logged in\n') };
      } });
    const signal = new AbortController().signal;
    assert.equal((await account('status', signal)).state, 'AUTH_REQUIRED');
    await assert.rejects(lstat(authHome), { code: 'ENOENT' });
    assert.deepEqual(commands, []);
    assert.equal((await account('login', signal)).state, 'CONNECTED');
    assert.equal((await account('status', signal)).state, 'CONNECTED');
    assert.equal((await account('login', signal)).state, 'CONNECTED');
    assert.deepEqual(commands, [
      ['--no-daemon', 'login'], ['--no-daemon', 'login', 'status'], ['--no-daemon', 'login', 'status'], ['--no-daemon', 'login', 'status'],
    ]);

    await writeFile(join(authHome, 'auth.json'), '{}');
    assert.equal((await account('login', signal)).state, 'UNAVAILABLE');
    assert.equal(commands.length, 4);
  });

test('an unverified binary cannot run and a cancelled login must be checked again',
  { skip: process.platform !== 'darwin' }, async t => {
    const home = await realpath(await mkdtemp(join(tmpdir(), 'maestro-codex-cancel-')));
    t.after(() => rm(home, { recursive: true, force: true }));
    const binary = join(home, 'codex');
    await writeFile(binary, '');
    const signal = new AbortController().signal;
    const invalid = createCodexAccount({ home, candidates: [binary],
      verify: async () => { throw new Error('PROVIDER_UNSUPPORTED'); },
      run: async () => { assert.fail('unverified binary was invoked'); } });
    assert.equal((await invalid('login', signal)).state, 'INCOMPATIBLE_CLI');
    const controller = new AbortController();
    const cancelled = createCodexAccount({ home, authHome: join(home, 'maestro-auth'), candidates: [binary], verify: async () => {},
      run: async (_program, _args, _cwd, _env, status, childSignal) => {
        if (status) return { code: 1, output: Buffer.from('Not logged in') };
        controller.abort();
        childSignal.throwIfAborted();
        assert.fail('login must observe cancellation');
      } });
    assert.equal((await cancelled('login', controller.signal)).state, 'CANCELLED');
    assert.equal((await cancelled('status', signal)).state, 'AUTH_REQUIRED');
  });
