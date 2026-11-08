import { readFile } from 'node:fs/promises';
import { createLocalTransport } from '../../src/platform/macos/transport.js';

const [endpoint, identity, credentialFile, mode] = process.argv.slice(2);
if (!endpoint || !identity || !credentialFile) throw new Error('INVALID_FIXTURE');
const key = (await readFile(credentialFile, 'utf8')).trim();
let cooperative = mode === 'cooperative';
const server = await createLocalTransport().listen(endpoint, identity, new Map([[key, 'controller']]), async request => {
  const base = { protocolVersion: 1 as const, correlationId: request.correlationId };
  if (request.method === 'internal.readiness') return { ...base, result: 'OK', data: { identity, generation: '1', ready: true } };
  if (request.method === 'internal.prepareStop' && cooperative) {
    setTimeout(() => { void server.close().then(() => process.exit(0)); }, 20);
    return { ...base, result: 'OK', data: { preparingStop: true } };
  }
  return { ...base, result: 'BLOCKED', data: { code: 'BLOCKED' } };
});
process.on('message', (value: {type?: string}) => {
  if (value.type === 'cooperate') { cooperative = true; process.send?.({ type: 'cooperating' }); }
  if (value.type === 'maestro-test-shutdown') void server.close().then(() => process.exit(0));
});
process.send?.({ type: 'ready' });
