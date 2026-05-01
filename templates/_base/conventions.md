# Project Conventions (Base)

These are the default conventions inherited by every engineer agent. The Architect or individual engineers may extend or override them in their own `.md` files (or by promoting learnings here via git commits).

## Code Quality
- Prefer clarity over cleverness.
- Small, focused functions; meaningful names.
- No dead code, no commented-out blocks.
- Comments only when the *why* is non-obvious.

## Version Control
- One feature per branch: `feature/<task-id>-<slug>`.
- Conventional Commits: `feat(scope): summary`, `fix(scope): ...`, etc.
- Never amend a published commit.
- Never force-push without explicit user approval.

## Testing
- New behavior gets tests. Bug fixes get a regression test when feasible.
- Run the relevant test suite before marking a task done.

## Docs
- If implementation diverges from `docs/`, call `update_docs` with the deviation reason.

## Safety
- Destructive shell commands (rm, drop, force-push, etc.) require explicit approval.
- Never commit secrets.
- Validate input at system boundaries; trust internal code.

## Cross-Agent
- Never call another engineer directly. Use `request_cross_agent_change`.
- Block your task when waiting on another agent; resume when unblocked.
