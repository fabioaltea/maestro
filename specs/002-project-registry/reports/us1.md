# US1 — registration MVP checkpoint

2026-11-10. **US1 PASS** for all seven acceptance scenarios on the qualified local
macOS/APFS/Node/Git profile. T001–T047 complete, one local commit per task.
No push, deployment, provider, project dependency execution or UI is included.

## Available behavior

CLI/API register an existing checkout, show confirmed configuration/dated observations,
and query the original operation. Main/linked/bare-common identity dedup preserves the
first reference/name/base/observation. Empty/unborn/detached, dirty/untracked/conflicted,
clones, nested repositories, submodules, SHA-256, Unicode and unsafe file-status
configurations are covered. Invalid explicit base is rejected even for a duplicate.
Git/source snapshots remain identical; status UNKNOWN never becomes false clean.

`project add`, `project show`, `project operation` are in the compiled CLI. Show/outcome
work offline with LAST_KNOWN and no autostart/upgrade/repair/sidecar creation. Client
intent UUID survives timeout/invalid observation, and accepted work survives transport
closure. Successful registration does not authorize future Git/agent operations.

## Evidence

- Full ordinary regression: **260 PASS, 0 FAIL/CANCELLED/SKIP**;
  [output](us1-regression.txt), [command/exit/duration](us1-regression.json).
- Registration slice: **28 PASS**, including contracts/unit/real Git/core and ten
  actual SIGKILL cases plus FULL/IO failures; [output](project-register-slice-green.txt).
- SC-004: **20 simultaneous equivalent imports**, one CREATED/nineteen EXISTING;
  **100 identical retries** in ten waves of ten, original snapshot retained, no new
  probes/configuration/events. Cross-scope conflicts and disconnect pass;
  [samples](register-concurrency-samples.json), [output](project-register-concurrency.txt).
- Ten REGISTER crashes: [samples](register-crash-samples.json), [recovery report](recovery.md).
  No partial effect, lost confirmed result or automatic rerun. Native SQLITE_FULL is
  a real page-allocation limit; IO is explicit injection, not physical disk failure.
- Independent CLI acceptance: twelve checkout inputs/eleven project IDs, separate
  client processes, restart and offline inspection. SHA-256/empty/dirty/conflicts/
  main+linked/common-bare/nested/submodule/unsafe status preserve complete source
  snapshots and zero helper marker; [output](project-register-acceptance.txt).

## Scenario mapping

| US1 scenario | Evidence |
|---|---|
| 1: complete context / no writes | project-register.test (integration+contract+acceptance), core test |
| 2: aliases/subdirectory, unchanged config | real Git integration; SC-004 and immutable UUID unit |
| 3: concurrent first import | integration + 20-import acceptance |
| 4: invalid/inaccessible/non-Git | integration; safe errors/no partial SQL rows |
| 5: dirty/untracked/conflict | integration + CLI snapshots, unsafe status remains UNKNOWN |
| 6: unborn/no configured base | unit, integration and independent CLI |
| 7: linked reference remains first | integration + concurrent aliases + CLI identity check |

## Remaining scope

This is US1, not full feature or release acceptance. US2–US4, their crash campaigns,
E2/E3/V1 and feature SC-002/003/005/008/009 still require their dedicated tasks.
The timings here are regression/qualification samples, not the full workload
performance qualification. Foundation 001/T082 is NOT_RUN and 001/T085 remains
OPEN; neither is simulated as PASS or a development blocker. Release remains gated.
