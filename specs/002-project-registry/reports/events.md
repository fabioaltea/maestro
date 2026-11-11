# Registry events — incremental qualification

2026-11-10. **E1 ledger checkpoint: PASS**, T027 RED → T028 GREEN.
Scope/projectId/revisions/action/effect are explicitly allowlisted in the existing
redactor. All registry drafts require an explicit requestId as operationId;
concurrent lifecycle pending work cannot supply it implicitly. Paths, names,
branches, canonical intents, raw errors and secrets are excluded.

Admission and terminal ledger transitions append operation.* to the same outbox in
the same IMMEDIATE transaction. Precommit injection rolls back both. Failed drain
after commit retains the outcome and bounded outbox; another admission cannot
bypass backpressure. Retrying the original request reads its saved result without
mutation or duplicate events. Repeated drain preserves event identity and sequence.
Story commits will use this same primitive; no project configuration effects or
public registry flows are certified before those stories exist.

Full `npm test`: **207 PASS, 0 FAIL/CANCELLED/SKIP**;
[output](e1-regression.txt), [command/exit/duration](e1-regression.json).
Build/typecheck/architecture lint pass. The existing Foundation event crash matrix
is included. Limits stay 16 KiB/event, 64 KiB/outbox, 60 KiB/page, 1 MiB/client.

At the E1 checkpoint, E2 replay and E3 live/backpressure under registry workloads
were NOT_RUN. E2 qualification follows below; E3/V1 remain separate increments. This report does
not claim full feature acceptance, measured feature performance, or closure of
Foundation 001/T082 and 001/T085.

## E2 — mixed replay qualification (T082–T084)

2026-11-11. **E2 PASS**. Targeted checkpoint: **10 PASS**, 0 FAIL/CANCELLED/SKIP;
[combined output](project-event-replay-e2.txt). The four
[contract cases](project-event-replay-contract.txt) and six
[integration cases](project-event-replay-integration.txt) are overlapping views of
those ten cases, not additional independent runs to add to the count.

The existing EventRecord v1, operation.* taxonomy, SQLite outbox, journal,
readEventPage, event pump and client cursor are reused. This increment adds tests,
fixtures and evidence; it requires no runtime rewrite, new event type, new store,
public method or retention setting. REGISTER/VERIFY/UPDATE/REMOVE completions keep
scope, projectId, requestId as operationId, author instance, effect and exact decimal
configuration/observation revisions. Names, paths, ref names and raw errors are redacted.
A 200-record structured workload forces multiple whole-record pages below 60 KiB,
including cursor metadata; values above JavaScript's safe integer range stay strings.

### Earlier Foundation history and lifecycle

A frozen Foundation schema 2 fixture contains 41 persisted v1 journal records plus
its original sequence-42 outbox completion. The current client reads this full prefix
after the normal exclusive schema 3 upgrade and outbox recovery, then replays all
four actual registry operations through the daemon. Existing event IDs, storeId,
sequence and legacy payloads are preserved; the original journal byte prefix remains
identical. Saved cursors resume with exactly the suffix, including after daemon
restart. Offline replay preserves the complete archive and source snapshot.
[Raw samples](event-replay-samples.json).

This is a qualified frozen schema/record fixture, not a claim that an old binary was
executed. It demonstrates that the updated client reads earlier Foundation v1 records.
It does not promise that old clients understand schema 3 or new registry methods.

### Failed drain and retained gaps

Each of REGISTER, VERIFY, UPDATE and REMOVE is committed in the real SQLite adapter,
then a post-sync journal allocation checkpoint fails. The terminal result remains
SUCCEEDED with the original immutable snapshot; observability is degraded and the
bounded outbox remains pending. Replay honors the committed journal high-water mark
rather than exposing an unacknowledged tail. Reopening through the production storage
worker and draining twice produces exactly one original completion (same seq/eventId).
A subsequent confined offline read gives the same records without modifying files.
These are explicit fault injections, not physical disk failures.

Real journal rotation with an injected 16 KiB segment/64 KiB archive budget advances
the retention floor. Expired cursors receive CURSOR_EXPIRED with verified storeId,
firstAvailable, highWater and reread-status; no implicit reset/skip is allowed.
Rotation overtaking an active paged event pump closes replay after the last delivered
sequence with the same explicit gap. Allocated journal bytes stay within that fixture
budget and authoritative project outcomes remain intact. Production 64 KiB segments,
40 MiB journal, 16 KiB/event, 64 KiB/outbox, 60 KiB/page and 1 MiB/client are unchanged.
This scaled retention test is correctness evidence, not performance qualification.

The [initial contract run](project-event-replay-contract-initial.txt) retained a fixture
assertion failure: normal read transactions in an active writable SQLite connection
can update existing SHM read marks. Corrected live-fixture checks compare durable
DB/WAL/journal/log bytes. Offline checks use the confined reader and compare every
file without exclusions. No production safety rule was relaxed for this correction.

### Reproducible checks and remaining gates

```sh
npm run build:test
caffeinate -i node --test --test-concurrency=1 dist-tests/tests/contract/project-event-replay.test.js dist-tests/tests/integration/project-event-replay.test.js
npm run typecheck
npm run lint
caffeinate -i npm test
```

Build/build:test, [typecheck/architecture lint](e2-static-checks.txt): PASS.
[Ordinary regression](e2-regression.txt): **358 PASS**, 0 FAIL/CANCELLED/SKIP,
exit 0; [command/exit/duration](e2-regression.json). The ordinary run also covers existing
Foundation replay, journal integrity/budgets, stream handoff and story regressions;
it does not replace E3 registry callback/cursor/live qualification or V1 load tests.

E3/T085–T087, V1/T088–T091 and final review/acceptance T092–T096 remain open.
Foundation 001/T082 second UID/machine is still NOT_RUN; 001/T085 complete IP-denied
acceptance remains OPEN. No feature performance target or release gate is promoted
to PASS by this checkpoint. No publication or next phase is implicitly authorized.

## E3 — registry streaming (T085–T087)

2026-11-11. **6 PASS**, 0 FAIL/SKIP/CANCELLED in [project-stream-e3.txt](project-stream-e3.txt).
Actual clients preserve scoped payload/revisions and advance lastReceived only after
the application callback succeeds. Callback failure and rejected frame retain the
previous cursor; no reconnect/control/new intent is issued. The new gap test exposed
that the transport accepted increasing but non-contiguous sequences. The one-line
transport check now requires exactly lastApplied+1; [initial evidence](project-stream-contract-red.txt).

Ten actual authenticated observers replay then receive all four committed registry
actions; the eleventh is BUSY. Disconnect leaves the daemon running; saved cursor
resumes across explicit restart and stop closes sessions. A real pending post-sync
outbox tail is withheld until drain acknowledgement. A stalled actual observer is
evicted while a healthy observer reaches high water and status remains usable;
reported peak buffers stay <=1 MiB/client. The load events in that slow-client test
are synthetic scoped drafts, not additional executed project mutations. Callback
and malformed-peer tests use controlled local peers; mutation streaming uses real Git.
Existing pump/daemon limits and event taxonomy are unchanged. V1 and final acceptance
remain separate; this checkpoint does not certify their thresholds.
