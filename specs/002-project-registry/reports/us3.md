# US3 — configuration revision and local base selection

2026-11-11. **US3 PASS**. US3 implements T060–T070 on the qualified local macOS/APFS profile.
`project update PROJECT_ID --expected-revision REV` accepts an atomic patch with
`--name`, `--base-branch` or `--clear-base-branch`. Base/clear flags are exclusive;
empty patches, missing revisions and additional authority are rejected.

## Resulting behavior

The immutable admitted intent binds project ID, exact configuration revision and
normalized patch. Core/storage both enforce the active project and revision.
Two clients on one revision confirm exactly one change; the other gets
REVISION_CONFLICT. Identical retry returns its original result before inspecting
current revision/repository, even after later updates. Changed intent with the
same request ID is rejected. Authentication precedes private lookup/admission.

Rename/clear never probe Git or touch repository paths. They work with the reference
missing or inaccessible. An explicit string base, including a no-op selection,
requires a fresh qualified local-branch proof against the fixed reference/identity.
Two observations plus final anchor checks reject deleted/moved refs or identity
changes during validation. No checkout, branch creation, project execution or
remote operation is performed. A complete patch succeeds together or changes nothing.

Actual changes increment configRevision and registryRevision once; no-op preserves
configuration, revisions and updatedAt. All terminal outcomes/events remain durable.
The configuration/result/outbox commit is one short SQL transaction, with no Git
inside it. An observation update alone does not consume configuration revision.

Existing observations are retained unchanged with their original observedConfigRevision,
completion date and LAST_KNOWN freshness. Changing configuration does not invent new
Git evidence: a configured base is projected UNVERIFIED until explicit verification;
a cleared base is UNCONFIGURED. Set-base uses proof for validation without publishing
an artificial observation. Valid base does not approve or establish readiness for
future agent/Git operations.

## Six acceptance scenarios

| US3 scenario | Evidence |
|---|---|
| 1: select local branch, preserve HEAD/index/files | integration local/dirty snapshots and CLI acceptance |
| 2: detached registration, absent versus explicit local base | integration detached checkout and explicit set-base; source unchanged |
| 3: missing/remote-only/unborn branch rejected atomically | integration invalid-base cases, unit proof validation and race deletion |
| 4: two clients, same revision | integration real clients and independent CLI processes: one success/one conflict |
| 5: externally deleted configured branch retained INVALID | integration explicit-first-base/delete/verify with unchanged config revision |
| 6: external first commit does not configure a base | integration unborn→first commit→verify→explicit selection; ID retained |

## Validation evidence

- [Functional API/CLI/Git slice](us3-functional.txt): **6 PASS**.
- [SQL boundary](us3-storage.txt): **2 PASS**;
  [core/no-Git policy](us3-core.txt): **5 PASS**, including those SQL tests.
- [Race qualification](us3-races.txt): **7 PASS**. Controlled races use real SQLite,
  Git and filesystem proofs with injected scheduling; the two-client CAS case uses
  the actual daemon/client transport. No positive result comes from a fake Git runner.
- [Story/recovery slice](us3-recovery.txt): **28 PASS**, 0 FAIL/CANCELLED/SKIP,
  including ten actual daemon SIGKILL cases.
- [Expanded crash/storage failure slice](us3-crash-failures.txt): **12 PASS**,
  including correlated completion events and injected FULL/IO rollback. These slices
  overlap and do not represent twenty distinct crashes.
- [Ten raw crash samples](update-crash-samples.json) and [recovery details](recovery.md):
  no partial name/base configuration or false success, original retries preserved.
  Precommit accepted intents become INTERRUPTED; committed results/events survive.
- [Independent CLI acceptance](us3-acceptance.txt): **1 PASS**, two clients, restart,
  original retry, denied repository access for rename/clear, complete Git snapshots
  and offline historical outcome without writes. [Samples](us3-preservation-samples.json).
- Build/build:test, [typecheck/architecture lint](us3-static-checks.txt): PASS.
  [Complete ordinary regression](us3-regression.txt): **320 PASS**,
  0 FAIL/CANCELLED/SKIP, exit 0; [command/exit/duration](us3-regression.json).

The earlier red test artifacts are expected pre-implementation evidence, not
unresolved failures. FULL/IO update errors are injected inside the real SQL transaction;
physical disk failures are not claimed. Measured test durations are not SC-002/003
performance workload qualification; those targets and combined idle remain T089–T091.

## Remaining scope

US4 registry-only removal and its ten crash cases remain open. SC-005 has ten
REGISTER plus ten UPDATE cases so far; VERIFY is additional evidence, not a substitute
for REMOVE. E2/E3/V1 and final acceptance still need their own checkpoints.
Foundation 001/T082 real second UID/machine remains NOT_RUN and 001/T085 complete
IP-denied acceptance remains OPEN. This story does not declare release readiness or
authorize publication. Provider, Agent Runtime, worktree management, dependency
execution and Electron remain outside scope.
