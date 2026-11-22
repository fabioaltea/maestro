import { fileURLToPath } from 'node:url';
import { createDaemonLauncher } from '../../src/platform/macos/launcher.js';
process.on('message', (message: {type?: string}) => {
  if (message.type === 'maestro-test-crash') process.exit(86);
  if (message.type === 'maestro-test-shutdown') process.exit(0);
});
const [directory, requestId] = process.argv.slice(2);
const controller = await createDaemonLauncher({ controllerFile: fileURLToPath(new URL('../../../dist/core/control-main.js', import.meta.url)) }).spawnController({ protocolVersion: 1, requestId: requestId!, action: 'restart', canonicalStateDir: directory! });
const accepted = await controller.bootstrap;
if (!accepted?.accepted) throw new Error('NOT_ACCEPTED');
process.send?.({ type: 'accepted' });
