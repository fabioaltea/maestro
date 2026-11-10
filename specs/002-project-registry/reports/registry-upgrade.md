# T023 — exclusive schema upgrade

2026-11-10. **13 PASS**, including 11 upgrade cases and 2 existing daemon-start
regressions. [Captured output](project-schema-upgrade-green.txt).
Typecheck/build pass. Dedicated connection, both trusted live lease handles,
owner/path checks and bounded SQLite lock wait precede mutation. Unknown schema,
expired deadline, wrong lease scopes/owner/path and a conflicting writer reject.
Schema 3 is idempotent; explicit daemon start upgrades 2 before its normal writer.

Tests compare every Foundation row (including instances/resources/tickets/attempts,
storeId/revision/event sequences/outbox/high-water/floor), catalog hash and FK/integrity.
Injected precommit FULL/IO/BUSY errors roll back; real owned-child SIGKILL immediately
before/after commit yields valid 2 or valid 3 respectively. Injection is not a claim
of physical disk exhaustion/power-loss testing. No copied sqlite-only backup,
writable_schema, automatic downgrade or foreign-key disabling is used.

Readonly Foundation access accepts known 2 without upgrade. Registry-specific
uninitialized error remains an expected RED contract until worker T025. No full
feature acceptance is asserted here.
