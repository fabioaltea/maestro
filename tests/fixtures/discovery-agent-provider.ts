import { appendFileSync } from 'node:fs';
const mode = process.argv[2]!, marker = process.argv[3]!, lifetime = Number(process.argv[4] ?? 10000);
process.on('SIGTERM', () => { appendFileSync(marker, 'provider-term\n'); if (mode !== 'ignore-term') process.exit(0); });
appendFileSync(marker, 'provider-started\n', { mode: 0o600 });
process.stdout.write(JSON.stringify({ type: 'fixture.started' }) + '\n');
process.stdin.resume();
process.on('message', value => { if ((value as { type?: string }).type === 'maestro-test-shutdown') process.exit(0); });
setTimeout(() => { appendFileSync(marker, 'provider-finished\n'); process.exit(0); }, lifetime);
