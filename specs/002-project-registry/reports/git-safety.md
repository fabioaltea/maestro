# Git inspection qualification — incremental evidence

Date: 2026-11-10. **G1 overall: PASS (qualified local platform/profile)**; no user-facing registry probe enabled.

## T010 runner

Six contracts GREEN after T007 RED: [initial RED](git-runner-red.txt),
[current GREEN](git-runner-green.txt). Compiled profile is copied beside both
production and test modules; location is independent of the working directory.
Typecheck, architecture lint and production/test builds pass.

Actual executable is the root-owned Xcode Git selected via trusted xcrun outside
repositories, version 2.50.1 (Apple Git-155). Executable identity is pinned and
rechecked. No shell/PATH dispatch, inherited Git/loader/askpass/config settings,
raw stderr result, unbounded output, partial-success truncation or unconfined fallback.

Profile denies default: no fork, network or persistent write. It permits only the
pinned initial executable, system/runtime/repository reads and the nonpersistent
/dev/null sink. Initial qualification exposed Git's need to read the root directory;
adding that directory read resolved startup failure without adding write/network/fork.

This checkpoint proves bounded normal invocation, environment isolation and fail-closed
capability behavior. Malicious helper/config races, actual fork/network/write denial,
full inspector semantics and supervisor recovery remain mandatory in T011–T016.

## T011 probe supervisor

Five contracts GREEN: authenticated cooperative cancellation within 1.5 s,
lifeline EOF, independent deadline, uncertain identity blocked and invalid/expired
ownership refused. Durable resource intent precedes launch; scoped records contain
nonce/generation and are released only after observed exit and owned cleanup.
No saved PID is used for termination. An unexpected executing supervisor exit
without a result remains BLOCKED with unknown descendant state.

Debugging exposed a Node IPC lifecycle race: after parent disconnect, exit was
observed but close could be omitted. Result acknowledgement now precedes worker
exit, and exit/close finalization is idempotent. Five GREEN tests include this
failed-start path; [output](probe-supervisor-green.txt).
The full real Git worker will be qualified with the inspector in T013–T016.

## T012 filesystem evidence

Four contracts GREEN: canonical paths preserve spaces/Unicode/newlines, symlink
aliases share evidence, common repository differs from per-checkout roots/admin
directories, and replacement/move does not rebind. Device/inode/birthtime are decimal
strings with full precision; missing/unreadable/wrong-kind paths return safe errors.
The adapter rejects non-Darwin and filesystem types different from the qualified
APFS system volume. [Output](repository-identity-green.txt).

## T013 confinement integration

Four integration cases GREEN, including native syscall sentinels under the exact
shipped profile. A tiny trusted C fixture, compiled only for qualification with
the already installed Xcode clang, confirms writes, fork, posix_spawn of the same
allowed executable and TCP connect succeed as positive controls outside the sandbox
(exit 10) and return real EPERM/EACCES inside it (exit 0). The denied network attempt
makes no connection. This C probe is not a runtime dependency or user-project build.

Git integration confirms configured filters/fsmonitor/hooks/alias/pager/diff helpers
never execute, index/ref/config/object/content snapshots remain identical, config
replacement races do not execute helpers and inherited GIT_DIR cannot redirect the
query. Missing promisor commit objects do not trigger lazy fetch or remote helpers.
A first test used different-size dirty content, which Git can identify without
calling a clean filter; equal-size different content now proves the filter path is
actually exercised. No safety assertion was weakened.

`npm test`: **147 PASS, 0 FAIL, 0 CANCELLED, 0 SKIP**, including all Foundation ordinary
regressions and the new contracts/integration. [Captured output](g1-regression.txt).
Full G1 remains pending inspector semantics and real owner-crash qualification in
T014–T016; no final acceptance gate or performance target is declared passed.

## T015 repository inspector

17 inspector contracts GREEN plus 6 runner and 6 supervisor contracts: **29 PASS**,
0 FAIL/CANCELLED/SKIP; [output](repository-inspector-green.txt). Build/typecheck/lint
pass. Cases include empty/unborn and later first commit, unborn HEAD with other
history, detached, explicit/omitted/removed base, dirty/untracked/conflicts,
main/linked/bare-common/submodule/nested/clone/alias, SHA-256, unavailable/replaced
reference, changed branch/history, missing objects, unavailable Git and invalid
Unicode paths. FIFO metadata is rejected before a blocking open.

Config reads and all subprocess output have cumulative limits. Common/root/admin
anchors, config fingerprints, index metadata and observed HEAD/base/history are
rechecked. Unsafe filters preserve verified metadata but expose UNKNOWN file status,
never a false clean result or automatic base selection. This remains interval
evidence, not an atomic snapshot or authorization for future Git operations.

The full worker now uses the real inspector. IPC size checks count UTF-8 bytes.
Cancellation proves native process exit independently of delayed durable resource
bookkeeping; publication still waits for that bookkeeping. A delayed-write contract
proves the cancellation budget without falsely claiming persistence completion.
G1 remains pending the real owned-parent crash/timeout checkpoint T016.


## T016 real owner crash and complete checkpoint

`npm test`: **169 PASS, 0 FAIL, 0 CANCELLED, 0 SKIP**. Full captured output:
[g1-complete-regression.txt](g1-complete-regression.txt); command, exit code and
wall-clock duration: [g1-complete-regression.json](g1-complete-regression.json).
Typecheck and architecture lint also pass. Qualification uses the platform and
Git version recorded above; other OS/Git combinations remain unsupported.

Four real lifecycle cases prove normal result publication follows worker exit and
resource release; a Git process blocked reading a fixture FIFO terminates on its
own deadline; killing only the owned parent handle causes IPC EOF and observed
worker/Git exit; oversized configuration and metadata/config/topology races fail
safely. Exit observation never sends signals to persisted PIDs. Owned sandbox
cleanup waits for verified process absence. Repository snapshots stay unchanged.

A configuration include can itself point to a FIFO. Preflight now reads config
with discovery disabled (cwd outside the checkout) and rejects includes before
other Git queries. Filter configurations retain partial metadata with UNKNOWN
file status. This avoids unbounded included reads rather than relying on a
nonexistent global Git no-includes switch.

G1 qualifies the confinement and owned-process primitives, not daemon-integrated
registry recovery, the full feature performance targets or Foundation final
acceptance. No user-facing registry methods are enabled yet. Schema/ledger,
S1/E1 and story-level recovery remain subsequent checkpoints. Foundation
001/T082 and 001/T085 remain final acceptance gates with their recorded open status.
