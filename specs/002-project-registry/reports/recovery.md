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

## T057 — VERIFY / US2 recovery

US2 fault slice: **14 PASS**, 0 FAIL/CANCELLED/SKIP in
[us2-recovery.txt](us2-recovery.txt); additional client/error contracts:
**8 PASS** in [us2-client-errors.txt](us2-client-errors.txt).
Six actual owned daemon SIGKILL cases: **6 PASS** in [us2-crash.txt](us2-crash.txt),
with [raw samples](verify-crash-samples.json). Accepted, probing and pre-commit
crashes retain the previous observation and become INTERRUPTED on restart. Committed,
pre-ACK and pre-drain crashes retain observation revision 2 and the original terminal
result on identical retry. Configuration, fixed reference and source snapshots survive.
These VERIFY cases do not replace the required REGISTER/UPDATE/REMOVE SC-005 campaigns.

Six concurrent FIFO-blocked verifies cover four active probes plus queued requests.
Status stays below its two-second budget; explicit stop completes below ten seconds,
all six requests become INTERRUPTED, and no new observation is published. Ownership
proof comes from captured handles/lifelines and observed exit, never a saved PID or
missing socket alone. Client timeout leaves an admitted verification running.

Terminating the actual production SQLite worker during a probe leaves the daemon
alive, fenced and VOLATILE, with WORKER_EXIT and its ownership lease held. No durable
success is invented; explicit process death/restart reconciles the request INTERRUPTED.
The test found and fixed a secondary error overwriting WORKER_EXIT. A second fix keeps
UNKNOWN_OUTCOME and the original requestId when polling an already admitted mutation
fails, instead of presenting that read failure as a rejected mutation.

Injected journal allocation failure after commit preserves the observation/result
and outbox, rejects a new admission with EVENT_BACKPRESSURE, then replays exactly one
completion after explicit drain recovery. The failure is injection, not physical disk
loss. Read-only native SQLite/confinement regressions pass, including writer-close
races, no WAL creation and no process spawn/write escape. Large whole-record pages
are additionally checked with 105 synthetic projects; this is a byte/count correctness
test, not the SC-002 performance workload.
