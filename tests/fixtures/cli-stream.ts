import { runCli } from '../../src/cli/main.js';
process.on('message', (message: {type?: string}) => {
  if (message.type === 'maestro-test-shutdown') process.kill(process.pid, 'SIGINT');
});
process.exit(await runCli(['daemon', 'events', '--follow', '--state-dir', process.argv[2]!, '--json', ...(process.argv[3] ? ['--after', process.argv[3]] : [])]));
