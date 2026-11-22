# US4 — remove only the registration

2026-11-11. **US4 PASS**. US4 implements T071–T081 on the qualified local macOS/APFS profile.
`project remove PROJECT_ID --expected-revision REV` authorizes only removal of
that registration. No force/cleanup/path flags or repository resource authority
are accepted. The repository can be dirty, conflicted, absent or inaccessible;
REMOVE never inspects Git, deletes a file, cleans a worktree or restores a registration.

## State and retry guarantees

The core and SQL writer enforce the admitted project ID and expected configuration
revision. One transaction marks removedAt, increments configRevision/registryRevision,
records the immutable REMOVED result and enqueues its correlated event. The project
leaves active pages, while its identity, fixed reference, configuration, last dated
observation and historical operations remain stored. There is no cascade deletion.

Get distinguishes PROJECT_NOT_FOUND from PROJECT_REMOVED. The latter carries only
an allowlisted tombstone (projectId, configRevision, removedAt), including offline.
Controller credentials cannot reach private lookup/admission. Safe errors and
public DTOs expose no filesystem anchors, canonical intents or raw driver output.

Idempotency resolves the original intent before current project/revision checks.
An identical retry returns its original result without a second effect. A new import
allocates a different project UUID and configRevision 1; retrying the old removal
cannot remove that new project. A different intent with the old request ID is rejected.
Two removals on one revision confirm exactly one tombstone; the other reports the
already removed registration. Stale/unknown targets do not remove another project.

A verify that captured the old state cannot publish after removal. The writer checks
its original project ID and active tombstone, even when a new registration of the
same repository already exists. No result or observation can resurrect the old row.

## Four acceptance scenarios

| US4 scenario | Evidence |
|---|---|
| 1: remove identified registration, preserve Git/work | real dirty/conflicted/main/linked/absent integration snapshots and CLI acceptance |
| 2: response lost, identical retry retained | ten actual crash windows, pre-ACK client deadline and original CLI retry after reimport/restart |
| 3: stale revision/unknown ID, zero wrong effects | SQL/core policy, real integration failures and two-client removal race |
| 4: new UUID immune to old removal | contract, integration, concurrent reimport/retry and CLI acceptance |

## Validation evidence

- [Functional/read/recovery regression slice](us4-functional.txt): **10 PASS**.
- [SQL tombstone boundary](us4-storage.txt): **2 PASS**;
  [core/no-Git policy](us4-core.txt): **4 PASS**, including those SQL tests.
- [Closed tombstone codec](us4-tombstone-codec.txt): **1 PASS**.
- [Races/authentication](us4-races.txt): **4 PASS**. Two-client removal/reimport use
  actual daemon clients; authorization uses real local IPC. The verify/remove SQL
  race uses injected scheduling and typed repository evidence, not a claim of a
  real Git process being paused. Real source preservation is checked separately.
- [US4/recovery slice](us4-recovery.txt): **28 PASS**, 0 FAIL/CANCELLED/SKIP,
  including ten actual owned daemon SIGKILL cases and injected FULL/IO rollback.
- [Ten raw REMOVE crash samples](remove-crash-samples.json),
  [combined mutation summary](mutation-crash-summary.json) and [recovery](recovery.md):
  **30 actual mutation crashes PASS**, ten each REGISTER/UPDATE/REMOVE; VERIFY excluded.
- [CLI acceptance](us4-acceptance.txt): **1 PASS**, independent client processes,
  dirty/absent checkout, reimport, original retry, restart, correlated completion
  events and offline outcome/tombstone reads with zero archive/source writes.
  [Raw preservation samples](us4-preservation-samples.json).
- Build/build:test and [typecheck/architecture lint](us4-static-checks.txt): PASS.
  [Complete ordinary regression](us4-regression.txt): **348 PASS**,
  0 FAIL/CANCELLED/SKIP, exit 0; [command/exit/duration](us4-regression.json).

Precommit crash leaves the complete ACTIVE row; accepted intents recover INTERRUPTED
without automatic replay. Postcommit crash preserves the full tombstone, result and
one correlated completion. Injected FULL/IO after the tombstone SQL statement rolls
back every effect; those errors are controlled injection, not physical disk failure.
The pre-implementation red artifacts record expected missing behavior, not open defects.
Test durations are not SC-002/003 workload qualification; performance targets remain
separate from measured evidence.

## Remaining scope

All four user stories have their local checkpoints. E2 replay, E3 streaming, V1
backpressure/performance and final cross-artifact/acceptance/release review remain
T082–T096. This checkpoint does not automatically start them or publish anything.
Foundation 001/T082 real second UID/machine is NOT_RUN; 001/T085 complete IP-denied
acceptance remains OPEN. Release is still gated. Provider, Agent Runtime, worktree
management, project dependency execution and Electron remain outside scope.
