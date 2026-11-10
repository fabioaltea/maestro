# T034 — common registry foundation checkpoint

2026-11-10. **G1/S1/E1 common: PASS** on the qualified macOS/APFS/Node/Git profile.
`npm test`: **231 PASS, 0 FAIL/CANCELLED/SKIP**; build/typecheck/architecture lint
PASS. [Full output](foundation-regression.txt), [command/exit/duration](foundation-regression.json).
This is a common foundation checkpoint, not feature acceptance or a performance run.

The suite includes domain/canonical intent/revisions, global catalog collisions,
immutable outcomes, separate lifecycle/registry pending, authorization, exact error
codecs, probe bounds/deadlines, start/stop/recovery, native Git confinement, actual
upgrade pre/post commit crashes and E1 ledger/outbox/redaction. Reads remain usable
while the writer retries BUSY or after a classified mutation failure. No registry
mutation is exposed yet; only projects.operation.get is advertised.

Additional common scenarios verify no autostart/files on absent archives, known
schema 2 readonly reporting without upgrade, real control/daemon lease fencing of
explicit start, real authenticated client/controller separation and lexical path
normalization in the core even when CLI validation is bypassed.

## Readonly safety refinement

The first offline probe reproduced WAL/SHM creation by native SQLite despite
readonly. readonly_shm alone still created WAL in a deterministic writer-close
race. A transient Node reader now runs under a shipped macOS profile denying
persistent writes, fork/exec helpers and network. The same actual SQLite race,
Node/native writes and native C fork/spawn/network sentinels are qualified with
successful unsandboxed controls. No new persistent service, store or dependency.

Each readonly RPC opens/closes its own view. A proven quiescent main file without
sidecars may use immutable only while both existing native lease reservations are
held by its host. Reservations do not create or change lease data. An initial RO
lease descriptor was disproved as a real write-lock proof; the adapter now uses
an existing RW descriptor solely to acquire the native reservation. The confined
reader itself never opens state as writer. The host holds fences until the query
has closed or actual child exit is observed. Views are not cached across writes.

The controller bootstrap acknowledgment now precedes its client's ledger polling,
so the client's own observation cannot win its admission lease. Status attempts
verified live IPC before offline access: worker loss remains visible as VOLATILE
when an offline SQLite view cannot be opened. These paths retain the original
Foundation ownership and deadlines; no PID from persistence is terminated.

## Failures retained

The [initial full run](foundation-regression-initial-failure.txt) had 226 PASS/1 FAIL
and exposed a stale long-lived immutable view. The
[second full run](foundation-regression-volatile-failure.txt) had 230 PASS/1 FAIL
and exposed status attempting offline SQLite before the still-live VOLATILE daemon.
Both are retained with command/exit metadata, fixed by per-request views and live
observation first. No assertion, timeout or acceptance denominator was weakened.
The final full run above passes all 231 cases. Native confinement and the existing
14-point actual process crash matrix were also rerun independently while debugging.

## Limits and remaining gates

Successful project/configuration story commits, >=10 crash cases per REGISTER,
UPDATE and REMOVE, 20 equivalent imports/100 retries, E2/E3 registry workloads,
SC-002/003 and 600-second idle remain later tasks. Foundation 001/T082 and 001/T085
retain their open final acceptance status; this checkpoint does not close them.
