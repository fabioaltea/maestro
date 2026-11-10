# Schema 3 — T022

2026-11-10. Fresh stores now use schema 3 in the existing Foundation database.
Registry tables, active-identity partial uniqueness, independent pending index,
retained tombstones, immutable identity/intents/terminal outcomes and global request
catalog are present. Current Foundation fixtures use SCHEMA_VERSION; the explicit
historical Foundation v2 fixture stays frozen for migration qualification.

Build, typecheck and architecture lint PASS. Existing ordinary suites plus pure
domain tests: **175 PASS, 0 FAIL/CANCELLED/SKIP**, [captured output](schema3-existing-regression.txt)
and [exact selected command/exclusions](schema3-existing-regression.json).
The three new RED contract files for storage, upgrade and protocol are explicitly
excluded pending their implementation; this is not a full npm test PASS.
Fresh-schema upgrade contract was also run independently and passes.

The [first regression](schema3-existing-regression-sleep-interrupted.txt) had
174 PASS and one start timeout. macOS pmset log records Maintenance Sleep at
2026-11-10 17:51:04 +0100 and wake at 17:54:05 (181 seconds), matching the delayed
35-second timer. Isolated daemon-start rerun: 2 PASS. The complete selected rerun
uses a temporary caffeinate -i assertion and passes; no timeout was increased.

Upgrade/admission/RPC are not complete at this checkpoint. No registry CLI is enabled
and no full feature acceptance or performance target is claimed.
