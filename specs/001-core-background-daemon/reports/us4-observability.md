# US4 observability load / T080

Result: PASS for SC-002/SC-007 load; FR-016 remains NOT_RUN on a real second UID
and remote machine. This is not full US4 or release acceptance.

Compiled daemon, isolated archive, Node 26.13.0 on macOS arm64. Ten authenticated
observers receive 100 events/s in batches of ten every 100ms for 60,000.58ms.
Ten concurrent readers perform 100 status RPCs each across the same window.
No client holds a SQL reader or journal segment while waiting for delivery.

| Measurement | Observed | Target | Result |
|---|---:|---:|---|
| Generated events | 6,000 | 6,000 / 60s | PASS |
| Received per observer | 6,000, ordered | no omission | PASS |
| Event deliveries | 60,000 | 60,000 | PASS |
| Event p95, pooled | 170.98ms | <=1,000ms | PASS |
| Worst per-observer event p95 | 177.50ms | <=1,000ms | PASS |
| Maximum event latency | 498.85ms | reported, not excluded | PASS |
| Status reads | 1,000 | 1,000 | PASS |
| Status p95 | 88.32ms | <=500ms | PASS |
| Maximum status latency | 193.78ms | <=2,000ms or explicit error | PASS |
| Errors / timeout / omissions | 0 | 0 silent failures | PASS |

Latency starts before the durable storage call, using a monotonic clock in the
producer harness; callbacks measure delivery. Status is authenticated RPC, not
CLI process startup latency. Each observer's peak buffered bytes is checked against
1 MiB. Slow-client eviction and explicit replay gaps have independent E2/E3 reports.

All per-observer and status samples, subscription metrics and platform details are
in [us4-observability-samples.json](us4-observability-samples.json). Values above
describe the first focused campaign; reruns retain their timestamped raw samples
and are summarized by final acceptance. Targets are unchanged.