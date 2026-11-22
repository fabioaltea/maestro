import { randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { createClientBackend } from '../bootstrap.js';
import { LocalClient } from '../client/local-client.js';
import type { DiscoveryIntent } from '../domain/discovery/intent.js';
import { requireUuid } from '../domain/identifiers.js';
import { createCodexAccount, type CodexAccountStatus } from '../platform/macos/discovery/codex-account.js';
import { CODEX_DISCOVERY_PIN } from '../providers/codex/argv.js';
import { CODEX_DISCOVERY_QUALIFICATION } from '../providers/codex/capabilities.js';

const defaultModel = 'gpt-6.1-sol';

export async function setupDiscovery(
  account: CodexAccountStatus, stateDirectory: string, storeId: string, signal: AbortSignal,
  client: Pick<LocalClient, 'runDiscovery'> = new LocalClient(createClientBackend()),
): Promise<{ state: 'READY' | 'BLOCKED'; code: string | null }> {
  try {
    if (account.state !== 'CONNECTED' || !account.binary || account.version !== CODEX_DISCOVERY_PIN.version) {
      return { state: 'BLOCKED', code: account.state === 'AUTH_REQUIRED' ? 'PROVIDER_AUTH_REQUIRED' : 'PROVIDER_UNAVAILABLE' };
    }
    const binary = account.binary;
    async function call(method: string, params: Record<string, unknown> = {}, requestId?: string) {
      signal.throwIfAborted();
      const result = await client.runDiscovery(`discovery.${method}`, params, { stateDirectory, ...(requestId ? { requestId } : {}) });
      if (result.storeId !== storeId) throw new Error(result.error?.code ?? 'WRONG_STORE');
      if (result.result !== 'OK' || result.liveness !== 'LIVE_VERIFIED') throw new Error(result.error?.code ?? 'DAEMON_UNAVAILABLE');
      return result.data;
    }
    const data = await call('provider.get');
    let configuration = data.configuration as { revision: string } | null;
    if (configuration === null) {
      const ownerUid = process.getuid?.();
      if (ownerUid === undefined) throw new Error('UNSUPPORTED_PLATFORM');
      const providerProfileDigest = CODEX_DISCOVERY_QUALIFICATION.digest;
      const intent: DiscoveryIntent = { ownerUid, storeId, action: 'configure', targetId: storeId,
        configRevision: null, stateRevision: null, snapshotId: null, contextDigest: null,
        providerRevision: null, providerProfileDigest, modelId: defaultModel,
        payload: { binaryRealpath: binary, binarySha256: CODEX_DISCOVERY_PIN.sha256, binaryVersion: account.version,
          modelId: defaultModel, expectedProviderRevision: null, providerProfileDigest } };
      const grant = await call('prepare', { intent });
      await call('provider.configure', { grantId: requireUuid(grant.grantId), binaryRealpath: binary, modelId: defaultModel });
      configuration = (await call('provider.get')).configuration as { revision: string } | null;
    }
    if (!configuration || typeof configuration.revision !== 'string') throw new Error('PROVIDER_NOT_CONFIGURED');

    const requestId = randomUUID();
    await call('provider.check', { expectedProviderRevision: configuration.revision }, requestId);
    const expires = performance.now() + 7500;
    while (performance.now() < expires) {
      signal.throwIfAborted();
      const result = await client.runDiscovery('discovery.operation.get', { requestId }, { stateDirectory });
      if (result.storeId !== storeId) throw new Error(result.error?.code ?? 'WRONG_STORE');
      if (result.liveness !== 'LIVE_VERIFIED') throw new Error('DAEMON_UNAVAILABLE');
      if (result.outcome === 'SUCCEEDED') return { state: 'READY', code: null };
      if (result.outcome !== 'IN_PROGRESS') {
        const operation = result.data.operation as { error?: { code: string } } | undefined;
        throw new Error(operation?.error?.code ?? result.error?.code ?? 'PROVIDER_UNAVAILABLE');
      }
      await delay(150, undefined, { signal });
    }
    throw new Error('PROVIDER_UNAVAILABLE');
  } catch (error) {
    const code = error instanceof Error && /^[A-Z_]{1,64}$/.test(error.message) ? error.message : 'PROVIDER_UNAVAILABLE';
    return { state: 'BLOCKED', code };
  }
}

export async function runCodexCli(args: readonly string[]) {
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  process.on('disconnect', stop);
  if (process.send && !process.connected) stop();
  try {
    const { positionals, values } = parseArgs({ args: [...args], allowPositionals: true, options: {
      'state-dir': { type: 'string' }, 'store-id': { type: 'string' }, help: { type: 'boolean' },
    } });
    const [action] = positionals;
    if (values.help) {
      process.stdout.write('maestro codex status|login\nmaestro codex configure --state-dir ABSOLUTE_PATH --store-id UUID\n');
      return 0;
    }
    if (positionals.length !== 1) throw new Error('INVALID_REQUEST');
    const account = createCodexAccount();
    let result: CodexAccountStatus | Awaited<ReturnType<typeof setupDiscovery>>;
    if (action === 'configure' && values['state-dir'] && isAbsolute(values['state-dir'])) {
      const storeId = requireUuid(values['store-id']);
      result = await setupDiscovery(await account('status', controller.signal), values['state-dir'], storeId, controller.signal);
    } else if ((action === 'status' || action === 'login') && !values['state-dir'] && !values['store-id']) {
      result = await account(action, controller.signal);
    } else throw new Error('INVALID_REQUEST');
    await new Promise<void>((resolve, reject) => {
      process.stdout.write(JSON.stringify(result) + '\n', error => error ? reject(error) : resolve());
    });
    return 0;
  } catch {
    return 2;
  } finally {
    process.off('SIGTERM', stop);
    process.off('SIGINT', stop);
    process.off('disconnect', stop);
  }
}
