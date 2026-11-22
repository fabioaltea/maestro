# Foundation acceptance / T085

Updated: 2026-11-09. Overall result: BLOCKED, not full acceptance PASS.
Package 0.1.0, schema 2; Node 26.13.0, TypeScript 6.0.3,
better-sqlite3 13.0.3; macOS 26.3.1 arm64/APFS, Apple M3, 8 GiB RAM.

T082 remains NOT_RUN by user decision: no second UID or remote-machine runner.
Consolidation despite this missing runner was authorized, not a waiver of FR-016.
T085 also remains open: the complete IP-denied acceptance campaign failed, and
passing individual reruns without that sandbox are not a replacement PASS.

## Executions

| Execution | Result | Scope |
|---|---|---|
| Build/typecheck/lint in IP-denial sandbox | PASS | production and test compilation, import boundaries |
| Ordinary tests in IP-denial sandbox | PASS | unit, contract and integration |
| Separate contract suite in IP-denial sandbox | 33 PASS | zero failures/skips |
| Separate integration suite in IP-denial sandbox | 73 PASS | zero failures/skips |
| Complete acceptance suite in IP-denial sandbox | 35 PASS, 11 FAIL, 1 SKIP | failed campaign, retained as such |
| Recovery rerun without sandbox, 2026-11-09 | PASS, CLI exit 0 | 30 crash scenarios; raw samples have no anomalies |
| Benchmark rerun without sandbox, 2026-11-09 | PASS, CLI exit 0 | 600s, 121 samples; see performance report |
| Current typecheck/lint | PASS | no source changes since validated implementation |
| Current streaming/local-access rerun without sandbox | 2 PASS, 1 SKIP | slow observer evicted; owner permissions/no TCP pass; real UID skipped |

Sandbox profile: `(version 1) (allow default)` with outbound remote IP and inbound
local IP denied. A localhost TCP probe produced EPERM, and all three UDS protocol
tests passed under that profile. This establishes that IP denial was effective;
it does not establish that the profile permits every platform measurement tool.

## Failed campaign and subsequent checks

The failed acceptance campaign ran on 2026-11-08/09. Its summary counted 47 tests
including nested test containers: 35 pass, 11 fail and 1 skip. It exited 1.

- E2 streaming failed with DEADLINE_EXCEEDED in the storage worker. The current
  unsandboxed E2 rerun passes, including fast-client progress, slow-client eviction,
  <=1 MiB queues and concurrent status targets. The sandbox failure is not erased.
- Idle measurement failed to spawn ps with EPERM. It collected no samples and
  cannot be treated as an RSS/CPU result. The subsequent unsandboxed benchmark passes.
- Owner local-access teardown timed out. Its current unsandboxed rerun passes.
- Recovery subcases 1, 4, 11, 17, 23 and 30 failed with CLI/fault-message timeouts;
  their parent container failed too. The loaded recovery test also timed out.
  The user's subsequent recovery rerun passes with 1,000 confirmed records and ten
  auxiliaries, unchanged before/after digest, and no anomalies.

Some wall durations in the failed campaign were much larger than configured
deadlines. Scheduling/suspension and sandbox restrictions have not been fully
separated; no specific cause is claimed for all timeouts. Preserved archives must
not be removed or signalled by saved PID. No cleanup was requested or performed.
Successful reruns overwrite the normal latest-sample filenames; this section keeps
the failed campaign visible rather than silently excluding it from acceptance.

## Requirement evidence

PASS below describes the cited focused evidence, not a full release gate PASS.

| Criterion | Focused evidence / result | Remaining qualification |
|---|---|---|
| SC-001 | PASS: 30 start/restart/stop cycles, f2-control report and samples | timings are campaign-specific |
| SC-002 | PASS: 1,000 reads with ten observers, us4-observability samples | RPC latency, not CLI startup |
| SC-003 | PASS: 100 rounds x ten starts and 100 identical retries | BUSY responses retained; concurrency report |
| SC-004 | PASS rerun: 30 crash scenarios, 34 matrix process crashes | failed offline campaign retained above |
| SC-005 | PASS rerun: 1,000 records + ten auxiliaries in 1,060.16ms | target <=30,000ms; digest unchanged |
| SC-006 | PASS for ownership, uncertain PID and foreign-resource tests | real cross-UID gate NOT_RUN |
| SC-007 | PASS focused load, E2 streaming and E3 replay/gap | complete offline campaign not yet PASS |
| SC-008 | PASS for detach and 600s same-instance survival | full offline acceptance remains FAIL |
| SC-009 | PASS idle rerun, diagnostic budgets and observer bounds | sampled RSS; separate campaigns, not one run |
| SC-010 | PASS diagnostic catalog, CLI/protocol and deadline contracts | physical disk-full uses controlled faults |
| AR-001 | PASS architecture and OS contracts | verified macOS only |
| AR-002 | PASS Foundation policy separated from OS mechanisms | Agent Runtime excluded |
| AR-003 | PASS independent E1/E2/E3 evidence | offline failed campaign not waived |

Evidence: [performance.md](performance.md), [f2-recovery-samples.json](f2-recovery-samples.json),
[concurrency.md](concurrency.md), [us4-observability.md](us4-observability.md),
[diagnostics.md](diagnostics.md), [architecture.md](architecture.md),
[e1-events.md](e1-events.md), [e2-stream.md](e2-stream.md), [e3-replay.md](e3-replay.md),
[f2-control.md](f2-control.md), [local-access.md](local-access.md).

## Closure condition

T085 needs a successful complete applicable acceptance run with verified IP
isolation and a measurement method that supports the platform tools, or an
explicitly approved change to that verification requirement. A passing benchmark
alone does not close it. FR-016/T082 independently requires real runner evidence.
No thresholds, specification or Constitution were changed; no release is authorized.
## 2026-11-11 — feature 002 final revalidation

Available native regression: 367 ordinary, 101 separate contract and 207 separate
integration tests pass; complete combined native acceptance has 53 PASS, 0 FAIL,
1 SKIP for the still-unprovisioned real second UID. Both additional qualified idle
runs pass and the combined acceptance performs its own third idle observation.
These combined Foundation/registry runs are not a replacement for the IP-denied gate.

The effective outer IP-denial profile rejects nested sandbox_apply and ps with
EPERM. The new ordinary IP-denied attempt was interrupted after repeated platform
failures, retaining 58 PASS / 44 FAIL / 70 CANCELLED. Complete acceptance under that
profile remains unavailable. T082 and T085 remain unchecked/open; no waiver or
network/process-confinement fallback was introduced. Exact commands/raw outputs:
../../002-project-registry/reports/final-verification-runs.json and acceptance.md.
