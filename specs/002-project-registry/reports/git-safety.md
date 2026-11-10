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
