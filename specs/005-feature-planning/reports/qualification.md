# Qualification005

Date2026-11-19. G0 synthetic PASS, official G1 BLOCKED by004/T028/T050. Runtime availability remains false until official authentication and the composed capability qualify.

## T004 — real pinned CLI, synthetic backend only

`MAESTRO_FEATURE_G0=1 MAESTRO_DISCOVERY_G0=1 node --test --test-concurrency=1 dist-tests/tests/integration/feature-boundary.test.js dist-tests/tests/integration/discovery-provider-boundary.test.js`:12PASS,0FAIL,0SKIP in2197ms. Includes unchanged shipped readonly OS profile, denied protected reads/writes/symlink/exec and injected tools, hostile config, real pin hash, closed argv/env, plus feature DRAFT through the real CLI and localhost synthetic Responses backend. Project/fixture snapshot unchanged. Fixture-only fake auth is not exposed in production.

The new result schema/parser is a data boundary, not authority; source/answer provenance is checked and approvals/commands rejected. Model validity and semantic quality are not established by synthetic completion. The test schema intentionally accepts a bundle object which the core parser then validates strictly; this does not relax runtime permissions.

Pin/version/policy: exactly the existing004 constants in src/providers/codex/argv.ts and shipped provider.sb; no binary, package, login/profile or production authentication change. Pin checked by SHA256 in each real-cli test. Official Keychain precheck004 was PROVIDER_UNSAFE before inference; no inference to official backend, token extraction, API key or fallback attempted.

Authoring/data gate can proceed. Assisted generation must remain unavailable in production unless its separate runtime/auth checks pass. Test substitutes do not create approved production Discovery.
