# Diagnostics acceptance / T079

Result: PASS for the automated Foundation surface. No multi-user PASS is implied.

`npm run build`, `npm run build:test`, and the focused diagnostic/domain/protocol/
authorization suite passed: 18 tests, zero failures or skips.

All 23 catalog codes expose bounded safe text, an explicit enumerated category,
operation correlation, retryability, cause and persistence status. The new category
field fixes an omission found by the FR-020 review; the focused assertion was RED
with category undefined before the catalog correction and GREEN afterwards.

Real daemon requests reject protocol major 2 and deny the public capability access
to internal.prepareStop. The denied request is audited without persisting its raw
password sentinel. Diagnostics, events and human/JSON output expose no environment
sentinel or client credential. Offline reads preserve the authoritative database
byte-for-byte; reads on an absent archive do not initialize it.

ENOSPC/SQLITE_FULL, read-only and I/O causes use controlled fault classification,
not a physically filled disk. A controlled launcher exit before acceptance returns
CORE_EXITED_BEFORE_ACCEPTANCE with persisted=false and no archive creation. Existing
integration tests separately cover native write rejection and actual worker loss.
This does not certify power-loss or physical media failures.

Intermediate test defects were retained in the session execution log: an incorrect
RPC response type, then an assertion looking for error.code instead of the current
data.code rejection payload. Both were corrected before the 18-test PASS. The RPC
data.code compatibility surface is unchanged; public SafeError adds category.

Samples: [diagnostics-samples.json](diagnostics-samples.json). Software is package
0.1.0, schema 2, Node 26.13.0; no schema migration, credentials or thresholds changed.