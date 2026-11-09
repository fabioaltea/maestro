# Maestro Foundation

Local headless daemon, CLI, durable lifecycle operations, conservative recovery,
diagnostics and replayable events. Providers, Agent Runtime, Git/worktree management,
project dependency management and Electron are outside this Foundation.

Implementation is available; full acceptance is **blocked**, not certified. Real
second-UID/remote access is NOT_RUN (T082), and complete IP-isolated acceptance
must be resolved (T085). See [acceptance](specs/001-core-background-daemon/reports/acceptance.md).

## Requirements

Verified on macOS 26.3.1 arm64/APFS, Apple M3, Node 26.13.0; TypeScript 6.0.3 and
better-sqlite3 13.0.3 are pinned. Other platforms and schema migrations are not supported.

```sh
npm ci
npm run build
node dist/cli/main.js --help
```

## Run

Use a new archive for an isolated exercise. Keep its path to inspect or stop it later.

```sh
state_dir="/private/tmp/maestro-demo-$(uuidgen)"
node dist/cli/main.js daemon start --state-dir "$state_dir" --json
node dist/cli/main.js daemon status --state-dir "$state_dir" --json
node dist/cli/main.js daemon diagnostics --state-dir "$state_dir" --json
node dist/cli/main.js daemon events --state-dir "$state_dir" --limit 100 --json
node dist/cli/main.js daemon stop --state-dir "$state_dir" --json
```

Restart is one durable stop/start operation. Use `--request-id UUID` to retry the
same intent and `daemon operation UUID` to inspect its outcome; a retry must not
be a new effect. `events --follow` observes live events, `--after CURSOR` adds replay.
Closing the observer does not stop the daemon. Expired history reports an explicit gap.

Status, diagnostics and events can read stopped archives without starting the
daemon. An absent archive is not initialized by a read. Historical RUNNING is not
proof of liveness: inspect freshness, liveness, ready and pendingFinalization.
BUSY means control contention; BLOCKED requires the reported nextAction. Unknown
process identity never authorizes killing a saved PID. No force/reset is provided.

## Verify

```sh
npm run typecheck
npm run lint
npm test
npm run test:contract
npm run test:integration
npm run test:acceptance
npm run bench:foundation
```

Benchmark duration is at least ten minutes. Keep the machine awake and run resource
workloads separately. The latest idle run sampled 76.56 MiB maximum RSS including
workers and 0.00833% CPU of one core over 600s, below 150 MiB / 1% targets. These are
idle measurements, not guarantees under arbitrary load. Diagnostic budget targets
are 50 MiB plus 5 MiB temporary and <=1 MiB per observer; see checkpoint reports.

The acceptance suite skips the real second-UID test when its runner is unavailable;
exit 0 with that skip is not full FR-016 verification. A restrictive sandbox can
also prevent ps/lsof measurements; failures must remain explicit, not relabelled PASS.

Details: [quickstart](specs/001-core-background-daemon/quickstart.md),
[performance](specs/001-core-background-daemon/reports/performance.md),
[local-access runner](tests/fixtures/multi-user-runner.md),
[tasks](specs/001-core-background-daemon/tasks.md).