# T030 — bounded registry coordinator

2026-11-10. **7 PASS**: five deterministic clock/storage policy cases, actual
SQLite worker integration, and BUSY/failure readonly catalog access. Typecheck,
build and architecture lint pass. [Output](project-coordinator-green.txt).
The recovery case from T029 remains RED until T031; no full npm test PASS is
claimed at this intermediate commit.

Admission is serialized independently of execution, reserves the original hash
before probing, and caps total pending work at 32/four active probes. Identical
retries consult the global reservation before capacity checks and never execute
again. Authentication precedes private lookup; core computes SHA-256 over the pure
canonical intent. No client session or transport abort owns the work.

The monotonic 28-second deadline includes queue/admission; probe budget is 26 seconds
from the same origin. Expired queued work never starts Git. Shutdown fences
synchronously, cancels owned probes and preserves BLOCKED on uncertain absence;
persistence uncertainty fences admission without inventing terminal outcomes.
These are deterministic policy measurements, not SC-003 end-to-end performance
qualification. Runtime wiring/recovery and public methods follow T031/T032.
