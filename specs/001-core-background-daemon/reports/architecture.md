# Architecture verification / T084

Result: PASS for AR-001/AR-002 Foundation boundaries. `npm run lint` reports
Architecture boundaries verified; architecture/platform-paths-lease/process-identity
contract files pass all 8 tests on macOS 26.3.1 arm64.

The combined run with local-access has 9 PASS, 1 SKIP, 0 failures. That skip is
T082 real second UID, not an architecture or OS-port PASS.

Evidence:

- Import checks reject OS, SQLite and core policy in domain/client across supported
  syntax forms; actual production imports pass.
- Read mode does not initialize an archive. Write mode creates canonical private
  directories/files; sensitive links, wrong permissions and unverified cleanup
  preserve the original files.
- The actual SQLite lease cannot be reopened by another factory in its holder or
  stolen by another process; no inode deletion or timeout-based ownership transfer.
- Controlled identity proofs test positive PID presence, denied probes, wrong
  generation and reused PID; none authorize signals. Exit proof uses the observed
  child handle.

Only `src/platform/macos/` exists beneath the platform implementation root. No
other OS adapter, provider, Agent Runtime, Git/worktree manager, project dependency
manager or UI was introduced. FoundationAuxiliaryRecovery remains a core decision
above process identity and transport ports, not a universal child-killing rule.

The explicit category addition in T079 remains in domain error serialization and
adds no OS or driver dependency. Package/runtime remain 0.1.0 / Node 26.13.0,
schema 2; architecture and platform requirements are unchanged.