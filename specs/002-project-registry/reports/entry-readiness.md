# Entry readiness — 002 Project Registry

Date: 2026-11-10, Europe/Rome. Implementation requested by the user.
Current decision after approved revision: **P0 LOCAL BASELINE PENDING**.
User approved local development without the external runner; no final gate is waived.
The earlier BLOCKED audit below is retained as history and superseded for ordering only.

## T001 — Inventory and branch alignment

Result: **PASS**. Initial checkout: `001-core-background-daemon-implementation`.
Foundation baseline: `e84e58783923521f2ad43e1bcdde000c0002c5bc`.
Feature branch: `002-project-registry`; previous tip:
`1989859a8cf6bd6958ac07d9cb4d258b15bb7d49`.

Before changing refs, verified that the previous feature tip was an ancestor of
baseline and that no worktree had the feature branch checked out. Advanced only
that branch ref with compare-and-swap and switched to its identical baseline tree.
No history was rewritten, no merge commit created and the Foundation branch was
not moved. No stash, reset, deletion, remote operation or cleanup was performed.

Pre-existing work preserved:

- `.specify/feature.json`: feature selector already changed to 002.
- `AGENTS.md`: existing planning/context additions for 002.
- Entire previously untracked `specs/002-project-registry/`: spec, checklist,
  plan, research, model, contracts, quickstart and tasks.

SHA-256 of all 13 pre-existing input files compared equal before and after the
branch switch. The preparation commit records these design inputs together with
this inventory and the T001 checkbox. No runtime source/test/package files changed.
The manually maintained AGENTS block remains byte-for-byte identical to baseline.

## Checks performed

- Prerequisites script found the intended 002 feature and all design documents/tasks.
- requirements.md checklist: 16 total, 16 complete, 0 incomplete; documentary PASS.
- Existing ignore rules cover Node outputs, dependencies, env/log files and local
  Maestro/SQLite/socket state. No publishing configuration is needed for a private package.
- Node `v26.13.0`, npm `11.20.0`, Git `2.50.1 (Apple Git-155)`.
- macOS `26.3.1 (a)`, build `25D771280a`, arm64.
- No application tests or acceptance benchmarks have been rerun during T001;
  this task changes documentation/branch preparation only.

## Remaining entry gates

| Task / prerequisite | State | Evidence |
|---|---|---|
| 002/T002 → 001/T082 / FR-016 | NOT_RUN, evidence unavailable in baseline | [local-access](../../001-core-background-daemon/reports/local-access.md) |
| 002/T003 → 001/T085 | FAIL / OPEN; 35 PASS, 11 FAIL, 1 SKIP | [acceptance](../../001-core-background-daemon/reports/acceptance.md) |
| 002/T004 entry verdict | BLOCKED by required predecessors | [plan](../plan.md#foundation-readiness-e-criteri-di-ingresso) |

The task list requires stopping at an unavailable sequential prerequisite. Neither
user authorization to begin implementation nor the documentary checklist PASS
changes these verification requirements. Historical Foundation focused passes
are not new acceptance evidence. No automatic account creation, permission changes,
credential copying or simulated cross-user/remote-machine PASS is permitted.

## T002 — Availability audit

Result: **BLOCKED / NOT_RUN**, task remains unchecked. Current process UID is 501.
Both MAESTRO_LOCAL_ACCESS_ARCHIVE and MAESTRO_LOCAL_ACCESS_ENDPOINT are absent;
only their presence was checked, no capability or secret was printed. The existing
Foundation report records the user's confirmation that no preconfigured second
UID or separate machine is available. No new real-run artifacts were provided.

Read `tests/acceptance/local-access.test.ts`: without both inputs the distinct-UID
case explicitly skips; with an archive owned by UID 501 it rejects the run as not
a real second user. Running that test in this owner session cannot close FR-016.
No redundant skipped run was presented as new evidence, no account was created
and no connection to another machine or privilege escalation was attempted.

Per `tasks.md` entry gate and sequential dependencies, T003/T004 and code tasks
T005 onward are not started. The implementation skill also requires halting when
a sequential prerequisite cannot be completed. This stop does not waive 001/T082,
001/T085, G1 or any acceptance criterion.

To resume T002, provide a runner already provisioned with a distinct user and a
separate machine, and retain the genuine outputs described in
`tests/fixtures/multi-user-runner.md`. A deliberate change to entry-gate ordering
would instead require an explicit revision of the plan/tasks; it is not inferred
from the request to begin implementation.

Documentation validation: local links resolve and the manual AGENTS block matches
baseline. Staged diff checking accepts intentional Markdown two-space hard breaks
using `core.whitespace=-blank-at-eol`; no runtime tests were claimed or run.

## T002 — Approved sequencing revision, 2026-11-10

Result: **PASS (documentation/sequencing only)**. The user approved moving the
real cross-UID/separate-machine verification to final acceptance, allowing local
implementation and tests to proceed. P0 now requires aligned branch and a passing
local build/typecheck/lint/ordinary-suite baseline. The complete IP-denied acceptance
also remains a final gate; its historical FAIL is not converted to PASS.

Updated plan/tasks/research/quickstart and generated agent context consistently.
001/T082 remains NOT_RUN; 001/T085 remains FAIL/OPEN. No Foundation report or
requirement was altered, no account/permissions/credentials were created or changed.
G1 confinement remains mandatory before user-facing Git inspection. T093/T096
must refuse final readiness if real required evidence is still absent.
