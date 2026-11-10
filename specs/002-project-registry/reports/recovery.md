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


## T045 — REGISTER recovery slice

**28 PASS**, 0 FAIL/CANCELLED/SKIP across registration contracts, unit policy,
real Git scenarios/core, ten actual SIGKILL cases and storage failures.
[Full slice](project-register-slice-green.txt); [raw crash samples](register-crash-samples.json).
The independent crash campaign also had [10 PASS](project-register-crash-green.txt).

Ten owned daemon SIGKILL samples cover before acceptance, accepted clean/dirty,
active probe (including real Git blocked on a FIFO), before commit clean/dirty,
committed, client deadline before final producer acknowledgment, and before journal
drain. Six accepted-but-uncommitted intents become INTERRUPTED without execution;
three committed results remain byte-equivalent on retry; the never-accepted request
can be explicitly admitted after restart. No confirmed project/result is lost and
source snapshots remain identical. Probe EOF/absence is observed without signaling
persisted PIDs. Client deadline uses the original requestId and never cancels work.

Inside-transaction crash cases use the same production SQLite adapter directly
behind the asynchronous storage port, so the owned daemon is killed with an actual
open transaction. Ordinary flows and worker-loss tests independently exercise the
production storage worker. This is not a synthetic mocked transaction failure.

A real SQLite max_page_count limit forces SQLITE_FULL on project overflow-page
allocation. IOERR_FSYNC is separately injected before commit. Both roll back
project/observation/terminal/event together and preserve the accepted intent as
pending when a terminal cannot be persisted. Driver detail is redacted. This does
not claim physical disk exhaustion or power-cut testing. UPDATE/REMOVE crash
campaigns remain future tasks, so total SC-005 feature acceptance is still open.
