const application = await import(new URL('../../src/cli/main.js', import.meta.url).href);
const directory = process.argv[2];
if (!directory) throw new Error('Missing fixture archive');
const code: number = await application.runCli(['daemon', 'start', '--state-dir', directory, '--json']);
if (code !== 0) process.exit(code);
process.on('message', (message: unknown) => {
  if (!message || typeof message !== 'object' || !('type' in message)) return;
  if (message.type === 'maestro-test-crash') process.exit(86);
  if (message.type === 'maestro-test-shutdown') process.exit(0);
});
process.send!({ type: 'ready' });
