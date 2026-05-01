# Engineer Tools (Base)

Every engineer has access to the following tools. Specialized agents may have extras declared in their own `## Tools` section.

## Filesystem
- `read_file(path)` — read a file from the repository.
- `write_file(path, content)` — create or overwrite a file.
- `edit_file(path, old, new)` — exact-match string replacement.

## Shell
- `run_shell(command)` — execute a shell command. Approval policy applies (auto / prompt / gate).
- `run_tests(scope?)` — run the project test suite (optionally scoped).

## Git
- `git_status()` / `git_diff()` / `git_commit(message)`
- `git_checkout(branch)` / `git_create_branch(name)`

## Coordination
- `ask_user(question)` — non-blocking; queued for next user attention.
- `request_cross_agent_change(target_area, description, blocking)` — escalate to the Architect.
- `update_docs(file, changes, deviation_reason?)` — record a deviation from spec.
- `update_learnings(content)` — append to your own `## Learnings` section.
- `report_failure(reason, last_state)` — invoke triage.

## Approval Policy
Commands fall into three buckets:
- **safe** → auto-approved by default
- **destructive** (rm, drop, force-push, etc.) → prompt the user
- **network** (pushes, deploys, external APIs) → prompt the user

Project-level overrides live in `.maestro/config.yaml` under `approvals`.
