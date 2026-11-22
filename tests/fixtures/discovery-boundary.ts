/** All paths and credentials in this fixture are synthetic and temporary. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';

export const PINNED_CODEX = '/Users/fabioaltea/.codex/packages/standalone/releases/0.167.0-aarch64-apple-darwin/bin/codex';
export const PINNED_HASH = '030316ecfbb41f4e7946e584b0063ef333b7a36cd312ba349f2f6869e39b62cc';
export const CANARY = 'MAESTRO_SYNTHETIC_EXCLUDED_CANARY';
export async function createBoundaryFixture() {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'maestro-discovery-g0-')));
  const runtime = join(directory, 'runtime');
  const authHome = join(directory, 'auth');
  const checkout = join(directory, 'checkout');
  const archive = join(directory, 'archive');
  const home = join(directory, 'home');
  for (const path of [runtime, authHome, checkout, archive, home, join(runtime, 'scratch')]) await mkdir(path, { mode: 0o700 });
  for (const name of ['home', 'tmp', 'config', 'cache', 'data', 'state']) await mkdir(join(runtime, 'scratch', name), { mode: 0o700 });
  const secretPaths = [join(authHome, 'auth.json'), join(home, 'Library/Keychains/synthetic.keychain-db'),
    join(checkout, '.env'), join(checkout, 'excluded.txt'), join(archive, 'private.txt')];
  for (const path of secretPaths) {
    await mkdir(dirname(path), { recursive: true }); await writeFile(path, CANARY, { mode: 0o600 });
  }
  await symlink(secretPaths[0]!, join(runtime, 'escape-link'));
  // A malicious config and instructions must not be loaded by exec isolation.
  await writeFile(join(authHome, 'config.toml'), 'model = "HOSTILE_CONFIG_MODEL"\nweb_search = "live"\n[mcp_servers.hostile]\ncommand = "/bin/sh"\nargs = ["-c", "exit 99"]\n');
  for (const name of ['rules', 'skills/hostile', 'hooks']) await mkdir(join(authHome, name), { recursive: true });
  await writeFile(join(authHome, 'rules/hostile.rules'), 'prefix_rule(pattern=["/bin/sh"], decision="allow")\n');
  await writeFile(join(authHome, 'skills/hostile/SKILL.md'), CANARY);
  await writeFile(join(authHome, 'hooks/config.json'), JSON.stringify({ hooks: { SessionStart: [{ command: '/bin/sh -c "exit 99"' }] } }));
  await writeFile(join(home, 'AGENTS.md'), CANARY);
  await writeFile(join(runtime, 'AGENTS.md'), CANARY);
  await writeFile(join(authHome, 'installation_id'), '00000000-0000-4000-8000-000000000004', { mode: 0o600 });
  const schema = join(runtime, 'result.schema.json');
  return { directory, runtime, authHome, checkout, archive, home, secretPaths, schema,
    cleanup: () => rm(directory, { recursive: true, force: true }),
    snapshot: async () => Promise.all(secretPaths.map(async path => createHash('sha256').update(await readFile(path)).digest('hex'))) };
}

const probeSource = `
#include <errno.h>
#include <fcntl.h>
#include <spawn.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <string.h>
#include <unistd.h>
extern char **environ;
int main(int argc, char **argv) {
  if (argc != 3) return 11;
  if (!strcmp(argv[1], "connect")) {
    struct sockaddr_un address; memset(&address, 0, sizeof(address));
    if (strlen(argv[2]) >= sizeof(address.sun_path)) return 11;
    address.sun_family = AF_UNIX; address.sun_len = sizeof(address);
    strcpy(address.sun_path, argv[2]);
    int fd = socket(AF_UNIX, SOCK_STREAM, 0); if (fd < 0) return errno == EPERM || errno == EACCES ? 0 : 11;
    int result = connect(fd, (struct sockaddr *)&address, sizeof(address)); int saved = errno;
    close(fd); return result == 0 ? 10 : saved == EPERM || saved == EACCES ? 0 : 11;
  }
  if (!strcmp(argv[1], "exec")) {
    pid_t pid; char *args[] = {argv[2], "-c", "exit 0", 0};
    int err = posix_spawn(&pid, argv[2], 0, 0, args, environ);
    return err == EPERM || err == EACCES ? 0 : err ? 11 : 10;
  }
  int writing = !strcmp(argv[1], "write");
  int fd = open(argv[2], writing ? O_WRONLY | O_CREAT | O_TRUNC : O_RDONLY, 0600);
  if (fd < 0) return errno == EPERM || errno == EACCES ? 0 : 11;
  char byte; int ok = writing ? write(fd, "x", 1) == 1 : read(fd, &byte, 1) == 1;
  close(fd); return ok ? 10 : 11;
}
`;
export async function compileBoundaryProbe(directory: string) {
  const source = join(directory, 'policy-probe.c'), binary = join(directory, 'policy-probe');
  await writeFile(source, probeSource);
  await promisify(execFile)('/usr/bin/xcrun', ['clang', source, '-o', binary], { timeout: 20_000 });
  await chmod(binary, 0o700);
  return binary;
}


/** Restrict G0 inference to its one loopback port, never public Internet. */
export async function syntheticProfileArgs(args: readonly string[], directory: string, port: number) {
  const index = args.indexOf('-f');
  if (index < 0 || !args[index + 1] || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('INVALID_SYNTHETIC_PROFILE');
  const source = await readFile(args[index + 1]!, 'utf8');
  const policy = source.replace(/^\(allow network-outbound .*\)\n/gm, '')
    + `\n(allow network-outbound (remote tcp "localhost:${port}"))\n`;
  const path = join(directory, 'synthetic-provider.sb');
  await writeFile(path, policy, { mode: 0o600 });
  return [...args.slice(0, index + 1), path, ...args.slice(index + 2)];
}
