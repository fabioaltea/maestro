# Registry recovery — incremental evidence

2026-11-10. T031 common lifecycle integration: **16 PASS**, including registry
policy/recovery, existing daemon start/restart/stop/resource regressions and shared
stop-budget tests. [Output](project-recovery-green.txt). Build/typecheck/lint pass.

After Foundation resource reconciliation, startup finalizes abandoned registry
intents INTERRUPTED before RUNNING, retaining canonical intent/requestId and adding
operation.failed to the shared journal. It never executes the saved action. The
event names the current recovery instance as author, preserving the original
operation owner in the immutable ledger. A real daemon restart test verifies this
ordering, no probe resources and persistence across a second restart.

Stop fences registry admission synchronously before STOPPING. Owned cancellation,
resource bookkeeping, terminal ledger persistence and Foundation auxiliary drain
share the existing eight-second drain budget; no extra thirty-second wait is
added. Physical exit alone does not close storage before resource bookkeeping.
Uncertain ownership or storage leaves BLOCKED rather than a fictitious completion.
The new registry executor is not exposed to public mutation methods yet.

This common checkpoint is not SC-005: the required >=10 real crash samples for each
REGISTER/UPDATE/REMOVE remain future story tests. Actual upgrade SIGKILL evidence
is separate in registry-upgrade.md and is not counted as registry mutation crashes.
