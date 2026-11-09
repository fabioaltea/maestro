# Release readiness / T087

Review completed: 2026-11-09. Decision: **BLOCKED / NOT RELEASE READY**.
Closing this review task does not declare feature 001 complete or waive any gate.

## Required gates

| Gate | State | Required action |
|---|---|---|
| T082 / FR-016 real second UID and remote access | NOT_RUN | real runner evidence; owner-session checks and mocks do not substitute |
| T085 complete acceptance with IP networking denied | FAIL / OPEN | resolve failed offline campaign and obtain a successful applicable full run |
| T083 idle resources | PASS | verified latest benchmark, unchanged targets |
| T086 usable documentation | COMPLETE | commands, platform, measured limits and remaining gates documented |
| T087 review | COMPLETE, decision BLOCKED | reopen readiness after remaining gates are satisfied |

The user accepted recording T082 as NOT_RUN and authorized consolidation despite
that absence. This is not authorization to call FR-016 verified or publish a release.
The later successful benchmark does not change the result of the full offline suite.

## Evidence checked

- Latest benchmark: exit 0, measured 2026-11-09T08:54:00.000Z, 121 samples,
  600,015.81ms, max RSS 80,281,600 bytes including workers, mean CPU 0.00833%
  of one core, no anomalies. Targets remain 150 MiB / 1% / ten minutes.
- Recovery rerun: 30 scenarios, 1,000 confirmed records, ten auxiliaries,
  1,060.16ms loaded recovery and equal before/after digest. Anomalies empty.
- Current E2 rerun: fast observer ordered through highWater, slow observer evicted
  with SLOW_CONSUMER, peak observed buffers 49,931/89,504 bytes, status p95 216.14ms.
- Current owner local-access checks pass; the real second-UID case explicitly skips.
- Current typecheck and architecture lint pass. Earlier ordinary, contract and
  integration executions under IP denial pass; all 11 failures and the skip of
  the complete acceptance campaign remain recorded in acceptance.md.
- Structured verification parsed all ten sample JSON files and asserted benchmark,
  recovery digest and stream bounds. Documentation check resolved 17 local links,
  compared AGENTS manual additions byte-for-byte, and ran CLI help/version (0.1.0).

## Diff and scope review

The closing work adds evidence and documentation; no lifecycle, SQL schema,
process-termination policy, thresholds or runtime dependency was changed here.
The earlier T079 change adds explicit enumerated categories to SafeError, with a
verified RED/GREEN regression test. This is additive error metadata, not a schema
migration or permission expansion. Raw samples are regenerated test output;
historical summaries describe their own campaigns rather than pretending to be
the latest whole-suite result.

T085 consolidation is commit 3c003cc; T086 documentation is commit 1fccff8.
Commits are local on 001-core-background-daemon-implementation, as explicitly
requested after the workspace was found on 002-project-registry. Only selected
Foundation files are committed. The user's uncommitted .specify/feature.json
selection of 002 and untracked specs/002-project-registry are intentionally
preserved and excluded; no restore, stash, deletion or cleanup is performed.

No provider, Agent Runtime, worktree manager, project dependency manager, Electron,
remote listener or automatic account creation is introduced. No push, merge,
release or deployment is performed or authorized by this review. A saved PID or
failed sandbox teardown never becomes authorization to terminate a process.

## Coverage and residual risk

[acceptance.md](acceptance.md) maps SC-001 through SC-010 and AR-001 through AR-003
to the focused reports, retaining failed and unavailable evidence. Implementation
and focused tests are not a replacement for the two required gates above.
The causes of all long timeout samples have not been established; the observed
ps spawn EPERM explains the failed idle measurement only, not every failure.
New focused passes cannot retrospectively turn that campaign into PASS.

Readiness can be reconsidered only after T085 is satisfied and FR-016 is verified,
or the responsible owner explicitly approves a change to the verification/scope
requirements through the project's specification governance. No such waiver is
recorded here. Until then: 85 tasks completed, T082 and T085 open; no declaration
of full Foundation acceptance.