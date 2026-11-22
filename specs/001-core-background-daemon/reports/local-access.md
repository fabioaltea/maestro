# Local access acceptance / T082

Overall result: NOT_RUN. FR-016 and US4-A4 are not certified. This required gate
blocks full feature acceptance and release readiness.

The user confirmed that neither a preconfigured second UID nor a separate machine
is available. No account, permission change, privilege escalation, credential copy,
remote connection or simulated PASS was attempted.

Automated owner-session checks pass: private archive/runtime directories 0700,
state/credential/socket files 0600, real UID ownership, a real UDS endpoint and no
TCP listener for the daemon PID (`lsof`, exit 1, empty stdout/stderr).
The distinct-UID test is explicitly skipped with NOT_RUN, not treated as evidence
that a real second user was refused.

Focused execution: local-access.test.js has 1 PASS, 1 SKIP, 0 failures. Combined
architecture/platform/identity execution has 9 PASS, 1 SKIP, 0 failures.

To close this gate, follow
[multi-user-runner.md](../../../tests/fixtures/multi-user-runner.md): run the
second-UID test without a skip, preserve numeric owner/requester UIDs and real
EACCES/UNAUTHORIZED results, record the separate-machine probe, then verify unchanged
owner instance/revision and a verified stop. Owner permissions and authentication
tests alone cannot substitute for this acceptance run.

Consolidation of the remaining available checks and documentation despite this
missing runner was explicitly authorized. That does not waive FR-016 or lower
any acceptance threshold. T082 remains unchecked.