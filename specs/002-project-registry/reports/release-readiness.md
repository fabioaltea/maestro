# Project Registry release readiness

2026-11-11. **BLOCKED**. Implementation, local qualification and final review do not
waive mandatory acceptance gates. **T093 remains open**; no release, push, merge,
deployment or next feature is authorized by this report.

| Gate | Result | Evidence |
|---|---|---|
| Constitution and architecture | local PASS | architecture-final.txt; no provider/UI/runtime/dependency executor; headless port boundaries |
| G1 Git safety/confinement | qualified local PASS | git-confinement/repository inspector reports and source snapshots |
| S1 schema/ledger | local PASS | registry upgrade, global immutable intents, CAS, tombstones and read-only confinement |
| US1–US4 | local PASS | us1.md, us2.md, us3.md, us4.md; all 23 scenarios mapped |
| SC-004 | local PASS | 20 equivalent imports / 100 retries; original configuration/reference retained |
| SC-005 | local PASS | >=30 actual mutation SIGKILL cases, >=10 each REGISTER/UPDATE/REMOVE; VERIFY additional |
| E1 | local PASS | atomic state/result/outbox and redaction |
| E2 | local PASS | mixed replay, schema-2/v1 history, retention/gap and recovered exactly-one completion |
| E3 | local PASS | applied contiguous cursor, callback rejection, ten observers, <=1 MiB slow-client handling |
| V1 | qualified host PASS | 100 projects/1000 full reads/10 clients, 30 inspections and two separate 600 s idle observations |
| Final native ordinary suite | PASS | ordinary-native.txt: 367 PASS, no failures/skips |
| Separate native contract/integration | PASS | contract-native.txt: 101 PASS; integration-native.txt: 207 PASS |
| Build/typecheck/lint with IP denied | PASS | build-ip-denied.txt, typecheck-ip-denied.txt, lint-ip-denied.txt |
| Complete IP-denied runtime campaign | FAILED / interrupted, incomplete | ordinary-ip-denied.txt; nested-sandbox-check.txt and sandbox-process-check.txt |
| Foundation 001/T082 real second UID/machine | NOT_RUN | no provisioned runner; tests/fixtures/multi-user-runner.md |
| Foundation 001/T085 full IP-denied acceptance | OPEN | available native tests cannot substitute for the required campaign |
| Complete native acceptance | 53 PASS / 1 mandatory NOT_RUN skip | acceptance-native.txt |
| Final acceptance T093 | OPEN | final-verification-runs.json; partial/blocked stages remain explicit |

The IP-denial profile is effective: outside-profile localhost bind succeeds;
inside, bind and connection return EPERM, including a child. Under that same outer
profile macOS refuses nested sandbox_apply and ps execution. The application relies
on qualified OS confinement and process identity, so these failures are not bypassed.
The ordinary IP-denied run was stopped after repeated reproducible failures, retaining
58 PASS / 44 FAIL / 70 CANCELLED in the interrupted output. Separate contract,
integration and full acceptance under that profile are BLOCKED_NOT_RUN, not green.
No production fallback, target increase or test exclusion was introduced to hide this.

Complete native acceptance has **53 PASS, 0 FAIL/CANCELLED, 1 SKIP** (real UID
NOT_RUN), exit 0; exact run metadata is in final-verification-runs.json.
A real UID/machine skip never becomes PASS merely because a test command exits zero.
The 001/T082 and 001/T085 checkboxes remain open. Final coverage review can complete
with BLOCKED readiness; it cannot mark T093 complete or authorize publication.

## Required next actions

1. Provide an administrator-provisioned distinct UID and genuinely separate machine,
   run the documented access checks and retain both numeric UIDs/host identities,
   denied reads/connections and unchanged owner state. Do not simulate or create an
   account automatically.
2. Run complete applicable runtime/acceptance verification with actual IP denial in
   an environment where required OS confinement and process identity measurements
   remain available. Preserve all errors/skips; a native rerun alone cannot close it.
3. Resolve any remaining runtime failures, rerun the relevant gates, then reassess
   T093 and release readiness. This requires no new feature/provider/UI implementation.

Performance numbers describe measured runs on this macOS/APFS host; they are not
cross-platform/unbounded-scale guarantees. Resource/retention budgets are unchanged.
All source changes stay on the local 002 branch with per-task commits; publication
and destructive Git actions remain separately authorized operations.

## T096 final diff and evidence review

The review is complete with **BLOCKED** readiness. Code/runtime and local E3/V1
qualification are implemented; **95/96 tasks are complete, T093 remains unchecked**.
T094–T096 consolidate documentation/coverage/review after the recorded T093 attempt;
this does not satisfy or waive its runtime gate. No mandatory failure/skip is hidden.

Final source follow-up strengthens the AST client rule against direct filesystem,
process/worker and network imports as well as external SDK/Electron. The runtime
was unchanged by this review-only guard. Build:test, typecheck, lint and both
architecture contracts pass in [review-static-checks.txt](review-static-checks.txt).
The full native runtime campaigns preceded this development-check-only tightening;
367 ordinary and 53 available acceptance cases remain their recorded measurements.
The immutable manual AGENTS block is byte-equivalent to its baseline. Documentation
links and all 34 criterion/23 scenario IDs resolve/map; per-task local commits retain
both passing evidence and the failed/interrupted IP campaign. No release readiness
claim is inferred from a completed review or an exit-zero run with a mandatory skip.
