# Concurrency acceptance / T081

Result: PASS, SC-003 Foundation. Node 26.13.0, macOS arm64, compiled CLI,
isolated local archive; workload run separately from the resource benchmark.

100 rounds of ten simultaneous start requests: 1,000 requests, exactly one claimed
launch ticket per round, consistent instanceId for each successful response and
ready=true afterwards. Each stop succeeds and the original PID is proven absent.
All 100 round instance IDs are distinct. No duplicate owner or spawn is observed.

One restart is followed by 100 identical retries in ten batches of ten. Every
response is either historical success or explicit BUSY while another controller
holds the lease. BUSY is included in the samples and operation lookup confirms
the original successful successor. The instance remains unchanged after each batch.

Two additional real fault scenarios reuse the established sandbox: a controller
lost after readiness is reconciled without a new successor; an issued launch ticket
is cancelled by stop and its delayed candidate exits without claiming or creating
an instance. No signal is sent to a PID read from storage.

The initial run completed 100 start rounds but failed a test expectation that every
simultaneous historical retry must immediately exit 0. It returned documented BUSY,
not a duplicate effect. The corrected test validates that historical lookup preserves
the successor; the complete rerun passes both tests. This intermediate failure is not
counted as an acceptance PASS or silently omitted.

Full final samples and BUSY codes:
[concurrency-samples.json](concurrency-samples.json).