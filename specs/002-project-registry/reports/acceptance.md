# Feature 002 — cross-artifact acceptance audit

2026-11-11. Final local verification and release readiness are distinct. A real
second UID/separate-machine runner is not configured in this environment. No account,
credential, permission change or mock can replace that Foundation gate.

## Architecture (T092)

The AST checker enforces OS/SQLite/core-policy boundaries for domain/client across
static, exported, dynamic and require imports. It additionally rejects provider SDK
and Electron imports in the headless client. Core registry handlers depend on typed
ports/execution context; storage/OS effects remain adapters/composition roots.
Same daemon, schema 3 SQLite writer/outbox/journal and local IPC are used throughout.
No provider/Discovery/runtime/worktree/dependency executor or Electron module or
runtime dependency was added. The runtime dependency remains better-sqlite3.
The native confined read helper is transient, not another background service/store.

## Requirement mapping (T095)

PASS below means the cited local behavior has evidence; external/global gates are
explicitly separate. Current complete IP-denied campaign outcome is recorded below,
not inferred from individual local runs.

| Requirement | Evidence / qualification |
|---|---|
| FR-001 commands/parity | US1–US4 API/CLI contracts and acceptance reports |
| FR-002 valid empty/detached repositories | G1 inspector and US1/US3 unborn/detached/first commit integration |
| FR-003 identity/equivalent checkouts | G1 and US1 main/linked/bare-common/clones/nested/submodule tests |
| FR-004 single active project/reference | 20 concurrent imports, 100 identical retries, immutable first reference; US1 |
| FR-005 name validation/IDs | unit Unicode/control/name tests, US3 atomic rename/CAS, duplicate names allowed |
| FR-006 optional/local base | US1/US3 omitted/null/explicit, remote-only/unborn invalid, detached and first commit |
| FR-007 configuration only | US3 full source snapshots, no checkout or Git write |
| FR-008 partial facts/reference scope | G1/US2 nullable metadata, explicit reference, submodule limits |
| FR-009 historical/read-only views | US2 complete archive snapshots, native confined SQLite, no sidecar/repair/autostart |
| FR-010 verify without rebind | US2 moved/denied/replaced/linked fixtures and observation-only CAS |
| FR-011 uncertain/changed proof | G1 safe fail-closed capability, ref/config/topology race tests and final anchors |
| FR-012 revision-bound mutations | US3/US4 two-client races, verify does not consume config revision |
| FR-013 immutable operation identity | global catalog/cross-scope conflict, 100 retries, offline historic results |
| FR-014 atomic crash state | 30 REGISTER/UPDATE/REMOVE SIGKILL cases; six VERIFY cases additional |
| FR-015 client independence/no autostart | coordinator/lifecycle, disconnect/timeout, stopped read and mutation refusal |
| FR-016 registration-only remove | US4 dirty/conflicted/main/linked/absent source snapshots, tombstone/no cleanup |
| FR-017 no executable repository authority | qualified Git confinement, filters/helpers/hooks sentinels, no remote/project execution |
| FR-018 auth/errors | private UDS/token/role, ID/revision validation, safe errors; real second-UID/machine Foundation gate NOT_RUN |
| FR-019 observable confirmed operations | E1 atomic ledger/outbox, E2 replay/gap, E3 applied contiguous cursors/slow client, V1 pressure |
| FR-020 no Discovery/AI/work | architecture/source audit; registration only confirms local context |
| NFR-001 local-only | all local stories/UDS; verified IP-denial campaign required separately |
| NFR-002 dated evidence | LAST_KNOWN observations, captured revisions and intervals; no future readiness promise |
| NFR-003 bounded work/resources | 4 probes/32 pending/33rd BUSY, 28 s core deadline, 26 s probe budget, 10 s stop, separate V1/idle measurements |
| NFR-004 redacted diagnostics | structured allowlists, no raw stderr/name/path/content/environment; sentinel and oversized-output tests |
| NFR-005 source/resource preservation | source snapshots, constrained read queries, owned-process exit/lifelines, no lock adoption or PID-only cleanup |
| SC-001 CLI/local scenarios | all 23 scenarios below; network-denied whole-suite outcome remains its own gate |
| SC-002 read latency | 100 projects/1,000 full paginated reads/10 clients; p95 76.14 ms, max 84.48 ms, zero errors |
| SC-003 inspection latency | 30 attempts, 10 branches/100 commits, inaccessible/slow reference; p95 672.87 ms, max 26.08 s, one explicit deadline |
| SC-004 concurrency/idempotency | 20 equivalent imports/100 retries; register-concurrency-samples.json and US1 |
| SC-005 crash recovery | mutation-crash-summary.json: 30 actual SIGKILL cases, >=10 per mutation; no lost confirmed state/partial result |
| SC-006 Git safety | G1/source snapshots, hostile metadata/filter/hook sentinels, deadline/cancellation tests; no application Git mutation |
| SC-007 zero unauthorized/stale effects | cross-scope/role/revision and update/remove/verify races; no automatic new intent |
| SC-008 preservation | all confirmed fixture IDs/configurations retained; US2 preservation samples, US4 old/new UUID and offline reads |
| SC-009 correlation/redaction | E1/E2/E3 scoped request/project/revision and one completion; explicit degraded outbox, sentinel tests |

### All 23 story scenarios

| Scenario | Evidence |
|---|---|
| US1.1 existing repository/context, zero writes | project-register integration/acceptance, us1.md |
| US1.2 equivalent path preserves registration | aliases/subdirectory integration and original-result retry |
| US1.3 concurrent equivalent import | 20-import acceptance campaign |
| US1.4 invalid/inaccessible/non-Git | register contract/integration and no partial rows |
| US1.5 dirty/untracked/conflicted | complete source snapshots and unsafe file-status UNKNOWN |
| US1.6 empty repository/no base | unborn metadata and CLI acceptance |
| US1.7 main/linked reference fixed | common identity/first checkout tests |
| US2.1 rediscover after restart/disconnect | read-verify integration/acceptance and lifecycle |
| US2.2 offline historical list/get | complete no-write archive snapshots, readonly confinement |
| US2.3 moved/deleted/inaccessible checkout | moved/denied integration and no recreation |
| US2.4 dated get, no implicit Git | fixed DTO/date across restart/offline |
| US2.5 changed/uncertain identity | replacement/refs/topology races, no rebind |
| US2.6 linked reference removed, common alive | linked integration/acceptance, no fallback |
| US3.1 local branch selection without checkout | real detached/dirty source snapshots |
| US3.2 detached/no implicit base | null versus explicit valid local base |
| US3.3 missing/remote-only/unborn rejection | atomic name/base failures, no partial rename |
| US3.4 two clients/revision conflict | one winner, conflict, configuration revision 2 |
| US3.5 deleted base retained INVALID | update/verify integration and no substitution |
| US3.6 first external commit preserves null base | explicit first-base integration |
| US4.1 remove only registration | dirty/conflicted/linked/absent complete source snapshots |
| US4.2 lost reply/identical retry | actual crash pre/post commit/ACK and original result |
| US4.3 wrong/stale target | no effect on other project, explicit error |
| US4.4 reimport/new UUID/old retry | contract, concurrent import+retry, CLI/restart/offline |

Edge cases covered include Unicode/invalid scalar/control/name limits; aliases,
symlinks, shared/bare common repository, independent clone/nested/submodule identity;
SHA-256 OIDs; unborn/detached/missing commits; unsupported/hostile filters/config/index;
unknown/changed anchors and no fallback; malformed/foreign/expired/future cursors;
config/observation/remove races; ledger conflicts; FULL/IO/worker loss; FIFO timeout;
blocked drain, retention and slow consumers. All fixture mutation/setup commands are
explicit test setup inside owned temporary roots, not application authority.

## External gate semantics

002 FR-016 (registration removal) is locally qualified. It must not be confused with
001 FR-016/T082 (real distinct UID and separate machine), which is not available.
The administrator-provisioned procedure is in tests/fixtures/multi-user-runner.md.
No automatic account creation/escalation is authorized or needed for local development.
T093 must stay unchecked if this gate is missing, even if every available test passes.
A completed final review may therefore report BLOCKED without hiding a skip/failure.

T092 architecture verification: **PASS**. Typecheck and lint pass; both AST/import
contract tests pass, including provider SDK and Electron negative fixtures and the
real source tree. [Output](architecture-final.txt). No extra runtime package or
service was introduced. T091 V1 and both independent 600-second idle observations
pass; actual samples are in performance.md. These are separate from T093 below.

## T093 — final verification attempts

**BLOCKED / task remains unchecked.** [Structured commands/exits/counts](final-verification-runs.json).

| Campaign | Result |
|---|---|
| Native npm test | 367 PASS, 0 FAIL/SKIP/CANCELLED |
| Separate native test:contract | 101 PASS, 0 FAIL/SKIP/CANCELLED |
| Separate native test:integration | 207 PASS, 0 FAIL/SKIP/CANCELLED |
| Complete native test:acceptance | 53 PASS, 0 FAIL/CANCELLED, 1 SKIP (real UID NOT_RUN), exit 0 |
| IP-denied build/typecheck/lint | all exit 0 |
| IP-denied ordinary runtime attempt | interrupted after repeated platform failures; 58 PASS / 44 FAIL / 70 CANCELLED; exit 130 |
| Separate IP-denied contract/integration/full acceptance | BLOCKED_NOT_RUN under this incompatible outer profile |

The complete native acceptance takes its own real idle observation; it also executes
100 concurrent-start rounds, 100 restart retries, event load/retention/corruption,
slow observer, the 002 workload and all story CLI acceptances, plus Foundation's
30 crash/recovery cases and 1,000-record/ten-auxiliary recovery. All available native
cases pass. The mandatory real second-UID case explicitly skips, so this is not
full access/release acceptance despite exit 0. Timings/failures are retained.

The scoped [IP profile](../../../tests/fixtures/ip-denied.sb) denies loopback bind
and connect with EPERM, including a child, while its outside positive bind succeeds:
[ip check](ip-denial-check.txt), [positive control](ip-positive-control.txt).
However macOS rejects nested sandbox_apply and ps execution inside the outer profile:
[nested probe](nested-sandbox-check.txt), [process probe](sandbox-process-check.txt).
This prevents the required qualified OS confinement/identity/readonly helpers; no
fallback or privilege change was added. The inherited campaign was interrupted via
its owned tool session after reproducible repeated failures. Raw cancelled tests
remain in [ordinary-ip-denied.txt](ordinary-ip-denied.txt), never relabelled PASS.

Native reruns and standalone Git confinement qualify the available behavior, not
the missing complete IP-denied campaign. Foundation 001/T082 real UID/machine and
001/T085 remain open. No accounts, capabilities, global firewall rules or permissions
were changed to manufacture a pass. A final read-only process audit found no daemon
entrypoint processes for this workspace after the interrupted campaign.

Documentation/coverage/readiness review proceeds after this recorded blocked attempt
as requested, without waiving its runtime dependency or checking T093 off. Review
can complete with BLOCKED; release cannot. See release-readiness.md for next actions.

## T095 — coverage review complete

[Machine-audited mapping](coverage-audit.json): all 20 FR, 5 NFR and 9 SC IDs
and all 23 story scenarios are mapped. Latest native artifacts retain 30 distinct
actual mutation SIGKILL cases (ten/action), 20 equivalent concurrent imports,
100 identical retries, one active project and unchanged original configuration.
US2 preserves 100% of confirmed fixture configurations; US3/US4 source snapshots
are unchanged. Event/log/error sentinel and no-authority cases pass in the local
suites. These are assertions of the exercised cases, not a proof over arbitrary
inputs or a waiver of external gates. T093 remains OPEN; NFR-001/full IP-denied
and Foundation real-UID/machine verification remain unaccepted globally.
