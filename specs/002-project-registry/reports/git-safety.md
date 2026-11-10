# Git inspection qualification — incremental evidence

Date: 2026-11-10. **G1 overall: PENDING**; no user-facing registry probe enabled.

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
