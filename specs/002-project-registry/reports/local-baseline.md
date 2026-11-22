# Local baseline — 002/T003

Date: 2026-11-10 (Europe/Rome). Result: **PASS** for local development only.
Baseline source: e84e587; preparation/reordering commits df48016 and 80717e6.

| Command | Exit | Evidence |
|---|---:|---|
| npm run typecheck | 0 | [output](npm-run-typecheck.txt) |
| npm run lint | 0 | [output](npm-run-lint.txt) |
| npm test | 0 | [output](npm-test.txt) |

`npm test` builds production/test code and runs unit, contract and integration
suites: 126 tests, 126 PASS, 0 FAIL, 0 CANCELLED, 0 SKIP. Build succeeded as part
of that command. Timings and exact commands in [results](local-baseline-results.json).
These are local ordinary-suite results, not a rerun of complete IP-denied acceptance,
real cross-UID/separate-machine access or registry performance acceptance.
001/T082 remains NOT_RUN and 001/T085 remains FAIL/OPEN until new final evidence.
No source/test/package code changed for this baseline run.
