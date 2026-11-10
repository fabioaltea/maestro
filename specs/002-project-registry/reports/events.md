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

E2 replay and E3 live/backpressure under registry workloads remain NOT_RUN, to be
qualified as separate increments after all story actions exist. This report does
not claim full feature acceptance, measured feature performance, or closure of
Foundation 001/T082 and 001/T085.
