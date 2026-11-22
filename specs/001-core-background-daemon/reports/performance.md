# Foundation performance / T083

Result: PASS for idle CPU/RSS and ten minutes of client-free daemon survival.
This does not waive the separate real-UID acceptance gate.

`npm run bench:foundation` builds production and tests, then runs the idle test in
a separate process without inspector/watch. One test passed; no failures or skips.
The full acceptance suite also contains this test and keeps workloads sequential.

Reference machine: macOS 26.3.1 / Darwin 25.3.0, arm64, Apple M3, 8 logical CPUs,
8 GiB RAM, Node 26.13.0. Package 0.1.0, schema 2. The compiled daemon runs detached
on its own temporary local archive with no auxiliaries or open client connections.

| Metric | First focused campaign | Target | Result |
|---|---:|---:|---|
| Client-free sample interval | 600,001.75ms | 600,000ms | PASS |
| Process samples | 121, every 5s | reported | PASS |
| Maximum sampled RSS | 80,101,376 bytes / 76.39 MiB | <=150 MiB | PASS |
| Mean CPU, one core | 0.00667% | <=1% | PASS |
| Same instanceId/PID, ready afterwards | yes | yes | PASS |

RSS is `/bin/ps -p PID -o rss=` in KiB converted to bytes. Worker threads live
in this same PID, so they are included rather than measured as separate processes.
CPU uses the delta of ps cumulative user+system CPU time divided by measured
monotonic elapsed time, normalized to one core, not the number of logical CPUs.
No CLI or RPC is invoked between the first and last resource samples. The final
status confirms the original instance and readiness; teardown uses verified stop.

The 5s sampling interval cannot claim a continuous peak between samples. CPU time
has ps reporting precision, and this is an idle measurement, not loaded memory or
peak CPU certification. No other test workload ran during the focused benchmark.
The diagnostic disk quotas and observer queue limits retain their independent E1/E2
evidence; idle measurement does not imply they were remeasured here.

All resource samples, platform metadata and anomalies are in
[performance-samples.json](performance-samples.json). The table describes the first
focused campaign; subsequent suite reruns are timestamped in their raw samples.
No thresholds were relaxed or shortened to produce a PASS.

## Verified rerun, 2026-11-09

The user's `npm run bench:foundation` finished with exit 0. Samples measured at
2026-11-09T08:54:00.000Z confirm 121 samples over 600,015.81ms, maximum RSS
80,281,600 bytes (76.56 MiB), and mean CPU 0.00833% of one core. Anomalies are empty.
This rerun is without sandbox-exec and passes the unchanged idle targets.

The earlier whole-suite IP-denial sandbox run failed to spawn ps with EPERM:
zero samples, no CPU measurement, not a resource-limit failure or an idle PASS.
The current raw file contains the successful rerun, not that failed attempt.
The failed campaign remains documented in [acceptance.md](acceptance.md).