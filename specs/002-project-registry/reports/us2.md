# US2 — retained registry and explicit verification

2026-11-10. **US2 PASS**. US2 implements T048–T059 on the qualified local macOS/APFS profile.
`project list`, `project show`, `project verify` and `project operation` use the
same daemon, schema 3 store, authentication and journal as US1/Foundation.

## Behavior and consistency

List/get report confirmed configuration with a dated LAST_KNOWN observation.
LIVE on the envelope means a live registry read, never a new Git inspection.
Stopped-archive queries use the confined read-only SQLite port without Git,
autostart, migration, journal drain, sidecar creation or checkout recreation.
Pages contain at most 100 whole records and stay below 60 KiB including envelope
reserve. Cursors bind store, registry revision and last project ID; a visible
change requires REGISTRY_CHANGED/restart-list. No transaction spans pages.

Verify uses only the original reference/common identity and captured configuration
and observation revisions. Two confined observations and final anchor checks
reject mixed ref/topology evidence. An older concurrent result cannot overwrite
an already published observation. The atomic commit updates observation, terminal
operation and outbox together, preserving all configuration fields/revisions.

A saved observation can report UNAVAILABLE, CHANGED or UNVERIFIED, nullable facts
and a safe cause/nextAction. SUCCEEDED/OBSERVED confirms persistence; it does not
certify positive Git availability or authorize future Git operations. The CLI
returns exit 0 for saved observations and directs human readers to project show
for availability/error details. Unknown/failed persistence is never reported as
OBSERVED. A first external commit never configures a previously absent base;
a deleted configured branch remains configured and is observed INVALID.

## Scenario coverage

| US2 scenario | Evidence |
|---|---|
| 1: preserve IDs/config after restart/disconnect | integration read-verify, lifecycle, CLI acceptance |
| 2: stopped-daemon historical reads, zero writes | offline-list, read-verify integration, native readonly confinement and CLI snapshots |
| 3: moved/deleted/inaccessible reference | moved/denied integration and linked-reference acceptance; nullable facts and safe errors |
| 4: saved dates, no implicit Git | unchanged dated DTOs before/after restart and offline pages/detail |
| 5: changed/uncertain identity, no rebind | replacement integration, ref/topology race tests and final anchor checks |
| 6: missing linked reference, common still present | linked integration/acceptance, unchanged common checkout and no fallback |

SC-008 passes for the exercised fixtures: all three confirmed project IDs and
configurations survive restart and unavailable reference (100% preservation),
with dated historical/unverifiable observations and zero offline writes/autostarts.
[Raw preservation samples](us2-preservation-samples.json). No unbounded-population
claim or future approval/readiness is implied by these samples.

## Validation evidence

- [Functional slice](us2-functional.txt): **14 PASS**.
- [Storage/CAS](us2-storage.txt): **3 PASS**; [races](us2-races.txt): **3 PASS**.
- [Verification policy](us2-verify.txt): **2 PASS**;
  [direct offline projection](us2-offline.txt): **1 PASS**.
- [Lifecycle, outbox, native read-only and large-page checks](us2-recovery.txt):
  **14 PASS**; [client/error contracts](us2-client-errors.txt): **8 PASS**.
- [Actual SIGKILL campaign](us2-crash.txt): **6 PASS**,
  [samples](verify-crash-samples.json), [recovery findings/fixes](recovery.md).
- [CLI acceptance](us2-acceptance.txt): **1 PASS**, independent client processes,
  restart and complete archive/source snapshots; missing linked reference is not recreated.
- [Corrupt/inaccessible archive regression](us2-corrupt.txt): **1 PASS**.
- [Typecheck and architecture lint](us2-static-checks.txt).

The initial [ordinary regression](us2-regression-initial.txt) has **289 PASS / 1 FAIL**:
the newly added corrupt-archive fixture omitted existing lease scaffolding, so the
safe reader correctly refused an unproved quiescent view before reaching SQLite.
The corrected fixture starts with a complete initialized archive and then corrupts
its bytes; it reports STATE_CORRUPT without writes. The initial failure is retained.
The final full rerun is **290 PASS, 0 FAIL/CANCELLED/SKIP**, exit 0, including
build/build:test and all unit/contract/integration tests. It is recorded in [output](us2-regression.txt) and
[command/exit/duration](us2-regression.json).

## Limits and remaining work

Reference-only file status and submodule limitations remain explicit. The 105-project
synthetic page check tests byte/count correctness, not SC-002 performance. Test
execution durations and bounded stop/status checks are evidence for those cases;
SC-002/003 workload targets and the combined 002 idle qualification remain T089–T091.
No threshold is promoted to a measured general guarantee.

US3 configuration and US4 registry removal, their crash campaigns, and E2/E3/V1
qualification remain open. Existing Foundation 001/T082 real second UID/machine is
NOT_RUN and 001/T085 complete IP-denied acceptance remains OPEN; release readiness
is still gated. No push/publication, provider, Agent Runtime, dependency execution,
worktree management or Electron is included.
