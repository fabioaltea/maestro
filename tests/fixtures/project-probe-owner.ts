import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createPlatformPaths } from '../../src/platform/macos/paths.js';
import { createProbeSupervisor } from '../../src/platform/macos/git/probe-supervisor.js';
import { makeDeadline, systemClock } from '../../src/ports/clock.js';
import type { OwnedProbe, ProbeOwnership } from '../../src/ports/repository.js';

const [repository, archive] = process.argv.slice(2);
if (!repository || !archive) throw new Error('INVALID_FIXTURE');
const paths = (await createPlatformPaths().resolveArchive(archive, 'write'))!;
const own: ProbeOwnership = { resourceId: randomUUID(), generation: randomUUID(),
  owningInstanceId: randomUUID(), policyScope: 'foundation' };
let probe: OwnedProbe | undefined;
let starting: Promise<OwnedProbe> | undefined;
let workerPid: number | null = null;
let stopping = false;
async function stop() {
  stopping = true;
  if (starting && !probe) { try { probe = await starting; } catch { process.exit(1); } }
  if (probe) { await probe.cancel(); await probe.result; }
  process.exit(0);
}
process.on('message', (message: { type?: string }) => {
  if (message.type === 'maestro-test-shutdown') void stop();
});
process.once('disconnect', () => { void stop(); });
const supervisor = createProbeSupervisor({ paths, onResource: async resource => {
  if (resource.pid !== null) workerPid = resource.pid;
  await writeFile(join(archive, 'probe-resource.json'), JSON.stringify(resource), { mode: 0o600 });
} });
starting = supervisor.start({ kind: 'CANDIDATE', path: repository }, own,
  { deadline: makeDeadline(systemClock, 10_000) });
probe = await starting;
if (stopping) await stop();
process.send?.({ type: 'ready', workerPid, ownership: own });
void probe.result.then(result => { if (process.connected) process.send?.({ type: 'result', result }); });
