# Real local-access runner

T078 defines the harness; T082 is PASS only after a real second-UID run and
the separate remote-machine check. Missing infrastructure is NOT_RUN, not PASS.
Never create accounts, change permissions, copy capabilities, or invoke privilege
escalation automatically. Root and hostile processes with the owner's UID are out
of scope. Use accounts provisioned by the runner administrator.

## Owner Session

Build with `npm run build && npm run build:test`. Choose an absent archive directly
under `/private/tmp` so its parent is searchable by the second account. Start it with
`node dist/cli/main.js daemon start --state-dir ARCHIVE --json` and save storeId,
instanceId and revision. Obtain the endpoint from the owner's runtime descriptor;
do not expose any credential. Keep the daemon running during both probes.

## Second Account Session

The administrator must provide a readable build and Node runtime to the second
account. Log in normally as that account and run from the build directory:

```sh
MAESTRO_LOCAL_ACCESS_ARCHIVE=ARCHIVE MAESTRO_LOCAL_ACCESS_ENDPOINT=ENDPOINT \
  node --test dist-tests/tests/acceptance/local-access.test.js
```

The second-UID test must run, not skip. Preserve TAP output and the diagnostic with
both numeric UIDs. It requires EACCES for capability reads and socket connections,
and UNAUTHORIZED for public reads. The owner then verifies unchanged instanceId,
revision and lifecycle. Permission-denied reads must not modify the archive.

## Separate Machine

On the owner machine, record `lsof -nP -a -p PID -iTCP -sTCP:LISTEN`: exit 1 and
empty output demonstrate no TCP listener for this daemon. On a genuinely separate
machine, verify the owner's endpoint is not present in that machine's filesystem
and a local UDS connection cannot reach it. Record host identities, command output
and time. Do not substitute localhost, a mock UID, or a transport stub. This is not
a firewall or root-resistance claim, and SSH forwarding is outside the protocol.

## Finish

The owner explicitly stops the daemon and verifies STOPPED/ABSENT_VERIFIED. Preserve
the results in `specs/001-core-background-daemon/reports/local-access.md`, including
any failure, skipped probe or missing remote machine. No destructive cleanup is
required by this procedure.