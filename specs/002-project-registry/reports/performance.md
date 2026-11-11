# V1 — pressure and measured resources

2026-11-11. Workload execution is separate from idle/benchmark and final acceptance.

The [32-pending/4-probe, blocked outbox and pinned WAL tests](project-backpressure.txt)
have 3 PASS. Request 33 is BUSY accepted=false with no ledger row; valid and failing
verifies share admission. Reads/status stay available and stop remains <=10 s.
Diagnostics expose only bounded counts/categories/queue waits, no path or intent.
[27 bounds/failure checks](v1-bounds.txt) qualify existing stdout/config limits,
bounded non-public stderr, owned process exit, outbox/WAL/journal saturation and
FULL/IO rollback for the three mutations. E3 separately qualifies the stalled-client
1 MiB bound. Native SQLITE_FULL allocation and injected IO cases are distinguished
in recovery.md; they are not all physical disk-failure experiments.

## Registry workload

[SC-002/003 output](project-performance.txt), [retained qualified samples](project-performance-qualified-samples.json).
The end-to-end reading samples include every page/status handshake, not just the
first page. Ten clients perform 1,000 complete inventories of 100 projects, including
while one reference is blocked on a FIFO. Full read results contain all 100 unique IDs.

The 30 inspection samples include duplicates REGISTER/VERIFY on a repository with
10 local branches/100 commits, an inaccessible reference, and one FIFO-blocked
reference. The last fails explicitly at the server deadline rather than inventing
success. An unavailable-reference observation can be successfully saved; this is
not a claim that Git availability was verified. All errors/timeouts stay in samples.

Measured on the pinned macOS/APFS/Node/Git profile:

| Metric | Measurement | Target |
|---|---:|---:|
| 1,000 complete reads, p95 | 76.14 ms | <=500 ms |
| Read max | 84.48 ms | <=2,000 ms |
| Read error rate | 0% | explicit errors retained |
| 30 inspections, p95 | 672.87 ms | <=5,000 ms |
| Inspection max, slow FIFO | 26,079.68 ms | <=30,000 ms |
| Inspection error rate | 1/30 (deadline) | errors included, not discarded |
| Status / stop | 82.88 / 272.71 ms | <=2,000 / <=10,000 ms |

Active RSS/cumulative CPU samples are in the same raw artifact. These are sampled
Node daemon resources including worker threads; auxiliary probe child CPU/RSS are
not claimed as part of that Node process sample. No active-load general guarantee
is inferred from a single host/run. Target statements remain targets elsewhere;
these values describe this measured run.

## Idle qualification

Two independent real 600-second observations are run sequentially, without active
workload tests or daemon clients during each interval: idle-resources.test and
bench:foundation. Their commands, exits/durations and resource samples are retained
in resource-runs.json, idle-samples.json and benchmark-samples.json. An unexecuted or
failed run must stay open; it cannot be replaced with the earlier Foundation sample.
The idle fixture has a fresh empty registry; it measures this compiled daemon and
worker runtime, not idle memory for an unbounded retained registry.

Both resource observations: **PASS**, each >=600 s, no anomalies.

| Run | Measured duration | Max sampled RSS | CPU of one core | Samples |
|---|---:|---:|---:|---:|
| idle | 600010.06 ms | 78.86 MiB | 0.003333% | 121 |
| benchmark | 600007.79 ms | 78.88 MiB | 0.003333% | 121 |

The V1 workload, bounded-pressure checks and both idle observations pass on this
qualified host. This does not close the distinct IP-denied/real-UID release gates.

The qualified workload samples are retained separately before final acceptance.
The full acceptance suite may regenerate project-performance-samples.json; its
command/outcome is recorded independently in final-verification-runs.json.
